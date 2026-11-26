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
export async function manageable(user, id) {
  const t = await getTeam(id);
  const ok = user.role === 'admin' || t.created_by === user.id ||
    await db.prepare('SELECT 1 FROM research WHERE team_id=? AND supervisor_id=?').get(id, user.id);
  return ok ? t : fail(403, 'Not your team');
}
const nameOf = async id => (await db.prepare('SELECT name FROM users WHERE id=?').get(id)).name;

export const teamView = async t => {
  const research = (await db.prepare("SELECT id,title,status,supervisor_id FROM research WHERE team_id=? ORDER BY (status='rejected'), id DESC").get(t.id)) ?? null;
  const rows = research ? await targets('t.research_id=?', research.id) : [];
  return {
    id: t.id, name: t.name, course: (await db.prepare('SELECT name FROM courses WHERE id=?').get(t.course_id))?.name, course_id: t.course_id,
    leader_id: t.leader_id, locked: await teamLocked(t), accepting: !!t.accepting, idea: t.idea, description: t.description,
    members: (await activeMembers(t.id)).map(m => ({ id: m.id, name: m.name, university_id: m.university_id, leader: m.role === 'leader' })), research,
    stages: { total: rows.length, approved: rows.filter(r => r.status === 'approved').length, pending_review: rows.filter(r => r.pending_review).length,
      missing: rows.filter(r => r.missing).length, late: rows.filter(r => r.late).length },
    stage_list: await stageList(rows),
  };
};
// Every stage of the team's research in order: what was handed in (latest attempt and its files), when, and the grade.
async function stageList(rows) {
  const subIds = rows.map(r => r.sub_id).filter(Boolean);
  const files = subIds.length ? await db.prepare(`SELECT id,submission_id,filename,size FROM stage_submission_files WHERE submission_id IN (${subIds.map(() => '?').join(',')}) ORDER BY submission_id, position`).all(...subIds) : [];
  return rows.map(r => ({
    stage_id: r.stage_id, name: r.stage_name, phase: r.phase, status: r.display_status, late: r.late, deadline: r.deadline,
    attempts: r.attempts, submission_id: r.sub_id ?? null, submitted_at: r.submitted_at ?? null, max_grade: r.max_grade, score: r.score ?? null,
    files: !r.sub_id ? [] : files.some(f => f.submission_id === r.sub_id) ? files.filter(f => f.submission_id === r.sub_id).map(({ submission_id, ...f }) => f) : [{ id: null, filename: r.filename, size: null }],
  }));
}

