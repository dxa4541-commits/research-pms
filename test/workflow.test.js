// End-to-end test of the automated research workflow: proposal → review → automatic stage initialization →
// sequential stage progression (approve / request revision / reject policies) → completion.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'pms-wf-'));
process.env.LOG = 'off';
process.env.DB_PATH = join(dir, 'pg');
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
const b64 = s => Buffer.from(s).toString('base64');
const pdf = b64('%PDF-1.4 workflow');
let n = 0; const ok = name => console.log(`ok ${++n} - ${name}`);
const is = async (p, status, name) => { const r = await p; assert.equal(r.status, status, `${name}: got ${r.status} ${JSON.stringify(r.body)}`); ok(name); return r; };
const keys = async tok => (await call('GET', '/notifications', null, tok)).body.map(x => JSON.parse(x.message).k);
const day = off => new Date(Date.now() + off * 86400000).toISOString().slice(0, 10);

const admin = await login('admin@example.com', 'admin123');
const doc = await login('doctor@example.com', 'doctor123');
const lead = await login('20240001', 'student123');
const mate = await login('20240002', 'student123');
const course = (await call('GET', '/courses', null, admin)).body[0];
await call('POST', '/users', { name: 'Solo', email: 'solo@example.com', password: 'secret1', role: 'student', courseIds: [course.id] }, admin);
const solo = await login('solo@example.com', 'secret1');
const drSara = (await call('GET', '/supervisors', null, lead)).body.find(s => s.name === 'Dr. Sara');

// ---------- Instructor settings ----------
let st = (await is(call('GET', '/supervisor/settings', null, doc), 200, 'instructor reads the workflow settings')).body;
assert.equal(st.auto_first_stage, true); assert.equal(st.reject_policy, 'resubmit'); ok('automatic first stage is on by default; rejection keeps the stage active');
await is(call('PUT', '/supervisor/settings', { rejectPolicy: 'explode' }, doc), 400, 'unknown rejection policy refused');
await is(call('GET', '/supervisor/settings', null, lead), 403, 'students have no instructor settings');

// ---------- Course stages, defined before any proposal (still "scheduled", like a fresh semester) ----------
const mk = body => call('POST', '/stages', { courseId: course.id, state: 'scheduled', ...body }, doc);
const s1 = (await is(mk({ name: 'Requirements', description: 'Gather requirements', instructions: 'Use the template', durationDays: 7, allowReplace: true }), 200, 'stage 1 with a 7-day duration')).body.id;
const s2 = (await is(mk({ name: 'Design', deadline: day(60), maxGrade: 50 }), 200, 'stage 2 with a fixed deadline')).body.id;
const s3 = (await is(mk({ name: 'Report', maxFiles: 2, formats: ['pdf', 'docx'] }), 200, 'stage 3 accepting two files')).body.id;
await is(mk({ name: 'Bad', maxFiles: 11 }), 400, 'at most 10 files per submission');
await is(mk({ name: 'Bad', durationDays: 0 }), 400, 'duration must be at least one day');

// ---------- 1. Research submission: group project with chosen members ----------
const avail = (await call('GET', `/available-students?courseId=${course.id}`, null, lead)).body;
const mateId = avail.find(s => s.name === 'Lina').id;
await is(call('POST', '/research', { title: 'Smart Library', courseId: course.id, supervisorId: drSara.id, newTeam: { name: 'Owls', memberIds: [] } }, lead), 400, 'a group project needs at least one member');
let r = await is(call('POST', '/research', { title: 'Smart Library', description: 'Book tracking', courseId: course.id, supervisorId: drSara.id, newTeam: { name: 'Owls', memberIds: [mateId] } }, lead), 200, 'student creates a group project and selects team members');
const rid = r.body.id; assert.ok(r.body.team_id); assert.equal(r.body.invited, 1); ok('team created with the student as leader and members invited');
const inv = (await call('GET', '/invitations', null, mate)).body.find(i => i.status === 'pending');
await is(call('POST', `/invitations/${inv.id}/respond`, { accept: true }, mate), 200, 'invited member accepts');
assert.equal((await call('GET', `/research/${rid}`, null, mate)).body.status, 'pending'); ok('member tracks the proposal status: pending review');
assert.ok((await keys(doc)).includes('n.submitted')); ok('instructor notified of the proposal');
assert.equal((await call('GET', `/research/${rid}/stages`, null, lead)).body.stages.length, 0); ok('no stages before approval');

