const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/knex');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../utils/errors');
const {
  getProjectStakeholderStudentIds,
  isStudentProjectParticipant,
} = require('../utils/projectStakeholders');
const { findSimilarOpenProjects } = require('../utils/projectTextSimilarity');
const { assertOwnerRecruitmentUpdate } = require('../utils/projectRecruitment');
const { MAX_GROUP_MEMBERS } = require('../constants/groupLimits');

const router = express.Router();

function groupMembersJsonSelect() {
  return db.raw(`(
    SELECT COALESCE(
      json_agg(
        json_build_object(
          'student_id', u.id,
          'name', u.name,
          'email', u.email,
          'status', gm.status::text
        ) ORDER BY CASE WHEN gm.status = 'accepted' THEN 0 ELSE 1 END, u.name
      ),
      '[]'::json
    )
    FROM group_members gm
    JOIN users u ON u.id = gm.student_id
    WHERE gm.group_id = p.group_id
  ) as group_members`);
}

/** Owner + project_members for individual (solo) projects; [] when project has a group. */
function soloTeamMembersJsonSelect() {
  return db.raw(`(
    SELECT COALESCE(
      json_agg(row_data ORDER BY ord),
      '[]'::json
    )
    FROM (
      SELECT json_build_object(
        'student_id', u.id,
        'name', u.name,
        'email', u.email,
        'member_role', 'owner',
        'status', 'accepted'
      ) AS row_data,
      0 AS ord
      FROM users u
      WHERE u.id = p.creator_student_id AND p.group_id IS NULL
      UNION ALL
      SELECT json_build_object(
        'student_id', u.id,
        'name', u.name,
        'email', u.email,
        'member_role', 'collaborator',
        'status', 'accepted'
      ),
      1 AS ord
      FROM project_members pm
      JOIN users u ON u.id = pm.student_id
      WHERE pm.project_id = p.id AND p.group_id IS NULL
    ) solo_team_ordered
  ) as solo_team_members`);
}