export const adminHandlers = {
  // Supervisor/Admin: Form teams. Every student must be enrolled, free in this course, and the size limits apply.
  async formTeams({ user, body }) {
    const name = need(body.name, 'Team name', 100);
    const course = (await db.prepare('SELECT * FROM courses WHERE id=?').get(Number(body.courseId))) ?? fail(400, 'Choose a valid course');
    if (await db.prepare('SELECT 1 FROM teams WHERE course_id=? AND lower(name)=lower(?)').get(course.id, name)) fail(409, 'A team with this name already exists in this course');
    const ids = [...new Set((body.memberIds ?? []).map(Number))];
    if (ids.length === 0) fail(400, 'Select at least one student');
    const leader = body.leaderId ? Number(body.leaderId) : ids[0];
    if (!ids.includes(leader)) fail(400, 'The team leader must be a member of the team');
    const t = await db.prepare('INSERT INTO teams (name,course_id,leader_id,created_by) VALUES (?,?,?,?)').run(name, course.id, null, user.id);
    const tid = t.lastInsertRowid, team = await getTeam(tid);
    await history(tid, null, user.id, 'created', { name });
    for (const uid of ids) await addMember(team, uid, { actor: user.id, role: uid === leader ? 'leader' : 'member', bypassLock: true });
    for (const uid of ids) await notify(uid, 'n.team', { name });
    await audit(user, 'team.created', { detail: { id: tid, name, members: ids, leader } });
    return { id: tid };
  },
  // Supervisor/Admin: add and/or remove members of a team they manage (allowed even when the team is locked).
  async updateTeamMembers({ user, params, body }) {
    const team = await manageable(user, Number(params.id));
    const add = [...new Set((body.add ?? []).map(Number))], remove = [...new Set((body.remove ?? []).map(Number))];
    if (!add.length && !remove.length) fail(400, 'Nothing to change');
    for (const id of remove) await removeMember(team, id, { actor: user.id, bypassLock: true });
    for (const id of add) await addMember(team, id, { actor: user.id, bypassLock: true });
    for (const id of add) { await notify(id, 'n.team', { name: team.name }); await notifyTeam(team.id, 'n.team.member_joined', { name: await nameOf(id), team: team.name }, id); }
    for (const id of remove) { await notify(id, 'n.team.removed', { name: team.name }); await notifyTeam(team.id, 'n.team.member_left', { name: await nameOf(id), team: team.name }); }
    await audit(user, 'team.members', { detail: { team: team.id, add, remove } });
    return { ok: true };
  },
  // Assign the team leader: supervisor/admin of the team any time, the current leader while the team is not locked.
  async setTeamLeader({ user, params, body }) {
    const team = await getTeam(Number(params.id));
    const uid = body.userId ? Number(body.userId) : null;
    if (user.role === 'student') { if (!await isLeader(user.id, team.id)) fail(403, 'Only the team leader can do this'); if (!uid) fail(400, 'Choose a member'); }
    else await manageable(user, team.id);
    if (uid) await setLeader(team, uid, user.id, { bypassLock: user.role !== 'student' });
    else { await db.prepare("UPDATE team_members SET role='member' WHERE team_id=? AND left_at IS NULL").run(team.id); await db.prepare('UPDATE teams SET leader_id=NULL WHERE id=?').run(team.id); }
    await audit(user, 'team.leader', { detail: { team: team.id, leader: uid } });
    return { leader_id: uid };
  },
  // Teams a supervisor manages: ones they created plus ones whose research is assigned to them. Admin sees all.
  async listTeams({ user }) {
    const where = user.role === 'admin' ? '' : ` WHERE t.created_by=? OR t.id IN (SELECT team_id FROM research WHERE supervisor_id=? AND team_id IS NOT NULL)`;
    const args = user.role === 'admin' ? [] : [user.id, user.id];
    const out = [];
    for (const t of await db.prepare(`SELECT t.* FROM teams t${where} ORDER BY t.id DESC`).all(...args)) out.push(await teamView(t));
    return out;
  },
  // Supervisor/Admin: lock or unlock a team's membership.
  async setTeamLock({ user, params, body }) {
    const team = await manageable(user, Number(params.id));
    await db.prepare('UPDATE teams SET locked=? WHERE id=?').run(body.locked ? 1 : 0, team.id);
    await history(team.id, null, user.id, body.locked ? 'locked' : 'unlocked');
    await audit(user, body.locked ? 'team.locked' : 'team.unlocked', { detail: { team: team.id } });
    return { locked: !!body.locked };
  },
  // Supervisor/Admin: history of a team's membership.
  async teamHistory({ user, params }) {
    const team = await manageable(user, Number(params.id));
    return (await db.prepare(`SELECT h.id,h.action,h.detail,h.created_at,u.name AS member,a.name AS actor FROM team_history h
      LEFT JOIN users u ON u.id=h.user_id LEFT JOIN users a ON a.id=h.actor_id WHERE h.team_id=? ORDER BY h.id DESC`).all(team.id))
      .map(x => ({ ...x, detail: x.detail ? JSON.parse(x.detail) : null }));
  },

  // Lookups. Students only see the courses they are enrolled in.
  listCourses({ user }) {
    return user.role === 'student' ? coursesOf(user.id) : db.prepare('SELECT * FROM courses ORDER BY name').all();
  },
  listSupervisors() { return db.prepare("SELECT id,name FROM users WHERE role='supervisor' AND active=1 ORDER BY name").all(); },
  async listStudents() {
    const en = await db.prepare("SELECT e.user_id,e.course_id FROM enrollments e JOIN users u ON u.id=e.user_id WHERE u.role='student'").all();
    const tm = await db.prepare('SELECT user_id,course_id,team_id FROM team_members WHERE left_at IS NULL').all();
    return (await db.prepare("SELECT id,name,email,university_id,active FROM users WHERE role='student' ORDER BY name").all())
      .map(u => ({ ...u, courses: en.filter(x => x.user_id === u.id).map(x => x.course_id),
        teams: Object.fromEntries(tm.filter(x => x.user_id === u.id).map(x => [x.course_id, x.team_id])) }));
  },
  async createCourse({ body }) {
    const name = need(body.name, 'Course name', 100);
    if (await db.prepare('SELECT 1 FROM courses WHERE name=?').get(name)) fail(409, 'Course already exists');
    try {
      const id = (await db.prepare('INSERT INTO courses (name) VALUES (?)').run(name)).lastInsertRowid;
      if (body.team_mode || body.max_team_size) await applySettings(id, body);
      return { id };
    } catch (e) { if (e instanceof HttpError) throw e; fail(409, 'Course already exists'); }
  },
  // Team rules of a course (supervisor or admin): mode, size limits, membership lock, ID privacy.
  async updateCourseSettings({ user, params, body }) {
    const c = await getCourse(Number(params.id));
    await applySettings(c.id, body);
    await audit(user, 'course.settings', { detail: { course: c.id, ...body } });
    return db.prepare('SELECT * FROM courses WHERE id=?').get(c.id);
  },

  // Admin: Manage users / Assign authorization
  async listUsers() {
    const en = await db.prepare('SELECT user_id,course_id FROM enrollments').all();
    return (await db.prepare('SELECT id,name,email,role,university_id,active,must_change_password FROM users ORDER BY id').all())
      .map(u => ({ ...u, courses: en.filter(x => x.user_id === u.id).map(x => x.course_id) }));
  },
  async createUser({ body }) {
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
    for (const c of courseIds) await getCourse(c);
    // checked up front: a failed INSERT would abort the request's transaction
    if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) fail(409, 'Email already in use');
    if (uid && await db.prepare('SELECT 1 FROM users WHERE university_id=?').get(uid)) fail(409, 'University ID already in use');
    try {
      const r = await db.prepare('INSERT INTO users (name,email,password_hash,role,university_id,must_change_password) VALUES (?,?,?,?,?,?)')
        .run(name, email, hashPassword(pw), body.role, uid, initial ? 1 : 0);
      const id = r.lastInsertRowid;
      if (body.role === 'student') for (const c of courseIds) await db.prepare('INSERT INTO enrollments (user_id,course_id) VALUES (?,?)').run(id, c);
      return { id };
    } catch (e) { if (e instanceof HttpError) throw e; fail(409, /university_id/.test(e.message) ? 'University ID already in use' : 'Email already in use'); }
  },
  // Admin: enroll a student in courses (replaces the list)
  async setEnrollments({ user, params, body }) {
    const id = Number(params.id);
    (await db.prepare("SELECT 1 FROM users WHERE id=? AND role='student'").get(id)) ?? fail(404, 'Student not found');
    const ids = [...new Set((body.courseIds ?? []).map(Number))];
    for (const c of ids) await getCourse(c);
    const active = [];
    for (const t of await teamIdsOf(id)) active.push((await getTeam(t)).course_id);
    const dropped = active.filter(c => !ids.includes(c));
    if (dropped.length) fail(409, 'The student is in a team for a course you are removing; remove them from the team first');
    await db.prepare('DELETE FROM enrollments WHERE user_id=?').run(id);
    for (const c of ids) await db.prepare('INSERT INTO enrollments (user_id,course_id) VALUES (?,?)').run(id, c);
    await audit(user, 'user.enrollments', { detail: { user: id, courses: ids } });
    return { ok: true };
  },
  // Admin: Assign authorization
  async assignRole({ user, params, body }) {
    const id = Number(params.id);
    (await db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) ?? fail(404, 'User not found');
    if (!ROLES.includes(body.role)) fail(400, 'Invalid role');
    if (id === user.id && body.role !== 'admin') fail(400, 'You cannot remove your own admin role');
    await db.prepare('UPDATE users SET role=? WHERE id=?').run(body.role, id);
    return { ok: true };
  },
  async updateUser({ user, params, body }) {
    const id = Number(params.id);
    (await db.prepare('SELECT 1 FROM users WHERE id=?').get(id)) ?? fail(404, 'User not found');
    if (body.active !== undefined) {
      if (id === user.id && !body.active) fail(400, 'You cannot deactivate yourself');
      await db.prepare('UPDATE users SET active=? WHERE id=?').run(body.active ? 1 : 0, id);
      if (!body.active) await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
      await audit(user, body.active ? 'user.activated' : 'user.deactivated', { detail: { user: id } });
    }
    if (body.name !== undefined) await db.prepare('UPDATE users SET name=? WHERE id=?').run(need(body.name, 'Name', 100), id);
    if (body.password) {
      if (typeof body.password !== 'string' || body.password.length < 6) fail(400, 'Password must be at least 6 characters');
      await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.password), id);
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    }
    return { ok: true };
  },
  async deleteUser({ user, params }) {
    const id = Number(params.id);
    if (id === user.id) fail(400, 'You cannot delete yourself');
    try {
      return await db.tx(async () => {   // savepoint: a refused delete leaves nothing half done
        await db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
        await db.prepare('DELETE FROM notifications WHERE user_id=?').run(id);
        const r = await db.prepare('DELETE FROM users WHERE id=?').run(id);
        if (!r.changes) fail(404, 'User not found');
        return { ok: true };
      });
    } catch (e) {
      if (e instanceof HttpError) throw e;
      if (!/FOREIGN KEY/.test(e.message)) throw e;
      fail(409, 'User is referenced by research or notes and cannot be deleted');
    }
  },

  // Admin: View progress reports (all research projects)
  async reports() {
    const byStatus = await db.prepare('SELECT status, COUNT(*) AS n FROM research GROUP BY status').all();
    const perSupervisor = await db.prepare(`SELECT u.name, COUNT(r.id) AS projects,
      COUNT(*) FILTER (WHERE r.status='approved') AS approved, COUNT(*) FILTER (WHERE r.status='pending') AS pending
      FROM users u LEFT JOIN research r ON r.supervisor_id=u.id WHERE u.role='supervisor' GROUP BY u.id`).all();
    const avg = (await db.prepare('SELECT ROUND(AVG(score)::numeric,1) AS avg FROM research_grades').get()).avg;
    const totals = await db.prepare(`SELECT (SELECT COUNT(*) FROM research) AS research,
      (SELECT COUNT(*) FROM submissions) AS submissions, (SELECT COUNT(*) FROM users) AS users`).get();
    const projects = await listFor({ role: 'admin' });  // all projects
    return { totals: { ...totals, overdue: projects.filter(p => p.overdue).length }, byStatus, perSupervisor, averageGrade: avg, projects };
  },
};

async function applySettings(courseId, body) {
  const c = await getCourse(courseId);
  const mode = body.team_mode ?? c.team_mode, min = Number(body.min_team_size ?? c.min_team_size), max = Number(body.max_team_size ?? c.max_team_size);
  if (!TEAM_MODES.includes(mode)) fail(400, 'Invalid team mode');
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || max < min || max > 20) fail(400, 'Team size must satisfy 1 ≤ min ≤ max ≤ 20');
  const biggest = (await db.prepare(`SELECT MAX(n) AS n FROM (SELECT COUNT(*) AS n FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE t.course_id=? AND tm.left_at IS NULL GROUP BY tm.team_id) sizes`).get(courseId)).n ?? 0;
  if (max < biggest) fail(409, 'A team in this course is already larger than this maximum');
  await db.prepare('UPDATE courses SET team_mode=?, min_team_size=?, max_team_size=?, teams_locked=?, show_student_ids=? WHERE id=?')
    .run(mode, min, max, (body.teams_locked ?? c.teams_locked) ? 1 : 0, (body.show_student_ids ?? c.show_student_ids) ? 1 : 0, courseId);
}
