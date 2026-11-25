// Stage model: lookups, access rules, status derivation and submission rules.
import { db } from './db.js';
import { fail } from './errors.js';

export const today = () => new Date().toISOString().slice(0, 10);
export const STATE_LIST = ['scheduled', 'open', 'closed', 'postponed'];

export function getStage(id) {
  return db.prepare('SELECT * FROM stages WHERE id=?').get(id) ?? fail(404, 'Stage not found');
}
// Supervisors manage only their own stages; admin may read all.
export function ownStage(user, id) {
  const s = getStage(id);
  return s.supervisor_id === user.id ? s : fail(403, 'Not your stage');
}
export const criteriaOf = stageId => db.prepare('SELECT id,name,max_score,position FROM stage_criteria WHERE stage_id=? ORDER BY position,id').all(stageId);

// A stage "has started" once students can work on it or any work/grade exists; after that its setup is frozen.
export function stageStarted(s) {
  if (s.state === 'closed') return true;
  if (s.state === 'open' && (!s.start_date || s.start_date <= today())) return true;
  return !!db.prepare(`SELECT 1 WHERE EXISTS (SELECT 1 FROM stage_submissions WHERE stage_id=?)
    OR EXISTS (SELECT 1 FROM stage_grades WHERE stage_id=?)`).get(s.id, s.id);
}
export const phase = s => s.state === 'open' && s.start_date && s.start_date > today() ? 'upcoming' : s.state;

export const formatsOf = s => s.allowed_formats.split(',').filter(Boolean);
export const publicStage = s => ({
  id: s.id, course_id: s.course_id, position: s.position, name: s.name, description: s.description, instructions: s.instructions,
  start_date: s.start_date, deadline: s.deadline, max_grade: s.max_grade, formats: formatsOf(s), max_file_mb: s.max_file_mb,
  allow_resubmit: !!s.allow_resubmit, max_attempts: s.max_attempts, state: s.state, phase: phase(s), assign_all: !!s.assign_all,
  grades_locked: !!s.grades_locked, allow_late: !!s.allow_late, started: stageStarted(s),
});

const TARGET_SQL = `SELECT st.id AS stage_id, st.name AS stage_name, st.deadline, st.max_grade, st.state, st.start_date, st.position, st.course_id, st.supervisor_id,
    t.research_id, t.extra_attempts, r.title, r.status AS research_status, r.team_id, r.student_id, tm.name AS team, u.name AS student,
    (SELECT COUNT(*) FROM stage_submissions x WHERE x.stage_id=t.stage_id AND x.research_id=t.research_id) AS attempts,
    ls.id AS sub_id, ls.attempt_no, ls.status AS sub_status, ls.late AS sub_late, ls.created_at AS submitted_at, ls.filename,
    g.score, g.comment AS grade_comment, g.published AS grade_published,
    (SELECT COUNT(*) FROM stage_reviews rv WHERE rv.submission_id=ls.id) AS review_count, st.state AS stage_state
  FROM stage_targets t JOIN stages st ON st.id=t.stage_id JOIN research r ON r.id=t.research_id JOIN users u ON u.id=r.student_id
  LEFT JOIN teams tm ON tm.id=r.team_id
  LEFT JOIN stage_submissions ls ON ls.id=(SELECT id FROM stage_submissions x WHERE x.stage_id=t.stage_id AND x.research_id=t.research_id ORDER BY attempt_no DESC LIMIT 1)
  LEFT JOIN stage_grades g ON g.stage_id=t.stage_id AND g.research_id=t.research_id`;

export function decorate(row) {
  const missing = !row.sub_id;
  const pastDue = !!row.deadline && row.deadline < today();
  return {
    ...row, sub_late: !!row.sub_late,
    status: row.sub_status ?? 'not_submitted', missing,
    late: !!row.sub_late || (missing && pastDue),
    pending_review: row.sub_status === 'submitted',
    display_status: displayStatus(row),
  };
}
// Student-facing status: not_started | open | closed | submitted | under_review | resubmitted | changes_requested | approved | rejected
export function displayStatus(row) {
  if (row.sub_id) {
    if (row.sub_status === 'submitted') return row.review_count > 0 ? 'under_review' : row.attempt_no > 1 ? 'resubmitted' : 'submitted';
    return row.sub_status;
  }
  if (row.stage_state === 'closed') return 'closed';
  if (row.stage_state === 'open' && !(row.start_date && row.start_date > today())) return 'open';
  return 'not_started';
}
// where: SQL condition on the aliases above (st, t, r), e.g. 't.stage_id=?'
export function targets(where, ...args) {
  return db.prepare(`${TARGET_SQL} WHERE ${where} ORDER BY st.position, st.id, r.id`).all(...args).map(decorate);
}

