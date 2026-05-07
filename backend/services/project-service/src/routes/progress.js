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

const getProjectWithGroup = async (projectId) =>
  db('projects as p')
    .join('groups as g', 'p.group_id', 'g.id')
    .select('p.id', 'p.title', 'p.group_id', 'g.leader_id')
    .where('p.id', projectId)
    .first();

const getAcceptedGroupMemberIds = async (trx, groupId) => {
  const members = await trx('group_members')
    .select('student_id')
    .where({ group_id: groupId, status: 'accepted' });
  return members.map((m) => m.student_id);
};

router.get('/projects/:id/progress', authenticate, async (req, res, next) => {
  try {
    const project = await getProjectWithGroup(req.params.id);
    if (!project) throw createError(404, 'Project not found');

    const isFaculty = req.user.role === 'faculty';
    const isStudent = req.user.role === 'student';

    if (isFaculty) {
      const assigned = await db('project_requests')
        .where({ project_id: project.id, faculty_id: req.user.id, status: 'accepted' })
        .first();
      if (!assigned) throw createError(403, 'You are not assigned to this project');
    } else if (isStudent) {
      const membership = await db('group_members')
        .where({ group_id: project.group_id, student_id: req.user.id, status: 'accepted' })
        .first();
      if (!membership) throw createError(403, 'You are not a member of this project group');
    }

    const milestones = await db('progress')
      .select('id', 'title', 'description', 'due_date', 'completed', 'created_at', 'updated_at')
      .where({ project_id: project.id })
      .orderBy('created_at', 'asc');

    res.status(200).json({ milestones });
  } catch (err) {
    next(err);
  }
});

router.post('/projects/:id/progress', authenticate, authorize('faculty'), async (req, res, next) => {
  try {
    const { title, description, due_date } = req.body;
    if (!title) throw createError(400, 'title is required');

    const project = await getProjectWithGroup(req.params.id);
    if (!project) throw createError(404, 'Project not found');

    const assigned = await db('project_requests')
      .where({ project_id: project.id, faculty_id: req.user.id, status: 'accepted' })
      .first();
    if (!assigned) throw createError(403, 'You are not assigned to this project');

    const milestoneId = uuidv4();
    await db.transaction(async (trx) => {
      await trx('progress').insert({
        id: milestoneId,
        project_id: project.id,
        title,
        description: description || null,
        due_date: due_date || null,
        completed: false,
      });

      const groupMemberIds = await getAcceptedGroupMemberIds(trx, project.group_id);
      for (const memberId of groupMemberIds) {
        await notifyUser(trx, {
          userId: memberId,
          type: 'milestone_created',
          title: 'New milestone added',
          message: `A new milestone was added to "${project.title}": ${title}`,
          metadata: { project_id: project.id, milestone_id: milestoneId },
        });
      }
    });

    res.status(201).json({ message: 'Milestone created', milestone_id: milestoneId });
  } catch (err) {
    next(err);
  }
});

router.put('/projects/:id/progress/:progressId', authenticate, authorize('faculty'), async (req, res, next) => {
  try {
    const { title, description, due_date, completed } = req.body;

    const project = await getProjectWithGroup(req.params.id);
    if (!project) throw createError(404, 'Project not found');

    const assigned = await db('project_requests')
      .where({ project_id: project.id, faculty_id: req.user.id, status: 'accepted' })
      .first();
    if (!assigned) throw createError(403, 'You are not assigned to this project');

    const milestone = await db('progress')
      .where({ id: req.params.progressId, project_id: project.id })
      .first();
    if (!milestone) throw createError(404, 'Milestone not found');

    const updates = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (due_date !== undefined) updates.due_date = due_date;
    if (completed !== undefined) updates.completed = !!completed;
    if (!Object.keys(updates).length) throw createError(400, 'No valid fields to update');
    updates.updated_at = db.fn.now();

    await db.transaction(async (trx) => {
      await trx('progress')
        .where({ id: req.params.progressId, project_id: project.id })
        .update(updates);

      const groupMemberIds = await getAcceptedGroupMemberIds(trx, project.group_id);
      for (const memberId of groupMemberIds) {
        await notifyUser(trx, {
          userId: memberId,
          type: 'milestone_updated',
          title: 'Milestone updated',
          message: `A milestone was updated in "${project.title}": ${updates.title || milestone.title}`,
          metadata: { project_id: project.id, milestone_id: req.params.progressId },
        });
      }
    });

    res.status(200).json({ message: 'Milestone updated' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
