// Supervisor: customizable research stages, per-stage submissions review and grading. Students: stage submissions.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { fail, str, need } from '../errors.js';
import { UPLOAD_DIR, ALL_FORMATS, DEFAULT_FORMATS, checkFile, storeFile, removeFile } from '../files.js';
import { notify, notifyParties } from '../notifications.js';
import { accessible, getResearch } from '../research.js';
import { audit } from '../audit.js';
import { addMessage, targetOf, notifyMessage, preview } from '../messages.js';
import {
  today, STATE_LIST, getStage, ownStage, criteriaOf, stageStarted, publicStage, targets, decorate, submitProblem, attemptsLeft,
  assign, stageTotals, formatsOf,
} from '../stages.js';

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
  const maxGrade = criteria.length ? criteria.reduce((a, c) => a + c.max, 0)
    : (body.maxGrade == null || body.maxGrade === '' ? 100 : num(body.maxGrade, 'Maximum grade', 0.1, 1000));
  if (maxGrade > 1000) fail(400, 'Maximum grade must be between 0.1 and 1000');
  return {
    name, description: optText(body.description, 2000, 'Description'), instructions: optText(body.instructions, 4000, 'Instructions'),
    start, deadline, formats, maxMb, allowResubmit, maxAttempts, criteria, maxGrade,
  };
}
const saveCriteria = (stageId, criteria) => {
  db.prepare('DELETE FROM stage_criteria WHERE stage_id=?').run(stageId);
  const ins = db.prepare('INSERT INTO stage_criteria (stage_id,name,max_score,position) VALUES (?,?,?,?)');
  for (const c of criteria) ins.run(stageId, c.name, c.max, c.position);
};
const inTx = fn => {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* no open transaction */ } throw e; }
};
const countsFor = rows => ({
  assigned: rows.length, submitted: rows.filter(r => !r.missing).length, missing: rows.filter(r => r.missing).length,
  pending_review: rows.filter(r => r.pending_review).length, approved: rows.filter(r => r.status === 'approved').length,
  changes_requested: rows.filter(r => r.status === 'changes_requested').length, rejected: rows.filter(r => r.status === 'rejected').length,
  late: rows.filter(r => r.late).length, graded: rows.filter(r => r.score != null).length,
});
const targetLabel = r => r.team ? `${r.team}` : r.student;

