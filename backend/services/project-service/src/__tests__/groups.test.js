/**
 * groups.test.js — Tests 53–72
 * POST /api/groups
 * PUT  /api/groups/:id/accept-invite
 * GET  /api/groups/me
 */
jest.setTimeout(30000);
require('dotenv').config({ path: `${__dirname}/../../.env.test` });

const request = require('supertest');
const {
  projectApp,
  cleanDb,
  createStudent,
  createFaculty,
  authHeader,
} = require('./helpers');

afterEach(cleanDb);

// Helper: create N students and return them
const makeStudents = async (n) => {
  const students = [];
  for (let i = 0; i < n; i++) {
    students.push(await createStudent());
  }
  return students;
};

// ─────────────────────────────────────────────────────────────────
describe('POST /api/groups', () => {
  // Test 53
  it('student creates a group with 2 invited members (3 total) → 201', async () => {
    const leader = await createStudent();
    const members = await makeStudents(2);

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({
        name: 'Team Alpha',
        member_emails: members.map((m) => m.user.email),
      });

    expect(res.status).toBe(201);
    expect(res.body.group_id).toBeDefined();
  });

  // Test 54
  it('student creates a group with 3 invited members (4 total) → 201', async () => {
    const leader = await createStudent();
    const members = await makeStudents(3);

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({
        name: 'Team Beta',
        member_emails: members.map((m) => m.user.email),
      });

    expect(res.status).toBe(201);
  });

  // Test 55
  it('student creates a group with 1 invited member (2 total) → 201', async () => {
    const leader = await createStudent();
    const [m1] = await makeStudents(1);

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Tiny Team', member_emails: [m1.user.email] });

    expect(res.status).toBe(201);
    expect(res.body.group_id).toBeDefined();
  });

  it('student creates a group with no invites (leader only) → 201', async () => {
    const leader = await createStudent();

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Solo Squad' });

    expect(res.status).toBe(201);
    expect(res.body.group_id).toBeDefined();

    const meRes = await request(projectApp).get('/api/groups/me').set(authHeader(leader.token));
    const g = meRes.body.groups.find((x) => x.group_id === res.body.group_id);
    expect(g).toBeDefined();
    expect(g.members).toHaveLength(1);
    expect(g.members[0].email).toBe(leader.user.email);
    expect(g.members[0].status).toBe('accepted');
  });

  // Test 56
  it('returns 400 when 4 invited members (5 total — too many)', async () => {
    const leader = await createStudent();
    const members = await makeStudents(4);

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({
        name: 'Giant Team',
        member_emails: members.map((m) => m.user.email),
      });

    expect(res.status).toBe(400);
  });

  // Test 57
  it('returns 400 when leader includes their own email', async () => {
    const leader = await createStudent();
    const [m1, m2] = await makeStudents(2);

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({
        name: 'Self Invite',
        member_emails: [leader.user.email, m1.user.email, m2.user.email].slice(0, 2),
      });

    // With leader's own email + 1 other = 2 total (too few), but the self-invite check fires first
    // Sending exactly self + 2 others = member_emails has 3 items → total = 4 → valid count
    // We must include ONLY leader email in member_emails to trigger the self-check:
    const res2 = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({
        name: 'Self Only',
        member_emails: [leader.user.email, m1.user.email],
      });

    expect(res2.status).toBe(400);
  });

  // Test 58
  it('returns 404 when invited email does not belong to a registered student', async () => {
    const leader = await createStudent();
    const [m1] = await makeStudents(1);

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({
        name: 'Unknown Email',
        member_emails: [m1.user.email, 'ghost@test.com'],
      });

    expect(res.status).toBe(404);
  });

  // Test 59
  it('returns 404 when an invited email belongs to a faculty member', async () => {
    const leader = await createStudent();
    const [m1] = await makeStudents(1);
    const { user: faculty } = await createFaculty();

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({
        name: 'Faculty Invite',
        member_emails: [m1.user.email, faculty.email],
      });

    expect(res.status).toBe(404);
  });

  // Test 60
  it('returns 403 when faculty tries to create a group', async () => {
    const { token: facultyToken } = await createFaculty();
    const [m1, m2] = await makeStudents(2);

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(facultyToken))
      .send({
        name: 'Prof Team',
        member_emails: [m1.user.email, m2.user.email],
      });

    expect(res.status).toBe(403);
  });

  // Test 61
  it('returns 400 when name is missing', async () => {
    const leader = await createStudent();
    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ member_emails: [] });
    expect(res.status).toBe(400);
  });

  it('returns 400 when member_emails is not an array', async () => {
    const leader = await createStudent();
    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Bad Emails', member_emails: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  // Test 62
  it('leader is stored as accepted, invitees as pending after creation', async () => {
    const leader = await createStudent();
    const [m1, m2] = await makeStudents(2);

    const createRes = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Status Check', member_emails: [m1.user.email, m2.user.email] });

    expect(createRes.status).toBe(201);

    // Check via GET /api/groups/me as leader
    const meRes = await request(projectApp)
      .get('/api/groups/me')
      .set(authHeader(leader.token));
    expect(meRes.status).toBe(200);

    const myGroup = meRes.body.groups.find((g) => g.group_id === createRes.body.group_id);
    expect(myGroup).toBeDefined();
    expect(myGroup.my_status).toBe('accepted');

    const leaderMember = myGroup.members.find((m) => m.email === leader.user.email);
    expect(leaderMember.status).toBe('accepted');

    const inviteeMember = myGroup.members.find((m) => m.email === m1.user.email);
    expect(inviteeMember.status).toBe('pending');
  });
});

