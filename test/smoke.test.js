// End-to-end test of every use case in the diagram, against a throw-away DB.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'pms-'));
process.env.LOG = 'off';
process.env.DB_PATH = join(dir, 't.db');
process.env.UPLOAD_DIR = join(dir, 'up');
const { server } = await import('../server.js');
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

async function call(method, path, body, token) {
  const res = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const login = async (email, password) => (await call('POST', '/login', { email, password })).body.token;
const pdf = Buffer.from('%PDF-1.4 test').toString('base64');
let n = 0; const ok = (name) => console.log(`ok ${++n} - ${name}`);

// Log in
assert.equal((await call('POST', '/login', { email: 'x@y.z', password: 'bad' })).status, 401); ok('bad login rejected');
const admin = await login('admin@example.com', 'admin123');
const doc = await login('doctor@example.com', 'doctor123');
const stu = await login('20240001', 'student123');
const stu2 = await login('20240002', 'student123');
assert.ok(admin && doc && stu); ok('login for all roles');
assert.equal((await call('GET', '/users')).status, 401); ok('unauthenticated blocked');
assert.equal((await call('GET', '/users', null, stu)).status, 403); ok('student cannot list users');

const sup = (await call('GET', '/supervisors', null, stu)).body[0];
const course = (await call('GET', '/courses', null, stu)).body[0];

// Submit research (+ file checks)
const bad = (filename, data) => call('POST', '/research', { title: 'T', courseId: course.id, supervisorId: sup.id, filename, data }, stu);
assert.equal((await bad('a.exe', pdf)).status, 415); ok('disallowed type rejected');
assert.equal((await bad('a.pptx', Buffer.from('PK\x03\x04x', 'latin1').toString('base64'))).status, 415); ok('only PDF/Word accepted');

assert.equal((await bad('a.pdf', Buffer.from('not a pdf').toString('base64'))).status, 415); ok('type/content mismatch rejected');
assert.equal((await bad('a.pdf', Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(11 * 1048576)]).toString('base64'))).status, 413); ok('oversize rejected');
assert.equal((await call('GET', '/research', null, stu)).body.length, 0); ok('failed submissions left nothing behind');
const r1 = await bad('proposal.pdf', pdf);
assert.equal(r1.status, 200); const rid = r1.body.id; ok('submit research');

assert.equal((await call('GET', '/notifications', null, doc)).body.length, 1); ok('supervisor notified of submission');
assert.equal((await call('GET', `/research/${rid}`, null, stu2)).status, 403); ok('other student cannot view research');

// Supervisor review
const d1 = (await call('GET', `/research/${rid}`, null, doc)).body;
const sid = d1.submissions[0].id;
assert.equal((await call('POST', `/submissions/${sid}/notes`, { text: 'Add references' }, stu)).status, 403); ok('student cannot add notes');
assert.equal((await call('POST', `/submissions/${sid}/notes`, { text: 'Add references' }, doc)).status, 200); ok('add note');
assert.equal((await call('POST', `/research/${rid}/request-changes`, {}, doc)).status, 400); ok('request changes needs comment');
assert.equal((await call('POST', `/research/${rid}/request-changes`, { comment: 'Fix intro' }, doc)).status, 200); ok('request changes');
const nots = (await call('GET', '/notifications', null, stu)).body;
const keys = nots.map(x => JSON.parse(x.message).k);
assert.ok(keys.includes('n.changes_requested') && keys.includes('n.note')); ok('student notified (status change + note)');

// Upload new version
assert.equal((await call('POST', `/research/${rid}/versions`, { filename: 'v2.pdf', data: pdf }, stu2)).status, 403); ok('non-owner cannot upload');
assert.equal((await call('POST', `/research/${rid}/versions`, { filename: 'v2.pdf', data: pdf }, stu)).body.versionNo, 2); ok('upload new version');
let d2 = (await call('GET', `/research/${rid}`, null, stu)).body;
assert.equal(d2.status, 'pending'); assert.equal(d2.submissions.length, 2); ok('status back to pending, 2 versions');