export const stageHandlers = {
  // ---------- Supervisor: stage CRUD ----------
  listStages({ user }) {
    const stages = user.role === 'admin' ? db.prepare('SELECT * FROM stages ORDER BY supervisor_id, position, id').all()
      : db.prepare('SELECT * FROM stages WHERE supervisor_id=? ORDER BY position, id').all(user.id);
    const course = db.prepare('SELECT name FROM courses WHERE id=?');
    return stages.map(s => ({ ...publicStage(s), course: course.get(s.course_id)?.name, criteria: criteriaOf(s.id), counts: countsFor(targets('t.stage_id=?', s.id)) }));
  },
  createStage({ user, body }) {
    const course = db.prepare('SELECT id FROM courses WHERE id=?').get(Number(body.courseId)) ?? fail(400, 'Choose a valid course');
    const p = parseStage(body);
    const state = body.state === 'open' ? 'open' : 'scheduled';
    const id = inTx(() => {
      const pos = db.prepare('SELECT COALESCE(MAX(position),0)+1 AS n FROM stages WHERE supervisor_id=?').get(user.id).n;
      const r = db.prepare(`INSERT INTO stages (supervisor_id,course_id,position,name,description,instructions,start_date,deadline,max_grade,
        allowed_formats,max_file_mb,allow_resubmit,max_attempts,state,assign_all) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(user.id, course.id, pos, p.name, p.description, p.instructions, p.start, p.deadline, p.maxGrade, p.formats.join(','), p.maxMb,
          p.allowResubmit ? 1 : 0, p.maxAttempts, state, body.assignAll ? 1 : 0);
      const sid = Number(r.lastInsertRowid);
      saveCriteria(sid, p.criteria);
      return sid;
    });
    const stage = getStage(id);
    const added = attach(stage, body);
    audit(user, 'stage.created', { stageId: id, detail: { name: p.name, targets: added.length } });
    return { id, assigned: added.length };
  },
  updateStage({ user, params, body }) {
    const s = ownStage(user, Number(params.id));
    if (stageStarted(s)) fail(409, 'This stage has already started and can no longer be edited (you can postpone it or change its state)');
    const p = parseStage(body);
    inTx(() => {
      db.prepare(`UPDATE stages SET name=?,description=?,instructions=?,start_date=?,deadline=?,max_grade=?,allowed_formats=?,max_file_mb=?,
        allow_resubmit=?,max_attempts=?,assign_all=? WHERE id=?`).run(p.name, p.description, p.instructions, p.start, p.deadline, p.maxGrade,
        p.formats.join(','), p.maxMb, p.allowResubmit ? 1 : 0, p.maxAttempts, body.assignAll ? 1 : 0, s.id);
      saveCriteria(s.id, p.criteria);
    });
    const stage = getStage(s.id);
    if (body.assignAll) attach(stage, { assignAll: true });
    for (const t of targets('t.stage_id=?', s.id)) notifyParties(getResearch(t.research_id), 'n.stage.updated', { stage: p.name });
    audit(user, 'stage.updated', { stageId: s.id, detail: { name: p.name } });
    return { ok: true };
  },
  deleteStage({ user, params }) {
    const s = ownStage(user, Number(params.id));
    if (stageStarted(s)) fail(409, 'This stage has already started and cannot be deleted');
    inTx(() => {
      db.prepare('UPDATE messages SET stage_id=NULL WHERE stage_id=?').run(s.id); // the messages stay; only their stage link goes
      db.prepare('DELETE FROM deadline_events WHERE stage_id=?').run(s.id);
      db.prepare('DELETE FROM stages WHERE id=?').run(s.id); // targets and criteria cascade
    });
    audit(user, 'stage.deleted', { stageId: s.id, detail: { name: s.name } });
    return { ok: true };
  },
  // Open / close / postpone (any time). Postponing needs a new start date and/or deadline.
  setStageState({ user, params, body }) {
    const s = ownStage(user, Number(params.id));
    if (!STATE_LIST.includes(body.state)) fail(400, 'Invalid stage state');
    let start = s.start_date, deadline = s.deadline;
    if (body.startDate !== undefined) start = optDate(body.startDate, 'Start date');
    if (body.deadline !== undefined) deadline = optDate(body.deadline, 'Deadline');
    if (start && deadline && deadline < start) fail(400, 'Deadline cannot be before the start date');
    if (body.state === 'postponed' && start === s.start_date && deadline === s.deadline) fail(400, 'Choose a new start date or deadline to postpone the stage');
    db.prepare('UPDATE stages SET state=?, start_date=?, deadline=? WHERE id=?').run(body.state, start, deadline, s.id);
    const key = deadline !== s.deadline ? 'n.stage.deadline' : 'n.stage.state';
    for (const t of targets('t.stage_id=?', s.id)) notifyParties(getResearch(t.research_id), key, { stage: s.name, state: body.state, date: deadline ?? '' });
    audit(user, 'stage.state', { stageId: s.id, detail: { from: s.state, to: body.state, start, deadline, prevDeadline: s.deadline } });
    return { state: body.state, start_date: start, deadline };
  },
  reorderStages({ user, body }) {
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : fail(400, 'ids must be a list');
    const mine = db.prepare('SELECT id FROM stages WHERE supervisor_id=?').all(user.id).map(x => x.id);
    if (new Set(ids).size !== ids.length || ids.some(i => !mine.includes(i))) fail(403, 'Not your stage');
    inTx(() => { const u = db.prepare('UPDATE stages SET position=? WHERE id=?'); ids.forEach((id, i) => u.run(i + 1, id)); });
    audit(user, 'stage.reordered', { detail: { ids } });
    return { ok: true };
  },
  setGradesLock({ user, params, body }) {
    const s = ownStage(user, Number(params.id));
    db.prepare('UPDATE stages SET grades_locked=? WHERE id=?').run(body.locked ? 1 : 0, s.id);
    audit(user, body.locked ? 'stage.grades_locked' : 'stage.grades_unlocked', { stageId: s.id });
    return { grades_locked: !!body.locked };
  },

  // ---------- Supervisor: stage overview (every assigned student/team and its status) ----------
  getStageDetail({ user, params }) {
    const s = getStage(Number(params.id));
    if (user.role !== 'admin' && s.supervisor_id !== user.id) fail(403, 'Not your stage');
    const rows = targets('t.stage_id=?', s.id);
    const assignedIds = rows.map(r => r.research_id);
    const candidates = db.prepare(`SELECT r.id,r.title,r.team_id,t.name AS team,u.name AS student FROM research r JOIN users u ON u.id=r.student_id
      LEFT JOIN teams t ON t.id=r.team_id WHERE r.supervisor_id=? AND r.course_id=? AND r.status='approved' ORDER BY r.id`).all(s.supervisor_id, s.course_id)
      .filter(r => !assignedIds.includes(r.id));
    return {
      stage: { ...publicStage(s), course: db.prepare('SELECT name FROM courses WHERE id=?').get(s.course_id)?.name }, criteria: criteriaOf(s.id),
      counts: countsFor(rows), unassigned: candidates,
      targets: rows.map(r => ({
        research_id: r.research_id, title: r.title, student: r.student, team: r.team, label: targetLabel(r), status: r.status, late: r.late,
        missing: r.missing, attempts: r.attempts, attempts_left: attemptsLeft(s, r), extra_attempts: r.extra_attempts, submission_id: r.sub_id,
        filename: r.filename, submitted_at: r.submitted_at, score: r.score, grade_comment: r.grade_comment,
      })),
    };
  },
  assignStage({ user, params, body }) {
    const s = ownStage(user, Number(params.id));
    const added = attach(s, body);
    audit(user, 'stage.assigned', { stageId: s.id, detail: { added } });
    return { added: added.length };
  },
  unassignStage({ user, params }) {
    const s = ownStage(user, Number(params.id)), rid = Number(params.rid);
    const used = db.prepare(`SELECT 1 WHERE EXISTS (SELECT 1 FROM stage_submissions WHERE stage_id=? AND research_id=?)
      OR EXISTS (SELECT 1 FROM stage_grades WHERE stage_id=? AND research_id=?)`).get(s.id, rid, s.id, rid);
    if (used) fail(409, 'This research already has submissions or a grade for the stage');
    const r = db.prepare('DELETE FROM stage_targets WHERE stage_id=? AND research_id=?').run(s.id, rid);
    if (!r.changes) fail(404, 'Not assigned to this stage');
    audit(user, 'stage.unassigned', { stageId: s.id, researchId: rid });
    return { ok: true };
  },
  // Allow one more attempt (e.g. when the attempt limit or "no resubmission" would block the student).
  allowResubmit({ user, params }) {
    const s = ownStage(user, Number(params.id)), rid = Number(params.rid);
    const r = db.prepare('UPDATE stage_targets SET extra_attempts=extra_attempts+1 WHERE stage_id=? AND research_id=?').run(s.id, rid);
    if (!r.changes) fail(404, 'Not assigned to this stage');
    notifyParties(getResearch(rid), 'n.stage.resubmit', { stage: s.name });
    audit(user, 'stage.resubmit_allowed', { stageId: s.id, researchId: rid });
    return { ok: true };
  },
  // Reminder (private message + notification) to every assigned student/team that has not submitted.
  remindStage({ user, params, body }) {
    const s = ownStage(user, Number(params.id));
    let rows = targets('t.stage_id=?', s.id).filter(r => r.missing);
    if (Array.isArray(body.researchIds)) { const ids = body.researchIds.map(Number); rows = rows.filter(r => ids.includes(r.research_id)); }
    const text = str(body.message, 1000) ?? `${s.name}${s.deadline ? ` — ${s.deadline}` : ''}`;
    for (const r of rows) {
      const target = targetOf(r);
      addMessage({ supervisorId: user.id, target, senderId: user.id, kind: 'reminder', body: text, stageId: s.id });
      notifyMessage({ sender: user, supervisorId: user.id, target, kind: 'reminder', preview: preview(text) });
    }
    audit(user, 'stage.reminder', { stageId: s.id, detail: { count: rows.length } });
    return { sent: rows.length };
  },

  // ---------- Stages of one research (student, supervisor, admin) ----------
  researchStages({ user, params }) {
    const r = accessible(user, Number(params.id));
    const rows = targets('t.research_id=?', r.id);
    const subs = db.prepare('SELECT id,attempt_no,filename,size,student_note,late,status,created_at,submitted_by FROM stage_submissions WHERE stage_id=? AND research_id=? ORDER BY attempt_no DESC');
    const revs = db.prepare(`SELECT v.id,v.decision,v.comment,v.created_at,u.name AS reviewer FROM stage_reviews v JOIN users u ON u.id=v.reviewer_id
      WHERE v.submission_id=? ORDER BY v.id`);
    const scores = db.prepare('SELECT criterion_id,score FROM stage_grade_scores WHERE stage_id=? AND research_id=?');
    const who = db.prepare('SELECT name FROM users WHERE id=?');
    const list = rows.filter(t => user.role !== 'student' || true).map(t => {
      const stage = getStage(t.stage_id);
      const problem = user.role === 'student' ? submitProblem(stage, t) : null;
      return {
        stage: publicStage(stage), criteria: criteriaOf(stage.id), status: t.status, late: t.late, missing: t.missing, attempts: t.attempts, attempts_left: attemptsLeft(stage, t),
        extra_attempts: t.extra_attempts, can_submit: user.role === 'student' && !problem, problem,
        grade: t.score == null ? null : { score: t.score, comment: t.grade_comment, scores: scores.all(stage.id, r.id) },
        submissions: subs.all(stage.id, r.id).map(x => ({ ...x, late: !!x.late, by: who.get(x.submitted_by)?.name, reviews: revs.all(x.id) })),
      };
    });
    return { research_id: r.id, totals: stageTotals(r.id), stages: list };
  },
  // Student: submit (or resubmit) a stage. Every attempt is stored as its own row/file; nothing is overwritten.
  submitStage({ user, params, body }) {
    const stage = getStage(Number(params.id));
    const r = accessible(user, Number(body.researchId));
    const row = targets('t.stage_id=? AND t.research_id=?', stage.id, r.id)[0] ?? fail(404, 'This stage is not assigned to your research');
    const problem = submitProblem(stage, row);
    if (problem) fail(409, problem);
    const { buf } = checkFile(body.filename, body.data, { formats: formatsOf(stage), maxBytes: Math.floor(stage.max_file_mb * 1048576) });
    const note = optText(body.note, 1000, 'Note');
    const file = storeFile(body.filename, buf);
    let attempt, late;
    try {
      ({ attempt, late } = inTx(() => {
        const n = db.prepare('SELECT COALESCE(MAX(attempt_no),0)+1 AS n FROM stage_submissions WHERE stage_id=? AND research_id=?').get(stage.id, r.id).n;
        const l = stage.deadline && today() > stage.deadline ? 1 : 0;
        try {
          db.prepare(`INSERT INTO stage_submissions (stage_id,research_id,attempt_no,filename,stored_name,size,student_note,submitted_by,late)
            VALUES (?,?,?,?,?,?,?,?,?)`).run(stage.id, r.id, n, file.safeName, file.stored, buf.length, note, user.id, l);
        } catch (e) { if (/UNIQUE/.test(e.message)) fail(409, 'Another submission was made at the same time; please retry'); throw e; }
        return { attempt: n, late: l };
      }));
    } catch (e) { removeFile(file.path); throw e; }
    const p = { student: user.name, stage: stage.name, title: r.title, n: attempt };
    notify(r.supervisor_id, attempt > 1 ? 'n.stage.resubmitted' : 'n.stage.submitted', p, r.id);
    if (late) notify(r.supervisor_id, 'n.stage.late_submission', p, r.id);
    audit(user, attempt > 1 ? 'stage.resubmitted' : 'stage.submitted', { stageId: stage.id, researchId: r.id, detail: { attempt, late: !!late, file: file.safeName } });
    return { attempt, late: !!late };
  },
  downloadStageFile({ user, params }) {
    const s = db.prepare('SELECT * FROM stage_submissions WHERE id=?').get(Number(params.id)) ?? fail(404, 'File not found');
    accessible(user, s.research_id);
    const p = join(UPLOAD_DIR, s.stored_name);
    if (!existsSync(p)) fail(404, 'File missing on disk');
    return { file: readFileSync(p), filename: s.filename };
  },

  // ---------- Supervisor: review a stage submission ----------
  reviewStageSubmission({ user, params, body }) {
    const sub = db.prepare('SELECT * FROM stage_submissions WHERE id=?').get(Number(params.id)) ?? fail(404, 'Submission not found');
    const stage = ownStage(user, sub.stage_id);
    const r = getResearch(sub.research_id);
    const decision = { approve: 'approved', request_changes: 'changes_requested', reject: 'rejected', comment: 'comment' }[body.decision] ??
      fail(400, 'decision must be approve, request_changes, reject or comment');
    const comment = str(body.comment, 2000);
    if (decision !== 'approved' && !comment) fail(400, decision === 'rejected' ? 'A rejection reason is required' : 'Please write your feedback');
    if (decision !== 'comment') {
      const latest = db.prepare('SELECT MAX(attempt_no) AS n FROM stage_submissions WHERE stage_id=? AND research_id=?').get(sub.stage_id, sub.research_id).n;
      if (sub.attempt_no !== latest) fail(409, 'Only the latest attempt can be decided; add a comment to older attempts');
    }
    inTx(() => {
      db.prepare('INSERT INTO stage_reviews (submission_id,reviewer_id,decision,comment) VALUES (?,?,?,?)').run(sub.id, user.id, decision, comment);
      if (decision !== 'comment') db.prepare('UPDATE stage_submissions SET status=? WHERE id=?').run(decision, sub.id);
      if (body.allowResubmit && (decision === 'changes_requested' || decision === 'rejected')) {
        const t = targets('t.stage_id=? AND t.research_id=?', stage.id, r.id)[0];
        if (attemptsLeft(stage, { ...t, attempts: t.attempts }) === 0)
          db.prepare('UPDATE stage_targets SET extra_attempts=extra_attempts+1 WHERE stage_id=? AND research_id=?').run(stage.id, r.id);
      }
    });
    const key = { approved: 'n.stage.approved', changes_requested: 'n.stage.changes', rejected: 'n.stage.rejected', comment: 'n.stage.feedback' }[decision];
    notifyParties(r, key, { stage: stage.name, title: r.title, comment: comment ?? '' });
    audit(user, `stage.review.${decision}`, { stageId: stage.id, researchId: r.id, detail: { submission: sub.id, attempt: sub.attempt_no, comment } });
    return { status: decision === 'comment' ? sub.status : decision };
  },

  // ---------- Supervisor: grade a stage (rubric criteria or a single score) ----------
  gradeStage({ user, params, body }) {
    const s = ownStage(user, Number(params.id)), rid = Number(params.rid);
    const row = targets('t.stage_id=? AND t.research_id=?', s.id, rid)[0] ?? fail(404, 'Not assigned to this stage');
    if (s.grades_locked) fail(409, 'Grades are locked for this stage');
    const criteria = criteriaOf(s.id);
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
    inTx(() => {
      db.prepare(`INSERT INTO stage_grades (stage_id,research_id,score,comment,graded_by,updated_at) VALUES (?,?,?,?,?,CURRENT_TIMESTAMP)
        ON CONFLICT(stage_id,research_id) DO UPDATE SET score=excluded.score,comment=excluded.comment,graded_by=excluded.graded_by,updated_at=CURRENT_TIMESTAMP`)
        .run(s.id, rid, score, comment, user.id);
      db.prepare('DELETE FROM stage_grade_scores WHERE stage_id=? AND research_id=?').run(s.id, rid);
      for (const p of parts) db.prepare('INSERT INTO stage_grade_scores (stage_id,research_id,criterion_id,score) VALUES (?,?,?,?)').run(s.id, rid, p.id, p.score);
    });
    notifyParties(getResearch(rid), 'n.stage.graded', { stage: s.name, score, max: s.max_grade });
    audit(user, before == null ? 'stage.graded' : 'stage.grade_updated', { stageId: s.id, researchId: rid, detail: { from: before, to: score, criteria: parts, comment } });
    return { score, total: stageTotals(rid) };
  },
};

// Assign by explicit research ids and/or "all approved research of this course" (also remembered for future approvals).
function attach(stage, body) {
  const added = [];
  const ids = new Set((Array.isArray(body.researchIds) ? body.researchIds : []).map(Number));
  if (body.assignAll) {
    db.prepare('UPDATE stages SET assign_all=1 WHERE id=?').run(stage.id);
    for (const r of db.prepare("SELECT id FROM research WHERE supervisor_id=? AND course_id=? AND status='approved'").all(stage.supervisor_id, stage.course_id)) ids.add(r.id);
  }
  for (const id of ids) {
    const { research, added: isNew } = assign(stage, id);
    if (isNew) { added.push(id); notifyParties(research, 'n.stage.assigned', { stage: stage.name, title: research.title, date: stage.deadline ?? '' }); }
  }
  return added;
}
