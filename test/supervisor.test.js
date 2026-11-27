// End-to-end test of the supervisor role: stages, submissions, review, grading, teams, messaging, dashboard, reports, restrictions.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'pms-sup-'));
process.env.LOG = 'off';
process.env.DB_PATH = join(dir, 'pg');
process.env.UPLOAD_DIR = join(dir, 'up');
const { server } = await import('../server.js');
const { db } = await import('../src/db.js');
const { checkDeadlines } = await import('../src/deadlines.js');
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;

async function call(method, path, body, token) {
  const res = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const login = async (email, password) => (await call('POST', '/login', { email, password })).body.token;
const b64 = s => Buffer.from(s).toString('base64');
const pdf = b64('%PDF-1.4 test');
let n = 0; const ok = name => console.log(`ok ${++n} - ${name}`);
const is = async (p, status, name) => { const r = await p; assert.equal(r.status, status, `${name}: got ${r.status} ${JSON.stringify(r.body)}`); ok(name); return r; };
const keys = async tok => (await call('GET', '/notifications', null, tok)).body.map(x => JSON.parse(x.message).k);
const day = off => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);

const admin = await login('admin@example.com', 'admin123');
const doc = await login('doctor@example.com', 'doctor123');
// these checks cover manual stage assignment; the automatic workflow has its own test (workflow.test.js)
await call('PUT', '/supervisor/settings', { autoFirstStage: false }, doc);
const stu1 = await login('20240001', 'student123');
const stu2 = await login('20240002', 'student123');
// a second supervisor + an outsider student
const course = (await call('GET', '/courses', null, admin)).body[0];
await call('POST', '/users', { name: 'Dr. Other', email: 'other@example.com', password: 'secret1', role: 'supervisor' }, admin);
await call('POST', '/users', { name: 'Solo', email: 'solo@example.com', password: 'secret1', role: 'student', courseIds: [course.id] }, admin);
const doc2 = await login('other@example.com', 'secret1');
const solo = await login('solo@example.com', 'secret1');
const sups = (await call('GET', '/supervisors', null, stu1)).body;
const drSara = sups.find(s => s.name === 'Dr. Sara'), drOther = sups.find(s => s.name === 'Dr. Other');
const students = (await call('GET', '/students', null, doc)).body;
const [s1, s2, sSolo] = ['student@example.com', 'student2@example.com', 'solo@example.com'].map(e => students.find(s => s.email === e));

// ---------- Teams (before research so the team owns the project) ----------
let r = await is(call('POST', '/teams', { name: 'Alpha', courseId: course.id, memberIds: [s1.id, s2.id], leaderId: s1.id }, doc), 200, 'supervisor creates a team with a leader');
const teamId = r.body.id;
await is(call('POST', '/teams', { name: 'Bad', courseId: course.id, memberIds: [s1.id], leaderId: s2.id }, doc), 400, 'leader must be a member');
await is(call('POST', '/teams', { name: 'Steal', courseId: course.id, memberIds: [s1.id] }, doc2), 409, 'another supervisor cannot take students from my team');
let teams = (await call('GET', '/teams', null, doc)).body;
assert.equal(teams.length, 1); assert.equal(teams[0].members.find(m => m.leader).id, s1.id); ok('team listing shows members and leader');
assert.equal((await call('GET', '/teams', null, doc2)).body.length, 0); ok('other supervisor does not see my team');
await is(call('PUT', `/teams/${teamId}/leader`, { userId: s2.id }, doc), 200, 'assign team leader');
await is(call('PUT', `/teams/${teamId}/leader`, { userId: s1.id }, doc), 200, 'reassign team leader');
await is(call('PUT', `/teams/${teamId}/leader`, { userId: sSolo.id }, doc), 400, 'leader must belong to the team');
await is(call('PUT', `/teams/${teamId}/leader`, { userId: s1.id }, doc2), 403, 'other supervisor cannot change my team');
await is(call('PUT', `/teams/${teamId}/members`, { add: [sSolo.id] }, doc), 200, 'add a member');
await is(call('PUT', `/teams/${teamId}/members`, { remove: [sSolo.id] }, doc), 200, 'remove a member');
await is(call('PUT', `/teams/${teamId}/members`, { remove: [sSolo.id] }, doc), 400, 'removing a non-member fails');
assert.ok((await keys(solo)).includes('n.team.removed')); ok('removed member notified');

