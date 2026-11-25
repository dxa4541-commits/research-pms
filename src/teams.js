// Team model: membership (one active team per student per course), size/lock rules and membership history.
import { db } from './db.js';
import { fail } from './errors.js';
import { notify } from './notifications.js';
import { stageStarted } from './stages.js';

export const getCourse = async id => (await db.prepare('SELECT * FROM courses WHERE id=?').get(id)) ?? fail(404, 'Course not found');
export const getTeam = async id => (await db.prepare('SELECT * FROM teams WHERE id=?').get(id)) ?? fail(404, 'Team not found');
export const activeMembers = teamId => db.prepare(`SELECT u.id,u.name,u.university_id,tm.role,tm.joined_at FROM team_members tm JOIN users u ON u.id=tm.user_id
  WHERE tm.team_id=? AND tm.left_at IS NULL ORDER BY tm.role DESC, u.name`).all(teamId);
export const memberIds = async teamId => (await db.prepare('SELECT user_id FROM team_members WHERE team_id=? AND left_at IS NULL').all(teamId)).map(x => x.user_id);
export const sizeOf = async teamId => (await db.prepare('SELECT COUNT(*) AS n FROM team_members WHERE team_id=? AND left_at IS NULL').get(teamId)).n;
export const isMember = async (userId, teamId) => !!await db.prepare('SELECT 1 FROM team_members WHERE team_id=? AND user_id=? AND left_at IS NULL').get(teamId, userId);
export const isLeader = async (userId, teamId) => !!await db.prepare("SELECT 1 FROM team_members WHERE team_id=? AND user_id=? AND left_at IS NULL AND role='leader'").get(teamId, userId);
export const teamIdsOf = async userId => (await db.prepare('SELECT team_id FROM team_members WHERE user_id=? AND left_at IS NULL').all(userId)).map(x => x.team_id);
export const teamFor = (userId, courseId) => db.prepare(`SELECT t.* FROM team_members tm JOIN teams t ON t.id=tm.team_id
  WHERE tm.user_id=? AND tm.course_id=? AND tm.left_at IS NULL`).get(userId, courseId);
export const enrolled = async (userId, courseId) => !!await db.prepare('SELECT 1 FROM enrollments WHERE user_id=? AND course_id=?').get(userId, courseId);
export const coursesOf = userId => db.prepare('SELECT c.* FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.user_id=? ORDER BY c.name').all(userId);

export async function history(teamId, userId, actorId, action, detail = null) {
  await db.prepare('INSERT INTO team_history (team_id,user_id,actor_id,action,detail) VALUES (?,?,?,?,?)').run(teamId, userId, actorId, action, detail == null ? null : JSON.stringify(detail));
}
export const teamResearch = teamId => db.prepare("SELECT * FROM research WHERE team_id=? ORDER BY (status='rejected'), id DESC").get(teamId);
// A team is locked by its supervisor/admin, by the course, or automatically once any of its stages has started.
export async function teamLocked(team) {
  if (team.locked || (await getCourse(team.course_id)).teams_locked) return true;
  const r = await db.prepare("SELECT id FROM research WHERE team_id=? AND status<>'rejected'").get(team.id);
  if (!r) return false;
  if (await db.prepare('SELECT 1 FROM stage_submissions WHERE research_id=?').get(r.id)) return true;
  for (const s of await db.prepare('SELECT s.* FROM stage_targets t JOIN stages s ON s.id=t.stage_id WHERE t.research_id=?').all(r.id))
    if (await stageStarted(s)) return true;
  return false;
}
export const LOCK_MSG = 'Team membership is locked; send a change request to your supervisor';
// Student with an active individual research in the course cannot also join a team there.
const hasIndividualResearch = async (userId, courseId) => !!await db.prepare("SELECT 1 FROM research WHERE student_id=? AND course_id=? AND team_id IS NULL AND status<>'rejected'").get(userId, courseId);

// Adds a student to a team, enforcing every membership rule. opts.bypassLock: supervisor/admin/approved change.
export async function addMember(team, userId, { actor = null, role = 'member', bypassLock = false } = {}) {
  const u = await db.prepare('SELECT * FROM users WHERE id=?').get(userId);
  if (!u || u.role !== 'student' || !u.active) fail(400, 'User is not an active student');
  const course = await getCourse(team.course_id);
  if (course.team_mode === 'individual') fail(409, 'This course only allows individual research');
  if (!await enrolled(userId, course.id)) fail(409, 'The student is not enrolled in this course');
  if (await teamFor(userId, course.id)) fail(409, 'The student already belongs to a team in this course');
  if (await hasIndividualResearch(userId, course.id)) fail(409, 'The student already has an individual research project in this course');
  if (!bypassLock && await teamLocked(team)) fail(409, LOCK_MSG);
  if (await sizeOf(team.id) >= course.max_team_size) fail(409, 'The team has reached its maximum size');
  await db.prepare('INSERT INTO team_members (team_id,user_id,course_id,role) VALUES (?,?,?,?)').run(team.id, userId, course.id, role);
  if (role === 'leader') await db.prepare('UPDATE teams SET leader_id=? WHERE id=?').run(userId, team.id);
  await history(team.id, userId, actor, role === 'leader' ? 'created_as_leader' : 'joined');
  // the student is no longer "available" in this course: drop their other pending invitations/requests there
  await db.prepare(`UPDATE team_invitations SET status='cancelled', decided_at=utc_now() WHERE invitee_id=? AND status='pending'
    AND team_id IN (SELECT id FROM teams WHERE course_id=?)`).run(userId, course.id);
  await db.prepare(`UPDATE join_requests SET status='cancelled', decided_at=utc_now() WHERE user_id=? AND status='pending'
    AND team_id IN (SELECT id FROM teams WHERE course_id=?)`).run(userId, course.id);
  return course;
}
export async function removeMember(team, userId, { actor = null, action = 'removed', bypassLock = false } = {}) {
  const m = (await db.prepare('SELECT * FROM team_members WHERE team_id=? AND user_id=? AND left_at IS NULL').get(team.id, userId)) ?? fail(400, 'The user is not in this team');
  if (!bypassLock && await teamLocked(team)) fail(409, LOCK_MSG);
  await db.prepare('UPDATE team_members SET left_at=utc_now() WHERE id=?').run(m.id);
  if (m.role === 'leader') await db.prepare('UPDATE teams SET leader_id=NULL WHERE id=?').run(team.id);
  await history(team.id, userId, actor, action);
  return m;
}
export async function setLeader(team, userId, actor, { bypassLock = false } = {}) {
  if (!await isMember(userId, team.id)) fail(400, 'The team leader must be a member of the team');
  if (!bypassLock && await teamLocked(team)) fail(409, LOCK_MSG);
  await db.tx(async () => {
    await db.prepare("UPDATE team_members SET role='member' WHERE team_id=? AND left_at IS NULL AND role='leader'").run(team.id);
    await db.prepare("UPDATE team_members SET role='leader' WHERE team_id=? AND user_id=? AND left_at IS NULL").run(team.id, userId);
    await db.prepare('UPDATE teams SET leader_id=? WHERE id=?').run(userId, team.id);
  });
  await history(team.id, userId, actor, 'leader_changed');
  await notify(userId, 'n.team.leader', { name: team.name });
}
// Tell the other members about a change (excluding the person it is about when they are told separately).
export async function notifyTeam(teamId, key, params, exceptUserId = null) {
  for (const id of await memberIds(teamId)) if (id !== exceptUserId) await notify(id, key, params);
}
