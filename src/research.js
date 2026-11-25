// Research model: lookups, access rules and list queries.
import { db } from './db.js';
import { fail } from './errors.js';

// Class diagram: Research.updateStatus()
export function updateStatus(research, status) {
  db.prepare('UPDATE research SET status=? WHERE id=?').run(status, research.id);
}
export function addNoteToLatest(research, author, text) {
  const last = db.prepare('SELECT id FROM submissions WHERE research_id=? ORDER BY version_no DESC LIMIT 1').get(research.id);
  db.prepare('INSERT INTO notes (submission_id,author_id,text) VALUES (?,?,?)').run(last.id, author.id, text);
}

export function getResearch(id) {
  const r = db.prepare(`
    SELECT r.*, c.name AS course, s.name AS student, s.email AS student_email, v.name AS supervisor, t.name AS team
    FROM research r JOIN courses c ON c.id=r.course_id
    JOIN users s ON s.id=r.student_id JOIN users v ON v.id=r.supervisor_id
    LEFT JOIN teams t ON t.id=r.team_id WHERE r.id=?`).get(id);
  return r ?? fail(404, 'Research not found');
}

function canView(user, r) {
  if (user.role === 'admin') return true;
  if (user.role === 'supervisor') return r.supervisor_id === user.id;
  return r.student_id === user.id || (user.team_id && r.team_id === user.team_id);
}
export const accessible = (user, id) => {
  const r = getResearch(id);
  return canView(user, r) ? r : fail(403, 'Not allowed to access this research');
};
export const own = (r, supervisor) => r.supervisor_id === supervisor.id ? r : fail(403, 'Not your research');

export const STATUSES = ['pending', 'changes_requested', 'approved', 'rejected'];
export const MAX_PAGE = 500;
// opts: { status, q, limit, offset } — all optional; limit is capped at MAX_PAGE.
export function listFor(user, opts = {}) {
  const where = [], args = [];
  if (user.role === 'supervisor') { where.push('r.supervisor_id=?'); args.push(user.id); }
  else if (user.role === 'student') {
    where.push('(r.student_id=? OR (? IS NOT NULL AND r.team_id=?))'); args.push(user.id, user.team_id, user.team_id);
  }
  if (opts.status) { where.push('r.status=?'); args.push(opts.status); }
  if (opts.q) { where.push("r.title LIKE ? ESCAPE '\\'"); args.push('%' + opts.q.replace(/[\\%_]/g, '\\$&') + '%'); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = db.prepare('SELECT COUNT(*) AS n FROM research r' + w).get(...args).n;
  const rows = db.prepare(`
    SELECT r.id,r.title,r.description,r.status,r.created_at,c.name AS course,s.name AS student,v.name AS supervisor,t.name AS team,
      r.deadline,
      (r.deadline IS NOT NULL AND r.deadline < date('now') AND r.status IN ('pending','changes_requested')) AS overdue,
      (SELECT COUNT(*) FROM submissions WHERE research_id=r.id) AS versions,
      (SELECT g.score FROM research_grades g WHERE g.research_id=r.id) AS grade,
      (SELECT COUNT(*) FROM stage_targets x WHERE x.research_id=r.id) AS stages_total,
      (SELECT COUNT(*) FROM stage_targets x WHERE x.research_id=r.id AND
        (SELECT status FROM stage_submissions y WHERE y.stage_id=x.stage_id AND y.research_id=x.research_id ORDER BY attempt_no DESC LIMIT 1)='approved') AS stages_approved
    FROM research r JOIN courses c ON c.id=r.course_id
    JOIN users s ON s.id=r.student_id JOIN users v ON v.id=r.supervisor_id
    LEFT JOIN teams t ON t.id=r.team_id${w}
    ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(...args, Math.min(opts.limit ?? MAX_PAGE, MAX_PAGE), opts.offset ?? 0);
  Object.defineProperty(rows, 'total', { value: total }); // exposed as X-Total-Count by the server
  return rows;
}