// ---------- 2. Instructor review: revision, then approval (every action in the history) ----------
await is(call('POST', `/research/${rid}/request-changes`, {}, doc), 400, 'revision feedback is mandatory');
await is(call('POST', `/research/${rid}/request-changes`, { comment: 'Narrow the scope' }, doc), 200, 'instructor requests a revision');
await is(call('PUT', `/research/${rid}/topic`, { title: 'Smart Library (campus)', description: 'Narrowed' }, lead), 200, 'leader revises and resubmits');
r = await is(call('POST', `/research/${rid}/approve`, { decision: 'approve', comment: 'Go ahead' }, doc), 200, 'instructor approves the proposal');
assert.equal(r.body.workflow.started, true); assert.equal(r.body.workflow.first, 'Requirements'); ok('approval starts the workflow with the first course stage');

// ---------- 3. Automatic workflow initialization ----------
const stagesOf = async tok => (await call('GET', `/research/${rid}/stages`, null, tok)).body.stages;
let ss = await stagesOf(lead);
assert.deepEqual(ss.map(e => e.stage.name), ['Requirements', 'Design', 'Report']); ok('every course stage initialized for the research, in order');
assert.deepEqual(ss.map(e => e.phase), ['active', 'locked', 'locked']); ok('first stage active, the rest wait');
assert.equal(ss[0].display_status, 'open'); assert.equal(ss[0].stage.phase, 'open'); assert.equal(ss[0].can_submit, true); ok('the first stage opens for this research although the stage itself is still scheduled');
assert.equal(ss[0].stage.deadline, day(7)); ok('deadline = activation + the stage duration');
assert.equal(ss[1].display_status, 'locked'); assert.equal(ss[1].can_submit, false); assert.equal(ss[1].problem, 'Complete the previous stage first'); ok('later stages are locked');
assert.ok((await keys(mate)).includes('n.stage.activated')); ok('all team members notified of the active stage');
let det = (await call('GET', `/stages/${s1}`, null, doc)).body;
assert.equal(det.counts.assigned, 1); assert.equal(det.targets[0].phase, 'active'); ok('instructor sees the research on the stage without assigning it by hand');
assert.equal((await call('GET', `/stages/${s2}`, null, doc)).body.counts.locked, 1); ok('queued research counted as locked, not missing');
await is(call('POST', `/research/${rid}/approve`, { decision: 'approve' }, doc), 200, 'approving again is harmless');
assert.equal((await stagesOf(lead)).filter(e => e.phase === 'active').length, 1); ok('the workflow is not started twice');

// ---------- 4/5. Stage submission ----------
const submit = (tok, sid, body) => call('POST', `/stages/${sid}/submissions`, { researchId: rid, ...body }, tok);
await is(submit(lead, s2, { filename: 'd.pdf', data: pdf }), 409, 'a locked stage refuses submissions');
await is(submit(lead, s1, { files: [{ filename: 'a.pdf', data: pdf }, { filename: 'b.pdf', data: pdf }] }), 400, 'only one file when the stage allows one');
r = await is(submit(lead, s1, { files: [{ filename: 'req.pdf', data: pdf }], note: 'First draft', clientToken: 'tok-1' }), 200, 'leader submits the active stage with a note');
assert.equal(r.body.attempt, 1); assert.equal(r.body.status, 'submitted'); assert.ok(r.body.submitted_at); ok('status becomes Submitted and the timestamp is recorded');
r = await is(submit(lead, s1, { files: [{ filename: 'req.pdf', data: pdf }], clientToken: 'tok-1' }), 200, 'the same request again (double click)');
assert.equal(r.body.duplicate, true); assert.equal(r.body.attempt, 1); ok('duplicate submission is not created twice');
await is(submit(lead, s1, { filename: 'again.pdf', data: pdf }), 409, 'no second submission while one waits for review');
assert.ok((await keys(doc)).includes('n.stage.submitted')); ok('instructor notified of the submission');
ss = await stagesOf(lead);
assert.equal(ss[0].can_replace, true); ok('the submission can still be replaced before review');
r = await is(submit(lead, s1, { files: [{ filename: 'req-v2.pdf', data: pdf }], replace: true }), 200, 'student replaces the submission before the deadline');
ss = await stagesOf(lead);
assert.equal(ss[0].attempts, 1); assert.equal(ss[0].submissions.length, 2); assert.equal(ss[0].submissions[1].replaced, true); ok('replacement keeps the old version and does not use an attempt');
assert.ok((await keys(doc)).includes('n.stage.replaced')); ok('instructor notified of the replacement');
let subId = (await call('GET', `/stages/${s1}`, null, doc)).body.targets[0].submission_id;
const review = (id, body) => call('POST', `/stage-submissions/${id}/review`, body, doc);
await is(review(subId, { decision: 'comment', comment: 'Reading it' }), 200, 'instructor starts reviewing');
await is(submit(lead, s1, { filename: 'late-swap.pdf', data: pdf, replace: true }), 409, 'no replacement once the review started');

