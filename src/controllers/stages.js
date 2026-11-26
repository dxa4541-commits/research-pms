// Supervisor: customizable research stages, per-stage submissions review and grading. Students: stage submissions.
import { db } from '../db.js';
import { fail, str, need } from '../errors.js';
import { ALL_FORMATS, DEFAULT_FORMATS, MAX_TOTAL_BYTES, checkFile, storeFile, readStored } from '../files.js';
import { notify, notifyParties } from '../notifications.js';
import { accessible, getResearch } from '../research.js';
import { audit } from '../audit.js';
import { addMessage, targetOf, notifyMessage, preview } from '../messages.js';
import { isLeader, getTeam } from '../teams.js';
import {
  today, addDays, STATE_LIST, getStage, ownStage, criteriaOf, stageStarted, publicStage, targets, decorate, submitProblem, attemptsLeft,
  assign, stageTotals, formatsOf, replaceProblem, openFor,
} from '../stages.js';
import { activateNext, finishTarget, settingsFor, saveSettings, startWorkflow, notStarted } from '../workflow.js';
import { own } from '../research.js';

const isDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d));
const optDate = (v, label) => v == null || v === '' ? null : isDate(v) ? v : fail(400, `${label} must be a date (YYYY-MM-DD)`);
const optText = (v, max, label) => {
  if (v == null || v === '') return null;
  return str(v, max) ?? fail(400, `${label} is too long (max ${max} chars)`);
};
const num = (v, label, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) && n > min - 1e-9 && n <= max ? n : fail(400, `${label} must be between ${min} and ${max}`);
};

// Validates the editable part of a stage (shared by create and update).
function parseStage(body) {
  const name = need(body.name, 'Stage name', 120);
  const start = optDate(body.startDate, 'Start date'), deadline = optDate(body.deadline, 'Deadline');
  if (start && deadline && deadline < start) fail(400, 'Deadline cannot be before the start date');
  const formats = body.formats == null ? DEFAULT_FORMATS : (Array.isArray(body.formats) ? [...new Set(body.formats.map(f => String(f).toLowerCase()))] : fail(400, 'Formats must be a list'));
  if (!formats.length || formats.some(f => !ALL_FORMATS.includes(f))) fail(400, `Allowed formats must be chosen from: ${ALL_FORMATS.join(', ')}`);
  const maxMb = body.maxFileMb == null || body.maxFileMb === '' ? 10 : num(body.maxFileMb, 'File size limit', 0.1, 10);
  const allowResubmit = body.allowResubmit == null ? true : !!body.allowResubmit;
  const allowLate = body.allowLate == null ? true : !!body.allowLate;
  let maxAttempts = null;
  if (body.maxAttempts != null && body.maxAttempts !== '') {
    maxAttempts = Number(body.maxAttempts);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) fail(400, 'Maximum attempts must be a whole number from 1 to 20');
  }
  let criteria = [];
  if (body.criteria != null) {
    if (!Array.isArray(body.criteria) || body.criteria.length > 10) fail(400, 'At most 10 grading criteria are allowed');
    criteria = body.criteria.map((c, i) => ({ name: need(c?.name, 'Criterion name', 100), max: num(c?.max, 'Criterion maximum', 0.1, 1000), position: i }));
  }
  const int = (v, label, min, max, def) => {
    if (v == null || v === '') return def;
    const n = Number(v);
    return Number.isInteger(n) && n >= min && n <= max ? n : fail(400, `${label} must be a whole number from ${min} to ${max}`);
  };
  const durationDays = int(body.durationDays, 'Stage duration', 1, 365, null);
  const maxFiles = int(body.maxFiles, 'Number of files', 1, 10, 1);
  const allowReplace = body.allowReplace == null ? true : !!body.allowReplace;
  const weight = body.weight == null || body.weight === '' ? null : num(body.weight, 'Stage weight', 0, 100);
  const maxGrade = criteria.length ? criteria.reduce((a, c) => a + c.max, 0)
    : (body.maxGrade == null || body.maxGrade === '' ? 100 : num(body.maxGrade, 'Maximum grade', 0.1, 1000));
  if (maxGrade > 1000) fail(400, 'Maximum grade must be between 0.1 and 1000');
  return {
    name, description: optText(body.description, 2000, 'Description'), instructions: optText(body.instructions, 4000, 'Instructions'),
    start, deadline, formats, maxMb, allowResubmit, allowLate, maxAttempts, criteria, maxGrade, durationDays, maxFiles, allowReplace, weight,
  };
}
const saveCriteria = async (stageId, criteria) => {
  await db.prepare('DELETE FROM stage_criteria WHERE stage_id=?').run(stageId);
  const ins = db.prepare('INSERT INTO stage_criteria (stage_id,name,max_score,position) VALUES (?,?,?,?)');
  for (const c of criteria) await ins.run(stageId, c.name, c.max, c.position);
};
// Each request already runs in one transaction; the rest of this file reads like the steps of a use case.
const notifyTargets = async (stageId, key, params) => {
  for (const t of await targets('t.stage_id=?', stageId)) await notifyParties(await getResearch(t.research_id), key, params);
};
const countsFor = rows => ({
  assigned: rows.length, submitted: rows.filter(r => !r.missing).length, missing: rows.filter(r => r.missing).length,
  pending_review: rows.filter(r => r.pending_review).length, approved: rows.filter(r => r.status === 'approved').length,
  changes_requested: rows.filter(r => r.status === 'changes_requested').length, rejected: rows.filter(r => r.status === 'rejected').length,
  late: rows.filter(r => r.late).length, graded: rows.filter(r => r.score != null).length,
  locked: rows.filter(r => r.locked).length, active: rows.filter(r => r.phase === 'active').length,
});
const targetLabel = r => r.team ? `${r.team}` : r.student;

