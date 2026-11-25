// End-to-end test of the student role: registration & approval, first-login password change, available students,
// teams, invitations, join requests, leader/member permissions, topics, stages, published grades, messaging, security.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'pms-stu-'));
process.env.LOG = 'off';
process.env.DB_PATH = join(dir, 'pg');
process.env.UPLOAD_DIR = join(dir, 'up');
const { server } = await import('../server.js');
const { db } = await import('../src/db.js');
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

async function call(method, path, body, token) {
  const res = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const login = async (id, password) => { const r = await call('POST', '/login', { email: id, password }); return r.body.token; };
const b64 = s => Buffer.from(s).toString('base64');
const pdf = b64('%PDF-1.4 test');
let n = 0; const ok = name => console.log(`ok ${++n} - ${name}`);
const is = async (p, status, name) => { const r = await p; assert.equal(r.status, status, `${name}: got ${r.status} ${JSON.stringify(r.body)}`); ok(name); return r; };
const keys = async tok => (await call('GET', '/notifications', null, tok)).body.map(x => JSON.parse(x.message).k);
const day = off => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);

const admin = await login('admin@example.com', 'admin123');
const doc = await login('doctor@example.com', 'doctor123');
const course = (await call('GET', '/courses', null, admin)).body[0];
const course2 = (await call('POST', '/courses', { name: 'Databases' }, admin)).body;
const supId = (await call('GET', '/supervisors', null, admin)).body[0].id;

// =============== 1. Registration & admin approval ===============
const reg = (body) => call('POST', '/register', body);
await is(reg({ universityId: '99999999' }), 403, 'ID that is not in the approved list is rejected');
await is(reg({ universityId: 'bad id!' }), 400, 'malformed University ID rejected');
const rq = await is(reg({ universityId: '20240003', email: 'omar.private@gmail.com' }), 200, 'registration request for an approved ID');
assert.equal(rq.body.status, 'pending'); ok('request starts as Pending Approval');
await is(reg({ universityId: '20240003' }), 409, 'duplicate registration request rejected');
await is(call('POST', '/login', { email: '20240003', password: '20240003' }), 403, 'pending student cannot log in (told why)');
assert.equal((await call('POST', '/login', { email: '20240003', password: '20240003' })).body.error, 'Your registration request is pending approval'); ok('pending message shown only with the initial password');
await is(call('POST', '/login', { email: '20240003', password: 'guess' }), 401, 'a wrong password reveals nothing');
await is(call('GET', '/registrations', null, doc), 403, 'supervisor cannot see registration requests');
const list = (await call('GET', '/registrations?status=pending', null, admin)).body;
assert.equal(list.length, 1); assert.equal(list[0].university_id, '20240003'); ok('admin sees the pending request');
await is(call('POST', `/registrations/${rq.body.id}/approve`, {}, doc), 403, 'supervisor cannot approve registrations');
const ap = await is(call('POST', `/registrations/${rq.body.id}/approve`, {}, admin), 200, 'admin approves');
await is(call('POST', `/registrations/${rq.body.id}/approve`, {}, admin), 409, 'a request is decided only once');
const decided = (await call('GET', '/registrations?status=approved', null, admin)).body[0];
assert.ok(decided.decided_at && decided.decided_by === 'System Admin'); ok('decision and timestamp recorded');
// second student: rejected, then may apply again
const rq2 = (await reg({ universityId: '20240004' })).body;
await is(call('POST', `/registrations/${rq2.id}/reject`, { note: 'Not enrolled this term' }, admin), 200, 'admin rejects a request');
await is(call('POST', '/login', { email: '20240004', password: '20240004' }), 403, 'rejected student cannot log in');
assert.equal((await call('POST', '/login', { email: '20240004', password: '20240004' })).body.error, 'Your registration request was rejected'); ok('rejected message shown');
await is(reg({ universityId: '20240004' }), 200, 'a rejected student can apply again');
// first login: initial password = University ID, forced change
const lg = await call('POST', '/login', { email: '20240003', password: '20240003' });
assert.equal(lg.status, 200); assert.equal(lg.body.user.must_change_password, true); const omar = lg.body.token; ok('initial password equals the University ID');
assert.equal(lg.body.user.email, null); ok('login response does not expose a placeholder e-mail');
await is(call('GET', '/research', null, omar), 403, 'dashboard blocked until the password is changed');
await is(call('GET', '/student/dashboard', null, omar), 403, 'student dashboard blocked too');
await is(call('GET', '/me', null, omar), 200, 'but /me works (the UI needs it)');
await is(call('POST', '/me/password', { currentPassword: '20240003', newPassword: '20240003' }, omar), 400, 'new password must differ');
await is(call('POST', '/me/password', { currentPassword: '20240003', newPassword: '123' }, omar), 400, 'weak password refused');
await is(call('POST', '/me/password', { currentPassword: '20240003', newPassword: 'omar-secret-1' }, omar), 200, 'first password change');
await is(call('GET', '/research', null, omar), 200, 'access after changing the password');
assert.equal((await call('POST', '/login', { email: '20240003', password: '20240003' })).status, 401); ok('the initial password stops working');
const omar2 = await login('20240003', 'omar-secret-1'); assert.ok(omar2); ok('the new password works');
assert.ok((await keys(omar2)).includes('n.registration.approved')); ok('approval notification waiting for the student');
const row = (await db.prepare('SELECT password_hash FROM users WHERE university_id=?').get('20240003'));
assert.ok(/^[0-9a-f]{32}:[0-9a-f]{128}$/.test(row.password_hash)); ok('password stored as a salted scrypt hash');
for (let i = 0; i < 6; i++) await call('POST', '/login', { email: '20240001', password: 'wrong' });
await is(call('POST', '/login', { email: '20240001', password: 'student123' }), 429, 'brute force on a student account is rate limited');

