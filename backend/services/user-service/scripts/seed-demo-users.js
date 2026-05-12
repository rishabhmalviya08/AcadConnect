/**
 * Insert demo users (idempotent: skips existing emails).
 *
 * Usage (from user-service directory, with backend/.env DATABASE_URL set):
 *   npm run seed:demo-users
 *
 * Env:
 *   SEED_DEMO_PASSWORD — default: 12345678
 *   SEED_DEMO_ROLE — student | faculty | admin (default: student, only for new student demo rows)
 *   SEED_DEMO_UPDATE_PASSWORD=1 — reset password_hash for all seeded emails + dev admin
 *   SEED_ADMIN_EMAIL — default: admin@acadconnect.demo (role admin, same password)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const knex = require('knex');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const knexfile = require('../knexfile');
const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const db = knex(knexfile[env]);

const DEMO_STUDENT_EMAILS = [
  'cba@gmail.com',
  'dcba@gmail.com',
  'edcba@gmail.com',
  '123@gmail.com',
  '1234@gmail.com',
  '12345@gmail.com',
  '1000@gmail.com',
  '2000@gmail.com',
  '3000@gmail.com',
  'new@gmail.com',
  'newer@gmail.com',
];

function displayNameFromEmail(email) {
  const local = email.split('@')[0] || 'user';
  return `Demo ${local}`;
}

async function processAccount({
  email,
  role,
  name,
  password_hash,
  updatePassword,
  counters,
}) {
  const existing = await db('users').where({ email }).first();
  if (existing) {
    if (updatePassword) {
      await db('users').where({ email }).update({ password_hash });
      console.log(`password reset: ${email} (${role})`);
      counters.updated += 1;
    } else {
      console.log(`skip (exists): ${email}`);
      counters.skipped += 1;
    }
    return;
  }

  await db.transaction(async (trx) => {
    const userId = uuidv4();
    await trx('users').insert({
      id: userId,
      name,
      email,
      password_hash,
      role,
    });

    if (role === 'student') {
      await trx('student_profiles').insert({
        id: uuidv4(),
        user_id: userId,
        skills: [],
        interests: null,
        eligibility_status: 'eligible',
      });
    } else if (role === 'faculty') {
      await trx('faculty_profiles').insert({
        id: uuidv4(),
        user_id: userId,
        research_areas: [],
        max_capacity: 3,
      });
    }
  });

  console.log(`created: ${email} (${role})`);
  counters.created += 1;
}

async function main() {
  const password = process.env.SEED_DEMO_PASSWORD || '12345678';
  const defaultStudentRole = process.env.SEED_DEMO_ROLE || 'student';

  if (!['student', 'faculty', 'admin'].includes(defaultStudentRole)) {
    console.error("SEED_DEMO_ROLE must be 'student', 'faculty', or 'admin'");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('Password must be at least 8 characters');
    process.exit(1);
  }

  const password_hash = await bcrypt.hash(password, 12);
  const updatePassword = process.env.SEED_DEMO_UPDATE_PASSWORD === '1';
  const counters = { created: 0, skipped: 0, updated: 0 };

  for (const email of DEMO_STUDENT_EMAILS) {
    const normalized = email.trim().toLowerCase();
    await processAccount({
      email: normalized,
      role: defaultStudentRole,
      name: displayNameFromEmail(normalized),
      password_hash,
      updatePassword,
      counters,
    });
  }

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@acadconnect.demo')
    .trim()
    .toLowerCase();
  await processAccount({
    email: adminEmail,
    role: 'admin',
    name: 'Demo Admin',
    password_hash,
    updatePassword,
    counters,
  });

  console.log(
    `\nDone. created=${counters.created} skipped=${counters.skipped} password_reset=${counters.updated}`
  );
  console.log(`Dev admin login: ${adminEmail} / (SEED_DEMO_PASSWORD or 12345678)`);
  await db.destroy();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