// Grade, approve, download
assert.equal((await call('PUT', `/research/${rid}/grade`, { score: 101 }, doc)).status, 400); ok('invalid grade rejected');
assert.equal((await call('PUT', `/research/${rid}/grade`, { score: 88, publish: true }, doc)).status, 200); ok('grade (one per research)');
assert.equal((await call('PUT', `/research/${rid}/grade`, { score: 90 }, stu)).status, 403); ok('student cannot grade');
assert.equal((await call('GET', `/research/${rid}`, null, stu)).body.grade, 88); ok('student sees the research grade');
assert.equal((await call('POST', `/research/${rid}/approve`, { decision: 'request_changes' }, doc)).status, 400); ok('approve only accepts approve/reject');
assert.equal((await call('POST', `/research/${rid}/approve`, { decision: 'approve' }, doc)).body.status, 'approved'); ok('approve');
const dl = await call('GET', `/submissions/${d2.submissions[0].id}/file`, null, stu);
assert.equal(dl.status, 200); assert.ok(dl.body.toString().startsWith('%PDF')); ok('download file');
assert.equal((await call('GET', `/submissions/${sid}/file`, null, stu2)).status, 403); ok('download access-controlled');

// Form teams
const studs = (await call('GET', '/students', null, doc)).body;
const thirdId = (await call('POST', '/users', { name: 'Third', email: 'third@example.com', password: 'secret1', role: 'student', courseIds: [course.id] }, admin)).body.id;
const team = await call('POST', '/teams', { name: 'Team A', courseId: course.id, memberIds: [studs.find(s => s.university_id === '20240002').id, thirdId] }, doc);
assert.equal(team.status, 200); assert.equal((await call('GET', '/teams', null, doc)).body[0].members.length, 2); ok('form teams');
assert.equal((await call('GET', `/research/${rid}`, null, stu2)).status, 403); ok('team added later does not leak existing individual research');

// Admin
const nu = await call('POST', '/users', { name: 'New', email: 'new@example.com', password: 'secret1', role: 'student' }, admin);
assert.equal(nu.status, 200); ok('create user');
assert.equal((await call('POST', '/users', { name: 'N', email: 'new@example.com', password: 'secret1', role: 'student' }, admin)).status, 409); ok('duplicate email rejected');
assert.equal((await call('PATCH', `/users/${nu.body.id}/role`, { role: 'supervisor' }, admin)).status, 200);
const nuTok = await login('new@example.com', 'secret1');
assert.equal((await call('GET', '/students', null, nuTok)).status, 200); ok('assign authorization takes effect immediately');
assert.equal((await call('PATCH', '/users/1/role', { role: 'student' }, admin)).status, 400); ok('admin cannot demote self');
const rep = (await call('GET', '/reports', null, admin)).body;
assert.equal(rep.totals.research, 1); assert.equal(rep.averageGrade, 88); assert.equal(rep.projects.length, 1); ok('progress reports');
assert.equal((await call('DELETE', '/users/3', null, admin)).status, 409); assert.equal((await call('GET', '/me', null, stu)).status, 200); ok('cannot delete user with research (and their session survives)');
assert.equal((await call('DELETE', `/users/${nu.body.id}`, null, admin)).status, 200); ok('delete user');

// Deadlines & overdue (FR9)
assert.equal((await call('PUT', `/research/${rid}/deadline`, { deadline: '2020-01-01' }, doc)).status, 403); ok('only admin sets deadlines');
assert.equal((await call('PUT', `/research/${rid}/deadline`, { deadline: 'soon' }, admin)).status, 400); ok('invalid deadline rejected');
assert.equal((await call('PUT', `/research/${rid}/deadline`, { deadline: '2020-01-01' }, admin)).status, 200);
let lst = (await call('GET', '/research', null, stu)).body[0];
assert.equal(lst.overdue, 0); ok('approved research is never overdue');
// second project: pending + past deadline => overdue
const r2 = await call('POST', '/research', { title: 'Second', courseId: course.id, supervisorId: sup.id, filename: 'b.pdf', data: pdf }, stu2);
assert.equal(r2.status, 200);
await call('PUT', `/research/${r2.body.id}/deadline`, { deadline: '2020-01-01' }, admin);
assert.equal((await call('GET', '/reports', null, admin)).body.totals.overdue, 1); ok('overdue identified in reports');
await call('PUT', `/research/${r2.body.id}/deadline`, { deadline: '2999-01-01' }, admin);
assert.equal((await call('GET', '/reports', null, admin)).body.totals.overdue, 0); ok('future deadline not overdue');
assert.ok((await call('GET', '/notifications', null, stu2)).body.some(x => JSON.parse(x.message).k === 'n.deadline')); ok('deadline notification');