// =============== 2. Available students & course settings ===============
const A = await login('20240002', 'student123');           // Lina — will be a team leader
const B = omar2;                                            // Omar
(await db.prepare("UPDATE users SET must_change_password=0").run());
const idOf = async id => (await db.prepare('SELECT id FROM users WHERE university_id=?').get(id)).id;
// more students (admin-created with their ID as initial password) and one NOT enrolled in the course
const mkStu = async (uid, courses = [course.id]) => { await call('POST', '/users', { name: 'S' + uid, universityId: uid, role: 'student', courseIds: courses }, admin); (await db.prepare('UPDATE users SET must_change_password=0, password_hash=(SELECT password_hash FROM users WHERE university_id=?) WHERE university_id=?').run('20240003', uid)); return null; };
// every created student gets the same hash as Omar => password 'omar-secret-1'
for (const id of ['S10001', 'S10002', 'S10003', 'S10004']) await mkStu(id);
await call('POST', '/users', { name: 'Outsider', universityId: 'S90000', role: 'student', courseIds: [course2.id] }, admin);
(await db.prepare('UPDATE users SET must_change_password=0, password_hash=(SELECT password_hash FROM users WHERE university_id=?) WHERE university_id=?').run('20240003', 'S90000'));
const tok = id => login(id, 'omar-secret-1');
const [S1, S2, S3, S4, OUT] = [await tok('S10001'), await tok('S10002'), await tok('S10003'), await tok('S10004'), await tok('S90000')];
assert.ok(S1 && OUT); ok('admin-created students log in with their ID (initial password flow)');
const avail = (tk, c = course.id) => call('GET', `/available-students?courseId=${c}`, null, tk);
let av = (await avail(A)).body;
assert.ok(av.length >= 5 && !av.some(s => s.name === 'Lina')); ok('available students: same course only, never myself');
assert.ok(!av.some(s => s.name === 'SS90000' || s.name === 'Outsider')); ok('students of other courses are not listed');
assert.ok(av.every(s => s.status === 'available' && !('email' in s) && !('password_hash' in s))); ok('no private fields (e-mail, password) in the list');
assert.ok(av.every(s => s.university_id)); ok('University IDs are shown (privacy setting on)');
await is(avail(OUT), 403, 'a student not enrolled in the course cannot browse it');
assert.equal((await call('GET', '/courses', null, OUT)).body.length, 1); ok('students only see their own courses');
await is(call('PUT', `/courses/${course.id}/settings`, { show_student_ids: false }, A), 403, 'students cannot change course settings');
await is(call('PUT', `/courses/${course.id}/settings`, { show_student_ids: false }, doc), 200, 'supervisor sets the privacy setting');
assert.ok((await avail(A)).body.every(s => s.university_id === null)); ok('University IDs hidden when privacy is on');
await call('PUT', `/courses/${course.id}/settings`, { show_student_ids: true }, doc);
await is(call('PUT', `/courses/${course.id}/settings`, { min_team_size: 5, max_team_size: 2 }, doc), 400, 'invalid team size limits rejected');
await is(call('PUT', `/courses/${course.id}/settings`, { team_mode: 'weird' }, doc), 400, 'invalid team mode rejected');