export const stageHandlers = {
  // ---------- Supervisor: stage CRUD ----------
  async listStages({ user }) {
    const stages = user.role === 'admin' ? await db.prepare('SELECT * FROM stages ORDER BY supervisor_id, position, id').all()
      : await db.prepare('SELECT * FROM stages WHERE supervisor_id=? ORDER BY position, id').all(user.id);
    const course = db.prepare('SELECT name FROM courses WHERE id=?');
    const out = [];
    for (const s of stages) out.push({ ...await publicStage(s), deletable: !await hasWork(s.id), course: (await course.get(s.course_id))?.name, criteria: await criteriaOf(s.id), counts: countsFor(await targets('t.stage_id=?', s.id)) });
    return out;
  },
  async createStage({ user, body }) {
    const course = (await db.prepare('SELECT id FROM courses WHERE id=?').get(Number(body.courseId))) ?? fail(400, 'Choose a valid course');
    const p = parseStage(body);
    const state = body.state === 'open' ? 'open' : 'scheduled';
    const pos = (await db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM stages WHERE supervisor_id=?').get(user.id)).n;
    const r = await db.prepare(`INSERT INTO stages (supervisor_id,course_id,position,name,description,instructions,start_date,deadline,max_grade,
        allowed_formats,max_file_mb,allow_resubmit,max_attempts,state,assign_all,allow_late,duration_days,max_files,allow_replace,weight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(user.id, course.id, pos, p.name, p.description, p.instructions, p.start, p.deadline, p.maxGrade, p.formats.join(','), p.maxMb,
          p.allowResubmit ? 1 : 0, p.maxAttempts, state, body.assignAll ? 1 : 0, p.allowLate ? 1 : 0, p.durationDays, p.maxFiles, p.allowReplace ? 1 : 0, p.weight);
    const id = r.lastInsertRowid;
    await saveCriteria(id, p.criteria);
    const stage = await getStage(id);
    const added = await attach(stage, body);
    await audit(user, 'stage.created', { stageId: id, detail: { name: p.name, targets: added.length } });
    return { id, assigned: added.length };
  },
  // Before a stage starts everything can be edited. Once students can work on it, what decides how work is judged
  // or accepted stays as it is (maximum grade, rubric, file formats and limits, start date — use postpone for
  // dates); name, description, instructions, deadline and the resubmission/late rules can still change, and every
  // research on the stage is told. A new deadline applies to research without a deadline of its own (duration).
  async updateStage({ user, params, body }) {
    const s = await ownStage(user, Number(params.id));
    const started = await stageStarted(s);
    const kept = started ? { startDate: s.start_date, maxGrade: s.max_grade, formats: formatsOf(s), maxFileMb: s.max_file_mb, maxFiles: s.max_files, criteria: null } : {};
    const p = parseStage({ ...body, ...kept });
    await db.prepare(`UPDATE stages SET name=?,description=?,instructions=?,start_date=?,deadline=?,max_grade=?,allowed_formats=?,max_file_mb=?,
        allow_resubmit=?,max_attempts=?,assign_all=?,allow_late=?,duration_days=?,max_files=?,allow_replace=?,weight=? WHERE id=?`).run(p.name, p.description, p.instructions, p.start, p.deadline, p.maxGrade,
        p.formats.join(','), p.maxMb, p.allowResubmit ? 1 : 0, p.maxAttempts, body.assignAll ? 1 : 0, p.allowLate ? 1 : 0, p.durationDays, p.maxFiles, p.allowReplace ? 1 : 0, p.weight, s.id);
    if (!started) await saveCriteria(s.id, p.criteria);
    const stage = await getStage(s.id);
    if (body.assignAll) await attach(stage, { assignAll: true });
    if (p.deadline !== s.deadline) await notifyTargets(s.id, 'n.stage.deadline', { stage: p.name, state: s.state, date: p.deadline ?? '—' });
    else await notifyTargets(s.id, 'n.stage.updated', { stage: p.name });
    const changed = ['name', 'description', 'instructions', 'deadline', 'allow_resubmit', 'max_attempts', 'allow_late', 'allow_replace', 'duration_days', 'weight']
      .filter(k => String(s[k] ?? '') !== String(stage[k] ?? ''));
    await audit(user, 'stage.updated', { stageId: s.id, detail: { name: p.name, started, changed, prevDeadline: s.deadline } });
    return { ok: true, started, kept: started ? ['max_grade', 'criteria', 'formats', 'max_file_mb', 'max_files', 'start_date'] : [] };
  },
  // A stage can be deleted as long as nobody has submitted work or received a grade for it, even when it is open.
  // Research for which it was the active stage moves on to its next stage.
  async deleteStage({ user, params }) {
    const s = await ownStage(user, Number(params.id));
    if (await hasWork(s.id)) fail(409, 'This stage already has submissions or grades and cannot be deleted');
    const active = await db.prepare("SELECT research_id FROM stage_targets WHERE stage_id=? AND phase='active'").all(s.id);
    await db.prepare('UPDATE messages SET stage_id=NULL WHERE stage_id=?').run(s.id); // the messages stay; only their stage link goes
    await db.prepare('DELETE FROM deadline_events WHERE stage_id=?').run(s.id);
    await db.prepare('DELETE FROM stages WHERE id=?').run(s.id); // targets and criteria cascade
    await audit(user, 'stage.deleted', { stageId: s.id, detail: { name: s.name, active: active.length } });
    for (const { research_id } of active) await activateNext(await getResearch(research_id), user);
    return { ok: true };
  },
  // Open / close / postpone (any time). Postponing needs a new start date and/or deadline.
  async setStageState({ user, params, body }) {
    const s = await ownStage(user, Number(params.id));
    if (!STATE_LIST.includes(body.state)) fail(400, 'Invalid stage state');
    let start = s.start_date, deadline = s.deadline;
    if (body.startDate !== undefined) start = optDate(body.startDate, 'Start date');
    if (body.deadline !== undefined) deadline = optDate(body.deadline, 'Deadline');
    if (start && deadline && deadline < start) fail(400, 'Deadline cannot be before the start date');
    if (body.state === 'postponed' && start === s.start_date && deadline === s.deadline) fail(400, 'Choose a new start date or deadline to postpone the stage');
    await db.prepare('UPDATE stages SET state=?, start_date=?, deadline=? WHERE id=?').run(body.state, start, deadline, s.id);
    const key = deadline !== s.deadline ? 'n.stage.deadline' : 'n.stage.state';
    await notifyTargets(s.id, key, { stage: s.name, state: body.state, date: deadline ?? '—' });
    await audit(user, 'stage.state', { stageId: s.id, detail: { from: s.state, to: body.state, start, deadline, prevDeadline: s.deadline } });
    return { state: body.state, start_date: start, deadline };
  },
  // Stage templates: copy stages (with their rubric and rules) into a course — the same course for a new term, or
  // another course. Dates move by shiftDays; copies start "scheduled" and are not assigned to anyone yet.
  async copyStages({ user, body }) {
    const course = (await db.prepare('SELECT id FROM courses WHERE id=?').get(Number(body.courseId))) ?? fail(400, 'Choose a valid course');
    const ids = Array.isArray(body.stageIds) ? [...new Set(body.stageIds.map(Number))] : fail(400, 'Choose the stages to copy');
    if (!ids.length) fail(400, 'Choose the stages to copy');
    const shift = body.shiftDays == null || body.shiftDays === '' ? 0 : Number(body.shiftDays);
    if (!Number.isInteger(shift) || Math.abs(shift) > 730) fail(400, 'Shift must be a whole number of days (up to 730)');
    const src = await db.prepare(`SELECT * FROM stages WHERE supervisor_id=? AND id IN (${ids.map(() => '?').join(',')}) ORDER BY position, id`).all(user.id, ...ids);
    if (src.length !== ids.length) fail(403, 'Not your stage');
    let pos = (await db.prepare('SELECT COALESCE(MAX(position),0) AS n FROM stages WHERE supervisor_id=?').get(user.id)).n;
    const move = d => d ? addDays(d, shift) : null;
    const created = [];
    for (const s of src) {
      const id = (await db.prepare(`INSERT INTO stages (supervisor_id,course_id,position,name,description,instructions,start_date,deadline,max_grade,allowed_formats,max_file_mb,
          allow_resubmit,max_attempts,state,assign_all,allow_late,duration_days,max_files,allow_replace,weight) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'scheduled',?,?,?,?,?,?)`)
        .run(user.id, course.id, ++pos, s.name, s.description, s.instructions, move(s.start_date), move(s.deadline), s.max_grade, s.allowed_formats, s.max_file_mb,
          s.allow_resubmit, s.max_attempts, s.assign_all, s.allow_late, s.duration_days, s.max_files, s.allow_replace, s.weight)).lastInsertRowid;
      await saveCriteria(id, (await criteriaOf(s.id)).map(c => ({ name: c.name, max: c.max_score, position: c.position })));
      created.push(id);
    }
    await audit(user, 'stage.copied', { detail: { from: ids, to: created, course: course.id, shift } });
    return { created: created.length, ids: created };
  },
  async reorderStages({ user, body }) {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : fail(400, 'ids must be a list');
    const mine = (await db.prepare('SELECT id FROM stages WHERE supervisor_id=?').all(user.id)).map(x => x.id);
    if (new Set(ids).size !== ids.length || ids.some(i => !mine.includes(i))) fail(403, 'Not your stage');
    const u = db.prepare('UPDATE stages SET position=? WHERE id=?');
    for (const [i, id] of ids.entries()) await u.run(i + 1, id);
    await audit(user, 'stage.reordered', { detail: { ids } });
    return { ok: true };
  },
  async setGradesLock({ user, params, body }) {
    const s = await ownStage(user, Number(params.id));
    await db.prepare('UPDATE stages SET grades_locked=? WHERE id=?').run(body.locked ? 1 : 0, s.id);
    await audit(user, body.locked ? 'stage.grades_locked' : 'stage.grades_unlocked', { stageId: s.id });
    return { grades_locked: !!body.locked };
  },

  // ---------- Supervisor: stage overview (every assigned student/team and its status) ----------
  async getStageDetail({ user, params }) {
    const s = await getStage(Number(params.id));
    if (user.role !== 'admin' && s.supervisor_id !== user.id) fail(403, 'Not your stage');
    const rows = await targets('t.stage_id=?', s.id);
    const assignedIds = rows.map(r => r.research_id);
    const candidates = (await db.prepare(`SELECT r.id,r.title,r.team_id,t.name AS team,u.name AS student FROM research r JOIN users u ON u.id=r.student_id
      LEFT JOIN teams t ON t.id=r.team_id WHERE r.supervisor_id=? AND r.course_id=? AND r.status='approved' ORDER BY r.id`).all(s.supervisor_id, s.course_id))
      .filter(r => !assignedIds.includes(r.id));
    return {
      stage: { ...await publicStage(s), course: (await db.prepare('SELECT name FROM courses WHERE id=?').get(s.course_id))?.name }, criteria: await criteriaOf(s.id),
      counts: countsFor(rows), unassigned: candidates,
      targets: rows.map(r => ({
        research_id: r.research_id, title: r.title, student: r.student, team: r.team, label: targetLabel(r), status: r.status, late: r.late,
        phase: r.phase, deadline: r.deadline, activated_at: r.activated_at,
        missing: r.missing, attempts: r.attempts, attempts_left: attemptsLeft(s, r), extra_attempts: r.extra_attempts, submission_id: r.sub_id,
        filename: r.filename, submitted_at: r.submitted_at, score: r.score, grade_comment: r.grade_comment,
      })),
    };
  },
  async assignStage({ user, params, body }) {
    const s = await ownStage(user, Number(params.id));
    const added = await attach(s, body);
    await audit(user, 'stage.assigned', { stageId: s.id, detail: { added } });
    return { added: added.length };
  },
  async unassignStage({ user, params }) {
    const s = await ownStage(user, Number(params.id)), rid = Number(params.rid);
    const used = await db.prepare(`SELECT 1 WHERE EXISTS (SELECT 1 FROM stage_submissions WHERE stage_id=? AND research_id=?)
      OR EXISTS (SELECT 1 FROM stage_grades WHERE stage_id=? AND research_id=?)`).get(s.id, rid, s.id, rid);
    if (used) fail(409, 'This research already has submissions or a grade for the stage');
    const r = await db.prepare('DELETE FROM stage_targets WHERE stage_id=? AND research_id=?').run(s.id, rid);
    if (!r.changes) fail(404, 'Not assigned to this stage');
    await audit(user, 'stage.unassigned', { stageId: s.id, researchId: rid });
    return { ok: true };
  },
  // Allow one more attempt (e.g. when the attempt limit or "no resubmission" would block the student).
  async allowResubmit({ user, params }) {
    const s = await ownStage(user, Number(params.id)), rid = Number(params.rid);
    // one more attempt; a stage stopped by a rejection ('closed' for this research) becomes active again
    const r = await db.prepare(`UPDATE stage_targets SET extra_attempts=extra_attempts+1,
        phase=CASE WHEN phase='closed' THEN 'active' ELSE phase END, completed_at=CASE WHEN phase='closed' THEN NULL ELSE completed_at END
      WHERE stage_id=? AND research_id=?`).run(s.id, rid);
    if (!r.changes) fail(404, 'Not assigned to this stage');
    await notifyParties(await getResearch(rid), 'n.stage.resubmit', { stage: s.name });
    await audit(user, 'stage.resubmit_allowed', { stageId: s.id, researchId: rid });
    return { ok: true };
  },
  // Reminder (private message + notification) to every assigned student/team that has not submitted.
  async remindStage({ user, params, body }) {
    const s = await ownStage(user, Number(params.id));
    let rows = (await targets('t.stage_id=?', s.id)).filter(r => r.missing);
    if (Array.isArray(body.researchIds)) { const ids = body.researchIds.map(Number); rows = rows.filter(r => ids.includes(r.research_id)); }
    const text = str(body.message, 1000) ?? `${s.name}${s.deadline ? ` — ${s.deadline}` : ''}`;
    for (const r of rows) {
      const target = targetOf(r);
      await addMessage({ supervisorId: user.id, target, senderId: user.id, kind: 'reminder', body: text, stageId: s.id });
      await notifyMessage({ sender: user, supervisorId: user.id, target, kind: 'reminder', preview: preview(text) });
    }
    await audit(user, 'stage.reminder', { stageId: s.id, detail: { count: rows.length } });
    return { sent: rows.length };
  },

  // ---------- Stages of one research (student, supervisor, admin) ----------
  async researchStages({ user, params }) {
    const r = await accessible(user, Number(params.id));
    const student = user.role === 'student';
    const rows = await targets('t.research_id=?', r.id);
    // everything of this research in a few queries, grouped in memory
    const subs = await db.prepare(`SELECT s.id,s.stage_id,s.attempt_no,s.filename,s.size,s.student_note,s.late,s.status,s.replaced,s.created_at,s.submitted_by,u.name AS by
      FROM stage_submissions s LEFT JOIN users u ON u.id=s.submitted_by WHERE s.research_id=? ORDER BY s.attempt_no DESC`).all(r.id);
    const files = await db.prepare(`SELECT f.id,f.submission_id,f.filename,f.size FROM stage_submission_files f JOIN stage_submissions s ON s.id=f.submission_id
      WHERE s.research_id=? ORDER BY f.submission_id, f.position`).all(r.id);
    const revs = await db.prepare(`SELECT v.id,v.submission_id,v.decision,v.comment,v.created_at,u.name AS reviewer FROM stage_reviews v JOIN users u ON u.id=v.reviewer_id
      JOIN stage_submissions s ON s.id=v.submission_id WHERE s.research_id=? ORDER BY v.id`).all(r.id);
    const scores = await db.prepare('SELECT stage_id,criterion_id,score FROM stage_grade_scores WHERE research_id=?').all(r.id);
    const may = student ? await mayStudentSubmit(user, r) : null;
    const list = [];
    for (const t of rows) {
      const stage = await getStage(t.stage_id);
      const problem = student ? (may ?? submitProblem(stage, t)) : null;
      const showGrade = t.score != null && (!student || t.grade_published);
      // the stage as this research sees it: its own deadline, and "open" once the workflow activated it
      const ps = await publicStage(stage);
      const view = { ...ps, deadline: t.deadline, phase: t.phase === 'locked' ? 'locked' : openFor(t) && t.activated_at ? 'open' : ps.phase };
      list.push({
        stage: view, criteria: await criteriaOf(stage.id), status: t.status, display_status: t.display_status, late: t.late, missing: t.missing, attempts: t.attempts, attempts_left: attemptsLeft(stage, t),
        phase: t.phase, activated_at: t.activated_at, completed_at: t.completed_at,
        extra_attempts: t.extra_attempts, can_submit: student && !problem, problem, can_replace: student && !may && !replaceProblem(stage, t),
        grade: showGrade ? { score: t.score, comment: t.grade_comment, published: !!t.grade_published, scores: scores.filter(x => x.stage_id === stage.id).map(({ criterion_id, score }) => ({ criterion_id, score })) } : null,
        grade_pending: student && t.score != null && !t.grade_published,
        submissions: subs.filter(x => x.stage_id === stage.id).map(({ stage_id, by, ...x }) => ({ ...x, late: !!x.late, replaced: !!x.replaced, by: by ?? undefined,
          files: files.some(f => f.submission_id === x.id) ? files.filter(f => f.submission_id === x.id).map(({ submission_id, ...f }) => f) : [{ id: null, filename: x.filename, size: x.size }],
          reviews: revs.filter(v => v.submission_id === x.id).map(({ submission_id, ...v }) => v) })),
      });
    }
    return { research_id: r.id, totals: await stageTotals(r.id, student), stages: list };
  },
  // Student: submit (or resubmit) a stage: one or more files and an optional note. Every attempt is stored as its own
  // row and files; nothing is overwritten. body.replace swaps a submission that nobody has reviewed yet (before the
  // deadline, when the stage allows it): the old attempt is kept, marked as replaced. body.clientToken makes a
  // repeated request (double click, network retry) return the first submission instead of creating another one.
  async submitStage({ user, params, body }) {
    const stage = await getStage(Number(params.id));
    const r = await accessible(user, Number(body.researchId));
    const token = body.clientToken == null ? null : (str(String(body.clientToken), 64) ?? fail(400, 'Invalid submission token'));
    if (token) {
      const dup = await db.prepare('SELECT attempt_no, late FROM stage_submissions WHERE research_id=? AND client_token=?').get(r.id, token);
      if (dup) return { attempt: dup.attempt_no, late: !!dup.late, duplicate: true };
    }
    const row = (await targets('t.stage_id=? AND t.research_id=?', stage.id, r.id))[0] ?? fail(404, 'This stage is not assigned to your research');
    const denied = await mayStudentSubmit(user, r);
    if (denied) fail(403, denied);
    const replace = !!body.replace;
    const problem = replace ? replaceProblem(stage, row) : submitProblem(stage, row);
    if (problem) fail(409, problem);
    const given = Array.isArray(body.files) ? body.files : [{ filename: body.filename, data: body.data }];
    if (!given.length) fail(400, 'A file is required');
    if (given.length > (stage.max_files ?? 1)) fail(400, stage.max_files > 1 ? `At most ${stage.max_files} files can be submitted` : 'Only one file can be submitted for this stage');
    const opts = { formats: formatsOf(stage), maxBytes: Math.floor(stage.max_file_mb * 1048576) };
    const checked = given.map(f => ({ name: f?.filename, buf: checkFile(f?.filename, f?.data, opts).buf }));
    if (checked.reduce((a, f) => a + f.buf.length, 0) > MAX_TOTAL_BYTES) fail(413, `The files together exceed the ${MAX_TOTAL_BYTES / 1048576} MB limit`);
    const note = optText(body.note, 1000, 'Note');
    const attempt = (await db.prepare('SELECT COALESCE(MAX(attempt_no),0)+1 AS n FROM stage_submissions WHERE stage_id=? AND research_id=?').get(stage.id, r.id)).n;
    const late = row.deadline && today() > row.deadline ? 1 : 0;
    const stored = [];
    for (const f of checked) stored.push({ ...await storeFile(f.name, f.buf), size: f.buf.length }); // removed again if the request fails
    if (replace) await db.prepare('UPDATE stage_submissions SET replaced=1 WHERE id=?').run(row.sub_id);
    let subId;
    try {
      subId = (await db.prepare(`INSERT INTO stage_submissions (stage_id,research_id,attempt_no,filename,stored_name,size,student_note,submitted_by,late,client_token)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(stage.id, r.id, attempt, stored[0].safeName, stored[0].stored, stored[0].size, note, user.id, late, token)).lastInsertRowid;
    } catch (e) { if (/UNIQUE/.test(e.message)) fail(409, 'Another submission was made at the same time; please retry'); throw e; }
    for (const [i, f] of stored.entries())
      await db.prepare('INSERT INTO stage_submission_files (submission_id,position,filename,stored_name,size) VALUES (?,?,?,?,?)').run(subId, i, f.safeName, f.stored, f.size);
    const p = { student: user.name, stage: stage.name, title: r.title, n: attempt };
    await notify(r.supervisor_id, replace ? 'n.stage.replaced' : attempt > 1 ? 'n.stage.resubmitted' : 'n.stage.submitted', p, r.id);
    if (late) await notify(r.supervisor_id, 'n.stage.late_submission', p, r.id);
    await audit(user, replace ? 'stage.replaced' : attempt > 1 ? 'stage.resubmitted' : 'stage.submitted',
      { stageId: stage.id, researchId: r.id, detail: { attempt, late: !!late, files: stored.map(f => f.safeName) } });
    return { attempt, late: !!late, status: 'submitted', submitted_at: (await db.prepare('SELECT created_at FROM stage_submissions WHERE id=?').get(subId)).created_at };
  },
  async downloadStageSubmissionFile({ user, params }) {
    const f = (await db.prepare('SELECT f.*, s.research_id FROM stage_submission_files f JOIN stage_submissions s ON s.id=f.submission_id WHERE f.id=?').get(Number(params.id))) ?? fail(404, 'File not found');
    await accessible(user, f.research_id);
    return { file: await readStored(f.stored_name), filename: f.filename };
  },
  async downloadStageFile({ user, params }) {
    const s = (await db.prepare('SELECT * FROM stage_submissions WHERE id=?').get(Number(params.id))) ?? fail(404, 'File not found');
    await accessible(user, s.research_id);
    return { file: await readStored(s.stored_name), filename: s.filename };
  },

  // ---------- Supervisor: review a stage submission ----------
  // approve          → optional grade + feedback; the stage is completed for the research and the next stage activated
  // request_changes  → feedback required; the stage stays active and the student can resubmit
  // reject           → reason required; then the instructor's rejection policy: resubmit (default: the stage stays active and
  //                    the stage's own attempt rules apply; allowResubmit grants one more) | stop | advance
  // comment          → feedback only, nothing changes
  async reviewStageSubmission({ user, params, body }) {
    const sub = (await db.prepare('SELECT * FROM stage_submissions WHERE id=?').get(Number(params.id))) ?? fail(404, 'Submission not found');
    const stage = await ownStage(user, sub.stage_id);
    const r = await getResearch(sub.research_id);
    const decision = { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected', comment: 'comment' }[body.decision] ??
      fail(400, 'decision must be approve, request_changes, reject or comment');
    const comment = str(body.comment, 2000);
    if (decision !== 'approved' && !comment) fail(400, decision === 'rejected' ? 'A rejection reason is required' : 'Please write your feedback');
    if (decision !== 'comment') {
      const latest = (await db.prepare('SELECT MAX(attempt_no) AS n FROM stage_submissions WHERE stage_id=? AND research_id=?').get(sub.stage_id, sub.research_id)).n;
      if (sub.attempt_no !== latest) fail(409, 'Only the latest attempt can be decided; add a comment to older attempts');
    }
    await db.prepare('INSERT INTO stage_reviews (submission_id,reviewer_id,decision,comment) VALUES (?,?,?,?)').run(sub.id, user.id, decision, comment);
    if (decision !== 'comment') await db.prepare('UPDATE stage_submissions SET status=? WHERE id=?').run(decision, sub.id);
    let grade = null, next = null, policy = null;
    if (decision === 'approved' && body.grade) grade = await saveGrade(user, stage, r.id, body.grade);
    const key = { approved: 'n.stage.approved', changes_requested: 'n.stage.changes', rejected: 'n.stage.rejected', comment: 'n.stage.feedback' }[decision];
    await notifyParties(r, key, { stage: stage.name, title: r.title, comment: comment ?? '' });
    await audit(user, `stage.review.${decision}`, { stageId: stage.id, researchId: r.id, detail: { submission: sub.id, attempt: sub.attempt_no, comment } });
    const keepGoing = async () => {           // the student must be able to send a new attempt
      const t = (await targets('t.stage_id=? AND t.research_id=?', stage.id, r.id))[0];
      if (attemptsLeft(stage, t) === 0) await db.prepare('UPDATE stage_targets SET extra_attempts=extra_attempts+1 WHERE stage_id=? AND research_id=?').run(stage.id, r.id);
    };
    // the workflow only moves while the stage is this research's active stage (a decision can be revised later)
    const phase = (await db.prepare('SELECT phase FROM stage_targets WHERE stage_id=? AND research_id=?').get(stage.id, r.id))?.phase;
    if (decision === 'approved' && phase === 'active') {
      await finishTarget(stage, r, user, 'completed');
      next = await activateNext(r, user);
    } else if (decision === 'changes_requested') {
      if (phase === 'completed' || phase === 'closed') await db.prepare("UPDATE stage_targets SET phase='active', completed_at=NULL WHERE stage_id=? AND research_id=?").run(stage.id, r.id);
      await keepGoing();
    } else if (decision === 'rejected') {
      policy = (await settingsFor(stage.supervisor_id)).reject_policy;
      if (body.allowResubmit) await keepGoing();
      else if (phase === 'active' && policy === 'stop') await finishTarget(stage, r, user, 'closed');
      else if (phase === 'active' && policy === 'advance') { await finishTarget(stage, r, user, 'completed'); next = await activateNext(r, user); }
    }
    return { status: decision === 'comment' ? sub.status : decision, grade, next_stage: next ? { id: next.id, name: next.name } : null, reject_policy: policy };
  },

  // ---------- Supervisor: grade a stage (rubric criteria or a single score) ----------
  async gradeStage({ user, params, body }) {
    const s = await ownStage(user, Number(params.id));
    return saveGrade(user, s, Number(params.rid), body);
  },
  // Publish / hide a stage grade for one team, or publish every graded team of the stage at once.
  async publishStageGrade({ user, params, body }) {
    const s = await ownStage(user, Number(params.id)), rid = Number(params.rid);
    return setPublished(user, s, [rid], !!body.published);
  },
  async publishStageGrades({ user, params, body }) {
    const s = await ownStage(user, Number(params.id));
    return setPublished(user, s, (await targets('t.stage_id=?', s.id)).filter(r => r.score != null).map(r => r.research_id), body.published === undefined ? true : !!body.published);
  },

  // ---------- Supervisor: workflow settings ----------
  getWorkflowSettings: async ({ user }) => ({ ...await settingsFor(user.id), not_started: await notStarted(user.id) }),
  // "Start workflow" for research approved before the automatic workflow (one research, or all of them at once).
  async startResearchWorkflow({ user, params }) {
    const r = own(await accessible(user, Number(params.id)), user);
    if (r.status !== 'approved') fail(409, 'Only approved research can start the stage workflow');
    if (r.workflow_started_at) fail(409, 'The stage workflow of this research has already started');
    return startWorkflow(r, user, { manual: true });
  },
  async startAllWorkflows({ user }) {
    const list = await notStarted(user.id);
    for (const x of list) await startWorkflow(x, user, { manual: true });
    return { started: list.length };
  },
  updateWorkflowSettings: ({ user, body }) => saveSettings(user, body),
};

