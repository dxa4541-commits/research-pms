// Teams (supervisor/admin side), courses, users and reports.
import { db } from '../db.js';
import { HttpError, fail, need } from '../errors.js';
import { hashPassword } from '../auth.js';
import { notify } from '../notifications.js';
import { listFor } from '../research.js';
import { audit } from '../audit.js';
import { targets } from '../stages.js';
import { getCourse, getTeam, activeMembers, addMember, removeMember, setLeader, isLeader, history, notifyTeam, coursesOf, teamIdsOf, teamLocked } from '../teams.js';

const ROLES = ['student', 'supervisor', 'admin'];
const TEAM_MODES = ['team', 'individual', 'both'];

// A team is managed by its creator or by the supervisor of its research; admin manages every team.
export function manageable(user, id) {
  const t = getTeam(id);
  const ok = user.role === 'admin' || t.created_by === user.id ||
    db.prepare('SELECT 1 FROM research WHERE team_id=? AND supervisor_id=?').get(id, user.id);
  return ok ? t : fail(403, 'Not your team');
}
const inTx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* no open transaction */ } throw e; } };

export const teamView = t => {
  const research = db.prepare("SELECT id,title,status,supervisor_id FROM research WHERE team_id=? ORDER BY (status='rejected'), id DESC").get(t.id) ?? null;
  const rows = research ? targets('t.research_id=?', research.id) : [];
  return {
    id: t.id, name: t.name, course: db.prepare('SELECT name FROM courses WHERE id=?').get(t.course_id)?.name, course_id: t.course_id,
    leader_id: t.leader_id, locked: teamLocked(t), accepting: !!t.accepting, idea: t.idea, description: t.description,
    members: activeMembers(t.id).map(m => ({ id: m.id, name: m.name, university_id: m.university_id, leader: m.role === 'leader' })), research,
    stages: { total: rows.length, approved: rows.filter(r => r.status === 'approved').length, pending_review: rows.filter(r => r.pending_review).length,
      missing: rows.filter(r => r.missing).length, late: rows.filter(r => r.late).length },
  };
};