// ---------- Topic approval: description + rejection reason ----------
const reg = (tok, title, extra = {}) => call('POST', '/research', { title, description: 'About ' + title, courseId: course.id, supervisorId: drSara.id, filename: 'p.pdf', data: pdf, ...extra }, tok);
const t1 = (await is(reg(stu1, 'Team project'), 200, 'team registers a topic with description')).body.id;
const t2 = (await is(reg(solo, 'Solo project'), 200, 'individual registers a topic')).body.id;
const t3 = (await is(call('POST', '/research', { title: 'Other sup', courseId: course.id, supervisorId: drOther.id, filename: 'p.pdf', data: pdf }, (await (async () => { await call('POST', '/users', { name: 'Zed', email: 'zed@example.com', password: 'secret1', role: 'student', courseIds: [course.id] }, admin); return login('zed@example.com', 'secret1'); })())), 200, "student registers with the other supervisor")).body.id;
let list = (await call('GET', '/research', null, doc)).body;
assert.equal(list.length, 2); assert.ok(list.every(x => x.description)); assert.ok(!list.some(x => x.id === t3)); ok("supervisor sees only own research with descriptions");
await is(call('POST', `/research/${t3}/approve`, { decision: 'approve' }, doc), 403, "cannot approve another supervisor's topic");
await is(call('POST', `/research/${t2}/approve`, { decision: 'reject' }, doc), 400, 'rejection requires a reason');
await is(call('POST', `/research/${t2}/approve`, { decision: 'reject', comment: 'Out of scope' }, doc), 200, 'reject with reason');
let d = (await call('GET', `/research/${t2}`, null, solo)).body;
assert.equal(d.status, 'rejected'); assert.equal(d.rejection_reason, 'Out of scope'); ok('student sees the rejection reason');
// Both team members are notified of decisions
await is(call('POST', `/research/${t1}/approve`, { decision: 'approve' }, doc), 200, 'approve team topic');
assert.ok((await keys(stu2)).includes('n.approved')); ok('every team member is notified of the decision');
await is(reg(solo, 'Solo again'), 200, 'student registers a second topic');
const t4 = (await call('GET', '/research', null, doc)).body.find(x => x.title === 'Solo again').id;
await is(call('POST', `/research/${t4}/approve`, { decision: 'approve' }, doc), 200, 'approve individual topic');

// ---------- Stages ----------
const mk = (body, tok = doc) => call('POST', '/stages', { courseId: course.id, ...body }, tok);
await is(mk({ name: 'X' }, stu1), 403, 'student cannot create stages');
await is(mk({ name: '' }), 400, 'stage needs a name');
await is(mk({ name: 'X', deadline: day(1), startDate: day(3) }), 400, 'deadline before start rejected');
await is(mk({ name: 'X', formats: ['exe'] }), 400, 'unknown format rejected');
await is(mk({ name: 'X', maxFileMb: 50 }), 400, 'file limit above 10 MB rejected');
await is(mk({ name: 'X', maxAttempts: 0 }), 400, 'attempt limit must be positive');
const rubric = [{ name: 'Research Content', max: 40 }, { name: 'References', max: 20 }, { name: 'Methodology', max: 20 }, { name: 'Organization', max: 10 }, { name: 'Language and Presentation', max: 10 }];
const st1 = (await is(mk({ name: 'Literature review', description: 'Review papers', instructions: 'Max 10 pages', startDate: day(-5), deadline: day(10), criteria: rubric,
  formats: ['pdf', 'docx'], maxFileMb: 1, allowResubmit: true, maxAttempts: 2, researchIds: [t1, t4], state: 'open' }), 200, 'create stage with rubric, formats, limits, targets')).body.id;
