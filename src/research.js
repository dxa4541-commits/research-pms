// Research model: lookups, access rules and list queries.
import { db } from './db.js';
import { fail } from './errors.js';

// Class diagram: Research.updateStatus()
export async function updateStatus(research, status) {
  await db.prepare('UPDATE research SET status=? WHERE id=?').run(status, research.id);
}
export async function addNoteToLatest(research, author, text) {
  const last = await db.prepare('SELECT id FROM submissions WHERE research_id=? ORDER BY version_no DESC LIMIT 1').get(research.id);
  if (!last) return; // a topic registered without a file keeps its feedback in topic_reviews only
  await db.prepare('INSERT INTO notes (submission_id,author_id,text) VALUES (?,?,?)').run(last.id, author.id, text);
}

export async function getResearch(id) {
  const r = await db.prepare(`
    SELECT r.*, c.name AS course, s.name AS student, s.email AS student_email, v.name AS supervisor, t.name AS team
    FROM research r JOIN courses c ON c.id=r.course_id
    JOIN users s ON s.id=r.student_id JOIN users v ON v.id=r.supervisor_id
    LEFT JOIN teams t ON t.id=r.team_id WHERE r.id=?`).get(id);
  return r ?? fail(404, 'Research not found');
}

async function canView(user, r) {
  if (user.role === 'admin') return true;
  if (user.role === 'supervisor') return r.supervisor_id === user.id;
  return r.student_id === user.id || (!!r.team_id && !!await db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=? AND left_at IS NULL').get(r.team_id, user.id));
}
export const accessible = async (user, id) => {
  const r = await getResearch(id);
  return await canView(user, r) ? r : fail(403, 'Not allowed to access this research');
};
export const own = (r, supervisor) => r.supervisor_id === supervisor.id ? r : fail(403, 'Not your research');

export const STATUSES = ['pending', 'changes_requested', 'approved', 'rejected'];
export const MAX_PAGE = 500;
// opts: { status, q, limit, offset } — all optional; limit is capped at MAX_PAGE.
export async function listFor(user, opts = {}) {
  const where = [], args = [];
  if (user.role === 'supervisor') { where.push('r.supervisor_id=?'); args.push(user.id); }
  else if (user.role === 'student') {
    where.push('(r.student_id=? OR r.team_id IN (SELECT team_id FROM team_members WHERE user_id=? AND left_at IS NULL))'); args.push(user.id, user.id);
  }
  if (opts.status) { where.push('r.status=?'); args.push(opts.status); }
  if (opts.q) { where.push("r.title ILIKE ? ESCAPE '\\'"); args.push('%' + opts.q.replace(/[\\%_]/g, '\\$&') + '%'); }
  const w = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = (await db.prepare('SELECT COUNT(*) AS n FROM research r' + w).get(...args)).n;
  const rows = await db.prepare(`
    SELECT r.id,r.title,r.description,r.status,r.created_at,c.name AS course,s.name AS student,v.name AS supervisor,t.name AS team,
      r.deadline,
      (r.deadline IS NOT NULL AND r.deadline < utc_today() AND r.status IN ('pending','changes_requested'))::int AS overdue,
      (SELECT COUNT(*) FROM submissions WHERE research_id=r.id) AS versions,
      (SELECT g.score FROM research_grades g WHERE g.research_id=r.id AND (?::int=1 OR g.published=1)) AS grade,
      (SELECT COUNT(*) FROM stage_targets x WHERE x.research_id=r.id) AS stages_total,
      (SELECT COUNT(*) FROM stage_targets x WHERE x.research_id=r.id AND
        (SELECT status FROM stage_submissions y WHERE y.stage_id=x.stage_id AND y.research_id=x.research_id ORDER BY attempt_no DESC LIMIT 1)='approved') AS stages_approved
    FROM research r JOIN courses c ON c.id=r.course_id
    JOIN users s ON s.id=r.student_id JOIN users v ON v.id=r.supervisor_id
    LEFT JOIN teams t ON t.id=r.team_id${w}
    ORDER BY r.id DESC LIMIT ? OFFSET ?`).all(user.role === 'student' ? 0 : 1, ...args, Math.min(opts.limit ?? MAX_PAGE, MAX_PAGE), opts.offset ?? 0);
  Object.defineProperty(rows, 'total', { value: total }); // exposed as X-Total-Count by the server
  return rows;
}