// ---------- 6. Instructor evaluation: revision keeps the stage active ----------
await is(review(subId, { decision: 'request_changes' }), 400, 'revision feedback is mandatory');
await is(review(subId, { decision: 'request_changes', comment: 'Add use cases' }), 200, 'instructor requests a revision');
ss = await stagesOf(lead);
assert.equal(ss[0].phase, 'active'); assert.equal(ss[0].can_submit, true); assert.equal(ss[1].phase, 'locked'); ok('stage stays active, next stage still locked');
assert.ok((await keys(mate)).includes('n.stage.changes')); ok('team notified of the revision');
await is(submit(lead, s1, { filename: 'req-v3.pdf', data: pdf }), 200, 'student resubmits');
subId = (await call('GET', `/stages/${s1}`, null, doc)).body.targets[0].submission_id;
r = await is(review(subId, { decision: 'approve', comment: 'Well done', grade: { score: 95, comment: 'Clear', publish: true } }), 200, 'instructor approves with a grade and feedback');
assert.equal(r.body.next_stage.name, 'Design'); assert.equal(r.body.grade.score, 95); ok('the next stage is activated automatically');
ss = await stagesOf(lead);
assert.deepEqual(ss.map(e => e.phase), ['completed', 'active', 'locked']); ok('current stage closed, next stage active');
assert.equal(ss[0].grade.score, 95); assert.equal(ss[1].stage.deadline, day(60)); ok('student sees the published grade; next stage keeps its fixed deadline');
await is(submit(lead, s1, { filename: 'x.pdf', data: pdf }), 409, 'a completed stage takes no more submissions');

// ---------- Rejection policies ----------
await is(call('PUT', '/supervisor/settings', { rejectPolicy: 'stop' }, doc), 200, 'instructor sets the rejection policy to stop');
await is(submit(lead, s2, { filename: 'design.pdf', data: pdf }), 200, 'student submits stage 2');
subId = (await call('GET', `/stages/${s2}`, null, doc)).body.targets[0].submission_id;
await is(review(subId, { decision: 'reject' }), 400, 'a rejection needs a reason');
r = await is(review(subId, { decision: 'reject', comment: 'Wrong method' }), 200, 'instructor rejects stage 2');
assert.equal(r.body.next_stage, null); assert.equal(r.body.reject_policy, 'stop'); ok('policy "stop": the next stage is not activated');
ss = await stagesOf(lead);
assert.deepEqual(ss.map(e => e.phase), ['completed', 'closed', 'locked']); assert.equal(ss[1].can_submit, false); ok('rejected stage closed for the research');
await is(call('POST', `/stages/${s2}/targets/${rid}/allow-resubmit`, null, doc), 200, 'instructor reopens the stage for one more attempt');
await is(submit(lead, s2, { filename: 'design2.pdf', data: pdf }), 200, 'student resubmits after reopening');
await is(call('PUT', '/supervisor/settings', { rejectPolicy: 'advance' }, doc), 200, 'policy switched to advance');
subId = (await call('GET', `/stages/${s2}`, null, doc)).body.targets[0].submission_id;
r = await is(review(subId, { decision: 'reject', comment: 'Still wrong, but move on' }), 200, 'instructor rejects again');
assert.equal(r.body.next_stage.name, 'Report'); ok('policy "advance": the next stage is activated');

