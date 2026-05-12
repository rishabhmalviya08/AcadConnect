/**
 * admin.test.js — Tests 25–44
 * GET /api/admin/users
 * GET /api/admin/users/:id
 * PUT /api/admin/users/:id/eligibility
 * GET /api/admin/audit-logs
 */
jest.setTimeout(30000);
require('dotenv').config({ path: `${__dirname}/../../.env.test` });

const request = require('supertest');
const { app, cleanDb, createStudent, createFaculty, createAdmin, authHeader } = require('./helpers');

afterEach(cleanDb);

// ─────────────────────────────────────────────────────────────────
describe('GET /api/admin/users', () => {
  // Test 25
  it('admin lists all users', async () => {
    const { token: adminToken } = await createAdmin();
    await createStudent();
    await createFaculty();

    const res = await request(app).get('/api/admin/users').set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeGreaterThanOrEqual(3); // admin + student + faculty
  });

  // Test 26
  it('admin filters by role=student', async () => {
    const { token: adminToken } = await createAdmin();
    await createStudent({ email: 's1@test.com' });
    await createFaculty();

    const res = await request(app)
      .get('/api/admin/users?role=student')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    res.body.users.forEach((u) => expect(u.role).toBe('student'));
  });

  // Test 27
  it('admin filters by role=faculty', async () => {
    const { token: adminToken } = await createAdmin();
    await createStudent();
    await createFaculty({ email: 'f1@test.com' });

    const res = await request(app)
      .get('/api/admin/users?role=faculty')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    res.body.users.forEach((u) => expect(u.role).toBe('faculty'));
  });

  // Test 28
  it('returns 403 when non-admin calls the endpoint', async () => {
    const { token: studentToken } = await createStudent();
    const res = await request(app).get('/api/admin/users').set(authHeader(studentToken));
    expect(res.status).toBe(403);
  });

  // Test 29
  it('returns 400 for invalid role filter value', async () => {
    const { token: adminToken } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/users?role=superman')
      .set(authHeader(adminToken));
    expect(res.status).toBe(400);
  });

  it('returns 400 for invalid eligibility_status filter', async () => {
    const { token: adminToken } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/users?eligibility_status=unknown')
      .set(authHeader(adminToken));
    expect(res.status).toBe(400);
  });

  it('filters by eligibility_status=probation (students on probation; staff still listed)', async () => {
    const { token: adminToken } = await createAdmin();
    const { user: s1 } = await createStudent({ email: 's_ok@test.com' });
    const { user: s2 } = await createStudent({ email: 's_prob@test.com' });
    await createFaculty({ email: 'f1@test.com' });

    await request(app)
      .put(`/api/admin/users/${s2.id}/eligibility`)
      .set(authHeader(adminToken))
      .send({ eligibility_status: 'probation' });

    const res = await request(app)
      .get('/api/admin/users?eligibility_status=probation')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    const ids = res.body.users.map((u) => u.id);
    expect(ids).toContain(s2.id);
    expect(ids).not.toContain(s1.id);
    expect(res.body.users.some((u) => u.role === 'faculty')).toBe(true);
    expect(res.body.users.some((u) => u.role === 'admin')).toBe(true);
  });

  it('sorts by role ascending', async () => {
    const { token: adminToken } = await createAdmin();
    await createStudent({ email: 's_sort@test.com' });
    await createFaculty({ email: 'f_sort@test.com' });

    const res = await request(app)
      .get('/api/admin/users?sort_by=role&sort_dir=asc')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    const roles = res.body.users.map((u) => u.role);
    const sorted = [...roles].sort();
    expect(roles).toEqual(sorted);
  });

  it('returns 400 for invalid sort_by', async () => {
    const { token: adminToken } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/users?sort_by=name')
      .set(authHeader(adminToken));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('GET /api/admin/users/:id', () => {
  // Test 30
  it('admin fetches a student by ID with profile', async () => {
    const { token: adminToken } = await createAdmin();
    const { user: student } = await createStudent();

    const res = await request(app)
      .get(`/api/admin/users/${student.id}`)
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(student.id);
    expect(res.body.user.profile).toBeDefined();
    expect(res.body.user.profile.eligibility_status).toBe('eligible');
  });

  // Test 31
  it('admin fetches a faculty by ID with profile + mentee_count', async () => {
    const { token: adminToken } = await createAdmin();
    const { user: faculty } = await createFaculty();

    const res = await request(app)
      .get(`/api/admin/users/${faculty.id}`)
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.user.profile.max_capacity).toBe(3);
    expect(res.body.user.profile.mentee_count).toBe(0);
  });

  // Test 32
  it('returns 404 for non-existent user ID', async () => {
    const { token: adminToken } = await createAdmin();
    const res = await request(app)
      .get('/api/admin/users/00000000-0000-0000-0000-000000000000')
      .set(authHeader(adminToken));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('PUT /api/admin/users/:id/eligibility', () => {
  // Tests 33–35
  it.each([['probation'], ['ineligible'], ['eligible']])(
    'admin sets student eligibility to %s → 200 + audit log created',
    async (status) => {
      const { token: adminToken } = await createAdmin();
      const { user: student } = await createStudent();

      const res = await request(app)
        .put(`/api/admin/users/${student.id}/eligibility`)
        .set(authHeader(adminToken))
        .send({ eligibility_status: status, reason: 'test reason' });

      expect(res.status).toBe(200);
      expect(res.body.eligibility_status).toBe(status);

      // Audit log check
      const logsRes = await request(app)
        .get('/api/admin/audit-logs')
        .set(authHeader(adminToken));
      expect(logsRes.body.logs.length).toBeGreaterThan(0);
      expect(logsRes.body.logs[0].action).toBe('ELIGIBILITY_CHANGE');
    }
  );

  // Test 36
  it('returns 400 for invalid status value', async () => {
    const { token: adminToken } = await createAdmin();
    const { user: student } = await createStudent();

    const res = await request(app)
      .put(`/api/admin/users/${student.id}/eligibility`)
      .set(authHeader(adminToken))
      .send({ eligibility_status: 'suspended' });
    expect(res.status).toBe(400);
  });

  // Test 37
  it('returns 404 when target user is faculty (not student)', async () => {
    const { token: adminToken } = await createAdmin();
    const { user: faculty } = await createFaculty();

    const res = await request(app)
      .put(`/api/admin/users/${faculty.id}/eligibility`)
      .set(authHeader(adminToken))
      .send({ eligibility_status: 'probation' });
    expect(res.status).toBe(404);
  });

  // Test 38
  it('returns 404 for non-existent user ID', async () => {
    const { token: adminToken } = await createAdmin();
    const res = await request(app)
      .put('/api/admin/users/00000000-0000-0000-0000-000000000000/eligibility')
      .set(authHeader(adminToken))
      .send({ eligibility_status: 'probation' });
    expect(res.status).toBe(404);
  });

  // Test 39
  it('returns 403 when non-admin calls the endpoint', async () => {
    const { token: studentToken } = await createStudent({ email: 's1@test.com' });
    const { user: student2 } = await createStudent({ email: 's2@test.com' });

    const res = await request(app)
      .put(`/api/admin/users/${student2.id}/eligibility`)
      .set(authHeader(studentToken))
      .send({ eligibility_status: 'probation' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('GET /api/admin/audit-logs', () => {
  let adminToken;
  let student;

  beforeEach(async () => {
    const adminResult = await createAdmin();
    adminToken = adminResult.token;
    const studentResult = await createStudent();
    student = studentResult.user;

    // Create an audit log entry
    await request(app)
      .put(`/api/admin/users/${student.id}/eligibility`)
      .set(authHeader(adminToken))
      .send({ eligibility_status: 'probation' });
  });

  // Test 40
  it('admin sees audit logs after eligibility change', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.logs.length).toBeGreaterThan(0);
    expect(res.body.total).toBeGreaterThan(0);
  });

  // Test 41
  it('pagination works with ?page=1&limit=5', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?page=1&limit=5')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(5);
    expect(Array.isArray(res.body.logs)).toBe(true);
  });

  // Test 42
  it('filters by ?action=ELIGIBILITY_CHANGE', async () => {
    const res = await request(app)
      .get('/api/admin/audit-logs?action=ELIGIBILITY_CHANGE')
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    res.body.logs.forEach((l) => expect(l.action).toBe('ELIGIBILITY_CHANGE'));
  });

  // Test 43
  it('filters by ?target_user_id', async () => {
    const res = await request(app)
      .get(`/api/admin/audit-logs?target_user_id=${student.id}`)
      .set(authHeader(adminToken));
    expect(res.status).toBe(200);
    res.body.logs.forEach((l) => expect(l.target_email).toBeDefined());
  });

  // Test 44
  it('returns 403 for non-admin request', async () => {
    const { token: studentToken } = await createStudent({ email: 'nonadmin@test.com' });
    const res = await request(app)
      .get('/api/admin/audit-logs')
      .set(authHeader(studentToken));
    expect(res.status).toBe(403);
  });
});