// =============== 3. Team creation ===============
await is(call('POST', '/my/teams', { courseId: course.id, name: '' }, A), 400, 'team needs a name');
await is(call('POST', '/my/teams', { courseId: course2.id, name: 'X' }, A), 403, 'cannot create a team for a course I am not enrolled in');
await call('PUT', `/courses/${course.id}/settings`, { team_mode: 'individual' }, doc);
await is(call('POST', '/my/teams', { courseId: course.id, name: 'Alpha' }, A), 409, 'course that only allows individual research refuses teams');
assert.equal((await avail(A)).body.length, 0); ok('no available students in an individual-only course');
await call('PUT', `/courses/${course.id}/settings`, { team_mode: 'both', max_team_size: 3, min_team_size: 2 }, doc);
const t1 = (await is(call('POST', '/my/teams', { courseId: course.id, name: 'Alpha', idea: 'Smart campus', description: 'IoT sensors' }, A), 200, 'student creates a team')).body.id;
let mine = (await call('GET', '/my/teams', null, A)).body;
assert.equal(mine.length, 1); assert.equal(mine[0].my_role, 'leader'); assert.equal(mine[0].members.find(m => m.leader).name, 'Lina'); assert.equal(mine[0].max_size, 3); ok('the creator is the Team Leader');
await is(call('POST', '/my/teams', { courseId: course.id, name: 'Alpha2' }, A), 409, 'one team per student per course');
await is(call('POST', '/my/teams', { courseId: course.id, name: 'alpha' }, B), 409, 'team name is unique in the course');
assert.ok(!(await avail(B)).body.some(s => s.name === 'Lina')); ok('a student who created a team leaves the available list');

// =============== 4. Invitations ===============
const inv = (tk, team, who) => call('POST', `/teams/${team}/invitations`, typeof who === 'number' ? { userId: who } : { universityId: who }, tk);
await is(inv(B, t1, 'S10001'), 403, 'only the leader can invite');
await is(inv(A, t1, '20240002'), 400, 'cannot invite myself');
await is(inv(A, t1, 'NOPE'), 404, 'unknown University ID');
await is(inv(A, t1, 'S90000'), 409, 'invited student must be enrolled in the course');
const i1 = (await is(inv(A, t1, '20240003'), 200, 'leader invites by University ID')).body.id;
await is(inv(A, t1, '20240003'), 409, 'duplicate invitation refused');
assert.ok((await keys(B)).includes('n.invitation.received')); ok('invited student notified');
let invs = (await call('GET', '/invitations', null, B)).body;
assert.equal(invs[0].status, 'pending'); assert.equal(invs[0].team, 'Alpha'); ok('student sees the pending invitation');
await is(call('POST', `/invitations/${i1}/respond`, { accept: true }, S1), 403, "cannot answer someone else's invitation");
await is(call('POST', `/invitations/${i1}/respond`, { accept: true }, B), 200, 'invited student accepts');
await is(call('POST', `/invitations/${i1}/respond`, { accept: true }, B), 409, 'an invitation is answered once');
assert.ok((await keys(A)).includes('n.invitation.accepted')); ok('leader notified of the acceptance');
mine = (await call('GET', '/my/teams', null, B)).body;
assert.equal(mine[0].my_role, 'member'); assert.equal(mine[0].size, 2); ok('membership updated after acceptance');
assert.ok(!(await avail(S1)).body.some(s => s.name === 'Omar')); ok('the new member disappears from Available Students');
// reject / cancel
const i2 = (await inv(A, t1, 'S10001')).body.id;
await is(call('POST', `/invitations/${i2}/respond`, { accept: false }, S1), 200, 'invited student rejects');
assert.ok((await keys(A)).includes('n.invitation.rejected')); ok('leader notified of the rejection');
const i3 = (await is(inv(A, t1, 'S10001'), 200, 're-invite after a rejection')).body.id;
await is(call('POST', `/invitations/${i3}/cancel`, {}, B), 403, 'a member cannot cancel invitations');
await is(call('POST', `/invitations/${i3}/cancel`, {}, A), 200, 'leader cancels a pending invitation');
await is(call('POST', `/invitations/${i3}/respond`, { accept: true }, S1), 409, 'cancelled invitation cannot be accepted');
const st = (await db.prepare('SELECT status FROM team_invitations ORDER BY id').all()).map(x => x.status);
assert.deepEqual(st, ['accepted', 'rejected', 'cancelled']); ok('invitation statuses: accepted / rejected / cancelled');
// size limit: max is 3 → third member fits, a fourth does not
const i4 = (await inv(A, t1, 'S10002')).body.id; await call('POST', `/invitations/${i4}/respond`, { accept: true }, S2);
await is(inv(A, t1, 'S10003'), 409, 'maximum team size enforced when inviting');
assert.equal((await call('GET', '/my/teams', null, A)).body[0].size, 3); ok('team has three members');