const st2 = (await is(mk({ name: 'Final report', maxGrade: 50, allowResubmit: false, deadline: day(30), assignAll: true }), 200, 'create a second stage (assign to all, no resubmission)')).body.id;
const st3 = (await is(mk({ name: 'Draft', maxGrade: 20 }), 200, 'create a third stage')).body.id;
await is(call('POST', `/stages/${st3}/targets`, { researchIds: [t2] }, doc), 409, 'only approved research can be assigned');
await is(call('POST', `/stages/${st3}/targets`, { researchIds: [t3] }, doc), 403, "cannot assign another supervisor's research");
let stages = (await call('GET', '/stages', null, doc)).body;
assert.deepEqual(stages.map(s => s.name), ['Literature review', 'Final report', 'Draft']); assert.equal(stages[0].max_grade, 100); assert.equal(stages[0].criteria.length, 5); ok('stages listed in order; max grade derived from the rubric');
assert.equal(stages[1].counts.assigned, 2); ok('"assign to all" covers every approved research');
assert.equal((await call('GET', '/stages', null, doc2)).body.length, 0); ok('other supervisor has no stages');
await is(call('GET', `/stages/${st1}`, null, doc2), 403, "other supervisor cannot open my stage");
await is(call('GET', `/stages/${st1}`, null, stu1), 403, 'students cannot use the supervisor stage view');
// edit / delete only before the stage starts
const before1 = (await call('GET', '/stages', null, doc)).body.find(s => s.id === st1);
await is(call('PUT', `/stages/${st1}`, { ...before1, name: 'Lit', maxGrade: 5, criteria: [], formats: ['txt'], startDate: before1.start_date, deadline: before1.deadline, description: 'New text' }, doc), 200, 'started stage: text and deadline can still be edited');
const after1 = (await call('GET', '/stages', null, doc)).body.find(s => s.id === st1);
assert.equal(after1.name, 'Lit'); assert.equal(after1.description, 'New text'); assert.equal(after1.max_grade, before1.max_grade); assert.equal(after1.criteria.length, before1.criteria.length);
assert.deepEqual(after1.formats, before1.formats); ok('started stage keeps its grade, rubric and file rules');
await call('PUT', `/stages/${st1}`, { ...before1, startDate: before1.start_date }, doc); // restore the name for the checks below
await is(call('PUT', `/stages/${st3}`, { name: 'Draft v2', maxGrade: 30, formats: ['pdf'], allowResubmit: true, maxAttempts: 3, deadline: day(20) }, doc), 200, 'edit a stage that has not started');
assert.equal((await call('GET', '/stages', null, doc)).body.find(s => s.id === st3).max_grade, 30); ok('edit persisted');
await is(call('DELETE', `/stages/${st3}`, null, doc), 200, 'delete a stage that has not started');
await is(call('DELETE', `/stages/${st3}`, null, doc), 404, 'deleted stage is gone');
// reorder
await is(call('PUT', '/stages/reorder', { ids: [st2, st1] }, doc), 200, 'reorder stages');
assert.deepEqual((await call('GET', '/stages', null, doc)).body.map(s => s.id), [st2, st1]); ok('new order persisted');
await is(call('PUT', '/stages/reorder', { ids: [st1, 9999] }, doc), 403, 'cannot reorder foreign stages');
assert.ok((await keys(stu1)).includes('n.stage.assigned')); ok('students notified when a stage is assigned');

