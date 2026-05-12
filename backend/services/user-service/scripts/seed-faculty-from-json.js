/**
 * Load AcadConnect/faculty.json into Postgres: users (role=faculty) + faculty_profiles.
 *
 * Usage (from user-service directory):
 *   npm run seed:faculty
 *
 * Env:
 *   FACULTY_JSON_PATH — absolute or relative path to JSON (default: repo AcadConnect/faculty.json)
 *   SEED_FACULTY_PASSWORD — bcrypt hash source for new accounts (default: ChangeMe_FacultySeed!2026)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const fs = require('fs');
const path = require('path');
const knex = require('knex');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const knexfile = require('../knexfile');
const env = process.env.NODE_ENV === 'production' ? 'production' : 'development';
const db = knex(knexfile[env]);

async function main() {
  const jsonPath =
    process.env.FACULTY_JSON_PATH ||
    path.resolve(__dirname, '../../../../faculty.json');

  if (!fs.existsSync(jsonPath)) {
    console.error(`Faculty JSON not found: ${jsonPath}`);
    process.exit(1);
  }

  const records = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  if (!Array.isArray(records)) {
    console.error('faculty.json must be a JSON array');
    process.exit(1);
  }

  const password = process.env.SEED_FACULTY_PASSWORD || 'ChangeMe_FacultySeed!2026';
  const password_hash = await bcrypt.hash(password, 12);

  let inserted = 0;
  let skipped = 0;

  for (const row of records) {
    const email = row.email;
    if (!email) continue;

    const existing = await db('users').where({ email }).first();
    if (existing) {
      skipped += 1;
      continue;
    }

    const name = `${row.first_name || ''} ${row.last_name || ''}`.trim() || email;
    const id = uuidv4();

    await db('users').insert({
      id,
      name,
      email,
      password_hash,
      role: 'faculty',
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    await db('faculty_profiles').insert({
      id: uuidv4(),
      user_id: id,
      research_areas: Array.isArray(row.research_areas) ? row.research_areas : [],
      max_capacity: row.max_capacity != null ? Number(row.max_capacity) : 3,
      created_at: db.fn.now(),
      updated_at: db.fn.now(),
    });

    inserted += 1;
  }

  console.log(`Faculty seed done: ${inserted} inserted, ${skipped} skipped (existing email).`);
  if (inserted > 0) {
    console.log(
      `Default login password for new faculty (change in production): ${process.env.SEED_FACULTY_PASSWORD || 'ChangeMe_FacultySeed!2026'}`
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.destroy());