export const adminHandlers = {
  // Supervisor/Admin: Form teams. Every student must be enrolled, free in this course, and the size limits apply.
  formTeams({ user, body }) {
    const name = need(body.name, 'Team name', 100);
    const course = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(body.courseId)) ?? fail(400, 'Choose a valid course');
    if (db.prepare('SELECT 1 FROM teams WHERE course_id=? AND lower(name)=lower(?)').get(course.id, name)) fail(409, 'A team with this name already exists in this course');
    const ids = [...new Set((body.memberIds ?? []).map(Number))];
    if (ids.length === 0) fail(400, 'Select at least one student');
    const leader = body.leaderId ? Number(body.leaderId) : ids[0];
    if (!ids.includes(leader)) fail(400, 'The team leader must be a member of the team');
    const tid = inTx(() => {
      const t = db.prepare('INSERT INTO teams (name,course_id,leader_id,created_by) VALUES (?,?,?,?)').run(name, course.id, null, user.id);
      const id = Number(t.lastInsertRowid), team = getTeam(id);
      history(id, null, user.id, 'created', { name });
      for (const uid of ids) addMember(team, uid, { actor: user.id, role: uid === leader ? 'leader' : 'member', bypassLock: true });
      return id;
    });
    for (const uid of ids) notify(uid, 'n.team', { name });
    audit(user, 'team.created', { detail: { id: tid, name, members: ids, leader } });
    return { id: tid };
  },
  // Supervisor/Admin: add and/or remove members of a team they manage (allowed even when the team is locked).
  updateTeamMembers({ user, params, body }) {
    const team = manageable(user, Number(params.id));
    const add = [...new Set((body.add ?? []).map(Number))], remove = [...new Set((body.remove ?? []).map(Number))];
    if (!add.length && !remove.length) fail(400, 'Nothing to change');
    inTx(() => {
      for (const id of remove) removeMember(team, id, { actor: user.id, bypassLock: true });
      for (const id of add) addMember(team, id, { actor: user.id, bypassLock: true });
    });
    for (const id of add) { notify(id, 'n.team', { name: team.name }); notifyTeam(team.id, 'n.team.member_joined', { name: db.prepare('SELECT name FROM users WHERE id=?').get(id).name, team: team.name }, id); }
    for (const id of remove) { notify(id, 'n.team.removed', { name: team.name }); notifyTeam(team.id, 'n.team.member_left', { name: db.prepare('SELECT name FROM users WHERE id=?').get(id).name, team: team.name }); }
    audit(user, 'team.members', { detail: { team: team.id, add, remove } });
    return { ok: true };
  },
  // Assign the team leader: supervisor/admin of the team any time, the current leader while the team is not locked.
  setTeamLeader({ user, params, body }) {
    const team = getTeam(Number(params.id));
    const uid = body.userId ? Number(body.userId) : null;
    if (user.role === 'student') { if (!isLeader(user.id, team.id)) fail(403, 'Only the team leader can do this'); if (!uid) fail(400, 'Choose a member'); }
    else manageable(user, team.id);
    if (uid) setLeader(team, uid, user.id, { bypassLock: user.role !== 'student' });
    else { db.prepare("UPDATE team_members SET role='member' WHERE team_id=? AND left_at IS NULL").run(team.id); db.prepare('UPDATE teams SET leader_id=NULL WHERE id=?').run(team.id); }
    audit(user, 'team.leader', { detail: { team: team.id, leader: uid } });
    return { leader_id: uid };
  },
  // Teams a supervisor manages: ones they created plus ones whose research is assigned to them. Admin sees all.
  listTeams({ user }) {
    const where = user.role === 'admin' ? '' : ` WHERE t.created_by=? OR t.id IN (SELECT team_id FROM research WHERE supervisor_id=? AND team_id IS NOT NULL)`;
    const args = user.role === 'admin' ? [] : [user.id, user.id];
    return db.prepare(`SELECT t.* FROM teams t${where} ORDER BY t.id DESC`).all(...args).map(teamView);
  },
  // Supervisor/Admin: lock or unlock a team's membership.
  setTeamLock({ user, params, body }) {
    const team = manageable(user, Number(params.id));
    db.prepare('UPDATE teams SET locked=? WHERE id=?').run(body.locked ? 1 : 0, team.id);
    history(team.id, null, user.id, body.locked ? 'locked' : 'unlocked');
    audit(user, body.locked ? 'team.locked' : 'team.unlocked', { detail: { team: team.id } });
    return { locked: !!body.locked };
  },
  // Supervisor/Admin: history of a team's membership.
  teamHistory({ user, params }) {
    const team = manageable(user, Number(params.id));
    return db.prepare(`SELECT h.id,h.action,h.detail,h.created_at,u.name AS member,a.name AS actor FROM team_history h
      LEFT JOIN users u ON u.id=h.user_id LEFT JOIN users a ON a.id=h.actor_id WHERE h.team_id=? ORDER BY h.id DESC`).all(team.id)
      .map(x => ({ ...x, detail: x.detail ? JSON.parse(x.detail) : null }));
  },

  // Lookups. Students only see the courses they are enrolled in.
  listCourses({ user }) {
    return user.role === 'student' ? coursesOf(user.id) : db.prepare('SELECT * FROM courses ORDER BY name').all();
  },
  listSupervisors() { return db.prepare("SELECT id,name FROM users WHERE role='supervisor' AND active=1 ORDER BY name").all(); },
  listStudents() {
    const en = db.prepare('SELECT course_id FROM enrollments WHERE user_id=?'), tm = db.prepare('SELECT course_id,team_id FROM team_members WHERE user_id=? AND left_at IS NULL');
    return db.prepare("SELECT id,name,email,university_id,active FROM users WHERE role='student' ORDER BY name").all()
      .map(u => ({ ...u, courses: en.all(u.id).map(x => x.course_id), teams: Object.fromEntries(tm.all(u.id).map(x => [x.course_id, x.team_id])) }));
  },
  createCourse({ body }) {
    const name = need(body.name, 'Course name', 100);
    try {
      const id = Number(db.prepare('INSERT INTO courses (name) VALUES (?)').run(name).lastInsertRowid);
      if (body.team_mode || body.max_team_size) applySettings(id, body);
      return { id };
    } catch (e) { if (e instanceof HttpError) throw e; fail(409, 'Course already exists'); }
  },
  // Team rules of a course (supervisor or admin): mode, size limits, membership lock, ID privacy.
  updateCourseSettings({ user, params, body }) {
    const c = getCourse(Number(params.id));
    applySettings(c.id, body);
    audit(user, 'course.settings', { detail: { course: c.id, ...body } });
    return db.prepare('SELECT * FROM courses WHERE id=?').get(c.id);
  },

  // Admin: Manage users / Assign authorization
  listUsers() {
    const en = db.prepare('SELECT course_id FROM enrollments WHERE user_id=?');
    return db.prepare('SELECT id,name,email,role,university_id,active,must_change_password FROM users ORDER BY id').all().map(u => ({ ...u, courses: en.all(u.id).map(x => x.course_id) }));
  },
  createUser({ body }) {
    const name = need(body.name, 'Name', 100);
    const uid = body.universityId ? need(String(body.universityId), 'University ID', 30) : null;
    if (uid && !/^[A-Za-z0-9._-]+$/.test(uid)) fail(400, 'University ID may contain letters, digits and . _ - only');
    if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
    if (uid && body.role !== 'student') fail(400, 'Only students have a University ID');
    const email = (body.email ? need(body.email, 'Email', 200) : (uid ? `${uid}@students.invalid` : need(body.email, 'Email', 200))).toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Invalid email');
    // A student with a University ID and no password gets the University ID as the initial password and must change it at first login.
    const initial = !body.password && uid;
    const pw = initial ? uid : body.password;
    if (typeof pw !== 'string' || pw.length < 6) fail(400, 'Password must be at least 6 characters');
    const courseIds = [...new Set((body.courseIds ?? []).map(Number))];
    for (const c of courseIds) getCourse(c);
    try {
      return inTx(() => {
        const r = db.prepare('INSERT INTO users (name,email,password_hash,role,university_id,must_change_password) VALUES (?,?,?,?,?,?)')
          .run(name, email, hashPassword(pw), body.role, uid, initial ? 1 : 0);
        const id = Number(r.lastInsertRowid);
        if (body.role === 'student') for (const c of courseIds) db.prepare('INSERT INTO enrollments (user_id,course_id) VALUES (?,?)').run(id, c);
        return { id };
      });
    } catch (e) { if (e instanceof HttpError) throw e; fail(409, /university_id/.test(e.message) ? 'University ID already in use' : 'Email already in use'); }
  },
  // Admin: enroll a student in courses (replaces the list)
  setEnrollments({ user, params, body }) {
    const id = Number(params.id);
    db.prepare("SELECT 1 FROM users WHERE id=? AND role='student'").get(id) ?? fail(404, 'Student not found');
    const ids = [...new Set((body.courseIds ?? []).map(Number))];
    for (const c of ids) getCourse(c);
    const active = teamIdsOf(id).map(t => getTeam(t).course_id);
    const dropped = active.filter(c => !ids.includes(c));
    if (dropped.length) fail(409, 'The student is in a team for a course you are removing; remove them from the team first');
    inTx(() => { db.prepare('DELETE FROM enrollments WHERE user_id=?').run(id); for (const c of ids) db.prepare('INSERT INTO enrollments (user_id,course_id) VALUES (?,?)').run(id, c); });
    audit(user, 'user.enrollments', { detail: { user: id, courses: ids } });
    return { ok: true };
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
  updateUser({ user, params, body }) {
    const id = Number(params.id);
    db.prepare('SELECT 1 FROM users WHERE id=?').get(id) ?? fail(404, 'User not found');
    if (body.active !== undefined) {
      if (id === user.id && !body.active) fail(400, 'You cannot deactivate yourself');
      db.prepare('UPDATE users SET active=? WHERE id=?').run(body.active ? 1 : 0, id);
      if (!body.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      audit(user, body.active ? 'user.activated' : 'user.deactivated', { detail: { user: id } });
    }
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

function applySettings(courseId, body) {
  const c = getCourse(courseId);
  const mode = body.team_mode ?? c.team_mode, min = Number(body.min_team_size ?? c.min_team_size), max = Number(body.max_team_size ?? c.max_team_size);
  if (!TEAM_MODES.includes(mode)) fail(400, 'Invalid team mode');
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 20) fail(400, 'Team size must satisfy 1 ≤ min ≤ max ≤ 20');
  const biggest = db.prepare(`SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE t.course_id=? AND tm.left_at IS NULL GROUP BY tm.team_id)`).get(courseId).n ?? 0;
  if (max < biggest) fail(409, 'A team in this course is already larger than this maximum');
  db.prepare('UPDATE courses SET team_mode=?, min_team_size=?, max_team_size=?, teams_locked=?, show_student_ids=? WHERE id=?')
    .run(mode, min, max, (body.teams_locked ?? c.teams_locked) ? 1 : 0, (body.show_student_ids ?? c.show_student_ids) ? 1 : 0, courseId);
}