// ---------- Student view + submissions ----------
let sv = (await call('GET', `/research/${t1}/stages`, null, stu2)).body;
assert.equal(sv.stages.length, 2); ok('team member sees the stages assigned to the team');
assert.equal((await call('GET', `/research/${t1}/stages`, null, solo)).status, 403); ok("student cannot see another team's stages");
const sub = (tok, id, rid, filename, data, note) => call('POST', `/stages/${id}/submissions`, { researchId: rid, filename, data, note }, tok);
await is(sub(doc, st1, t1, 'a.pdf', pdf), 403, 'supervisor cannot submit');
await is(sub(solo, st1, t1, 'a.pdf', pdf), 403, "other student cannot submit for someone else's research");
await is(sub(stu1, st2, t1, 'a.pdf', pdf), 409, 'a stage that is not open refuses submissions');
// file rules of the stage (pdf/docx, 1 MB)
await is(sub(stu1, st1, t1, 'a.txt', b64('hello')), 415, 'format not allowed by this stage');
await is(sub(stu1, st1, t1, 'a.pdf', b64('not a pdf')), 415, 'content must match the extension');
await is(sub(stu1, st1, t1, 'a.pdf', Buffer.concat([Buffer.from('%PDF'), Buffer.alloc(1.2 * 1048576)]).toString('base64')), 413, "stage's own size limit enforced");
let a1 = (await is(sub(stu1, st1, t1, 'one.pdf', pdf, 'first try'), 200, 'student submits a stage')).body;
assert.equal(a1.attempt, 1); assert.equal(a1.late, false);
await is(call('DELETE', `/stages/${st1}`, null, doc), 409, 'a stage with submissions cannot be deleted');
assert.ok((await keys(doc)).includes('n.stage.submitted')); ok('supervisor notified of the stage submission');
await is(sub(stu2, st1, t1, 'two.pdf', pdf), 403, 'a team member who is not the leader cannot submit');
await is(sub(stu1, st1, t1, 'two.pdf', pdf), 409, 'cannot submit again while awaiting review');
let det = (await call('GET', `/stages/${st1}`, null, doc)).body;
const row1 = det.targets.find(t => t.research_id === t1), row4 = det.targets.find(t => t.research_id === t4);
assert.equal(row1.status, 'submitted'); assert.equal(row4.status, 'not_submitted'); assert.equal(row4.missing, true); ok('stage overview shows who submitted and who did not');
const sub1 = row1.submission_id;
// download + access control
const dl = await call('GET', `/stage-submissions/${sub1}/file`, null, doc);
assert.equal(dl.status, 200); assert.ok(dl.body.toString().startsWith('%PDF')); ok('supervisor downloads a submission');
await is(call('GET', `/stage-submissions/${sub1}/file`, null, stu2), 200, 'team member downloads the team submission');
await is(call('GET', `/stage-submissions/${sub1}/file`, null, solo), 403, "other students cannot download it");
await is(call('GET', `/stage-submissions/${sub1}/file`, null, doc2), 403, "other supervisors cannot download it");
// review
const review = (tok, id, body) => call('POST', `/stage-submissions/${id}/review`, body, tok);
await is(review(stu1, sub1, { decision: 'approve' }), 403, 'student cannot review');
await is(review(doc2, sub1, { decision: 'approve' }), 403, "other supervisor cannot review");
await is(review(doc, sub1, { decision: 'maybe' }), 400, 'unknown decision rejected');
await is(review(doc, sub1, { decision: 'request_changes' }), 400, 'feedback required when requesting changes');
await is(review(doc, sub1, { decision: 'reject' }), 400, 'reason required when rejecting');
await is(review(doc, sub1, { decision: 'request_changes', comment: 'Add 5 more papers' }), 200, 'request modifications with feedback');
assert.ok((await keys(stu2)).includes('n.stage.changes')); ok('all team members notified of the feedback');
sv = (await call('GET', `/research/${t1}/stages`, null, stu1)).body.stages.find(x => x.stage.id === st1);
assert.equal(sv.status, 'changes_requested'); assert.equal(sv.can_submit, true); assert.equal(sv.submissions[0].reviews[0].comment, 'Add 5 more papers'); ok('student sees feedback and may resubmit');
let a2 = (await is(sub(stu1, st1, t1, 'two.pdf', pdf), 200, 'student resubmits')).body;
assert.equal(a2.attempt, 2); assert.ok((await keys(doc)).includes('n.stage.resubmitted')); ok('supervisor notified of the resubmission');
const attempts = (await db.prepare('SELECT attempt_no,filename FROM stage_submissions WHERE stage_id=? AND research_id=? ORDER BY attempt_no').all(st1, t1));
assert.deepEqual(attempts.map(a => a.filename), ['one.pdf', 'two.pdf']); ok('earlier attempts are preserved (never overwritten)');
await is(call('GET', `/stage-submissions/${sub1}/file`, null, doc), 200, 'old attempt is still downloadable');
await is(review(doc, sub1, { decision: 'approve' }), 409, 'only the latest attempt can be decided');
await is(review(doc, sub1, { decision: 'comment', comment: 'Old note' }), 200, 'comments on older attempts are allowed');
const sub2 = (await call('GET', `/stages/${st1}`, null, doc)).body.targets.find(t => t.research_id === t1).submission_id;
await is(review(doc, sub2, { decision: 'request_changes', comment: 'Still weak' }), 200, 'second round of modifications');
await is(sub(stu1, st1, t1, 'three.pdf', pdf), 200, 'a revision request always allows another attempt, even past the attempt limit (2)');
await is(call('POST', `/stages/${st1}/targets/${t1}/allow-resubmit`, null, stu1), 403, 'student cannot grant resubmission');
await is(call('POST', `/stages/${st1}/targets/${t1}/allow-resubmit`, null, doc), 200, 'supervisor allows another attempt');
const sub3 = (await call('GET', `/stages/${st1}`, null, doc)).body.targets.find(t => t.research_id === t1).submission_id;
await is(review(doc, sub3, { decision: 'approve' }), 200, 'approve a submission');
await is(sub(stu1, st1, t1, 'four.pdf', pdf), 409, 'approved stage takes no more submissions');
// no-resubmission stage: supervisor can grant it while requesting changes
await is(call('PUT', `/stages/${st2}/state`, { state: 'open' }, doc), 200, 'open the second stage');
await is(sub(solo, st2, t4, 'solo.pdf', pdf), 200, 'individual student submits');
const subS = (await call('GET', `/stages/${st2}`, null, doc)).body.targets.find(t => t.research_id === t4).submission_id;
await is(review(doc, subS, { decision: 'reject', comment: 'Wrong template' }), 200, 'reject a stage submission with a reason');
await is(sub(solo, st2, t4, 'solo2.pdf', pdf), 409, 'no resubmission unless the supervisor allows it');
await is(review(doc, subS, { decision: 'reject', comment: 'Wrong template', allowResubmit: true }), 200, 'review can allow resubmission at the same time');
await is(sub(solo, st2, t4, 'solo2.pdf', pdf), 200, 'student resubmits after being allowed');