// ---------- Multiple files and completion ----------
await is(submit(lead, s3, { files: [{ filename: 'r.pdf', data: pdf }, { filename: 'r.txt', data: b64('hi') }] }), 415, 'every file must match the allowed formats');
await is(submit(lead, s3, { files: [{ filename: 'report.pdf', data: pdf }, { filename: 'appendix.pdf', data: pdf }], note: 'Final' }), 200, 'student submits two files');
ss = await stagesOf(mate);
const files = ss[2].submissions[0].files;
assert.deepEqual(files.map(f => f.filename), ['report.pdf', 'appendix.pdf']); ok('both files listed in the submission history');
const dl = await call('GET', `/stage-submission-files/${files[1].id}/file`, null, mate);
assert.equal(dl.status, 200); assert.ok(dl.body.toString().startsWith('%PDF')); ok('team member downloads the second file');
assert.equal((await call('GET', `/stage-submission-files/${files[1].id}/file`, null, solo)).status, 403); ok('outsiders cannot download it');
subId = (await call('GET', `/stages/${s3}`, null, doc)).body.targets[0].submission_id;
await is(review(subId, { decision: 'approve' }), 200, 'instructor approves the last stage');
assert.ok((await keys(mate)).includes('n.workflow.done')); assert.ok((await keys(doc)).includes('n.workflow.doneSup')); ok('team and instructor told the research workflow is complete');
const hist = (await call('GET', `/research/${rid}/history`, null, doc)).body.map(h => h.action);
for (const a of ['topic.registered', 'topic.changes_requested', 'topic.edited', 'topic.approved', 'workflow.started', 'workflow.stage_activated', 'stage.replaced', 'stage.review.approved', 'workflow.stage_closed', 'workflow.completed'])
  assert.ok(hist.includes(a), `history has ${a}`);
ok('every step is recorded in the research activity history');

// ---------- Deleting an open stage that has no work yet ----------
const sx = (await mk({ name: 'Temp', assignAll: true })).body.id;   // active for the research (nothing else is active)
assert.equal((await call('GET', '/stages', null, doc)).body.find(s => s.id === sx).deletable, true); ok('an active stage without work can be deleted');
const sy = (await mk({ name: 'After temp', assignAll: true })).body.id;  // queued behind it
await is(call('DELETE', `/stages/${sx}`, null, doc), 200, 'instructor deletes the active stage');
assert.equal((await stagesOf(lead)).find(e => e.stage.id === sy).phase, 'active'); ok('the next queued stage takes its place');
await is(call('DELETE', `/stages/${sy}`, null, doc), 200, 'and that one too');
assert.equal((await call('GET', '/stages', null, doc)).body.find(s => s.id === s1).deletable, false); ok('a stage with submissions cannot be deleted');
await is(call('DELETE', `/stages/${s1}`, null, doc), 409, 'deleting it is refused');

// ---------- A stage added later joins the queue ----------
const s4 = (await is(mk({ name: 'Presentation', assignAll: true }), 200, 'instructor adds a stage after the workflow finished (assign to all)')).body.id;
ss = await stagesOf(lead);
assert.equal(ss.find(e => e.stage.id === s4).phase, 'active'); ok('nothing else is active, so the new stage becomes active');

// ---------- Automatic start switched off ----------
await is(call('PUT', '/supervisor/settings', { autoFirstStage: false, rejectPolicy: 'resubmit' }, doc), 200, 'instructor switches the automatic first stage off');
const sid = (await is(call('POST', '/research', { title: 'Solo work', courseId: course.id, supervisorId: drSara.id }, solo), 200, 'individual proposal')).body.id;
r = await is(call('POST', `/research/${sid}/approve`, { decision: 'approve' }, doc), 200, 'approved without automatic start');
assert.equal(r.body.workflow.started, false);
const soloStages = (await call('GET', `/research/${sid}/stages`, null, solo)).body.stages;
assert.deepEqual(soloStages.map(e => e.stage.name), ['Presentation']); assert.equal(soloStages[0].phase, 'active'); ok('only "assign to all" stages are attached, as before');

