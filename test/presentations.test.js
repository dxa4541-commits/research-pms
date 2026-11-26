// Final presentation scheduling: slots, booking by the team leader, instructor assignment, lock, notifications.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'pms-pres-'));
process.env.LOG = 'off'; process.env.DB_PATH = join(dir, 'pg'); process.env.UPLOAD_DIR = join(dir, 'up');
const { server } = await import('../server.js');
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
async function call(method, path, body, token) {
  const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: (res.headers.get('content-type') ?? '').includes('json') ? await res.json() : null };
}
const login = async (email, password) => (await call('POST', '/login', { email, password })).body.token;
let n = 0; const ok = name => console.log(`ok ${++n} - ${name}`);
const is = async (p, status, name) => { const r = await p; assert.equal(r.status, status, `${name}: got ${r.status} ${JSON.stringify(r.body)}`); ok(name); return r; };
const keys = async tok => (await call('GET', '/notifications', null, tok)).body.map(x => JSON.parse(x.message).k);

const admin = await login('admin@example.com', 'admin123'), doc = await login('doctor@example.com', 'doctor123');
const lead = await login('20240001', 'student123'), mate = await login('20240002', 'student123');
const course = (await call('GET', '/courses', null, admin)).body[0];
await call('POST', '/users', { name: 'Solo', email: 'solo@example.com', password: 'secret1', role: 'student', courseIds: [course.id] }, admin);
const solo = await login('solo@example.com', 'secret1');
const sup = (await call('GET', '/supervisors', null, lead)).body[0];
const mateId = (await call('GET', `/available-students?courseId=${course.id}`, null, lead)).body.find(s => s.name === 'Lina').id;
const rid = (await call('POST', '/research', { title: 'Team project', courseId: course.id, supervisorId: sup.id, newTeam: { name: 'team1', memberIds: [mateId] } }, lead)).body.id;
const inv = (await call('GET', '/invitations', null, mate)).body.find(i => i.status === 'pending');
await call('POST', `/invitations/${inv.id}/respond`, { accept: true }, mate);
const sid = (await call('POST', '/research', { title: 'Solo project', courseId: course.id, supervisorId: sup.id }, solo)).body.id;
await call('POST', `/research/${rid}/approve`, { decision: 'approve' }, doc);

// ---- slots ----
const mk = body => call('POST', '/presentations/slots', { courseId: course.id, date: '2026-12-10', from: '09:00', to: '10:00', every: 20, location: 'Room 101', ...body }, doc);
await is(mk({ from: '9:00' }), 400, 'times must be HH:MM');
await is(mk({ to: '08:00' }), 400, 'end before start refused');
await is(mk({ every: 2 }), 400, 'slot length at least 5 minutes');
await is(call('POST', '/presentations/slots', { courseId: course.id, date: '2026-12-10', from: '09:00', to: '10:00', every: 20 }, lead), 403, 'students cannot create slots');
let r = await is(mk({}), 200, 'instructor creates 09:00–10:00 every 20 minutes');
assert.equal(r.body.created, 3); ok('three slots');
r = await is(mk({ to: '10:20' }), 200, 'creating overlapping times again');
assert.equal(r.body.created, 1); assert.equal(r.body.skipped, 3); ok('existing times are skipped');
let p = (await call('GET', '/presentations', null, doc)).body;
assert.deepEqual(p.slots.map(s => s.starts_at.slice(11)), ['09:00', '09:20', '09:40', '10:00']); assert.equal(p.slots[0].ends_at, '09:20'); assert.equal(p.slots[0].location, 'Room 101'); ok('slots listed in time order with end time and place');
assert.equal(p.research.length, 1); assert.equal(p.research[0].label, 'team1'); ok('only approved research is listed to present');

// ---- booking ----
const [s1, s2, s3, s4] = p.slots.map(s => s.id);
let st = (await call('GET', '/presentations', null, mate)).body;
assert.equal(st.length, 1); assert.equal(st[0].can_book, false); assert.equal(st[0].slots.length, 4); ok('a team member sees the schedule but cannot book');
await is(call('POST', `/presentations/slots/${s1}/book`, { researchId: rid }, mate), 403, 'members cannot book');
await is(call('POST', `/presentations/slots/${s1}/book`, { researchId: sid }, solo), 409, 'a research that is not approved cannot book');
await is(call('POST', `/presentations/slots/${s1}/book`, { researchId: rid }, lead), 200, 'the team leader books 09:00');
assert.ok((await keys(doc)).includes('n.pres.booked')); assert.ok((await keys(mate)).includes('n.pres.assigned')); ok('instructor and team notified');
await is(call('POST', `/presentations/slots/${s2}/book`, { researchId: rid }, lead), 200, 'the leader changes to 09:20');
st = (await call('GET', '/presentations', null, lead)).body[0];
assert.equal(st.my_slot.id, s2); assert.equal(st.slots.find(s => s.id === s1).research_id, null); ok('the earlier slot is freed (one slot per research)');
await call('POST', `/research/${sid}/approve`, { decision: 'approve' }, doc);
await is(call('POST', `/presentations/slots/${s2}/book`, { researchId: sid }, solo), 409, 'a taken slot cannot be booked');
await is(call('POST', `/presentations/slots/${s3}/book`, { researchId: sid }, solo), 200, 'another student books a free slot');
await is(call('POST', `/presentations/slots/${s3}/cancel`, { researchId: rid }, lead), 409, 'cannot cancel another booking');
await is(call('POST', `/presentations/slots/${s3}/cancel`, { researchId: sid }, solo), 200, 'a student cancels their booking');
assert.ok((await keys(doc)).includes('n.pres.cancelled')); ok('instructor notified of the cancellation');

// ---- instructor: assign, move, free, lock, delete ----
await is(call('PUT', `/presentations/slots/${s4}`, { researchId: sid }, doc), 200, 'instructor assigns a student to 10:00');
await is(call('PUT', `/presentations/slots/${s1}`, { researchId: sid }, doc), 200, 'instructor moves them to 09:00');
p = (await call('GET', '/presentations', null, doc)).body;
assert.equal(p.slots.find(s => s.id === s1).research_id, sid); assert.equal(p.slots.find(s => s.id === s4).research_id, null); ok('moved, old slot freed');
await is(call('PUT', '/presentations/lock', { courseId: course.id, locked: true }, doc), 200, 'instructor locks the schedule');
await is(call('POST', `/presentations/slots/${s3}/book`, { researchId: rid }, lead), 409, 'no booking changes once locked');
assert.equal((await call('GET', '/presentations', null, lead)).body[0].locked, true); ok('students see it is locked');
await is(call('PUT', `/presentations/slots/${s2}`, { location: 'Hall B' }, doc), 200, 'instructor can still change the place');
await is(call('DELETE', `/presentations/slots/${s2}`, null, doc), 200, 'instructor deletes a booked slot');
assert.ok((await keys(lead)).includes('n.pres.freed')); ok('team told its slot was removed');
const doc2 = await (async () => { await call('POST', '/users', { name: 'Dr. X', email: 'x@example.com', password: 'secret1', role: 'supervisor' }, admin); return login('x@example.com', 'secret1'); })();
await is(call('DELETE', `/presentations/slots/${s1}`, null, doc2), 403, "other instructors cannot touch my slots");
const hist = (await call('GET', `/research/${rid}/history`, null, doc)).body.map(h => h.action);
assert.ok(hist.includes('presentation.booked')); ok('bookings are in the research history');

console.log(`\nAll ${n} presentation checks passed`);
server.close(); process.exit(0);