// ---------- Grading ----------
const grade = (tok, id, rid, body) => call('PUT', `/stages/${id}/targets/${rid}/grade`, body, tok);
await is(grade(stu1, st1, t1, { score: 90 }), 403, 'student cannot grade');
await is(grade(doc2, st1, t1, { criteria: [] }), 403, "other supervisor cannot grade my stage");
await is(grade(doc, st1, t1, { criteria: [{ id: 1, score: 10 }] }), 400, 'every rubric criterion must be scored');
const crit = (await call('GET', `/stages/${st1}`, null, doc)).body.criteria;
await is(grade(doc, st1, t1, { criteria: crit.map((c, i) => ({ id: c.id, score: i === 0 ? 41 : 1 })) }), 400, 'criterion score above its maximum rejected');
const g1 = await is(grade(doc, st1, t1, { criteria: crit.map(c => ({ id: c.id, score: c.max_score * 0.9 })), comment: 'Solid work' }), 200, 'grade with rubric criteria');
assert.equal(g1.body.score, 90); ok('total = sum of criteria');
await is(grade(doc, st2, t4, { score: 51 }), 400, 'simple score above the stage maximum rejected');
await is(grade(doc, st2, t4, { score: 45, comment: 'ok' }), 200, 'grade a stage without rubric');
await is(call('PUT', `/stages/${st1}/grades-lock`, { locked: true }, doc), 200, 'lock grades');
await is(grade(doc, st1, t1, { criteria: crit.map(c => ({ id: c.id, score: c.max_score })) }), 409, 'locked grades cannot change');
await is(call('PUT', `/stages/${st1}/grades-lock`, { locked: false }, doc), 200, 'unlock grades');
await is(grade(doc, st1, t1, { criteria: crit.map(c => ({ id: c.id, score: c.max_score })), publish: true }), 200, 'update a grade when permitted');
const tot = (await call('GET', `/research/${t1}/stages`, null, stu1)).body.totals;
assert.equal(tot.earned, 100); assert.equal(tot.total_max, 150); assert.equal(tot.percent, 66.7); ok('accumulated total across stages');
await is(call('PUT', `/research/${t1}/grade`, { score: 92, comment: 'Excellent', publish: true }, doc), 200, 'final research grade');
await is(call('PUT', `/research/${t1}/grade`, { score: 93 }, doc2), 403, "other supervisor cannot set the final grade");
assert.equal((await call('GET', `/research/${t1}`, null, stu2)).body.grade, 92); ok('team sees the final grade');
await is(call('PUT', `/stages/${st1}/targets/${t1}/grade`, { score: 5 }, stu1), 403, 'students cannot change grades');
await is(call('DELETE', `/stages/${st1}/targets/${t1}`, null, doc), 409, 'cannot unassign a stage that has submissions/grade');
// history
const hist = (await call('GET', `/research/${t1}/history`, null, doc)).body;
const acts = hist.map(h => h.action);
for (const a of ['stage.submitted', 'stage.resubmitted', 'stage.review.changes_requested', 'stage.review.approved', 'stage.graded', 'stage.grade_updated', 'final.graded'])
  assert.ok(acts.includes(a), 'history has ' + a);
