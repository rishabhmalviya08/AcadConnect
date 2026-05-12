/**
 * requests.test.js — Tests 73–97
 * POST /api/requests
 * GET  /api/requests/faculty
 * PUT  /api/requests/:id/status
 * Capacity enforcement + auto-closure logic
 */
jest.setTimeout(30000);
require('dotenv').config({ path: `${__dirname}/../../.env.test` });

const request = require('supertest');
const {
  projectApp,
  userApp,
  db,
  cleanDb,
  createStudent,
  createFaculty,
  createProject,
  createFullGroup,
  authHeader,
} = require('./helpers');

afterEach(cleanDb);

// ─── Snippet Helpers ─────────────────────────────────────────────
const VALID_SNIPPET = 'This is a test snippet. '.repeat(5).trim(); // ~20 words
const LONG_SNIPPET = 'word '.repeat(201).trim(); // 201 words

// ─────────────────────────────────────────────────────────────────
describe('POST /api/requests', () => {
  let faculty, project, leader, invitees, groupId;

  /**
   * Sets up a faculty, a project, and a fully-accepted group with 3 members.
   */
  beforeEach(async () => {
    faculty = await createFaculty();
    leader = await createStudent();
    invitees = [await createStudent(), await createStudent()]; // 2 invitees → 3 total
    ({ groupId } = await createFullGroup(
      leader.token,
      invitees.map((i) => ({ email: i.user.email, token: i.token }))
    ));
    const pres = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(leader.token))
      .send({
        title: 'Test Project',
        description: 'A test project description',
        group_id: groupId,
      });
    if (pres.status !== 201) throw new Error(`seed project failed: ${JSON.stringify(pres.body)}`);
    project = pres.body.project;
  });

  // Test 73
  it('project owner with 3 accepted members submits a valid request → 201', async () => {
    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: VALID_SNIPPET });

    expect(res.status).toBe(201);
    expect(res.body.request_id).toBeDefined();
  });

  // Test 74
  it('returns 400 when snippet exceeds 200 words', async () => {
    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: LONG_SNIPPET });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/200/);
  });

  // Test 75
  it('returns 403 when requester is not the project owner', async () => {
    const nonLeader = invitees[0];
    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(nonLeader.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: VALID_SNIPPET });

    expect(res.status).toBe(403);
  });

  // Test 76
  it('allows PUT to link a group when only the leader has accepted (invites still pending)', async () => {
    const loneLeader = await createStudent();
    const [pending1, pending2] = [await createStudent(), await createStudent()];

    const createRes = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(loneLeader.token))
      .send({ name: 'Unaccepted Group', member_emails: [pending1.user.email, pending2.user.email] });

    const loneGroupId = createRes.body.group_id;

    const projRes = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(loneLeader.token))
      .send({ title: 'Solo for link test', description: 'D' });
    expect(projRes.status).toBe(201);
    const pid = projRes.body.project.id;

    const res = await request(projectApp)
      .put(`/api/projects/${pid}/group`)
      .set(authHeader(loneLeader.token))
      .send({ group_id: loneGroupId });

    expect(res.status).toBe(200);
    expect(res.body.group_id).toBe(loneGroupId);
  });

  // Test 77
  it('returns 400 when group has more than 4 accepted members (edge case)', async () => {
    const fac = await createFaculty();
    const bigLeader = await createStudent();
    const bigInvitees = await Promise.all([createStudent(), createStudent(), createStudent()]);
    const createRes = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(bigLeader.token))
      .send({
        name: 'Big Group',
        member_emails: bigInvitees.map((i) => i.user.email),
      });

    expect(createRes.status).toBe(201);
    const bigGroupId = createRes.body.group_id;

    for (const inv of bigInvitees) {
      await request(projectApp)
        .put(`/api/groups/${bigGroupId}/accept-invite`)
        .set(authHeader(inv.token));
    }

    const projRes = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(bigLeader.token))
      .send({
        title: 'Group project for capacity test',
        description: 'Description',
        group_id: bigGroupId,
      });
    expect(projRes.status).toBe(201);
    const bigProjectId = projRes.body.project.id;

    const extra = await createStudent();
    await db('group_members').insert({
      group_id: bigGroupId,
      student_id: extra.user.id,
      status: 'accepted',
    });

    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(bigLeader.token))
      .send({
        project_id: bigProjectId,
        faculty_id: fac.user.id,
        snippet: VALID_SNIPPET,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/4/);
  });

  // Test 78
  it('returns 404 when project does not exist', async () => {
    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({
        project_id: '00000000-0000-0000-0000-000000000000',
        faculty_id: faculty.user.id,
        snippet: VALID_SNIPPET,
      });
    expect(res.status).toBe(404);
  });

  // Test 79
  it('returns 400 when project is already closed', async () => {
    await db('projects').where({ id: project.id }).update({ status: 'closed' });

    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: VALID_SNIPPET });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/open/i);
  });

  // Test 80
  it('returns 409 when same group submits duplicate request to same project', async () => {
    await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: VALID_SNIPPET });

    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: VALID_SNIPPET });

    expect(res.status).toBe(409);
  });

  // Test 81
  it('returns 400 when required fields are missing', async () => {
    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id }); // missing faculty_id and snippet
    expect(res.status).toBe(400);
  });

  // Test 82
  it('returns 403 when non-student tries to submit a request', async () => {
    const res = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(faculty.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: VALID_SNIPPET });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('GET /api/requests/faculty', () => {
  // Test 83
  it('faculty sees all requests with group name and member list', async () => {
    const receivingFaculty = await createFaculty();
    const leader = await createStudent();
    const [m1, m2] = [await createStudent(), await createStudent()];
    const { groupId } = await createFullGroup(
      leader.token,
      [{ email: m1.user.email, token: m1.token }, { email: m2.user.email, token: m2.token }]
    );
    const pres = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(leader.token))
      .send({
        title: 'Listed project',
        description: 'For faculty inbox',
        group_id: groupId,
      });
    const project = pres.body.project;

    await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id, faculty_id: receivingFaculty.user.id, snippet: VALID_SNIPPET });

    const res = await request(projectApp)
      .get('/api/requests/faculty')
      .set(authHeader(receivingFaculty.token));

    expect(res.status).toBe(200);
    expect(res.body.requests.length).toBe(1);
    expect(res.body.requests[0].group_name).toBeDefined();
    expect(Array.isArray(res.body.requests[0].members)).toBe(true);
    expect(res.body.requests[0].members.length).toBeGreaterThan(0);
  });

  // Test 84
  it('returns empty array when no requests exist', async () => {
    const faculty = await createFaculty();
    const res = await request(projectApp)
      .get('/api/requests/faculty')
      .set(authHeader(faculty.token));
    expect(res.status).toBe(200);
    expect(res.body.requests).toEqual([]);
  });

  // Test 85
  it('returns 403 for non-faculty role', async () => {
    const { token: studentToken } = await createStudent();
    const res = await request(projectApp)
      .get('/api/requests/faculty')
      .set(authHeader(studentToken));
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('PUT /api/requests/:id/status', () => {
  let faculty, project, leader, invitees, groupId, requestId;

  beforeEach(async () => {
    faculty = await createFaculty();
    leader = await createStudent();
    invitees = [await createStudent(), await createStudent()];
    ({ groupId } = await createFullGroup(
      leader.token,
      invitees.map((i) => ({ email: i.user.email, token: i.token }))
    ));
    const pres = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(leader.token))
      .send({
        title: 'Status test project',
        description: 'For PUT /requests/:id/status',
        group_id: groupId,
      });
    project = pres.body.project;

    const reqRes = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({ project_id: project.id, faculty_id: faculty.user.id, snippet: VALID_SNIPPET });
    requestId = reqRes.body.request_id;
  });

  // Test 86
  it('faculty accepts a pending request → 200, request=accepted, project=in_progress', async () => {
    const res = await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);

    // Verify project status upgraded
    const projectRes = await request(projectApp)
      .get(`/api/projects/${project.id}`)
      .set(authHeader(faculty.token));
    expect(projectRes.body.project.status).toBe('in_progress');
  });

  // Test 87
  it('faculty rejects a pending request → 200, request=rejected', async () => {
    const res = await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'rejected' });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/rejected/i);
  });

  // Test 88
  it("returns 403 when faculty tries to alter another faculty's request", async () => {
    const otherFaculty = await createFaculty();
    const res = await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(otherFaculty.token))
      .send({ status: 'accepted' });
    expect(res.status).toBe(403);
  });

  // Test 89 & 90
  it('returns 400 when request is already accepted or rejected', async () => {
    // Accept first
    await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });

    // Try to accept again
    const res = await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });
    expect(res.status).toBe(400);
  });

  // Test 91
  it('returns 404 for non-existent request ID', async () => {
    const res = await request(projectApp)
      .put('/api/requests/00000000-0000-0000-0000-000000000000/status')
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });
    expect(res.status).toBe(404);
  });

  // Test 92
  it('returns 403 for non-faculty role', async () => {
    const res = await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(leader.token))
      .send({ status: 'accepted' });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('Capacity Enforcement', () => {
  const buildGroupProjectAndRequest = async (facultyUserId) => {
    const groupLeader = await createStudent();
    const members = [await createStudent(), await createStudent()];
    const { groupId } = await createFullGroup(
      groupLeader.token,
      members.map((m) => ({ email: m.user.email, token: m.token }))
    );
    const pres = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(groupLeader.token))
      .send({
        title: 'Capacity test project',
        description: 'Description',
        group_id: groupId,
      });
    const projectId = pres.body.project.id;
    const reqRes = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(groupLeader.token))
      .send({
        project_id: projectId,
        faculty_id: facultyUserId,
        snippet: VALID_SNIPPET,
      });
    if (reqRes.status !== 201) throw new Error(`seed request failed: ${JSON.stringify(reqRes.body)}`);
    return { groupLeader, groupId, projectId, requestId: reqRes.body.request_id };
  };

  // Test 93
  it('faculty at max_capacity=3 cannot accept a 4th request → 400', async () => {
    const faculty = await createFaculty();

    const reqs = [];
    for (let i = 0; i < 4; i++) {
      const { requestId, projectId } = await buildGroupProjectAndRequest(faculty.user.id);
      reqs.push({ requestId, projectId });
    }

    // Accept the first 3
    for (let i = 0; i < 3; i++) {
      const res = await request(projectApp)
        .put(`/api/requests/${reqs[i].requestId}/status`)
        .set(authHeader(faculty.token))
        .send({ status: 'accepted' });
      expect(res.status).toBe(200);
    }

    // 4th should fail — but projects 1–2 are now 'closed' by auto-closure
    // Create a separate project that is still open
    // Note: after 3 accepts, auto-closure fires → open projects become closed
    // So the 4th request was placed on a project that may be closed. The capacity check
    // fires before the project status check in the code, so we test directly:
    const fourthRes = await request(projectApp)
      .put(`/api/requests/${reqs[3].requestId}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });

    expect(fourthRes.status).toBe(400);
    expect(fourthRes.body.error).toMatch(/max capacity/i);
  });

  // Test 94
  it('faculty with max_capacity=1 can accept exactly 1 request successfully', async () => {
    const faculty = await createFaculty();

    // Set max capacity to 1 via user-service
    await request(userApp)
      .put('/api/users/me')
      .set(authHeader(faculty.token))
      .send({ max_capacity: 1 });

    const { requestId } = await buildGroupProjectAndRequest(faculty.user.id);

    const res = await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });

    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('Auto-Closure', () => {
  const buildGroupProjectAndRequest = async (facultyUserId) => {
    const leader = await createStudent();
    const members = [await createStudent(), await createStudent()];
    const { groupId } = await createFullGroup(
      leader.token,
      members.map((m) => ({ email: m.user.email, token: m.token }))
    );
    const pres = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(leader.token))
      .send({
        title: 'Auto-closure project',
        description: 'Description',
        group_id: groupId,
      });
    const projectId = pres.body.project.id;
    const reqRes = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(leader.token))
      .send({
        project_id: projectId,
        faculty_id: facultyUserId,
        snippet: VALID_SNIPPET,
      });
    if (reqRes.status !== 201) throw new Error(`seed request failed: ${JSON.stringify(reqRes.body)}`);
    return { leader, groupId, projectId, requestId: reqRes.body.request_id };
  };

  // Test 95
  it('accepting at max_capacity rejects other pending requests to the same faculty', async () => {
    const faculty = await createFaculty();

    await request(userApp)
      .put('/api/users/me')
      .set(authHeader(faculty.token))
      .send({ max_capacity: 1 });

    const { requestId: req1Id, projectId: _proj1 } = await buildGroupProjectAndRequest(faculty.user.id);
    const { requestId: req2Id, projectId: proj2 } = await buildGroupProjectAndRequest(faculty.user.id);

    await request(projectApp)
      .put(`/api/requests/${req1Id}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });

    const req2row = await db('project_requests').where({ id: req2Id }).first();
    expect(req2row.status).toBe('rejected');

    const proj2Res = await request(projectApp)
      .get(`/api/projects/${proj2}`)
      .set(authHeader(faculty.token));

    expect(proj2Res.body.project.status).toBe('open');
  });

  // Test 96
  it('accepting at capacity does not change unrelated project statuses', async () => {
    const faculty = await createFaculty();

    await request(userApp)
      .put('/api/users/me')
      .set(authHeader(faculty.token))
      .send({ max_capacity: 1 });

    const ownerA = await createStudent();
    const pIp = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(ownerA.token))
      .send({ title: 'In Progress', description: 'D' });
    expect(pIp.status).toBe(201);
    const proj_in_progress = pIp.body.project;
    await db('projects').where({ id: proj_in_progress.id }).update({ status: 'in_progress' });

    const ownerB = await createStudent();
    const pCl = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(ownerB.token))
      .send({ title: 'Already Closed', description: 'D' });
    expect(pCl.status).toBe(201);
    const proj_closed = pCl.body.project;
    await db('projects').where({ id: proj_closed.id }).update({ status: 'closed' });

    const { requestId } = await buildGroupProjectAndRequest(faculty.user.id);

    await request(projectApp)
      .put(`/api/requests/${requestId}/status`)
      .set(authHeader(faculty.token))
      .send({ status: 'accepted' });

    const ipRes = await request(projectApp)
      .get(`/api/projects/${proj_in_progress.id}`)
      .set(authHeader(faculty.token));
    expect(ipRes.body.project.status).toBe('in_progress');

    const clRes = await request(projectApp)
      .get(`/api/projects/${proj_closed.id}`)
      .set(authHeader(faculty.token));
    expect(clRes.body.project.status).toBe('closed');
  });

  // Test 97
  it('returns 400 when owner submits mentorship for a closed project', async () => {
    const faculty = await createFaculty();
    const owner = await createStudent();
    const pres = await request(projectApp)
      .post('/api/projects')
      .set(authHeader(owner.token))
      .send({ title: 'Closed proj', description: 'D' });
    expect(pres.status).toBe(201);
    const proj = pres.body.project;
    await db('projects').where({ id: proj.id }).update({ status: 'closed' });

    const newReqRes = await request(projectApp)
      .post('/api/requests')
      .set(authHeader(owner.token))
      .send({
        project_id: proj.id,
        faculty_id: faculty.user.id,
        snippet: VALID_SNIPPET,
      });

    expect(newReqRes.status).toBe(400);
    expect(newReqRes.body.error).toMatch(/open/i);
  });
});