// =============== 5. Discovery & join requests ===============
let disc = (await call('GET', `/discover-teams?courseId=${course.id}`, null, S3)).body;
assert.ok(!disc.some(t => t.id === t1)); ok('a full team is not offered for joining');
await call('PUT', `/courses/${course.id}/settings`, { max_team_size: 4 }, doc);
disc = (await call('GET', `/discover-teams?courseId=${course.id}`, null, S3)).body;
const d1 = disc.find(t => t.id === t1);
assert.ok(d1 && d1.leader === 'Lina' && d1.places === 1 && d1.size === 3 && d1.max_size === 4 && d1.idea === 'Smart campus' && d1.members.length === 3 && d1.status === 'accepting'); ok('discovery shows leader, members, size, places, idea, status');
await is(call('GET', `/discover-teams?courseId=${course.id}`, null, OUT), 403, 'outsiders cannot browse teams');
const j1 = (await is(call('POST', `/teams/${t1}/join-requests`, { message: 'I know Node.js' }, S3), 200, 'student requests to join')).body.id;
await is(call('POST', `/teams/${t1}/join-requests`, {}, S3), 409, 'duplicate join request refused');
await is(call('POST', `/teams/${t1}/join-requests`, {}, B), 409, 'a student who already has a team cannot request another');
assert.ok((await keys(A)).includes('n.join.request')); ok('leader notified of the request');
await is(call('GET', `/teams/${t1}/join-requests`, null, B), 403, 'members cannot read join requests');
const jl = (await is(call('GET', `/teams/${t1}/join-requests`, null, A), 200, 'leader reads join requests')).body;
assert.equal(jl[0].name, 'SS10003'); assert.equal(jl[0].message, 'I know Node.js'); ok('leader sees the requester information');
await is(call('POST', `/join-requests/${j1}/respond`, { accept: true }, B), 403, 'only the leader answers join requests');
await is(call('POST', `/join-requests/${j1}/respond`, { accept: false }, A), 200, 'leader rejects');
assert.ok((await keys(S3)).includes('n.join.rejected')); ok('requester notified of the rejection');
const j2 = (await call('POST', `/teams/${t1}/join-requests`, {}, S3)).body.id;
await is(call('POST', `/join-requests/${j2}/cancel`, {}, S4), 403, "cannot cancel someone else's request");
await is(call('POST', `/join-requests/${j2}/cancel`, {}, S3), 200, 'requester cancels');
const j3 = (await call('POST', `/teams/${t1}/join-requests`, {}, S3)).body.id;
await is(call('POST', `/join-requests/${j3}/respond`, { accept: true }, A), 200, 'leader accepts');
assert.deepEqual((await db.prepare('SELECT status FROM join_requests ORDER BY id').all()).map(x => x.status), ['rejected', 'cancelled', 'accepted']); ok('join request statuses tracked');
assert.ok((await keys(S3)).includes('n.join.accepted') && (await keys(B)).includes('n.team.member_joined')); ok('requester and members notified');
await is(call('POST', `/teams/${t1}/join-requests`, {}, S4), 409, 'a team at maximum capacity refuses requests');
await call('PUT', `/my/teams/${t1}`, { accepting: false }, A);
await call('PUT', `/courses/${course.id}/settings`, { max_team_size: 5 }, doc);
await is(call('POST', `/teams/${t1}/join-requests`, {}, S4), 409, 'a team that is not accepting members refuses requests');
await call('PUT', `/my/teams/${t1}`, { accepting: true }, A);
// invitation code
await is(call('POST', `/teams/${t1}/invite-code`, { action: 'generate' }, B), 403, 'members cannot create invitation codes');
const code = (await is(call('POST', `/teams/${t1}/invite-code`, { action: 'generate' }, A), 200, 'leader generates an invitation code')).body.invite_code;
assert.ok(/^[A-Z0-9]{8}$/.test(code)); ok('code format');
await is(call('POST', '/teams/join-by-code', { code: 'WRONG123' }, S4), 404, 'wrong code refused');
await is(call('POST', '/teams/join-by-code', { code }, S4), 200, 'student joins with the code');
await call('POST', `/teams/${t1}/invite-code`, { action: 'disable' }, A);
await is(call('POST', '/teams/join-by-code', { code }, S4), 404, 'disabled code stops working');
assert.equal((await call('GET', '/my/teams', null, A)).body[0].size, 5); ok('five members now');