assert.equal(hist.find(h => h.action === 'stage.grade_updated').detail.from, 90); ok('history keeps submissions, reviews, grades (with old values)');
await is(call('GET', `/research/${t1}/history`, null, stu1), 403, 'students cannot read the history');
await is(call('GET', `/research/${t1}/history`, null, doc2), 403, "other supervisors cannot read my history");
await is(call('DELETE', `/stage-submissions/${sub1}`, null, doc), 404, 'there is no way to delete a submission');
assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM stage_submissions WHERE research_id=?').get(t1)).n, 3); ok('all three attempts still stored');

// ---------- Late / deadlines / postpone ----------
const st4 = (await is(mk({ name: 'Overdue stage', startDate: day(-10), deadline: day(-1), state: 'open', researchIds: [t4] }), 200, 'stage with a deadline in the past')).body.id;
const st5 = (await is(mk({ name: 'Soon stage', startDate: day(-1), deadline: day(1), state: 'open', researchIds: [t1] }), 200, 'stage with a deadline tomorrow')).body.id;
let la = (await is(sub(solo, st4, t4, 'late.pdf', pdf), 200, 'late submission is accepted')).body;
assert.equal(la.late, true); assert.ok((await keys(doc)).includes('n.stage.late_submission')); ok('late submission flagged and supervisor notified');
const row = (await call('GET', `/stages/${st4}`, null, doc)).body.targets[0]; assert.equal(row.late, true); ok('late flag visible to the supervisor');
const st6 = (await is(mk({ name: 'Missed stage', startDate: day(-10), deadline: day(-2), state: 'open', researchIds: [t1] }), 200, 'stage nobody submitted')).body.id;
const before = (await keys(doc)).length;
assert.ok((await checkDeadlines()) >= 2); ok('deadline watcher fires');
const k = await keys(doc);
assert.ok(k.includes('n.deadline.late') && k.includes('n.deadline.soon')); ok('supervisor notified: submission late + deadline approaching');
assert.ok((await keys(stu1)).includes('n.deadline.soon.own')); ok('students are warned too');
assert.equal((await checkDeadlines()), 0); ok('each warning fires only once');
await is(call('PUT', `/stages/${st6}/state`, { state: 'postponed' }, doc), 400, 'postponing needs a new date');
await is(call('PUT', `/stages/${st6}/state`, { state: 'postponed', deadline: day(7) }, doc), 200, 'postpone a stage with a new deadline');
assert.ok((await keys(stu1)).includes('n.stage.deadline')); ok('students notified of the deadline change');
await is(sub(stu1, st6, t1, 'x.pdf', pdf), 409, 'postponed stage is not open');
await is(call('PUT', `/stages/${st6}/state`, { state: 'open' }, doc), 200, 'reopen it');
await is(call('PUT', `/stages/${st6}/state`, { state: 'closed' }, doc), 200, 'close a stage');
await is(sub(stu1, st6, t1, 'x.pdf', pdf), 409, 'closed stage refuses submissions');
await is(call('PUT', `/stages/${st6}/state`, { state: 'closed' }, doc2), 403, "other supervisor cannot change my stage state");

