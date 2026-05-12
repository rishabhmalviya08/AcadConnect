/**
 * helpers.js — project-service test utilities
 *
 * Provides user factories (via user-service app), project-service app reference,
 * group helpers, and DB cleanup — used across all project-service test suites.
 */
require('dotenv').config({ path: `${__dirname}/../../.env.test` });

const request = require('supertest');
const knex = require('knex');

// Load both apps
const projectApp = require('../index');
const userApp = require('../../../user-service/src/index');

// ─── Shared DB Instance ──────────────────────────────────────────
const db = knex({
  client: 'pg',
  connection: process.env.TEST_DATABASE_URL,
});

// ─── Cleanup ─────────────────────────────────────────────────────
const cleanDb = async () => {
  await db.raw(`
    TRUNCATE TABLE
      audit_logs,
      project_requests,
      group_members,
      groups,
      projects,
      student_profiles,
      faculty_profiles,
      users
    RESTART IDENTITY CASCADE
  `);
};

// ─── Auth Header ─────────────────────────────────────────────────
const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

// ─── User Factories (via user-service) ───────────────────────────
const createStudent = async (overrides = {}) => {
  const defaults = {
    name: 'Test Student',
    email: `student_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    role: 'student',
  };
  const payload = { ...defaults, ...overrides };
  const res = await request(userApp).post('/api/auth/register').send(payload);
  if (res.status !== 201) throw new Error(`createStudent failed: ${JSON.stringify(res.body)}`);
  return { user: res.body.user, token: res.body.token };
};

const createFaculty = async (overrides = {}) => {
  const defaults = {
    name: 'Test Faculty',
    email: `faculty_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`,
    password: 'password123',
    role: 'faculty',
  };
  const payload = { ...defaults, ...overrides };
  const res = await request(userApp).post('/api/auth/register').send(payload);
  if (res.status !== 201) throw new Error(`createFaculty failed: ${JSON.stringify(res.body)}`);
  return { user: res.body.user, token: res.body.token };
};

// ─── Project Factory (student creator) ─────────────────────────
const createProject = async (studentToken, overrides = {}) => {
  const payload = {
    title: 'Test Project',
    description: 'A test project description',
    ...overrides,
  };
  const res = await request(projectApp)
    .post('/api/projects')
    .set(authHeader(studentToken))
    .send(payload);
  if (res.status !== 201) throw new Error(`createProject failed: ${JSON.stringify(res.body)}`);
  return res.body.project;
};

// ─── Group Helpers ────────────────────────────────────────────────
/**
 * Creates a group and has all invited members accept their invites.
 * Returns { groupId } with all invitees now in 'accepted' status.
 *
 * @param {string} leaderToken - JWT of the group leader
 * @param {Array<{email: string, token: string}>} members - invited members
 */
const createFullGroup = async (leaderToken, members) => {
  const member_emails = members.map((m) => m.email);
  const res = await request(projectApp)
    .post('/api/groups')
    .set(authHeader(leaderToken))
    .send({ name: `Group_${Date.now()}`, member_emails });

  if (res.status !== 201) throw new Error(`createFullGroup failed: ${JSON.stringify(res.body)}`);
  const groupId = res.body.group_id;

  // Have each invited member accept
  for (const member of members) {
    await request(projectApp)
      .put(`/api/groups/${groupId}/accept-invite`)
      .set(authHeader(member.token));
  }

  return { groupId };
};

module.exports = {
  projectApp,
  userApp,
  db,
  cleanDb,
  authHeader,
  createStudent,
  createFaculty,
  createProject,
  createFullGroup,
};