// =============== 6. Leader and member permissions ===============
await is(call('PUT', `/my/teams/${t1}`, { name: 'Hacked' }, B), 403, 'member cannot edit the team');
await is(call('PUT', `/my/teams/${t1}`, { name: 'Alpha Team' }, A), 200, 'leader edits the team name');
await is(call('DELETE', `/my/teams/${t1}`, null, B), 403, 'member cannot delete the team');
await is(call('DELETE', `/teams/${t1}/members/${(await idOf('S10004'))}`, null, B), 403, 'member cannot remove members');
await is(call('DELETE', `/teams/${t1}/members/${(await idOf('20240002'))}`, null, A), 400, 'leader cannot remove themselves');
await is(call('DELETE', `/teams/${t1}/members/${(await idOf('S10004'))}`, null, A), 200, 'leader removes a member (team not locked)');
assert.ok((await keys(S4)).includes('n.team.removed') && (await keys(B)).includes('n.team.member_left')); ok('removed member and team notified');
await is(avail(OUT, course2.id), 200, 'sanity: other course listing works for its students');
assert.ok((await avail(S1)).body.some(s => s.name === 'SS10004')); ok('a removed member is available again');
await is(call('PUT', `/teams/${t1}/leader`, { userId: (await idOf('S10002')) }, B), 403, 'member cannot change the leader');
await is(call('POST', `/teams/${t1}/leave`, {}, A), 409, 'leader must hand over leadership before leaving');
await is(call('POST', `/teams/${t1}/leave`, {}, S3), 200, 'member leaves an unlocked team');
await is(call('POST', `/teams/${t1}/invitations`, { universityId: 'S10003' }, A), 200, 're-invite the student who left');
await call('POST', '/invitations/' + (await db.prepare('SELECT MAX(id) AS i FROM team_invitations').get()).i + '/respond', { accept: true }, S3);
await is(call('PUT', `/teams/${t1}/leader`, { userId: (await idOf('20240003')) }, A), 200, 'leader hands over leadership');
await is(call('PUT', `/my/teams/${t1}`, { name: 'Again' }, A), 403, 'the former leader no longer has leader permissions');
await is(call('PUT', `/teams/${t1}/leader`, { userId: (await idOf('20240002')) }, B), 200, 'new leader hands it back');
const hist = (await call('GET', `/my/teams/${t1}/history`, null, B)).body.map(h => h.action);
for (const a of ['created_as_leader', 'joined', 'left', 'removed', 'leader_changed', 'renamed']) assert.ok(hist.includes(a), 'history has ' + a);
ok('membership history kept (joined / left / removed / leader changed / renamed)');
await is(call('GET', `/my/teams/${t1}/history`, null, S4), 403, 'outsiders cannot read the history');

// =============== 7. Research topic ===============
const topic = (tk, extra = {}) => call('POST', '/research', { title: 'Smart Campus', description: 'IoT', problem: 'Waste of energy', objectives: 'Measure and reduce', courseId: course.id, supervisorId: supId, ...extra }, tk);
await call('PUT', `/courses/${course.id}/settings`, { min_team_size: 6, max_team_size: 8 }, doc).then(r => assert.equal(r.status, 200));
await is(topic(A), 409, 'minimum team size enforced before registering a topic');
await call('PUT', `/courses/${course.id}/settings`, { min_team_size: 2, max_team_size: 5 }, doc);
await is(topic(B), 403, 'only the team leader registers the topic');
const rid = (await is(topic(A), 200, 'leader registers a topic (problem, objectives, no file needed)')).body.id;
await is(topic(A, { title: 'Second' }), 409, 'one active research per team and course');
let d = (await call('GET', `/research/${rid}`, null, B)).body;
assert.equal(d.status, 'pending'); assert.equal(d.problem, 'Waste of energy'); assert.equal(d.objectives, 'Measure and reduce'); assert.equal(d.is_leader, false); ok('members view the topic and its status');
await is(call('GET', `/research/${rid}`, null, S1), 403, 'students outside the team cannot view it');
await is(call('PUT', `/research/${rid}/topic`, { title: 'x' }, A), 409, 'a pending topic cannot be edited');
await is(call('POST', `/research/${rid}/request-changes`, { comment: 'Narrow the scope' }, doc), 200, 'supervisor requests modifications');
d = (await call('GET', `/research/${rid}`, null, A)).body;
assert.equal(d.status, 'changes_requested'); assert.equal(d.topic_reviews[0].comment, 'Narrow the scope'); assert.equal(d.can_edit_topic, true); ok('leader sees the feedback and may edit');
assert.equal((await call('GET', `/research/${rid}`, null, B)).body.can_edit_topic, false); ok('members cannot edit');
await is(call('PUT', `/research/${rid}/topic`, { title: 'Smart Campus v2' }, B), 403, 'member cannot resubmit the topic');
await is(call('PUT', `/research/${rid}/topic`, { title: 'Smart Campus v2', description: 'Narrower', problem: 'P', objectives: 'O' }, A), 200, 'leader edits and resubmits');
assert.equal((await call('GET', `/research/${rid}`, null, A)).body.status, 'pending'); ok('topic back to Pending');
assert.ok((await keys(doc)).includes('n.topic.resubmitted')); ok('supervisor notified of the resubmission');
await is(call('POST', `/research/${rid}/approve`, { decision: 'approve', comment: 'Good' }, B), 403, 'students cannot approve topics');
await is(call('POST', `/research/${rid}/approve`, { decision: 'approve', comment: 'Good' }, doc), 200, 'supervisor approves');
assert.ok((await keys(S3)).includes('n.approved')); ok('every member notified of the approval');
await is(call('PUT', `/research/${rid}/topic`, { title: 'Changed' }, A), 409, 'an approved topic cannot be changed by students');
assert.equal((await call('GET', `/research/${rid}`, null, A)).body.topic_reviews.length, 2); ok('topic review history kept');