// Backend hardening
const files = () => readdirSync(process.env.UPLOAD_DIR).length;
const before = files();
await bad('x.pdf', Buffer.from('not a pdf').toString('base64'));
await call('POST', '/research', { title: 'T', courseId: 9999, supervisorId: sup.id, filename: 'a.pdf', data: pdf }, stu);
assert.equal(files(), before); ok('failed submissions leave no orphan files');

const h = await fetch(base + '/api/me', { headers: { Authorization: 'Bearer ' + stu } });
assert.equal(h.headers.get('x-frame-options'), 'DENY'); assert.ok(h.headers.get('content-security-policy').includes("default-src 'self'"));
assert.equal(h.headers.get('cache-control'), 'no-store'); ok('security headers');

const pg = await fetch(base + '/api/research?limit=1', { headers: { Authorization: 'Bearer ' + admin } });
assert.equal((await pg.json()).length, 1); assert.equal(pg.headers.get('x-total-count'), '2'); ok('pagination + X-Total-Count');
assert.equal((await call('GET', '/research?status=approved', null, admin)).body.length, 1); ok('filter by status');
assert.equal((await call('GET', '/research?q=Second', null, admin)).body.length, 1); ok('search by title');
assert.equal((await call('GET', '/research?q=%25', null, admin)).body.length, 0); ok('LIKE wildcards are escaped');
assert.equal((await call('GET', '/research?limit=abc', null, admin)).status, 400); ok('bad paging rejected');
assert.equal((await call('GET', '/research?status=nope', null, admin)).status, 400); ok('bad status filter rejected');
const third = await login('third@example.com', 'secret1');
assert.equal((await call('GET', '/research?q=Second', null, third)).body.length, 1); ok('teammate sees team research via filter');
await call('POST', '/users', { name: 'Out', email: 'out@example.com', password: 'secret1', role: 'student' }, admin);
const outsider = await login('out@example.com', 'secret1');
assert.equal((await call('GET', '/research?q=Second', null, outsider)).body.length, 0); ok('filters never widen role scope');

assert.equal((await call('POST', '/me/password', { currentPassword: 'wrong', newPassword: 'newpass1' }, stu)).status, 403); ok('wrong current password rejected');
assert.equal((await call('POST', '/me/password', { currentPassword: 'student123', newPassword: '123' }, stu)).status, 400); ok('weak new password rejected');
const stuOther = await login('20240001', 'student123');
assert.equal((await call('POST', '/me/password', { currentPassword: 'student123', newPassword: 'newpass1' }, stu)).status, 200);
assert.equal((await call('GET', '/me', null, stu)).status, 200); assert.equal((await call('GET', '/me', null, stuOther)).status, 401); ok('password change keeps this session, drops others');
assert.ok(await login('20240001', 'newpass1')); ok('login with new password');
assert.ok(await login('  20240001  ', 'newpass1')); assert.ok(await login('  Doctor@Example.com  ', 'doctor123')); ok('login ignores spaces and letter case');
assert.equal((await call('POST', '/login', { email: 'student@example.com', password: 'newpass1' })).status, 401); ok('students with a University ID cannot log in by e-mail');

let last;
for (let i = 0; i < 6; i++) last = await call('POST', '/login', { email: 'doctor@example.com', password: 'wrong' });
assert.equal(last.status, 429); ok('login rate limit after repeated failures');
assert.equal((await call('POST', '/login', { email: 'doctor@example.com', password: 'doctor123' })).status, 429); ok('correct password also blocked while limited');

// Static
const html = await fetch(base + '/'); assert.equal(html.status, 200);
assert.equal((await fetch(base + '/..%2fserver.js')).status, 404); ok('static + no path traversal');

console.log(`\nAll ${n} checks passed`);
server.close();
