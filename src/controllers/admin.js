// Teams, courses, users and reports (Form teams, Manage users, Assign authorization, View progress reports).
import { db } from '../db.js';
import { HttpError, fail, need } from '../errors.js';
import { hashPassword } from '../auth.js';
import { notify } from '../notifications.js';
import { listFor } from '../research.js';
import { audit } from '../audit.js';
import { targets } from '../stages.js';

const ROLES = ['student', 'supervisor', 'admin'];

// A team is managed by its creator or by the supervisor of its research; admin manages every team.
function manageable(user, id) {
  const t = db.prepare('SELECT * FROM teams WHERE id=?').get(id) ?? fail(404, 'Team not found');
  const ok = user.role === 'admin' || t.created_by === user.id ||
    db.prepare('SELECT 1 FROM research WHERE team_id=? AND supervisor_id=?').get(id, user.id);
  return ok ? t : fail(403, 'Not your team');
}
// A student a supervisor may put in a team: no team yet, or already in a team they manage (admin: anyone).
function takeable(user, id) {
  const s = db.prepare("SELECT id,team_id FROM users WHERE id=? AND role='student'").get(id) ?? fail(400, `User ${id} is not a student`);
  if (s.team_id && user.role !== 'admin') {
    try { manageable(user, s.team_id); } catch { fail(409, `User ${id} already belongs to another supervisor's team`); }
  }
  return s;
}
// When a student leaves their old team and was its leader, the leader slot is cleared.
const clearLeader = s => { if (s.team_id) db.prepare('UPDATE teams SET leader_id=NULL WHERE id=? AND leader_id=?').run(s.team_id, s.id); };