function parseGroupMembersValue(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseProjectRow(p) {
  if (!p) return p;
  p.group_members = parseGroupMembersValue(p.group_members);
  p.solo_team_members = parseGroupMembersValue(p.solo_team_members);
  return p;
}

/** Leader only; accepted roster must not exceed MAX (app group size cap). */
async function validateGroupForProjectLink(trx, groupId, studentId) {
  const group = await trx('groups').where({ id: groupId }).first();
  if (!group) throw createError(404, 'Group not found');
  if (String(group.leader_id) !== String(studentId)) {
    throw createError(403, 'You must be the leader of this group to link it to a project');
  }
  const { count: memberCount } = await trx('group_members')
    .where({ group_id: groupId, status: 'accepted' })
    .count('student_id as count')
    .first();
  const acceptedCount = Number(memberCount);
  if (acceptedCount > MAX_GROUP_MEMBERS) {
    throw createError(
      400,
      `The group cannot have more than ${MAX_GROUP_MEMBERS} accepted members to link (currently ${acceptedCount}).`
    );
  }
  return groupId;
}

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
 * GET /api/projects
 * List all projects (open). Anyone authenticating can see them.
 */
const projectListSelect = () => [
  'p.id',
  'p.group_id',
  'p.title',
  'p.description',
  'p.abstract',
  'p.status',
  'p.recruitment_status',
  'p.created_at',
  'p.creator_student_id',
  'cr.name as creator_name',
  db.raw("COALESCE(g.name, 'Individual project') as group_name"),
  db.raw(`(
    SELECT u2.name
    FROM project_requests pr
    JOIN users u2 ON pr.faculty_id = u2.id
    WHERE pr.project_id = p.id AND pr.status = 'accepted'
    LIMIT 1
  ) as faculty_name`),
  groupMembersJsonSelect(),
  soloTeamMembersJsonSelect(),
];

router.get('/', authenticate, async (req, res, next) => {
  try {
    const discoverable =
      req.query.discoverable === 'true' || req.query.discoverable === '1';

    let q = db('projects as p')
      .leftJoin('groups as g', 'p.group_id', 'g.id')
      .join('users as cr', 'p.creator_student_id', 'cr.id')
      .select(...projectListSelect());

    if (discoverable) {
      q = q
        .where('p.status', 'open')
        .andWhere(function onlyNonFull() {
          this.where(function soloRoom() {
            this.whereNull('p.group_id').whereNot('p.recruitment_status', 'full');
          }).orWhere(function groupRoom() {
            this.whereNotNull('p.group_id').whereRaw(
              `(SELECT COUNT(*)::int FROM group_members gm WHERE gm.group_id = p.group_id AND gm.status = ?) < ?`,
              ['accepted', MAX_GROUP_MEMBERS]
            );
          });
        });
    }

    const projects = await q.orderBy('p.created_at', 'desc');

    res.status(200).json({ projects: projects.map(parseProjectRow) });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/me
 * List only projects associated with the authenticated user.
 * Students: Projects in groups they belong to.
 * Faculty: Projects they have an accepted request for.
 */
router.get('/me', authenticate, async (req, res, next) => {
  try {
    let projects = [];

    if (req.user.role === 'admin') {
      projects = await db('projects as p')
        .leftJoin('groups as g', 'p.group_id', 'g.id')
        .join('users as cr', 'p.creator_student_id', 'cr.id')
        .select(...projectListSelect())
        .orderBy('p.created_at', 'desc');
    } else if (req.user.role === 'student') {
      projects = await db('projects as p')
        .leftJoin('groups as g', 'p.group_id', 'g.id')
        .select(
          'p.id',
          'p.group_id',
          'p.title',
          'p.description',
          'p.abstract',
          'p.status',
          'p.recruitment_status',
          'p.created_at',
          db.raw("COALESCE(g.name, 'Individual project') as group_name"),
          db.raw(`(
            SELECT u2.name
            FROM project_requests pr
            JOIN users u2 ON pr.faculty_id = u2.id
            WHERE pr.project_id = p.id AND pr.status = 'accepted'
            LIMIT 1
          ) as faculty_name`),
          groupMembersJsonSelect(),
          soloTeamMembersJsonSelect()
        )
        .where(function () {
          this.whereExists(function () {
            this.select(1)
              .from('group_members as gm')
              .whereRaw('gm.group_id = p.group_id')
              .where({ 'gm.student_id': req.user.id, 'gm.status': 'accepted' });
          })
            .orWhere(function () {
              this.whereNull('p.group_id').andWhere('p.creator_student_id', req.user.id);
            })
            .orWhereExists(function () {
              this.select(1)
                .from('project_members as pm')
                .whereRaw('pm.project_id = p.id')
                .where('pm.student_id', req.user.id);
            });
        })
        .orderBy('p.created_at', 'desc');
    } else if (req.user.role === 'faculty') {
      projects = await db('projects as p')
        .leftJoin('groups as g', 'p.group_id', 'g.id')
        .join('project_requests as pr', 'p.id', 'pr.project_id')
        .select(
          'p.id',
          'p.group_id',
          'p.title',
          'p.description',
          'p.abstract',
          'p.status',
          'p.recruitment_status',
          'p.created_at',
          db.raw("COALESCE(g.name, 'Individual project') as group_name"),
          db.raw(`(
            SELECT u2.name
            FROM project_requests pr2
            JOIN users u2 ON pr2.faculty_id = u2.id
            WHERE pr2.project_id = p.id AND pr2.status = 'accepted'
            LIMIT 1
          ) as faculty_name`),
          groupMembersJsonSelect(),
          soloTeamMembersJsonSelect()
        )
        .where('pr.faculty_id', req.user.id)
        .andWhere('pr.status', 'accepted')
        .orderBy('p.created_at', 'desc');
    }

    res.status(200).json({ projects: projects.map(parseProjectRow) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects/:id/join-request
 * Ask to join an open project. Notifies the project creator.
 */
router.post('/:id/join-request', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const projectId = req.params.id;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 500) : '';

    const project = await db('projects').where({ id: projectId }).first();
    if (!project) throw createError(404, 'Project not found');
    if (project.status !== 'open') {
      throw createError(400, 'Join requests are only allowed for open projects');
    }

    if (await isStudentProjectParticipant(db, project, req.user.id)) {
      throw createError(400, 'You are already part of this project');
    }

    if (!project.group_id && project.recruitment_status === 'full') {
      throw createError(400, 'This project is not accepting join requests');
    }

    const existing = await db('project_join_requests')
      .where({ project_id: projectId, requester_id: req.user.id })
      .first();

    if (existing) {
      if (existing.status === 'pending') {
        throw createError(409, 'You already have a pending join request for this project');
      }
      if (existing.status === 'accepted') {
        throw createError(400, 'You are already a member of this project');
      }
    }

    const requester = await db('users').select('name').where({ id: req.user.id }).first();

    await db.transaction(async (trx) => {
      let requestId;
      if (existing && existing.status === 'rejected') {
        requestId = existing.id;
        await trx('project_join_requests')
          .where({ id: existing.id })
          .update({
            status: 'pending',
            message: message || null,
            updated_at: trx.fn.now(),
          });
      } else {
        requestId = uuidv4();
        await trx('project_join_requests').insert({
          id: requestId,
          project_id: projectId,
          requester_id: req.user.id,
          status: 'pending',
          message: message || null,
        });
      }

      await notifyUser(trx, {
        userId: project.creator_student_id,
        type: 'project_join_requested',
        title: 'New request to join your project',
        message: `${requester?.name || 'A student'} wants to join "${project.title}".${message ? ` Note: ${message}` : ''}`,
        metadata: { project_id: projectId, join_request_id: requestId },
      });
    });

    res.status(201).json({ message: 'Join request sent to the project creator' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:id/join-requests
 * List pending join requests (project creator only).
 */
router.get('/:id/join-requests', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const project = await db('projects').where({ id: req.params.id }).first();
    if (!project) throw createError(404, 'Project not found');
    if (project.creator_student_id !== req.user.id) {
      throw createError(403, 'Only the project creator can view join requests');
    }

    const rows = await db('project_join_requests as jr')
      .join('users as u', 'jr.requester_id', 'u.id')
      .select(
        'jr.id as request_id',
        'jr.requester_id',
        'jr.message',
        'jr.status',
        'jr.created_at',
        'u.name as requester_name',
        'u.email as requester_email'
      )
      .where('jr.project_id', project.id)
      .andWhere('jr.status', 'pending')
      .orderBy('jr.created_at', 'asc');

    res.status(200).json({ requests: rows });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/projects/:id/join-requests/:requestId
 * Accept or reject a join request (project creator only).
 * Body: { status: 'accepted' | 'rejected' }
 */
router.put('/:id/join-requests/:requestId', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!['accepted', 'rejected'].includes(status)) {
      throw createError(400, "status must be 'accepted' or 'rejected'");
    }

    const projectId = req.params.id;
    const requestId = req.params.requestId;

    await db.transaction(async (trx) => {
      const project = await trx('projects').where({ id: projectId }).first();
      if (!project) throw createError(404, 'Project not found');
      if (project.creator_student_id !== req.user.id) {
        throw createError(403, 'Only the project creator can respond to join requests');
      }

      const jr = await trx('project_join_requests')
        .where({ id: requestId, project_id: projectId })
        .first();
      if (!jr) throw createError(404, 'Join request not found');
      if (jr.status !== 'pending') {
        throw createError(400, `This request is already ${jr.status}`);
      }

      if (status === 'rejected') {
        await trx('project_join_requests')
          .where({ id: requestId })
          .update({ status: 'rejected', updated_at: trx.fn.now() });

        await notifyUser(trx, {
          userId: jr.requester_id,
          type: 'project_join_rejected',
          title: 'Join request declined',
          message: `Your request to join "${project.title}" was declined.`,
          metadata: { project_id: projectId },
        });
        return;
      }

      // accepted
      if (await isStudentProjectParticipant(trx, project, jr.requester_id)) {
        throw createError(400, 'This student is already part of the project');
      }

      if (project.group_id) {
        const totRow = await trx('group_members')
          .where({ group_id: project.group_id })
          .count('* as count')
          .first();
        if (Number(totRow?.count || 0) >= MAX_GROUP_MEMBERS) {
          throw createError(
            400,
            `The project group is full (maximum ${MAX_GROUP_MEMBERS} members).`
          );
        }

        await trx('group_members')
          .insert({
            group_id: project.group_id,
            student_id: jr.requester_id,
            status: 'accepted',
          })
          .onConflict(['group_id', 'student_id'])
          .merge({
            status: 'accepted',
            updated_at: trx.fn.now(),
          });
      } else {
        await trx('project_members').insert({
          project_id: project.id,
          student_id: jr.requester_id,
        });
      }

      await trx('project_join_requests')
        .where({ id: requestId })
        .update({ status: 'accepted', updated_at: trx.fn.now() });

      await notifyUser(trx, {
        userId: jr.requester_id,
        type: 'project_join_accepted',
        title: 'You joined a project',
        message: `You were added to "${project.title}".`,
        metadata: { project_id: projectId },
      });
    });

    res.status(200).json({ message: `Join request ${status}` });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/projects/:id/recruitment-status
 * Project creator only. Body may include:
 * - recruitment_status (solo projects): full | looking_for_1 | looking_for_2 | looking_for_3
 * - abstract (optional text): any project; omit key to leave unchanged
 */
router.put('/:id/recruitment-status', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const { recruitment_status, abstract } = req.body;
    const hasRecruitment = typeof recruitment_status === 'string' && recruitment_status.trim() !== '';
    const hasAbstract = Object.prototype.hasOwnProperty.call(req.body, 'abstract');

    if (!hasRecruitment && !hasAbstract) {
      throw createError(400, 'Provide recruitment_status and/or abstract');
    }

    await db.transaction(async (trx) => {
      const project = await trx('projects').where({ id: req.params.id }).first();
      if (!project) throw createError(404, 'Project not found');
      if (project.creator_student_id !== req.user.id) {
        throw createError(403, 'Only the project creator can update these fields');
      }

      const updates = { updated_at: trx.fn.now() };

      if (hasRecruitment) {
        await assertOwnerRecruitmentUpdate(trx, project, recruitment_status.trim());
        updates.recruitment_status = recruitment_status.trim();
      }

      if (hasAbstract) {
        if (typeof abstract !== 'string') {
          throw createError(400, 'abstract must be a string when provided');
        }
        updates.abstract = abstract.slice(0, 8000);
      }

      await trx('projects').where({ id: project.id }).update(updates);
    });

    const updated = await db('projects')
      .select('recruitment_status', 'abstract')
      .where({ id: req.params.id })
      .first();
    res.status(200).json({
      message: 'Project updated',
      recruitment_status: updated.recruitment_status,
      abstract: updated.abstract,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/projects/:id/group
 * Project owner (creator) only: link, change, or clear the backing group.
 * Body: { group_id: string | null } — null or empty string clears the link (solo project).
 */
router.put('/:id/group', authenticate, authorize('student'), async (req, res, next) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(req.body, 'group_id')) {
      throw createError(400, 'group_id is required (use null to run as an individual project)');
    }

    let nextGroupId = req.body.group_id;
    if (nextGroupId === '' || nextGroupId === undefined) nextGroupId = null;
    if (nextGroupId !== null && typeof nextGroupId !== 'string') {
      throw createError(400, 'group_id must be a string UUID or null');
    }

    await db.transaction(async (trx) => {
      const project = await trx('projects').where({ id: req.params.id }).first();
      if (!project) throw createError(404, 'Project not found');
      if (project.creator_student_id !== req.user.id) {
        throw createError(403, 'Only the project owner can link or change the group');
      }
      if (project.status !== 'open') {
        throw createError(400, 'You can only change the linked group while the project is open');
      }

      const acceptedMentor = await trx('project_requests')
        .where({ project_id: project.id, status: 'accepted' })
        .first();
      const prev = project.group_id ? String(project.group_id) : '';
      const next = nextGroupId ? String(nextGroupId) : '';
      if (acceptedMentor && prev !== next) {
        throw createError(400, 'Cannot change the linked group after a faculty mentor has accepted');
      }

      if (nextGroupId) {
        await validateGroupForProjectLink(trx, nextGroupId, req.user.id);
      }

      await trx('projects')
        .where({ id: project.id })
        .update({
          group_id: nextGroupId,
          recruitment_status: nextGroupId ? null : 'looking_for_3',
          updated_at: trx.fn.now(),
        });
    });

    const row = await db('projects as p')
      .leftJoin('groups as g', 'p.group_id', 'g.id')
      .select('p.id', 'p.group_id', db.raw("COALESCE(g.name, 'Individual project') as group_name"))
      .where('p.id', req.params.id)
      .first();

    res.status(200).json({
      message: 'Linked group updated',
      group_id: row.group_id,
      group_name: row.group_name,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/projects/:id
 * Get details for a specific project.
 */
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const project = await db('projects as p')
      .leftJoin('groups as g', 'p.group_id', 'g.id')
      .join('users as cr', 'p.creator_student_id', 'cr.id')
      .select(
        'p.id',
        'p.group_id',
        'p.creator_student_id',
        'cr.name as creator_name',
        'p.title',
        'p.description',
        'p.abstract',
        'p.status',
        'p.recruitment_status',
        'p.created_at',
        db.raw("COALESCE(g.name, 'Individual project') as group_name"),
        db.raw(`(
          SELECT u2.name
          FROM project_requests pr
          JOIN users u2 ON pr.faculty_id = u2.id
          WHERE pr.project_id = p.id AND pr.status = 'accepted'
          LIMIT 1
        ) as faculty_name`),
        groupMembersJsonSelect(),
        soloTeamMembersJsonSelect()
      )
      .where('p.id', req.params.id)
      .first();

    if (!project) throw createError(404, 'Project not found');

    const parsed = parseProjectRow(project);
    if (req.user.role === 'student' && parsed.creator_student_id === req.user.id) {
      parsed.mentorship_requests = await db('project_requests as pr')
        .join('users as fu', 'pr.faculty_id', 'fu.id')
        .select(
          'pr.id',
          'pr.status',
          'pr.snippet',
          'pr.created_at',
          'fu.id as faculty_id',
          'fu.name as faculty_name',
          'fu.email as faculty_email'
        )
        .where('pr.project_id', req.params.id)
        .orderBy('pr.created_at', 'desc');
    }

    res.status(200).json({ project: parsed });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/projects/:id
 * Update project status. Faculty can close their own in-progress projects.
 *
 * Body: { status: 'closed' }
 */
router.put('/:id', authenticate, authorize('faculty'), async (req, res, next) => {
  try {
    const { status } = req.body;
    if (status !== 'closed') {
      throw createError(400, "Only status='closed' is supported for this endpoint");
    }

    const project = await db('projects').where({ id: req.params.id }).first();
    if (!project) throw createError(404, 'Project not found');

    const acceptedRequest = await db('project_requests')
      .where({ project_id: project.id, faculty_id: req.user.id, status: 'accepted' })
      .first();
    if (!acceptedRequest) {
      throw createError(403, 'You are not assigned to this project');
    }

    await db.transaction(async (trx) => {
      await trx('projects')
        .where({ id: project.id })
        .update({ status: 'closed', updated_at: trx.fn.now() });

      const full = await trx('projects').where({ id: project.id }).first();
      const stakeholderIds = await getProjectStakeholderStudentIds(trx, full);
      for (const memberId of stakeholderIds) {
        await notifyUser(trx, {
          userId: memberId,
          type: 'project_closed',
          title: 'Project completed',
          message: `Project "${project.title}" has been marked as completed by faculty.`,
          metadata: { project_id: project.id },
        });
      }
    });

    res.status(200).json({ message: 'Project marked as closed' });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/projects
 * Create a new open project. Student only.
 * With group_id: must be group leader; accepted roster at most MAX_GROUP_MEMBERS.
 * Without group_id: solo project for the authenticated student.
 *
 * Body: { title, description, abstract?, group_id? }
 */
router.post('/', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const { title, description, group_id } = req.body;
    const abstractRaw = req.body?.abstract;
    const abstract =
      typeof abstractRaw === 'string' ? abstractRaw.slice(0, 8000) : null;

    if (!title || !description) {
      throw createError(400, 'title and description are required');
    }

    let resolvedGroupId = group_id || null;

    if (resolvedGroupId) {
      await validateGroupForProjectLink(db, resolvedGroupId, req.user.id);
    }

    const projectId = uuidv4();
    await db('projects').insert({
      id: projectId,
      group_id: resolvedGroupId,
      creator_student_id: req.user.id,
      title,
      description,
      abstract,
      status: 'open',
      recruitment_status: resolvedGroupId ? null : 'looking_for_3',
    });

    res.status(201).json({
      message: 'Project created successfully',
      project: {
        id: projectId,
        title,
        group_id: resolvedGroupId,
        abstract,
        status: 'open',
        recruitment_status: resolvedGroupId ? null : 'looking_for_3',
      },
    });
  } catch (err) {
    next(err);
  }
});

const AI_FEEDBACK_URL = process.env.AI_FEEDBACK_SERVICE_URL || 'http://localhost:8001';

/**
 * POST /api/projects/:id/ai-feedback
 * Let a student ping the AI service for real-time feedback on their project pitch.
 */
router.post('/:id/ai-feedback', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const project = await db('projects').where({ id: req.params.id }).first();
    if (!project) throw createError(404, 'Project not found');

    if (project.group_id) {
      const group = await db('groups').where({ id: project.group_id }).first();
      if (!group || group.leader_id !== req.user.id) {
        throw createError(403, 'Only the group leader can trigger feedback');
      }
    } else {
      const allowed =
        project.creator_student_id === req.user.id ||
        (await db('project_members')
          .where({ project_id: project.id, student_id: req.user.id })
          .first());
      if (!allowed) {
        throw createError(403, 'Only the project creator or collaborators can trigger feedback');
      }
    }

    const scanMax = Math.min(
      5000,
      Math.max(50, parseInt(process.env.SIMILARITY_SCAN_MAX || '2000', 10) || 2000)
    );
    const topK = Math.min(30, Math.max(5, parseInt(process.env.SIMILARITY_TOP_K || '15', 10) || 15));

    const base = String(AI_FEEDBACK_URL || '').replace(/\/$/, '');
    const feedbackUrl = `${base}/api/feedback/generate-sync`;
    const authHeader = req.headers['authorization'];

    const [otherRows, response] = await Promise.all([
      db('projects')
        .select('id', 'title', 'abstract', 'description')
        .whereNot('id', project.id)
        .orderBy('updated_at', 'desc')
        .limit(scanMax),
      (async () => {
        try {
          return await fetch(feedbackUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(authHeader ? { Authorization: authHeader } : {}),
            },
            body: JSON.stringify({
              project_title: project.title,
              project_description: project.description,
              ...(project.abstract ? { project_abstract: project.abstract } : {}),
            }),
          });
        } catch (netErr) {
          netErr.code = 'FETCH_FAILED';
          throw netErr;
        }
      })(),
    ]);

    const similarity = findSimilarOpenProjects(
      { abstract: project.abstract, description: project.description },
      otherRows,
      { topK, maxScan: scanMax }
    );

    if (response.status === 429) {
      let msg = 'Too many AI feedback requests. Please wait a minute and try again.';
      try {
        const errBody = await response.json();
        if (typeof errBody.detail === 'string') msg = errBody.detail;
      } catch { /* ignore */ }
      throw createError(429, msg);
    }

    if (!response.ok) {
      let msg = `AI feedback service returned HTTP ${response.status}.`;
      try {
        const errBody = await response.json();
        if (typeof errBody.detail === 'string') {
          msg = errBody.detail;
        } else if (Array.isArray(errBody.detail)) {
          msg = errBody.detail
            .map((d) => (d && typeof d.msg === 'string' ? d.msg : JSON.stringify(d)))
            .join('; ');
        }
      } catch {
        /* ignore parse errors */
      }
      const status = response.status >= 400 && response.status < 600 ? response.status : 502;
      throw createError(status, msg);
    }

    const aiData = await response.json();
    res.status(200).json({
      ...aiData,
      similar_projects: similarity.similar_projects,
      projects_compared: similarity.projects_compared,
      similarity_method: similarity.similarity_method,
    });
  } catch (err) {
    console.error('[project-service] AI Feedback Error:', err);
    if (err && err.code === 'FETCH_FAILED') {
      const base = String(AI_FEEDBACK_URL || '').replace(/\/$/, '');
      return next(
        createError(
          503,
          `Cannot reach the AI feedback service (${base}). Start it on port 8001 or set AI_FEEDBACK_SERVICE_URL in the project-service environment.`
        )
      );
    }
    next(err);
  }
});

module.exports = router;
