/**
 * Idempotent insert of 10 demo SE/CS projects (same logic as startup seed).
 *
 *   cd backend/services/project-service && npm run seed:sample-projects
 *
 * Env: DATABASE_URL, NODE_ENV, DISABLE_DEV_SAMPLE_PROJECTS, DEV_SAMPLE_PROJECTS_OWNER_EMAIL
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const knex = require('knex');
const knexConfig = require('../knexfile');
const { syncDevSampleProjects } = require('../src/lib/syncDevSampleProjects');

const env = process.env.NODE_ENV || 'development';
const db = knex(knexConfig[env]);

async function main() {
  const r = await syncDevSampleProjects(db);
  if (r.skipped) {
    console.log(`Skipped: ${r.reason || 'unknown'}`);
  } else {
    console.log(`Inserted ${r.inserted} new project(s).`);
  }
  await db.destroy();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