// ---------- Starting the workflow for research approved earlier ----------
st = (await call('GET', '/supervisor/settings', null, doc)).body;
assert.deepEqual(st.not_started.map(x => x.id), [sid]); ok('research approved without the workflow is listed as not started');
const pres = soloStages[0].stage.id;
await is(call('PUT', `/stages/${pres}/state`, { state: 'open' }, doc), 200, 'instructor opens the hand-assigned stage');
await is(call('POST', `/stages/${pres}/submissions`, { researchId: sid, filename: 'p.pdf', data: pdf }, solo), 200, 'student works on a hand-assigned stage');
const presSub = (await call('GET', `/stages/${pres}`, null, doc)).body.targets.find(x => x.research_id === sid).submission_id;
await is(call('POST', `/stage-submissions/${presSub}/review`, { decision: 'approve' }, doc), 200, 'instructor approves it');
await is(call('POST', `/research/${sid}/workflow/start`, null, solo), 403, 'students cannot start the workflow');
r = await is(call('POST', `/research/${sid}/workflow/start`, null, doc), 200, 'instructor starts the workflow of the earlier research');
assert.equal(r.body.first, 'Requirements'); ok('the first unfinished stage is activated');
let ws = (await call('GET', `/research/${sid}/stages`, null, solo)).body.stages;
assert.equal(ws.find(e => e.stage.id === pres).phase, 'completed'); assert.equal(ws.find(e => e.stage.id === pres).status, 'approved'); ok('work already approved is kept as completed');
assert.equal(ws.filter(e => e.phase === 'active').length, 1); assert.ok(ws.filter(e => e.phase === 'locked').length >= 2); ok('the other stages wait in order');
assert.ok((await keys(solo)).includes('n.stage.activated')); ok('student notified of the active stage');
await is(call('POST', `/research/${sid}/workflow/start`, null, doc), 409, 'starting twice is refused');
assert.equal((await call('POST', '/supervisor/workflow/start-all', null, doc)).body.started, 0); ok('nothing left to start');

// ---------- Editing a stage after it started ----------
const d2 = (await call('GET', '/stages', null, doc)).body.find(s => s.id === s2);
assert.equal(d2.started, true);
r = await is(call('PUT', `/stages/${s2}`, { ...d2, name: 'Design v2', instructions: 'Use UML', maxGrade: 999, formats: ['txt'], maxFiles: 5, deadline: day(70) }, doc), 200, 'instructor edits a started stage');
assert.equal(r.body.started, true);
const e2 = (await call('GET', '/stages', null, doc)).body.find(s => s.id === s2);
assert.equal(e2.name, 'Design v2'); assert.equal(e2.instructions, 'Use UML'); assert.equal(e2.deadline, day(70)); ok('name, instructions and deadline changed');
assert.equal(e2.max_grade, 50); assert.deepEqual(e2.formats, d2.formats); assert.equal(e2.max_files, d2.max_files); ok('maximum grade and file rules unchanged');
assert.ok((await keys(mate)).includes('n.stage.deadline')); ok('team notified of the new deadline');
await is(call('PUT', `/stages/${s2}`, { ...d2, deadline: day(1), startDate: day(5) }, doc), 200, 'start date is kept even if sent');
assert.equal((await call('GET', '/stages', null, doc)).body.find(s => s.id === s2).start_date, d2.start_date); ok('start date unchanged (use postpone)');

// ---------- Suggested final grade (by marks, then by weights) ----------
let det2 = (await call('GET', `/research/${rid}`, null, doc)).body;
const sf = det2.suggested_final, all = (await call('GET', '/stages', null, doc)).body;
const mine = (await stagesOf(lead)).map(e => e.stage.id);
const maxSum = all.filter(x => mine.includes(x.id)).reduce((a, x) => a + x.max_grade, 0);
assert.equal(sf.method, 'marks'); assert.equal(sf.score, Math.round(95 / maxSum * 1000) / 10); assert.equal(sf.complete, false); ok('suggested final grade by marks; ungraded stages count as 0');
assert.equal((await call('GET', `/research/${rid}`, null, lead)).body.suggested_final, null); ok('students do not see the suggestion');
await is(call('PUT', `/stages/${s1}`, { name: 'Requirements', weight: 101 }, doc), 400, 'weight above 100 refused');
for (const x of all.filter(x => mine.includes(x.id))) await call('PUT', `/stages/${x.id}`, { name: x.name, description: x.description, instructions: x.instructions, deadline: x.deadline, weight: x.id === s1 ? 50 : 50 / (mine.length - 1) }, doc);
det2 = (await call('GET', `/research/${rid}`, null, doc)).body;
assert.equal(det2.suggested_final.method, 'weights'); assert.equal(det2.suggested_final.score, 47.5); ok('with a weight on every stage: 95/100 × 50% = 47.5');

