// Teams, courses, users and reports (Form teams, Manage users, Assign authorization, View progress reports).
import { db } from '../db.js';
import { HttpError, fail, need } from '../errors.js';
import { hashPassword } from '../auth.js';
import { notify } from '../notifications.js';
import { listFor } from '../research.js';

const ROLES = ['student', 'supervisor', 'admin'];

export const adminHandlers = {
  // Supervisor/Admin: Form teams
  formTeams({ user, body }) {
    const name = need(body.name, 'Team name', 100);
    const course = db.prepare('SELECT id FROM courses WHERE id=?').get(Number(body.courseId)) ?? fail(400, 'Choose a valid course');
    const ids = [...new Set((body.memberIds ?? []).map(Number))];
    if (ids.length === 0) fail(400, 'Select at least one student');
    const students = ids.map(id => db.prepare("SELECT id,team_id FROM users WHERE id=? AND role='student'").get(id) ?? fail(400, `User ${id} is not a student`));
    db.exec('BEGIN');
    try {
      const t = db.prepare('INSERT INTO teams (name,course_id) VALUES (?,?)').run(name, course.id);
      const upd = db.prepare('UPDATE users SET team_id=? WHERE id=?');
      for (const s of students) upd.run(Number(t.lastInsertRowid), s.id);
      db.exec('COMMIT');
      for (const s of students) notify(s.id, 'n.team', { name });
      return { id: Number(t.lastInsertRowid) };
    } catch (e) { db.exec('ROLLBACK'); throw e; }
  },
  listTeams() {
    const teams = db.prepare('SELECT t.id,t.name,c.name AS course FROM teams t JOIN courses c ON c.id=t.course_id ORDER BY t.id DESC').all();
    const m = db.prepare('SELECT name FROM users WHERE team_id=?');
    return teams.map(t => ({ ...t, members: m.all(t.id).map(x => x.name) }));
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