// ---------- Messaging ----------
const send = (tok, body) => call('POST', '/messages', body, tok);
const th = (await call('GET', '/messages/threads', null, doc)).body;
assert.ok(th.some(t => t.team_id === teamId) && th.some(t => t.student_id === sSolo.id)); ok('supervisor sees a thread per team/student');
await is(send(doc, { teamId, body: 'Hello team' }), 200, 'private message to a team');
await is(send(doc, { body: 'x', teamId: 9999 }), 403, 'cannot message a team that is not mine');
await is(send(doc2, { body: 'x', teamId }), 403, "other supervisor cannot message my team");
await is(send(doc, { teamId }), 400, 'empty message rejected');
let msgs = (await call('GET', `/messages?supervisor=${drSara.id}`, null, stu2)).body;
assert.equal(msgs.length, 1); assert.equal(msgs[0].body, 'Hello team'); ok('team member reads the team conversation');
assert.ok((await keys(stu2)).includes('n.message')); ok('team notified of the message');
assert.equal((await call('GET', `/messages?supervisor=${drSara.id}`, null, solo)).body.length, 0); ok("another team's thread is private");
await is(call('GET', `/messages?team=${teamId}`, null, doc2), 403, "other supervisors cannot read my team's thread");
await is(call('GET', `/messages?team=${teamId}`, null, admin), 403, 'admin cannot read private messages');
await is(send(stu2, { body: 'Thanks doctor' }), 200, 'student replies');
assert.ok((await keys(doc)).includes('n.message.in')); ok('supervisor notified of the reply');
await is(send(stu2, { body: 'x', supervisorId: drOther.id }), 403, 'student cannot message a foreign supervisor');
// links to stage and submission
await is(send(doc, { teamId, body: 'About your stage', stageId: st1, submissionId: sub3 }), 200, 'message linked to a stage and a submission');
await is(send(doc, { teamId, body: 'wrong', submissionId: subS }), 403, "cannot link another team's submission");
await is(send(doc, { teamId, body: 'wrong', stageId: 9999 }), 404, 'cannot link an unknown stage');
msgs = (await call('GET', `/messages?team=${teamId}`, null, doc)).body;
assert.ok(msgs.some(m => m.stage === 'Literature review' && m.submission_id === sub3)); ok('links are returned with the thread');
// attachments
const att = await is(send(doc, { teamId, body: 'See file', filename: 'guide.pdf', data: pdf }), 200, 'message with an attachment');
await is(send(doc, { teamId, body: 'bad', filename: 'x.exe', data: pdf }), 415, 'attachment type checked');
await is(call('GET', `/messages/${att.body.id}/file`, null, stu1), 200, 'team member downloads the attachment');
await is(call('GET', `/messages/${att.body.id}/file`, null, solo), 403, "other students cannot download it");
await is(call('GET', `/messages/${att.body.id}/file`, null, doc2), 403, "other supervisors cannot download it");
// announcements / reminders
const sol = (await call('GET', '/messages/threads', null, doc)).body.find(t => t.student_id === sSolo.id);
await is(call('POST', '/messages/announce', { body: 'Selected', targets: [`t${teamId}`, 'tX'] }, doc), 403, 'announcement to an unknown target rejected');
await is(call('POST', '/messages/announce', { body: 'Selected', targets: [`t${teamId}`] }, doc), 200, 'message to selected teams');
assert.equal((await call('GET', `/messages?supervisor=${drSara.id}`, null, solo)).body.length, 0); ok('selected-team message is invisible to others');
const an = await is(call('POST', '/messages/announce', { body: 'Everyone: midterm moved', all: true }, doc), 200, 'announcement to all assigned teams');
assert.equal(an.body.sent, 2); ok('announcement reached all teams and students');
assert.ok((await call('GET', `/messages?supervisor=${drSara.id}`, null, solo)).body.some(m => m.kind === 'announcement')); ok('individual student receives it privately');
await is(call('POST', '/messages/announce', { body: 'x', all: true }, stu1), 403, 'students cannot announce');
const rem = await is(call('POST', `/stages/${st4}/remind`, { message: 'Hurry up' }, doc), 200, 'stage reminder');
assert.equal(rem.body.sent, 0); ok('reminder skips those who already submitted');
const rem2 = await is(call('POST', `/stages/${st5}/remind`, {}, doc), 200, 'reminder for a stage with missing work');
assert.equal(rem2.body.sent, 1); assert.ok((await call('GET', `/messages?supervisor=${drSara.id}`, null, stu1)).body.some(m => m.kind === 'reminder' && m.stage_id === st5)); ok('reminder delivered as a stage-linked message');
assert.ok((await keys(stu1)).includes('n.reminder')); ok('reminder notification');

