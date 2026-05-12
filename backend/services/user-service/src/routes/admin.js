const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/knex');
const { authenticate, authorize } = require('../middleware/auth');
const { createError } = require('../utils/errors');

const router = express.Router();

// All /api/admin routes: must be logged in AND be an admin
router.use(authenticate, authorize('admin'));

// ─── Helper: write an audit log entry ────────────────────
const writeAuditLog = async (trx, { admin_id, target_user_id, action, details }) => {
  await trx('audit_logs').insert({
    id: uuidv4(),
    admin_id,
    target_user_id: target_user_id || null,
    action,
    details: JSON.stringify(details || {}),
  });
};

const ELIGIBILITY_STATUSES = ['eligible', 'probation', 'ineligible'];

/**
 * GET /api/admin/users
 * Returns all users with their role-specific profile summary.
 * Query: ?role=student|faculty|admin
 *         ?eligibility_status=eligible|probation|ineligible (students matching; non-students still included)
 *         ?sort_by=created_at|role&sort_dir=asc|desc (default created_at desc)
 *
 * Response 200: { users: [...] } — each row includes eligibility_status (null for non-students)
 */
router.get('/users', async (req, res, next) => {
  try {
    const { role, eligibility_status, sort_by, sort_dir } = req.query;
    const sortBy = sort_by === 'role' ? 'role' : 'created_at';
    const sortDir = String(sort_dir || 'desc').toLowerCase() === 'asc' ? 'asc' : 'desc';

    if (sort_by && sort_by !== 'created_at' && sort_by !== 'role') {
      throw createError(400, "sort_by must be 'created_at' or 'role'");
    }
    if (sort_dir && !['asc', 'desc'].includes(String(sort_dir).toLowerCase())) {
      throw createError(400, "sort_dir must be 'asc' or 'desc'");
    }

    const query = db('users as u')
      .leftJoin('student_profiles as sp', 'u.id', 'sp.user_id')
      .select(
        'u.id',
        'u.name',
        'u.email',
        'u.role',
        'u.created_at',
        db.raw(
          `CASE WHEN u.role = 'student' THEN COALESCE(sp.eligibility_status::text, 'eligible') ELSE NULL END as eligibility_status`
        )
      );

    if (role) {
      if (!['student', 'faculty', 'admin'].includes(role)) {
        throw createError(400, "role filter must be 'student', 'faculty', or 'admin'");
      }
      query.where('u.role', role);
    }

    if (eligibility_status) {
      if (!ELIGIBILITY_STATUSES.includes(eligibility_status)) {
        throw createError(
          400,
          `eligibility_status must be one of: ${ELIGIBILITY_STATUSES.join(', ')}`
        );
      }
      query.where(function filterByEligibility() {
        this.where('u.role', '!=', 'student').orWhereRaw(
          "COALESCE(sp.eligibility_status::text, 'eligible') = ?",
          [eligibility_status]
        );
      });
    }

    if (sortBy === 'role') {
      query.orderBy('u.role', sortDir).orderBy('u.created_at', 'desc');
    } else {
      query.orderBy('u.created_at', sortDir);
    }

    const users = await query;
    res.status(200).json({ users });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/users/:id
 * Returns a single user + their full profile.
 *
 * Response 200: { user: { ...base, profile: {...} } }
 */
router.get('/users/:id', async (req, res, next) => {
  try {
    const user = await db('users')
      .select('id', 'name', 'email', 'role', 'created_at')
      .where({ id: req.params.id })
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
      const { count } = await db('project_requests as pr')
        .where('pr.faculty_id', user.id)
        .andWhere('pr.status', 'accepted')
        .count('pr.id as count')
        .first();
      profile = { ...fp, mentee_count: Number(count) };
    }

    res.status(200).json({ user: { ...user, profile } });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/admin/users/:id/eligibility
 * Updates a student's eligibility_status. Admin-only.
 * Automatically writes an audit log entry.
 *
 * Body: { eligibility_status: 'eligible'|'probation'|'ineligible', reason? }
 * Response 200: { message, eligibility_status }
 */
router.put('/users/:id/eligibility', async (req, res, next) => {
  try {
    const { eligibility_status, reason } = req.body;
    const targetId = req.params.id;
    const adminId = req.user.id;

    if (!eligibility_status || !ELIGIBILITY_STATUSES.includes(eligibility_status)) {
      throw createError(400, `eligibility_status must be one of: ${ELIGIBILITY_STATUSES.join(', ')}`);
    }

    // Ensure target is a student
    const target = await db('users').where({ id: targetId, role: 'student' }).first();
    if (!target) throw createError(404, 'Student not found');

    // Fetch current status for audit trail
    const currentProfile = await db('student_profiles')
      .select('eligibility_status')
      .where({ user_id: targetId })
      .first();

    await db.transaction(async (trx) => {
      await trx('student_profiles')
        .where({ user_id: targetId })
        .update({ eligibility_status, updated_at: trx.fn.now() });

      await writeAuditLog(trx, {
        admin_id: adminId,
        target_user_id: targetId,
        action: 'ELIGIBILITY_CHANGE',
        details: {
          before: currentProfile.eligibility_status,
          after: eligibility_status,
          reason: reason || null,
          student_name: target.name,
          student_email: target.email,
        },
      });
    });

    res.status(200).json({
      message: `Eligibility updated to '${eligibility_status}'`,
      eligibility_status,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/admin/audit-logs
 * Returns audit logs, newest first. Admin-only.
 * Supports optional filters: ?admin_id=&target_user_id=&action=
 * Pagination: ?page=1&limit=20
 *
 * Response 200: { logs: [...], total, page, limit }
 */
router.get('/audit-logs', async (req, res, next) => {
  try {
    const { admin_id, target_user_id, action, page = 1, limit = 20 } = req.query;
    const offset = (Number(page) - 1) * Number(limit);

    const query = db('audit_logs as al')
      .join('users as admin', 'al.admin_id', 'admin.id')
      .leftJoin('users as target', 'al.target_user_id', 'target.id')
      .select(
        'al.id',
        'al.action',
        'al.details',
        'al.created_at',
        'admin.name as admin_name',
        'admin.email as admin_email',
        'target.name as target_name',
        'target.email as target_email'
      )
      .orderBy('al.created_at', 'desc')
      .limit(Number(limit))
      .offset(offset);

    if (admin_id) query.where('al.admin_id', admin_id);
    if (target_user_id) query.where('al.target_user_id', target_user_id);
    if (action) query.where('al.action', action);

    const [logs, [{ count: total }]] = await Promise.all([
      query,
      db('audit_logs').count('id as count'),
    ]);

    res.status(200).json({
      logs,
      total: Number(total),
      page: Number(page),
      limit: Number(limit),
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
