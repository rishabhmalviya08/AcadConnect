const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/knex');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../utils/errors');

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

const getAcceptedGroupMemberIds = async (trx, groupId) => {
  const members = await trx('group_members')
    .select('student_id')
    .where({ group_id: groupId, status: 'accepted' });
  return members.map((m) => m.student_id);
};

/**
 * GET /api/projects
 * List all projects (open). Anyone authenticating can see them.
 */
router.get('/', authenticate, async (req, res, next) => {
  try {
    const projects = await db('projects as p')
      .join('groups as g', 'p.group_id', 'g.id')
      .select(
        'p.id',
        'p.title',
        'p.description',
        'p.status',
        'p.created_at',
        'g.name as group_name'
      )
      .orderBy('p.created_at', 'desc');

    res.status(200).json({ projects });
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
      .join('groups as g', 'p.group_id', 'g.id')
      .select(
        'p.id',
        'p.group_id',
        'p.title',
        'p.description',
        'p.status',
        'p.created_at',
        'g.name as group_name'
      )
      .where('p.id', req.params.id)
      .first();

    if (!project) throw createError(404, 'Project not found');

    res.status(200).json({ project });
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

      const groupMemberIds = await getAcceptedGroupMemberIds(trx, project.group_id);
      for (const memberId of groupMemberIds) {
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
 * Create a new open project. Must be a student and leader of the group.
 * Group must have 3-5 accepted members.
 *
 * Body: { title, description, group_id }
 */
router.post('/', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const { title, description, group_id } = req.body;
    if (!title || !description || !group_id) {
      throw createError(400, 'title, description, and group_id are required');
    }

    // Ensure the group exists and the user is the leader
    const group = await db('groups').where({ id: group_id }).first();
    if (!group) throw createError(404, 'Group not found');
    if (group.leader_id !== req.user.id) throw createError(403, 'Only the group leader can create a project for the group');

    // Count *accepted* members
    const { count: memberCount } = await db('group_members')
      .where({ group_id, status: 'accepted' })
      .count('student_id as count')
      .first();

    const acceptedCount = Number(memberCount);
    if (acceptedCount < 3 || acceptedCount > 5) {
      throw createError(400, `Your group must have between 3 and 5 **accepted** members to create a project. Currently has ${acceptedCount}.`);
    }

    const projectId = uuidv4();
    await db('projects').insert({
      id: projectId,
      group_id: group_id,
      title,
      description,
      status: 'open',
    });

    res.status(201).json({
      message: 'Project created successfully',
      project: { id: projectId, title, group_id, status: 'open' },
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
    
    const group = await db('groups').where({ id: project.group_id }).first();
    if (group.leader_id !== req.user.id) throw createError(403, 'Only the group leader can trigger feedback');

    // Forward the description payload to python service synchronously
    const authHeader = req.headers['authorization'];
    const response = await fetch(`${AI_FEEDBACK_URL}/feedback/generate-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify({
        project_title: project.title,
        project_description: project.description
      })
    });

    if (response.status === 429) {
      let msg = 'Too many AI feedback requests. Please wait a minute and try again.';
      try {
        const errBody = await response.json();
        if (typeof errBody.detail === 'string') msg = errBody.detail;
      } catch { /* ignore */ }
      throw createError(429, msg);
    }

    if (!response.ok) {
      throw createError(500, 'AI Feedback service returned an error');
    }

    const aiData = await response.json();
    res.status(200).json(aiData);
  } catch (err) {
    console.error('[project-service] AI Feedback Error:', err);
    next(err);
  }
});

module.exports = router;