// =============== 8. Stages, submissions, publishing ===============
const mkStage = body => call('POST', '/stages', { courseId: course.id, researchIds: [rid], state: 'open', startDate: day(-3), ...body }, doc);
const sA = (await mkStage({ name: 'Proposal', deadline: day(5), maxGrade: 20 })).body.id;
const sLate = (await mkStage({ name: 'Strict', deadline: day(-1), allowLate: false })).body.id;
const sSoft = (await mkStage({ name: 'Soft', deadline: day(-1), allowLate: true })).body.id;
const sFuture = (await mkStage({ name: 'Later', state: 'scheduled', startDate: day(10), deadline: day(20) })).body.id;
assert.ok((await keys(B)).includes('n.stage.assigned')); ok('members notified of new stages');
const mystages = async tk => (await call('GET', `/research/${rid}/stages`, null, tk)).body;
let ms = await mystages(B);
assert.equal(ms.stages.length, 4); ok('students see every stage configured by the supervisor');
const byName = (x, nme) => x.stages.find(e => e.stage.name === nme);
assert.equal(byName(ms, 'Proposal').display_status, 'open'); assert.equal(byName(ms, 'Later').display_status, 'not_started'); ok('statuses: Open / Not Started');
assert.ok(byName(ms, 'Proposal').stage.formats.length && byName(ms, 'Proposal').stage.max_grade === 20 && byName(ms, 'Proposal').stage.deadline); ok('stage shows formats, max grade and deadline');
const sub = (tk, id, f = 'p.pdf') => call('POST', `/stages/${id}/submissions`, { researchId: rid, filename: f, data: pdf, note: 'n' }, tk);
await is(sub(B, sA), 403, 'members cannot submit by default (the leader submits for the team)');
await is(sub(S1, sA), 403, 'outsiders cannot submit');
await is(sub(A, sFuture), 409, 'a stage that has not started refuses submissions');
await is(sub(A, sLate), 409, 'submissions after the deadline refused when late submissions are not allowed');
const late = (await is(sub(A, sSoft), 200, 'late submission accepted when allowed')).body;
assert.equal(late.late, true); ok('flagged as late');
await call('PUT', `/my/teams/${t1}`, { membersCanSubmit: true }, A);
const sub1 = (await is(sub(B, sA), 200, 'a member can submit once the leader allows it')).body;
assert.equal(sub1.late, false); ok('on time');
const hist2 = (await db.prepare('SELECT submitted_by FROM stage_submissions WHERE stage_id=?').get(sA)); assert.equal(hist2.submitted_by, (await idOf('20240003'))); ok('who submitted is recorded');
ms = await mystages(S3); assert.equal(byName(ms, 'Proposal').display_status, 'submitted'); assert.equal(byName(ms, 'Proposal').submissions.length, 1); ok('all members see the submission history');
await is(call('GET', `/stage-submissions/${(await db.prepare('SELECT id FROM stage_submissions WHERE stage_id=?').get(sA)).id}/file`, null, S3), 200, 'members download their submissions');
await is(call('GET', `/stage-submissions/${(await db.prepare('SELECT id FROM stage_submissions WHERE stage_id=?').get(sA)).id}/file`, null, S1), 403, 'students of other teams cannot');
const subA = (await db.prepare('SELECT id FROM stage_submissions WHERE stage_id=?').get(sA)).id;
await call('POST', `/stage-submissions/${subA}/review`, { decision: 'comment', comment: 'Looking' }, doc);
assert.equal(byName(await mystages(A), 'Proposal').display_status, 'under_review'); ok('status: Under Review');
await is(call('POST', `/stage-submissions/${subA}/review`, { decision: 'request_changes', comment: 'Fix section 2' }, A), 403, 'students cannot review submissions');
await call('POST', `/stage-submissions/${subA}/review`, { decision: 'request_changes', comment: 'Fix section 2' }, doc);
ms = await mystages(A); assert.equal(byName(ms, 'Proposal').display_status, 'changes_requested'); assert.equal(byName(ms, 'Proposal').submissions[0].reviews.pop().comment, 'Fix section 2'); ok('status: Changes Requested + feedback per submission version');
assert.ok((await keys(B)).includes('n.stage.changes')); ok('members notified of the modification request');
await is(sub(A, sA, 'v2.pdf'), 200, 'resubmit after modifications');
ms = await mystages(A); assert.equal(byName(ms, 'Proposal').display_status, 'resubmitted'); assert.equal(byName(ms, 'Proposal').submissions.length, 2); ok('status: Resubmitted; both attempts preserved');
assert.equal(byName(ms, 'Strict').display_status, 'open'); ok('late-blocked stage still Open');
// grades are hidden until published
const subA2 = (await db.prepare('SELECT id FROM stage_submissions WHERE stage_id=? ORDER BY attempt_no DESC').get(sA)).id;
await call('POST', `/stage-submissions/${subA2}/review`, { decision: 'approve' }, doc);
assert.equal(byName(await mystages(A), 'Proposal').display_status, 'approved'); ok('status: Approved');
await call('PUT', `/stages/${sA}/targets/${rid}/grade`, { score: 18, comment: 'Nice' }, doc);
ms = await mystages(B); assert.equal(byName(ms, 'Proposal').grade, null); assert.equal(byName(ms, 'Proposal').grade_pending, true); assert.equal(ms.totals.earned, 0); ok('an unpublished stage grade is hidden from students');
assert.ok(!(await keys(B)).includes('n.stage.graded')); ok('no grade notification before publishing');
await call('PUT', `/research/${rid}/grade`, { score: 90, comment: 'Great' }, doc);
assert.equal((await call('GET', `/research/${rid}`, null, B)).body.grade, null); assert.equal((await call('GET', '/research', null, B)).body[0].grade, null); ok('an unpublished final grade is hidden');
await is(call('PUT', `/stages/${sA}/targets/${rid}/publish`, { published: true }, B), 403, 'students cannot publish grades');
await is(call('PUT', `/stages/${sA}/targets/${rid}/publish`, { published: true }, doc), 200, 'supervisor publishes the stage grade');
ms = await mystages(B); assert.equal(byName(ms, 'Proposal').grade.score, 18); assert.equal(ms.totals.earned, 18); ok('published stage grade and accumulated total visible');
assert.ok((await keys(B)).includes('n.stage.graded')); ok('grade-published notification');
await is(call('PUT', `/research/${rid}/grade/publish`, { published: true }, doc), 200, 'supervisor publishes the final grade');
assert.equal((await call('GET', `/research/${rid}`, null, B)).body.grade, 90); ok('final grade visible once published');
await is(call('PUT', `/research/${rid}/grade`, { score: 50 }, B), 403, 'students cannot change grades');
// others never see grades
assert.equal((await call('GET', `/research/${rid}/stages`, null, S1)).status, 403); ok("students cannot read another team's stages/grades");

