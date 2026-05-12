/**
 * Idempotent dev accounts: (re)creates known users and resets their password every run.
 * Uses reserved `.test` hostnames (RFC 6761) so they never collide with real domains.
 *
 * Password: DEV_SEED_PASSWORD env or "12345678"
 *
 * Not loaded in production (caller must guard).
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const PASSWORD = () => process.env.DEV_SEED_PASSWORD || '12345678';

function buildRoster() {
  const admins = [1, 2].map((n) => ({
    email: `dev-admin-${n}@acadconnect.test`,
    role: 'admin',
    name: `Dev Admin ${n}`,
  }));
  const faculties = [1, 2, 3].map((n) => ({
    email: `dev-faculty-${n}@acadconnect.test`,
    role: 'faculty',
    name: `Dev Faculty ${n}`,
  }));
  const students = Array.from({ length: 11 }, (_, i) => {
    const n = String(i + 1).padStart(2, '0');
    return {
      email: `dev-student-${n}@acadconnect.test`,
      role: 'student',
      name: `Dev Student ${n}`,
    };
  });
  const legacy = [
    { email: 'admin@acadconnect.demo', role: 'admin', name: 'Demo Admin' },
  ];
  return [...legacy, ...admins, ...faculties, ...students];
}

async function ensureRoleProfile(knex, userId, role) {
  if (role === 'student') {
    const row = await knex('student_profiles').where({ user_id: userId }).first();
    if (!row) {
      await knex('student_profiles').insert({
        id: uuidv4(),
        user_id: userId,
        skills: [],
        interests: null,
        eligibility_status: 'eligible',
      });
    }
  } else if (role === 'faculty') {
    const row = await knex('faculty_profiles').where({ user_id: userId }).first();
    if (!row) {
      await knex('faculty_profiles').insert({
        id: uuidv4(),
        user_id: userId,
        research_areas: [],
        max_capacity: 3,
      });
    }
  }
}

async function removeWrongRoleProfile(knex, userId, role) {
  if (role !== 'student') {
    await knex('student_profiles').where({ user_id: userId }).del();
  }
  if (role !== 'faculty') {
    await knex('faculty_profiles').where({ user_id: userId }).del();
  }
}

/**
 * @param {import('knex').Knex} knex
 * @returns {Promise<{ count: number, password: string } | { skipped: true, count: number }>}
 */
async function syncDevAccounts(knex) {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SEED_IN_PRODUCTION !== '1') {
    return { skipped: true, count: 0, password: null };
  }

  const plain = PASSWORD();
  if (plain.length < 8) {
    throw new Error('DEV_SEED_PASSWORD must be at least 8 characters');
  }
  const password_hash = await bcrypt.hash(plain, 12);
  const roster = buildRoster();

  for (const acc of roster) {
    const email = acc.email.trim().toLowerCase();
    const existing = await knex('users')
      .whereRaw('LOWER(TRIM(email)) = ?', [email])
      .first();

    if (existing) {
      await knex('users').where({ id: existing.id }).update({
        password_hash,
        name: acc.name,
        role: acc.role,
        updated_at: knex.fn.now(),
      });
      await removeWrongRoleProfile(knex, existing.id, acc.role);
      await ensureRoleProfile(knex, existing.id, acc.role);
    } else {
      const id = uuidv4();
      await knex('users').insert({
        id,
        name: acc.name,
        email,
        password_hash,
        role: acc.role,
      });
      await ensureRoleProfile(knex, id, acc.role);
    }
  }

  return { count: roster.length, password: plain, skipped: false };
}

module.exports = { syncDevAccounts, buildRoster };