// May this research submit (another) attempt for the stage now? Returns an English reason when not.
export function submitProblem(stage, row) {
  if (stage.deadline && stage.deadline < today() && !stage.allow_late && stage.state === 'open') return 'The deadline has passed and late submissions are not allowed';
  if (stage.state !== 'open') return stage.state === 'closed' ? 'This stage is closed' : 'This stage is not open for submissions yet';
  if (stage.start_date && stage.start_date > today()) return 'This stage has not started yet';
  if (row.attempts > 0) {
    if (row.sub_status === 'approved') return 'Your submission was already approved';
    if (row.sub_status === 'submitted') return 'Your submission is awaiting review';
    const base = stage.allow_resubmit ? (stage.max_attempts ?? Infinity) : 1;
    if (row.attempts >= base + row.extra_attempts) return 'No submission attempts left; ask your supervisor to allow resubmission';
  }
  return null;
}
export const attemptsLeft = (stage, row) => {
  const base = stage.allow_resubmit ? (stage.max_attempts ?? Infinity) : 1;
  const left = base + row.extra_attempts - row.attempts;
  return Number.isFinite(left) ? Math.max(0, left) : null; // null = unlimited
};

// Assign a stage to a research (idempotent). Only approved research of the same supervisor and course.
export function assign(stage, researchId) {
  const r = db.prepare('SELECT * FROM research WHERE id=?').get(researchId) ?? fail(404, 'Research not found');
  if (r.supervisor_id !== stage.supervisor_id) fail(403, 'Not your research');
  if (r.course_id !== stage.course_id) fail(400, 'Research belongs to another course');
  if (r.status !== 'approved') fail(409, 'Only approved research can be assigned to a stage');
  const res = db.prepare('INSERT OR IGNORE INTO stage_targets (stage_id,research_id) VALUES (?,?)').run(stage.id, r.id);
  return { research: r, added: res.changes > 0 };
}
// When a research gets approved, attach every "assign to all" stage of its supervisor/course.
export function autoAssign(research) {
  for (const s of db.prepare('SELECT * FROM stages WHERE supervisor_id=? AND course_id=? AND assign_all=1').all(research.supervisor_id, research.course_id))
    db.prepare('INSERT OR IGNORE INTO stage_targets (stage_id,research_id) VALUES (?,?)').run(s.id, research.id);
}

// Totals across a research's assigned stages.
// publishedOnly: what a student may see (only published grades count).
export function stageTotals(researchId, publishedOnly = false) {
  const t = db.prepare(`SELECT COUNT(*) AS stages, COALESCE(SUM(st.max_grade),0) AS total_max,
      COALESCE(SUM(g.score),0) AS earned, COALESCE(SUM(CASE WHEN g.score IS NOT NULL THEN st.max_grade END),0) AS graded_max,
      SUM(g.score IS NOT NULL) AS graded
    FROM stage_targets t JOIN stages st ON st.id=t.stage_id
    LEFT JOIN stage_grades g ON g.stage_id=t.stage_id AND g.research_id=t.research_id AND (? OR g.published=1) WHERE t.research_id=?`).get(publishedOnly ? 0 : 1, researchId);
  const approved = db.prepare(`SELECT COUNT(*) AS n FROM stage_targets t WHERE t.research_id=? AND
    (SELECT status FROM stage_submissions x WHERE x.stage_id=t.stage_id AND x.research_id=t.research_id ORDER BY attempt_no DESC LIMIT 1)='approved'`).get(researchId).n;
  return { stages: t.stages, approved, graded: t.graded ?? 0, earned: t.earned, graded_max: t.graded_max, total_max: t.total_max,
    percent: t.total_max ? Math.round(t.earned / t.total_max * 1000) / 10 : null };
}