// ---------- Stage templates: copy into another course ----------
const c2 = (await call('POST', '/courses', { name: 'Software Engineering 2' }, admin)).body;
const c2id = c2.id ?? (await call('GET', '/courses', null, admin)).body.find(c => c.name === 'Software Engineering 2').id;
await is(call('POST', '/stages/copy', { stageIds: [], courseId: c2id }, doc), 400, 'choose at least one stage');
await is(call('POST', '/stages/copy', { stageIds: [s1], courseId: c2id, shiftDays: 1.5 }, doc), 400, 'shift must be whole days');
r = await is(call('POST', '/stages/copy', { stageIds: [s1, s2], courseId: c2id, shiftDays: 100 }, doc), 200, 'instructor copies two stages into another course');
assert.equal(r.body.created, 2);
const copies = (await call('GET', '/stages', null, doc)).body.filter(x => r.body.ids.includes(x.id));
const o2 = (await call('GET', '/stages', null, doc)).body.find(x => x.id === s2);
assert.deepEqual(copies.map(x => x.name), ['Requirements', o2.name]); assert.ok(copies.every(x => x.state === 'scheduled' && x.counts.assigned === 0)); ok('copies keep their order, start scheduled and unassigned');
assert.equal(copies[1].deadline, (d => new Date(Date.parse(d + 'T00:00:00Z') + 100 * 86400000).toISOString().slice(0, 10))(o2.deadline)); assert.equal(copies[1].max_grade, 50); assert.equal(copies[0].weight, 50); ok('dates moved by 100 days; grade and weight kept');
const docOther = await (async () => { await call('POST', '/users', { name: 'Dr. X', email: 'x@example.com', password: 'secret1', role: 'supervisor' }, admin); return login('x@example.com', 'secret1'); })();
await is(call('POST', '/stages/copy', { stageIds: [s1], courseId: c2id }, docOther), 403, "cannot copy another instructor's stages");

// ---------- Workflow report ----------
const rep = (await call('GET', '/supervisor/reports', null, doc)).body.workflow;
const wr = rep.find(x => x.id === rid);
assert.ok(wr && wr.stages >= 3 && wr.completed >= 1 && wr.progress_percent > 0); ok('workflow report lists progress per research');
assert.ok(rep.every(x => ['student', 'instructor', null].includes(x.waiting_on))); assert.ok(rep.some(x => x.current_stage)); ok('current stage and who has to act next');
const csv = (await call('GET', '/supervisor/reports/export', null, doc)).body.toString();
assert.ok(csv.includes('Workflow') && csv.includes('Waiting on')); ok('CSV export includes the workflow section');

// ---------- Team card: what the team handed in for each stage ----------
const owls = (await call('GET', '/teams', null, doc)).body.find(x => x.name === 'Owls');
const tl = owls.stage_list;
assert.equal(tl[0].name, 'Requirements'); assert.equal(tl[0].status, 'approved'); assert.equal(tl[0].score, 95); ok('team card lists the stages in order with status and grade');
assert.deepEqual(tl[0].files.map(f => f.filename), ['req-v3.pdf']); assert.ok(tl[0].submitted_at); ok('latest submitted files and submission time per stage');
const rep3 = tl.find(x => x.name === 'Report');
assert.deepEqual(rep3.files.map(f => f.filename), ['report.pdf', 'appendix.pdf']); ok('several files of one submission');
assert.equal((await call('GET', `/stage-submission-files/${rep3.files[0].id}/file`, null, doc)).status, 200); ok('instructor downloads a file from the team card');

console.log(`\nAll ${n} workflow checks passed`);
server.close(); process.exit(0);