// ---------- Dashboard & reports ----------
const dash = (await call('GET', '/supervisor/dashboard', null, doc)).body;
assert.equal(dash.totals.research, 3); assert.equal(dash.totals.teams, 1); assert.equal(dash.totals.approved, 1);
assert.ok(dash.totals.late >= 1); assert.ok(dash.upcoming.length >= 1); assert.ok(dash.recent_messages.length >= 1); assert.ok(dash.progress.completion_percent != null); ok('dashboard totals, late, upcoming, recent messages, progress');
await is(call('GET', '/supervisor/dashboard', null, stu1), 403, 'students cannot open the dashboard');
await is(call('GET', '/supervisor/dashboard', null, admin), 403, 'admin has no supervisor dashboard');
const rep = (await call('GET', '/supervisor/reports', null, doc)).body;
assert.equal(rep.research.length, 3); assert.ok(rep.stages.length >= 4); assert.ok(rep.missing.length >= 1); assert.ok(rep.late_teams.length >= 1);
const s1rep = rep.stages.find(s => s.id === st1); assert.equal(s1rep.approved, 1); assert.equal(s1rep.missing, 1); assert.equal(s1rep.avg_score, 100); ok('report: per-stage statistics, missing and late teams');
assert.equal((await call('GET', '/supervisor/reports', null, doc2)).body.research.length, 1); ok('reports only cover own research');
const csv = await call('GET', '/supervisor/reports/export', null, doc);
assert.ok(csv.headers.get('content-type').startsWith('text/csv')); assert.ok(csv.body.toString('utf8').includes('Stage statistics')); ok('CSV export');

// ---------- Restrictions ----------
await is(call('POST', '/users', { name: 'N', email: 'n@e.com', password: 'secret1', role: 'student' }, doc), 403, 'supervisor cannot manage users');
await is(call('PATCH', `/users/${s1.id}/role`, { role: 'admin' }, doc), 403, 'supervisor cannot change roles');
const proj = await call('POST', '/courses', { name: 'Supervisor Project' }, doc);
assert.equal(proj.status, 200); ok('supervisor can add a project (course)');
await is(call('POST', '/courses', { name: 'Supervisor Project' }, doc), 409, 'duplicate project name refused');
await is(call('POST', `/courses/${proj.body.id}/end-term`, {}, doc), 403, 'supervisor cannot end a term');
await is(call('PUT', `/research/${t1}/deadline`, { deadline: '2999-01-01' }, doc), 403, 'supervisor cannot change the global deadline');
await is(call('GET', '/reports', null, doc), 403, 'supervisor cannot open admin reports');
await is(call('GET', `/research/${t3}`, null, doc), 403, "supervisor cannot open another supervisor's research");
await is(call('PUT', `/research/${t3}/grade`, { score: 50 }, doc), 403, "supervisor cannot grade another supervisor's research");
await is(call('GET', `/research/${t3}/stages`, null, doc), 403, "supervisor cannot see another supervisor's stages");
await is(call('GET', '/messages/threads', null, admin), 403, 'admin cannot list message threads');

console.log(`\nAll ${n} supervisor checks passed`);
server.close();
await (await import('../src/db.js')).db.close();