// Grade a stage for one research (rubric criteria or a single score); also used when approving with a grade.
async function saveGrade(user, s, rid, body) {
  const row = (await targets('t.stage_id=? AND t.research_id=?', s.id, rid))[0] ?? fail(404, 'Not assigned to this stage');
  if (s.grades_locked) fail(409, 'Grades are locked for this stage');
  const criteria = await criteriaOf(s.id);
  let score, parts = [];
  if (criteria.length) {
    const given = new Map((Array.isArray(body.criteria) ? body.criteria : fail(400, 'Score every grading criterion')).map(c => [Number(c.id), c.score]));
    parts = criteria.map(c => {
      const v = given.get(c.id);
      if (v === '' || v == null || !Number.isFinite(Number(v)) || Number(v) < 0 || Number(v) > c.max_score) fail(400, `Score for "${c.name}" must be between 0 and ${c.max_score}`);
      return { id: c.id, score: Number(v) };
    });
    score = parts.reduce((a, c) => a + c.score, 0);
  } else {
    if (body.score === '' || body.score == null || !Number.isFinite(Number(body.score)) || Number(body.score) < 0 || Number(body.score) > s.max_grade)
      fail(400, `Score must be a number between 0 and ${s.max_grade}`);
    score = Number(body.score);
  }
  const comment = optText(body.comment, 2000, 'Comment');
  const before = row.score;
  const publish = body.publish === undefined ? null : (body.publish ? 1 : 0);
  await db.prepare(`INSERT INTO stage_grades (stage_id,research_id,score,comment,graded_by,updated_at,published) VALUES (?,?,?,?,?,utc_now(),?)
    ON CONFLICT(stage_id,research_id) DO UPDATE SET score=excluded.score,comment=excluded.comment,graded_by=excluded.graded_by,updated_at=utc_now(),
      published=COALESCE(?::int, stage_grades.published)`)
    .run(s.id, rid, score, comment, user.id, publish ?? 0, publish);
  await db.prepare('DELETE FROM stage_grade_scores WHERE stage_id=? AND research_id=?').run(s.id, rid);
  for (const p of parts) await db.prepare('INSERT INTO stage_grade_scores (stage_id,research_id,criterion_id,score) VALUES (?,?,?,?)').run(s.id, rid, p.id, p.score);
  const published = !!(await db.prepare('SELECT published FROM stage_grades WHERE stage_id=? AND research_id=?').get(s.id, rid)).published;
  if (published) await notifyParties(await getResearch(rid), 'n.stage.graded', { stage: s.name, score, max: s.max_grade });
  await audit(user, before == null ? 'stage.graded' : 'stage.grade_updated', { stageId: s.id, researchId: rid, detail: { from: before, to: score, criteria: parts, comment, published } });
  return { score, published, total: await stageTotals(rid) };
}

