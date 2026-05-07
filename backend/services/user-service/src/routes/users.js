const express = require('express');
const db = require('../db/knex');
const { authenticate } = require('../middleware/auth');
const { createError } = require('../utils/errors');
const { pushToUser } = require('../realtime/notificationsHub');

const router = express.Router();

// All /api/users routes require a valid JWT
router.use(authenticate);

/**
 * GET /api/users/me
 * Returns the authenticated user's profile, including their role-specific data.
 *
 * Response 200:
 *   For student: { id, name, email, role, profile: { skills, interests, eligibility_status } }
 *   For faculty: { id, name, email, role, profile: { research_areas, max_capacity, mentee_count } }
 *   For admin:   { id, name, email, role }
 */
router.get('/me', async (req, res, next) => {
  try {
    const user = await db('users')
      .select('id', 'name', 'email', 'role', 'created_at')
      .where({ id: req.user.id })
      .first();

    if (!user) throw createError(404, 'User not found');

    let profile = null;

    if (user.role === 'student') {
      profile = await db('student_profiles')
        .select('skills', 'interests', 'eligibility_status')
        .where({ user_id: user.id })
        .first();
    } else if (user.role === 'faculty') {
      const fp = await db('faculty_profiles')
        .select('research_areas', 'max_capacity')
        .where({ user_id: user.id })
        .first();

      // Derive current mentee count via accepted project_requests
      const { count } = await db('project_requests as pr')
        .where('pr.faculty_id', user.id)
        .andWhere('pr.status', 'accepted')
        .count('pr.id as count')
        .first();

      profile = { ...fp, mentee_count: Number(count) };
    }

    res.status(200).json({ ...user, profile });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/users/me
 * Updates the authenticated user's own profile.
 *
 * Student body:  { name?, skills?, interests? }
 * Faculty body:  { name?, research_areas?, max_capacity? }
 * Admin body:    { name? }
 *
 * Response 200: { message: 'Profile updated', user: { ... } }
 */
router.put('/me', async (req, res, next) => {
  try {
    const { name, skills, interests, research_areas, max_capacity } = req.body;
    const userId = req.user.id;
    const role = req.user.role;

    await db.transaction(async (trx) => {
      // Update core user fields
      if (name) {
        await trx('users').where({ id: userId }).update({ name, updated_at: trx.fn.now() });
      }

      if (role === 'student') {
        const updates = {};
        if (skills !== undefined) {
          if (!Array.isArray(skills)) throw createError(400, 'skills must be an array');
          updates.skills = skills;
        }
        if (interests !== undefined) updates.interests = interests;
        if (Object.keys(updates).length) {
          updates.updated_at = trx.fn.now();
          await trx('student_profiles').where({ user_id: userId }).update(updates);
        }
      } else if (role === 'faculty') {
        const updates = {};
        if (research_areas !== undefined) {
          if (!Array.isArray(research_areas)) throw createError(400, 'research_areas must be an array');
          updates.research_areas = research_areas;
        }
        if (max_capacity !== undefined) {
          const cap = Number(max_capacity);
          if (!Number.isInteger(cap) || cap < 1) throw createError(400, 'max_capacity must be a positive integer');
          updates.max_capacity = cap;
        }
        if (Object.keys(updates).length) {
          updates.updated_at = trx.fn.now();
          await trx('faculty_profiles').where({ user_id: userId }).update(updates);
        }
      }
    });

    res.status(200).json({ message: 'Profile updated successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/users/notifications
 * Returns the authenticated user's notifications.
 * Query: ?unread_only=true&limit=20
 */
router.get('/notifications', async (req, res, next) => {
  try {
    const unreadOnly = req.query.unread_only === 'true';
    const limit = Math.min(Number(req.query.limit) || 50, 100);

    const query = db('notifications')
      .select('id', 'type', 'title', 'message', 'metadata', 'is_read', 'created_at')
      .where({ user_id: req.user.id })
      .orderBy('created_at', 'desc')
      .limit(limit);

    if (unreadOnly) query.andWhere('is_read', false);

    const [notifications, unreadRow] = await Promise.all([
      query,
      db('notifications').where({ user_id: req.user.id, is_read: false }).count('id as count').first(),
    ]);

    res.status(200).json({
      notifications,
      unread_count: Number(unreadRow?.count || 0),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/users/notifications/:id/read
 * Mark a notification as read.
 */
router.put('/notifications/:id/read', async (req, res, next) => {
  try {
    const updated = await db('notifications')
      .where({ id: req.params.id, user_id: req.user.id })
      .update({ is_read: true });

    if (!updated) throw createError(404, 'Notification not found');
    pushToUser(db, req.user.id).catch(() => {});
    res.status(200).json({ message: 'Notification marked as read' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