// ─────────────────────────────────────────────────────────────────
describe('PUT /api/groups/:id/accept-invite', () => {
  let leader, invitee1, invitee2, groupId;

  beforeEach(async () => {
    leader = await createStudent();
    invitee1 = await createStudent();
    invitee2 = await createStudent();

    const res = await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Invite Test', member_emails: [invitee1.user.email, invitee2.user.email] });

    groupId = res.body.group_id;
  });

  // Test 63
  it('invited student accepts their invite → 200, status=accepted', async () => {
    const res = await request(projectApp)
      .put(`/api/groups/${groupId}/accept-invite`)
      .set(authHeader(invitee1.token));
    expect(res.status).toBe(200);

    // Verify status in GET /api/groups/me
    const meRes = await request(projectApp)
      .get('/api/groups/me')
      .set(authHeader(invitee1.token));
    const group = meRes.body.groups.find((g) => g.group_id === groupId);
    expect(group.my_status).toBe('accepted');
  });

  // Test 64
  it('returns 404 when student is not invited to the group', async () => {
    const stranger = await createStudent();
    const res = await request(projectApp)
      .put(`/api/groups/${groupId}/accept-invite`)
      .set(authHeader(stranger.token));
    expect(res.status).toBe(404);
  });

  // Test 65
  it('returns 400 when student has already accepted', async () => {
    await request(projectApp)
      .put(`/api/groups/${groupId}/accept-invite`)
      .set(authHeader(invitee1.token));

    const res = await request(projectApp)
      .put(`/api/groups/${groupId}/accept-invite`)
      .set(authHeader(invitee1.token));
    expect(res.status).toBe(400);
  });

  // Test 66
  it('returns 403 when non-student tries to accept invite', async () => {
    const { token: facultyToken } = await createFaculty();
    const res = await request(projectApp)
      .put(`/api/groups/${groupId}/accept-invite`)
      .set(authHeader(facultyToken));
    expect(res.status).toBe(403);
  });

  // Test 67
  it('returns 404 for non-existent group ID', async () => {
    const res = await request(projectApp)
      .put('/api/groups/00000000-0000-0000-0000-000000000000/accept-invite')
      .set(authHeader(invitee1.token));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────
describe('GET /api/groups/me', () => {
  // Test 68
  it('returns groups where student is leader (my_status=accepted)', async () => {
    const leader = await createStudent();
    const [m1, m2] = await makeStudents(2);

    await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Led Group', member_emails: [m1.user.email, m2.user.email] });

    const res = await request(projectApp)
      .get('/api/groups/me')
      .set(authHeader(leader.token));

    expect(res.status).toBe(200);
    expect(res.body.groups.length).toBeGreaterThan(0);
    expect(res.body.groups[0].my_status).toBe('accepted');
    expect(res.body.groups[0].leader_name).toBeDefined();
  });

  // Test 69
  it('returns groups where student is invited (my_status=pending)', async () => {
    const leader = await createStudent();
    const invitee = await createStudent();
    const [other] = await makeStudents(1);

    await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Pending Group', member_emails: [invitee.user.email, other.user.email] });

    const res = await request(projectApp)
      .get('/api/groups/me')
      .set(authHeader(invitee.token));

    expect(res.status).toBe(200);
    const pending = res.body.groups.find((g) => g.my_status === 'pending');
    expect(pending).toBeDefined();
  });

  // Test 70
  it('returns full member list for each group', async () => {
    const leader = await createStudent();
    const [m1, m2] = await makeStudents(2);

    await request(projectApp)
      .post('/api/groups')
      .set(authHeader(leader.token))
      .send({ name: 'Member List', member_emails: [m1.user.email, m2.user.email] });

    const res = await request(projectApp)
      .get('/api/groups/me')
      .set(authHeader(leader.token));

    expect(res.body.groups[0].members).toBeDefined();
    expect(res.body.groups[0].members.length).toBe(3); // leader + 2 invitees
  });

  // Test 71
  it('returns empty array when student has no groups', async () => {
    const loner = await createStudent();
    const res = await request(projectApp)
      .get('/api/groups/me')
      .set(authHeader(loner.token));
    expect(res.status).toBe(200);
    expect(res.body.groups).toEqual([]);
  });

  // Test 72
  it('returns 403 for non-student role', async () => {
    const { token: facultyToken } = await createFaculty();
    const res = await request(projectApp)
      .get('/api/groups/me')
      .set(authHeader(facultyToken));
    expect(res.status).toBe(403);
  });
});