// =============== 9. Locked teams ===============
assert.equal((await call('GET', '/my/teams', null, A)).body[0].locked, true); ok('team locks automatically once its stages started');
await is(call('DELETE', `/teams/${t1}/members/${(await idOf('S10003'))}`, null, A), 409, 'leader cannot remove members of a locked team');
await is(call('POST', `/teams/${t1}/invitations`, { universityId: 'S10004' }, A), 409, 'cannot invite into a locked team');
await is(call('POST', `/teams/${t1}/join-requests`, {}, S4), 409, 'locked teams refuse join requests');
const cr = (await is(call('POST', `/teams/${t1}/change-requests`, { kind: 'remove', userId: (await idOf('S10003')), note: 'inactive' }, A), 200, 'leader asks the supervisor to remove a member')).body.id;
await is(call('POST', `/teams/${t1}/change-requests`, { kind: 'remove', userId: (await idOf('S10003')) }, A), 409, 'duplicate change request refused');
await is(call('POST', `/teams/${t1}/change-requests`, { kind: 'remove', userId: (await idOf('S10003')) }, B), 403, 'members cannot request removals');
const lv = (await is(call('POST', `/teams/${t1}/leave`, {}, S2), 200, 'a member asks to leave a locked team')).body;
assert.equal(lv.pending, true); ok('leaving a locked team needs approval');
assert.ok((await keys(doc)).includes('n.change.request')); ok('supervisor notified of change requests');
const crs = (await call('GET', '/membership-requests', null, doc)).body;
assert.equal(crs.filter(x => x.status === 'pending').length, 2); ok('supervisor lists pending membership requests');
await is(call('GET', '/membership-requests', null, A), 403, 'students cannot list them');
await is(call('POST', `/membership-requests/${cr}/decide`, { approve: true }, A), 403, 'students cannot decide them');
await is(call('POST', `/membership-requests/${cr}/decide`, { approve: true }, doc), 200, 'supervisor approves a removal');
assert.equal((await call('GET', '/my/teams', null, A)).body[0].size, 3); ok('membership changed after approval');
await is(call('POST', `/membership-requests/${lv.id}/decide`, { approve: false }, doc), 200, 'supervisor rejects the leave request');
assert.ok((await keys(S2)).includes('n.change.rejected')); ok('student notified of the decision');
await is(call('PUT', `/teams/${t1}/lock`, { locked: false }, doc), 200, 'supervisor can unlock');
assert.equal((await call('GET', '/my/teams', null, A)).body[0].locked, true); ok('a team with started stages stays locked');
const th = (await call('GET', `/teams/${t1}/history`, null, doc)).body.map(h => h.action);
assert.ok(th.includes('removed') && th.includes('unlocked')); ok('supervisor reads membership history');