export const adminHandlers = {
  // Supervisor/Admin: Form teams (a supervisor can only gather students who are free or already in a team of theirs)
  formTeams({ user, body }) {
    const name = need(body.name, 'Team name', 100);
    const course = db.prepare('SELECT id FROM courses WHERE id=?').get(Number(body.courseId)) ?? fail(400, 'Choose a valid course');
    const ids = [...new Set((body.memberIds ?? []).map(Number))];
    if (ids.length === 0) fail(400, 'Select at least one student');
    const students = ids.map(id => takeable(user, id));
    const leader = body.leaderId ? Number(body.leaderId) : null;
    if (leader && !ids.includes(leader)) fail(400, 'The team leader must be a member of the team');
    db.exec('BEGIN');
    try {
      const t = db.prepare('INSERT INTO teams (name,course_id,leader_id,created_by) VALUES (?,?,?,?)').run(name, course.id, leader, user.id);
      const tid = Number(t.lastInsertRowid);
      const upd = db.prepare('UPDATE users SET team_id=? WHERE id=?');
      for (const s of students) { upd.run(tid, s.id); clearLeader(s); }
      db.exec('COMMIT');
      for (const s of students) notify(s.id, 'n.team', { name });
      audit(user, 'team.created', { detail: { id: tid, name, members: ids, leader } });
      return { id: tid };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  // Supervisor/Admin: add and/or remove members of a team they manage.
  updateTeamMembers({ user, params, body }) {
    const team = manageable(user, Number(params.id));
    const add = [...new Set((body.add ?? []).map(Number))], remove = [...new Set((body.remove ?? []).map(Number))];
    if (!add.length && !remove.length) fail(400, 'Nothing to change');
    const toAdd = add.map(id => takeable(user, id));
    for (const id of remove) if (db.prepare('SELECT 1 FROM users WHERE id=? AND team_id=?').get(id, team.id) == null) fail(400, `User ${id} is not in this team`);
    db.exec('BEGIN');
    try {
      for (const s of toAdd) { clearLeader(s); db.prepare('UPDATE users SET team_id=? WHERE id=?').run(team.id, s.id); }
      for (const id of remove) db.prepare('UPDATE users SET team_id=NULL WHERE id=?').run(id);
      if (team.leader_id && remove.includes(team.leader_id)) db.prepare('UPDATE teams SET leader_id=NULL WHERE id=?').run(team.id);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    for (const s of toAdd) notify(s.id, 'n.team', { name: team.name });
    for (const id of remove) notify(id, 'n.team.removed', { name: team.name });
    audit(user, 'team.members', { detail: { team: team.id, add, remove } });
    return { ok: true };
  },
  // Supervisor/Admin: assign the team leader (must be a member) or clear it.
  setTeamLeader({ user, params, body }) {
    const team = manageable(user, Number(params.id));
    const uid = body.userId ? Number(body.userId) : null;
    if (uid && !db.prepare('SELECT 1 FROM users WHERE id=? AND team_id=?').get(uid, team.id)) fail(400, 'The team leader must be a member of the team');
    db.prepare('UPDATE teams SET leader_id=? WHERE id=?').run(uid, team.id);
    if (uid) notify(uid, 'n.team.leader', { name: team.name });
    audit(user, 'team.leader', { detail: { team: team.id, leader: uid } });
    return { leader_id: uid };
  },
  // Teams a supervisor manages: ones they created plus ones whose research is assigned to them. Admin sees all.
  listTeams({ user }) {
    const where = user.role === 'admin' ? '' : ` WHERE t.created_by=? OR t.id IN (SELECT team_id FROM research WHERE supervisor_id=? AND team_id IS NOT NULL)`;
    const args = user.role === 'admin' ? [] : [user.id, user.id];
    const teams = db.prepare(`SELECT t.id,t.name,t.leader_id,c.name AS course FROM teams t JOIN courses c ON c.id=t.course_id${where} ORDER BY t.id DESC`).all(...args);
    const m = db.prepare('SELECT id,name,email FROM users WHERE team_id=? ORDER BY name');
    const res = db.prepare('SELECT id,title,status,supervisor_id FROM research WHERE team_id=?');
    return teams.map(t => {
      const research = res.get(t.id) ?? null;
      const rows = research ? targets('t.research_id=?', research.id) : [];
      return {
        ...t, members: m.all(t.id).map(x => ({ ...x, leader: x.id === t.leader_id })), research,
        stages: { total: rows.length, approved: rows.filter(r => r.status === 'approved').length, pending_review: rows.filter(r => r.pending_review).length,
          missing: rows.filter(r => r.missing).length, late: rows.filter(r => r.late).length },
      };
    });
  },

  // Lookups
  listCourses() { return db.prepare('SELECT * FROM courses ORDER BY name').all(); },
  listSupervisors() { return db.prepare("SELECT id,name FROM users WHERE role='supervisor' ORDER BY name").all(); },
  listStudents() { return db.prepare("SELECT id,name,email,team_id FROM users WHERE role='student' ORDER BY name").all(); },
  createCourse({ body }) {
    const name = need(body.name, 'Course name', 100);
    try { return { id: Number(db.prepare('INSERT INTO courses (name) VALUES (?)').run(name).lastInsertRowid) }; }
    catch { fail(409, 'Course already exists'); }
  },

  // Admin: Manage users / Assign authorization
  listUsers() {
    return db.prepare('SELECT id,name,email,role,team_id FROM users ORDER BY id').all();
  },
  createUser({ body }) {
    const name = need(body.name, 'Name', 100);
    const email = need(body.email, 'Email', 200).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Invalid email');
    if (typeof body.password !== 'string' || body.password.length < 6) fail(400, 'Password must be at least 6 characters');
    if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
    try {
      const r = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)')
        .run(name, email, hashPassword(body.password), body.role);
      return { id: Number(r.lastInsertRowid) };
    } catch { fail(409, 'Email already in use'); }
  },
  // Admin: Assign authorization
  assignRole({ user, params, body }) {
    const id = Number(params.id);
    db.prepare('SELECT 1 FROM users WHERE id=?').get(id) ?? fail(404, 'User not found');
    if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
    if (id === user.id && body.role !== 'admin') fail(400, 'You cannot remove your own admin role');
    db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role, id);
    return { ok: true };
  },
  updateUser({ params, body }) {
    const id = Number(params.id);
    db.prepare('SELECT 1 FROM users WHERE id=?').get(id) ?? fail(404, 'User not found');
    if (body.name !== undefined) db.prepare('UPDATE users SET name=? WHERE id=?').run(need(body.name, 'Name', 100), id);
    if (body.password) {
      if (typeof body.password !== 'string' || body.password.length < 6) fail(400, 'Password must be at least 6 characters');
      db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password), id);
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    }
    return { ok: true };
  },
  deleteUser({ user, params }) {
    const id = Number(params.id);
    if (id === user.id) fail(400, 'You cannot delete yourself');
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      db.prepare('DELETE FROM notifications WHERE user_id=?').run(id);
      const r = db.prepare('DELETE FROM users WHERE id=?').run(id);
      if (!r.changes) { db.exec('ROLLBACK'); fail(404, 'User not found'); }
      db.exec('COMMIT');
      return { ok: true };
    } catch (e) {
      try { db.exec('ROLLBACK'); }
      catch (rollbackError) { console.error('Rollback failed:', rollbackError.message); } // no open transaction is fine, but never hide it
      if (e instanceof HttpError) throw e;
      fail(409, 'User is referenced by research or notes and cannot be deleted');
    }
  },

  // Admin: View progress reports (all research projects)
  reports() {
    const byStatus = db.prepare('SELECT status, COUNT(*) AS n FROM research GROUP BY status').all();
    const perSupervisor = db.prepare(`SELECT u.name, COUNT(r.id) AS projects,
      SUM(r.status='approved') AS approved, SUM(r.status='pending') AS pending
      FROM users u LEFT JOIN research r ON r.supervisor_id=u.id WHERE u.role='supervisor' GROUP BY u.id`).all();
    const avg = db.prepare('SELECT ROUND(AVG(score),1) AS avg FROM research_grades').get().avg;
    const totals = db.prepare(`SELECT (SELECT COUNT(*) FROM research) AS research,
      (SELECT COUNT(*) FROM submissions) AS submissions, (SELECT COUNT(*) FROM users) AS users`).get();
    const projects = listFor({ role: 'admin' });  // all projects
    return { totals: { ...totals, overdue: projects.filter(p => p.overdue).length }, byStatus, perSupervisor, averageGrade: avg, projects };
  },
};
