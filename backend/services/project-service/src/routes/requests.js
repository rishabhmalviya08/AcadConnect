const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/knex');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../utils/errors');
const { getProjectStakeholderStudentIds } = require('../utils/projectStakeholders');
const { MAX_GROUP_MEMBERS } = require('../constants/groupLimits');

const router = express.Router();

const notifyUser = async (trx, { userId, type, title, message, metadata = {} }) => {
  await trx('notifications').insert({
    id: uuidv4(),
    user_id: userId,
    type,
    title,
    message,
    metadata,
  });
};

/**
 * POST /api/requests
 * Submit a mentorship request to a specific faculty member.
 * Student only. Only the project owner (creator) may submit a mentorship request.
 *
 * Body: { project_id, faculty_id?, faculty_name?, snippet? }
 */
router.post('/', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const { project_id, faculty_id, faculty_name, snippet } = req.body;
    if (!project_id || (!faculty_id && !faculty_name)) {
      throw createError(400, 'project_id and either faculty_id or faculty_name are required');
    }
    if (!snippet || typeof snippet !== 'string') {
      throw createError(400, 'snippet is required');
    }
    const wordCount = snippet.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount > 200) {
      throw createError(400, 'snippet cannot exceed 200 words');
    }

    let resolvedFacultyId = faculty_id;
    if (!resolvedFacultyId && faculty_name) {
      const matches = await db('users')
        .select('id')
        .where({ name: faculty_name, role: 'faculty' })
        .limit(2);

      if (matches.length === 0) {
        throw createError(404, 'Faculty not found');
      }
      if (matches.length > 1) {
        throw createError(409, 'Ambiguous faculty name. Please retry with faculty_id.');
      }

      resolvedFacultyId = matches[0].id;
    }

    const project = await db('projects').where({ id: project_id }).first();
    if (!project) throw createError(404, 'Project not found');
    if (project.status !== 'open') {
      throw createError(400, 'Mentorship requests can only be submitted for open projects');
    }

    if (project.creator_student_id !== req.user.id) {
      throw createError(403, 'Only the project owner can submit a mentorship request for this project');
    }

    if (project.group_id) {
      const group = await db('groups').where({ id: project.group_id }).first();
      if (!group) {
        throw createError(400, 'Project references a missing group; update the linked group first');
      }

      const { count: memberCount } = await db('group_members')
        .where({ group_id: group.id, status: 'accepted' })
        .count('student_id as count')
        .first();

      const acceptedCount = Number(memberCount);
      if (acceptedCount > MAX_GROUP_MEMBERS) {
        throw createError(
          400,
          `Your linked group cannot have more than ${MAX_GROUP_MEMBERS} accepted members before requesting a mentor. Currently has ${acceptedCount}.`
        );
      }
    }

    const acceptedMentors = await db('project_requests')
      .where({ project_id })
      .andWhere({ status: 'accepted' })
      .first();

    if (acceptedMentors) {
      throw createError(400, 'This project already has an accepted mentor.');
    }

    // 4. Ensure no duplicate pending request to the same faculty
    const existing = await db('project_requests')
      .where({ project_id, faculty_id: resolvedFacultyId })
      .first();
    if (existing) throw createError(409, 'A request to this faculty for this project already exists');

    // 5. Insert Request and notify faculty
    const requestId = uuidv4();
    await db.transaction(async (trx) => {
      await trx('project_requests').insert({
        id: requestId,
        project_id,
        faculty_id: resolvedFacultyId,
        snippet: snippet.trim(),
        status: 'pending',
      });

      await notifyUser(trx, {
        userId: resolvedFacultyId,
        type: 'request_submitted',
        title: 'New mentorship request',
        message: `A mentorship request was submitted for project "${project.title}".`,
        metadata: { project_id, request_id: requestId },
      });
    });

    res.status(201).json({
      message: 'Request submitted successfully',
      request_id: requestId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/requests/faculty
 * List all received requests sent to this faculty.
 */
router.get('/faculty', authenticate, authorize('faculty'), async (req, res, next) => {
  try {
    // 1. Fetch the requests
    const requests = await db('project_requests as pr')
      .join('projects as p', 'pr.project_id', 'p.id')
      .leftJoin('groups as g', 'p.group_id', 'g.id')
      .leftJoin('users as leader', 'g.leader_id', 'leader.id')
      .leftJoin('users as creator', 'p.creator_student_id', 'creator.id')
      .select(
        'pr.id as request_id',
        'pr.status as request_status',
        'pr.snippet',
        'pr.created_at',
        'p.id as project_id',
        'p.title as project_title',
        'p.description as project_description',
        'g.id as group_id',
        db.raw("COALESCE(g.name, 'Individual project') as group_name"),
        db.raw('COALESCE(leader.name, creator.name) as leader_name'),
        'p.creator_student_id'
      )
      .where('pr.faculty_id', req.user.id)
      .orderBy('pr.created_at', 'desc');

    for (const reqObj of requests) {
      if (reqObj.group_id) {
        const members = await db('group_members as gm')
          .join('users as u', 'gm.student_id', 'u.id')
          .select('u.name', 'u.email')
          .where('gm.group_id', reqObj.group_id)
          .andWhere('gm.status', 'accepted');
        reqObj.members = members;
      } else {
        const creator = await db('users')
          .select('name', 'email')
          .where({ id: reqObj.creator_student_id })
          .first();
        reqObj.members = creator ? [creator] : [];
      }
      delete reqObj.creator_student_id;
    }

    res.status(200).json({ requests });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/requests/:id/status
 * Accept or reject a student's request. Faculty only.
 * IMPORTANT: Enforces N:1 faculty-group logic and max_capacity.
 *
 * Body: { status: 'accepted' | 'rejected' }
 */
router.put('/:id/status', authenticate, authorize('faculty'), async (req, res, next) => {
  try {
    const { status } = req.body;
    const reqId = req.params.id;
    if (!['accepted', 'rejected'].includes(status)) {
      throw createError(400, "status must be 'accepted' or 'rejected'");
    }

    await db.transaction(async (trx) => {
      // 1. Get request and verify faculty ownership
      const pr = await trx('project_requests').where({ id: reqId }).first();

      if (!pr) throw createError(404, 'Request not found');
      if (pr.faculty_id !== req.user.id) throw createError(403, 'Not your request');
      if (pr.status !== 'pending') throw createError(400, `Request is already ${pr.status}`);

      const project = await trx('projects as p')
        .select('p.id', 'p.title', 'p.group_id', 'p.creator_student_id')
        .where('p.id', pr.project_id)
        .first();

      if (status === 'accepted') {
        const fp = await trx('faculty_profiles').select('max_capacity').where('user_id', req.user.id).first();
        const maxCapacity = fp.max_capacity;

        // Current mentees for this faculty
        const { count: currentMenteeCountStr } = await trx('project_requests')
          .where('faculty_id', req.user.id)
          .andWhere('status', 'accepted')
          .count('id as count')
          .first();

        const currentMentees = Number(currentMenteeCountStr);

        if (currentMentees >= maxCapacity) {
          throw createError(400, `Cannot accept: You have reached your max capacity of ${maxCapacity} mentees.`);
        }

        // Verify the group itself hasn't been scooped by another faculty in the meantime
        const groupBooking = await trx('project_requests')
          .where({ project_id: pr.project_id, status: 'accepted' })
          .first();

        if (groupBooking) {
          throw createError(400, "This project has already accepted a different mentor's request.");
        }

        // 2. Mark this request accepted
        await trx('project_requests').where({ id: reqId }).update({ status: 'accepted', updated_at: trx.fn.now() });

        // 3. Mark the project as in_progress
        await trx('projects').where({ id: pr.project_id }).update({ status: 'in_progress', updated_at: trx.fn.now() });

        // 4. Group is fully booked - reject all their other pending requests out to the world
        await trx('project_requests')
          .where({ project_id: pr.project_id, status: 'pending' })
          .update({ status: 'rejected', updated_at: trx.fn.now() });

        // 5. If faculty reached capacity, reject all other pending requests sent to them
        const newMenteeCount = currentMentees + 1;
        if (newMenteeCount >= maxCapacity) {
          await trx('project_requests')
            .where({ faculty_id: req.user.id, status: 'pending' })
            .update({ status: 'rejected', updated_at: trx.fn.now() });
        }

        const stakeholderIds = await getProjectStakeholderStudentIds(trx, project);
        for (const memberId of stakeholderIds) {
          await notifyUser(trx, {
            userId: memberId,
            type: 'request_accepted',
            title: 'Mentorship request accepted',
            message: `Your request for "${project.title}" was accepted.`,
            metadata: { project_id: project.id, request_id: reqId },
          });
        }
      } else {
        // Just rejecting
        await trx('project_requests').where({ id: reqId }).update({ status: 'rejected', updated_at: trx.fn.now() });

        const stakeholderIds = await getProjectStakeholderStudentIds(trx, project);
        for (const memberId of stakeholderIds) {
          await notifyUser(trx, {
            userId: memberId,
            type: 'request_rejected',
            title: 'Mentorship request rejected',
            message: `Your request for "${project.title}" was rejected.`,
            metadata: { project_id: project.id, request_id: reqId },
          });
        }
      }
    });

    res.status(200).json({ message: `Request successfully ${status}` });

  } catch (err) {
    next(err);
  }
});

module.exports = router;