const hasWork = async stageId => !!await db.prepare(`SELECT 1 WHERE EXISTS (SELECT 1 FROM stage_submissions WHERE stage_id=?)
  OR EXISTS (SELECT 1 FROM stage_grades WHERE stage_id=?)`).get(stageId, stageId);

// Assign by explicit research ids and/or "all approved research of this course" (also remembered for future approvals).
async function attach(stage, body) {
  const added = [];
  const ids = new Set((Array.isArray(body.researchIds) ? body.researchIds : []).map(Number));
  if (body.assignAll) {
    await db.prepare('UPDATE stages SET assign_all=1 WHERE id=?').run(stage.id);
    for (const r of await db.prepare("SELECT id FROM research WHERE supervisor_id=? AND course_id=? AND status='approved' ORDER BY id").all(stage.supervisor_id, stage.course_id)) ids.add(r.id);
  }
  for (const id of ids) {
    const { research, added: isNew, phase } = await assign(stage, id);
    if (!isNew) continue;
    added.push(id);
    // a stage queued behind the research's current stage is announced when it is activated
    if (phase === 'active') await notifyParties(research, 'n.stage.assigned', { stage: stage.name, title: research.title, date: (await targets('t.stage_id=? AND t.research_id=?', stage.id, id))[0]?.deadline ?? '—' });
  }
  return added;
}

