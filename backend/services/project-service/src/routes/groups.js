const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db/knex');
const { MAX_GROUP_MEMBERS } = require('../constants/groupLimits');
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

/**
 * POST /api/groups
 * Creates a new student group; the creator is the leader and first accepted member.
 * Optional pending invites: member_emails (0 to MAX_GROUP_MEMBERS-1 students).
 * Linking a group to a project has no minimum member count; roster is capped at MAX_GROUP_MEMBERS.
 * Student only.
 *
 * Body: { name: "Team Alpha", member_emails?: ["bob@uni.edu"] }
 */
router.post('/', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const { name, member_emails: rawEmails } = req.body;
    const leaderId = req.user.id;

    if (!name || typeof name !== 'string' || !name.trim()) {
      throw createError(400, 'name is required');
    }

    let member_emails = [];
    if (rawEmails !== undefined && rawEmails !== null) {
      if (!Array.isArray(rawEmails)) {
        throw createError(400, 'member_emails must be an array when provided');
      }
      const seen = new Set();
      for (const e of rawEmails) {
        const trimmed = e != null ? String(e).trim() : '';
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        member_emails.push(trimmed);
      }
    }

    const leaderEmail = String(req.user.email || '').trim().toLowerCase();
    for (const e of member_emails) {
      if (e.toLowerCase() === leaderEmail) {
        throw createError(400, 'Do not include your own email in member_emails.');
      }
    }

    const totalMembers = member_emails.length + 1;
    if (totalMembers > MAX_GROUP_MEMBERS) {
      throw createError(
        400,
        `A group can have at most ${MAX_GROUP_MEMBERS} members (including you). You provided ${member_emails.length} invites.`
      );
    }

    const groupId = uuidv4();

    await db.transaction(async (trx) => {
      let invitees = [];
      if (member_emails.length > 0) {
        invitees = await trx('users')
          .select('id', 'email')
          .whereIn('email', member_emails)
          .andWhere('role', 'student');

        if (invitees.length !== member_emails.length) {
          const foundEmails = invitees.map((u) => u.email);
          const missing = member_emails.filter((e) => !foundEmails.includes(e));
          throw createError(404, `The following emails do not belong to registered students: ${missing.join(', ')}`);
        }
      }

      // 2. Create the group
      await trx('groups').insert({
        id: groupId,
        name: name.trim(),
        leader_id: leaderId,
      });

      // 3. Add the leader as an 'accepted' member
      const membersToInsert = [
        { group_id: groupId, student_id: leaderId, status: 'accepted' }
      ];

      // 4. Add the rest as 'pending'
      for (const invitee of invitees) {
        membersToInsert.push({
          group_id: groupId,
          student_id: invitee.id,
          status: 'pending',
        });
      }

      await trx('group_members').insert(membersToInsert);
    });

    res.status(201).json({
      message: member_emails.length ? 'Group created and invites sent' : 'Group created',
      group_id: groupId,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/groups/:id/accept-invite
 * Accepts a pending invite for the authenticated student.
 */
/**
 * POST /api/groups/:id/invite
 * Group leader invites an additional student (max 4 members total in group).
 */
router.post('/:id/invite', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const groupId = req.params.id;
    const { member_email } = req.body;
    if (!member_email || typeof member_email !== 'string') {
      throw createError(400, 'member_email is required');
    }
    const email = member_email.trim().toLowerCase();
    if (!email) throw createError(400, 'member_email is required');

    const group = await db('groups').where({ id: groupId }).first();
    if (!group) throw createError(404, 'Group not found');
    if (group.leader_id !== req.user.id) {
      throw createError(403, 'Only the group leader can invite members');
    }

    const leader = await db('users').where({ id: group.leader_id }).first();
    if (leader && leader.email.toLowerCase() === email) {
      throw createError(400, 'You cannot invite yourself');
    }

    const invitee = await db('users').whereRaw('LOWER(email) = ?', [email]).andWhere('role', 'student').first();
    if (!invitee) throw createError(404, 'No registered student found with that email');

    await db.transaction(async (trx) => {
      const totRow = await trx('group_members')
        .where({ group_id: groupId })
        .count('* as count')
        .first();
      if (Number(totRow?.count || 0) >= MAX_GROUP_MEMBERS) {
        throw createError(
          400,
          `This group already has the maximum of ${MAX_GROUP_MEMBERS} members`
        );
      }

      const existing = await trx('group_members').where({ group_id: groupId, student_id: invitee.id }).first();
      if (existing) {
        if (existing.status === 'accepted') {
          throw createError(400, 'This student is already in the group');
        }
        await trx('group_members')
          .where({ group_id: groupId, student_id: invitee.id })
          .update({ status: 'pending', updated_at: trx.fn.now() });
      } else {
        await trx('group_members').insert({
          group_id: groupId,
          student_id: invitee.id,
          status: 'pending',
        });
      }

      await notifyUser(trx, {
        userId: invitee.id,
        type: 'group_invite',
        title: 'New group invitation',
        message: `You were invited to join the group "${group.name}".`,
        metadata: { group_id: groupId },
      });
    });

    res.status(201).json({ message: 'Invitation sent', student_id: invitee.id });
  } catch (err) {
    next(err);
  }
});

router.put('/:id/accept-invite', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const groupId = req.params.id;
    const studentId = req.user.id;

    // Verify invite exists and is pending
    const membership = await db('group_members')
      .where({ group_id: groupId, student_id: studentId })
      .first();

    if (!membership) throw createError(404, 'You are not invited to this group');
    if (membership.status === 'accepted') throw createError(400, 'You have already accepted this invite');

    await db('group_members')
      .where({ group_id: groupId, student_id: studentId })
      .update({ status: 'accepted', updated_at: db.fn.now() });

    res.status(200).json({ message: 'Invite accepted successfully' });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/groups/me
 * Lists all groups the student belongs to or is invited to.
 */
router.get('/me', authenticate, authorize('student'), async (req, res, next) => {
  try {
    const groups = await db('group_members as gm')
      .join('groups as g', 'gm.group_id', 'g.id')
      .join('users as leader', 'g.leader_id', 'leader.id')
      .select(
        'g.id as group_id',
        'g.name',
        'g.leader_id',
        'leader.name as leader_name',
        'gm.status as my_status',
        'g.created_at'
      )
      .where('gm.student_id', req.user.id);

    // For each group, fetch all members
    for (let grp of groups) {
      const members = await db('group_members as gm')
        .join('users as u', 'gm.student_id', 'u.id')
        .select('u.name', 'u.email', 'gm.status')
        .where('gm.group_id', grp.group_id);
      grp.members = members;
    }

    res.status(200).json({ groups });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
