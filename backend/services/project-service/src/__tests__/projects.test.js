/**
 * projects.test.js — Tests 45–52
 * POST /api/projects
 * GET  /api/projects
 * GET  /api/projects/:id
 */
jest.setTimeout(30000);
require('dotenv').config({ path: `${__dirname}/../../.env.test` });

const request = require('supertest');
const {
  projectApp,
  cleanDb,
  createStudent,
  createFaculty,
  createProject,
  authHeader,
} = require('./helpers');

afterEach(cleanDb);

// ─────────────────────────────────────────────────────────────────
describe('POST /api/projects', () => {
  // Test 45
  it('student creates a project with status=open', async () => {
    const { token: studentToken } = await createStudent();
    const res = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(studentToken))
      .send({ title: 'AI Research', description: 'Researching AI systems' });

    expect(res.status).toBe(201);
    expect(res.body.project).toMatchObject({ title: 'AI Research', status: 'open' });
    expect(res.body.project.id).toBeDefined();
  });

  // Test 46
  it('returns 403 when faculty tries to create a project', async () => {
    const { token: facultyToken } = await createFaculty();
    const res = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(facultyToken))
      .send({ title: 'Sneaky', description: 'Not allowed' });
    expect(res.status).toBe(403);
  });

  // Test 47
  it('returns 400 when title or description is missing', async () => {
    const { token: studentToken } = await createStudent();
    const res = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(studentToken))
      .send({ title: 'Only Title' }); // missing description
    expect(res.status).toBe(400);
  });

  // Test 48
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(projectApp)
      .post('/api/projects')
      .send({ title: 'No Auth', description: 'Should fail' });
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('GET /api/projects', () => {
  // Test 49
  it('authenticated user sees all projects with faculty_name', async () => {
    const { token: facultyToken } = await createFaculty({ name: 'Dr. Smith' });
    const { token: studentToken } = await createStudent();
    await createProject(studentToken, { title: 'Vision Research' });

    const res = await request(projectApp)
      .get('/api/projects')
      .set(authHeader(studentToken));

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.projects)).toBe(true);
    expect(res.body.projects.length).toBeGreaterThan(0);
    expect(res.body.projects[0]).toHaveProperty('faculty_name');
  });

  // Test 50
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(projectApp).get('/api/projects');
    expect(res.status).toBe(401);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('GET /api/projects/:id', () => {
  // Test 51
  it('any authenticated user gets a specific project', async () => {
    const { token: facultyToken } = await createFaculty();
    const { token: studentToken } = await createStudent();
    const project = await createProject(studentToken, { title: 'Specific Project' });

    const res = await request(projectApp)
      .get(`/api/projects/${project.id}`)
      .set(authHeader(studentToken));

    expect(res.status).toBe(200);
    expect(res.body.project.id).toBe(project.id);
    expect(res.body.project.title).toBe('Specific Project');
  });

  // Test 52
  it('returns 404 for non-existent project ID', async () => {
    const { token: studentToken } = await createStudent();
    const res = await request(projectApp)
      .get('/api/projects/00000000-0000-0000-0000-000000000000')
      .set(authHeader(studentToken));
    expect(res.status).toBe(404);
  });
});