// =============== 10. Dashboard, messaging, restrictions ===============
await call('POST', '/messages', { teamId: t1, body: 'Please see my feedback', stageId: sA, submissionId: subA }, doc);
const dash = (await is(call('GET', '/student/dashboard', null, B), 200, 'student dashboard')).body;
assert.equal(dash.student.university_id, '20240003'); assert.equal(dash.teams.length, 1); assert.equal(dash.teams[0].members.length, 3);
const dr = dash.research[0];
assert.equal(dr.title, 'Smart Campus v2'); assert.equal(dr.status, 'approved'); assert.equal(dr.final_grade, 90); assert.equal(dr.stages.length, 4); assert.equal(dr.progress.approved, 1); assert.ok(dr.topic_feedback.length === 2); ok('dashboard: team, members, research, stages, feedback, progress, final grade');
assert.ok(dash.upcoming.length >= 1 && dash.messages.length >= 1 && dash.notifications.length >= 1); ok('dashboard: upcoming deadlines, supervisor messages, notifications');
assert.ok(Array.isArray(dash.invitations) && Array.isArray(dash.join_requests) && Array.isArray(dash.join_requests_for_leader)); ok('dashboard: invitations and join requests');
const dashOther = (await call('GET', '/student/dashboard', null, S1)).body;
assert.equal(dashOther.research.length, 0); assert.equal(dashOther.teams.length, 0); ok("a student's dashboard never contains another team's data");
await is(call('GET', '/student/dashboard', null, doc), 403, 'supervisors have no student dashboard');
const msgs = (await call('GET', '/messages?supervisor=' + supId, null, B)).body;
assert.ok(msgs.some(m => m.stage && m.submission_id === subA)); ok('students see messages linked to a stage and a submission');
await is(call('POST', '/messages', { body: 'Question about stage 1', supervisorId: supId }, B), 200, 'student sends a message to the supervisor');
assert.ok((await keys(A)).includes('n.message')); ok('team members notified of new messages');
await is(call('GET', `/messages?supervisor=${supId}`, null, S1), 403, "other students cannot read the team's conversation");
await is(call('GET', `/messages?supervisor=${supId}&team=${t1}`, null, S1), 403, 'not even by guessing the team id');
// restrictions
for (const [m, p, b] of [['GET', '/supervisor/dashboard'], ['GET', '/registrations'], ['GET', '/approved-ids'], ['POST', '/stages', { name: 'x' }], ['GET', '/users'], ['POST', '/users', {}],
  ['POST', '/courses', { name: 'Z' }], ['PUT', `/research/${rid}/deadline`, { deadline: '2999-01-01' }], ['GET', '/reports'], ['GET', '/teams'], ['POST', '/teams', { name: 'x' }], ['PATCH', '/users/1/role', { role: 'admin' }],
  ['POST', `/research/${rid}/request-changes`, { comment: 'x' }], ['PUT', `/stages/${sA}/state`, { state: 'closed' }]])
  assert.equal((await call(m, p, b, A)).status, 403, `${m} ${p}`);
ok('students cannot reach supervisor/admin functions or global settings');
await is(call('GET', '/research'), 401, 'unauthenticated requests are refused');
// audit log
const acts = (await db.prepare('SELECT DISTINCT action FROM audit_log').all()).map(x => x.action);
for (const a of ['registration.requested', 'registration.approved', 'registration.rejected', 'team.created', 'team.invited', 'team.invitation_accepted', 'team.join_requested', 'team.join_accepted', 'team.member_removed', 'team.change_requested', 'team.change_approved', 'stage.submitted', 'topic.registered', 'topic.edited'])
  assert.ok(acts.includes(a), 'audit has ' + a);
ok('sensitive operations are in the audit log');
// registration rate limit (10 requests per hour per IP)
let last;
for (let i = 0; i < 10; i++) last = await reg({ universityId: '99999999' });
assert.equal(last.status, 429); ok('registration requests are rate limited');

console.log(`\nAll ${n} student checks passed`);
server.close();
await (await import('../src/db.js')).db.close();