// Only the team leader (or the individual owner) submits; members only when the leader allowed it for the team.
async function mayStudentSubmit(user, research) {
  if (!research.team_id) return research.student_id === user.id ? null : 'Only the owner can submit';
  if (await isLeader(user.id, research.team_id)) return null;
  return (await getTeam(research.team_id)).members_can_submit ? null : 'Only the team leader can submit stages for the team';
}
async function setPublished(user, stage, researchIds, published) {
  let n = 0;
  for (const rid of researchIds) {
    const g = await db.prepare('SELECT * FROM stage_grades WHERE stage_id=? AND research_id=?').get(stage.id, rid);
    if (!g) { if (researchIds.length === 1) fail(404, 'There is no grade to publish yet'); continue; }
    if (!!g.published === published) continue;
    await db.prepare('UPDATE stage_grades SET published=? WHERE stage_id=? AND research_id=?').run(published ? 1 : 0, stage.id, rid);
    if (published) await notifyParties(await getResearch(rid), 'n.stage.graded', { stage: stage.name, score: g.score, max: stage.max_grade });
    await audit(user, published ? 'stage.grade_published' : 'stage.grade_hidden', { stageId: stage.id, researchId: rid, detail: { score: g.score } });
    n++;
  }
  return { changed: n, published };
}
