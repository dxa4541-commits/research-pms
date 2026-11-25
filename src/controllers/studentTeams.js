// Student team life-cycle: available students, team creation, invitations, join requests, invitation codes,
// leader permissions, leaving, locked-team change requests, and the student dashboard.
import { randomBytes } from 'node:crypto';
import { db } from '../db.js';
import { fail, need, str } from '../errors.js';
import { notify } from '../notifications.js';
import { audit } from '../audit.js';
import {
  getCourse, getTeam, activeMembers, addMember, removeMember, setLeader, isMember, isLeader, teamFor, enrolled, sizeOf,
  teamLocked, history, notifyTeam, LOCK_MSG,
} from '../teams.js';
import { manageable, teamView } from './admin.js';
import { stageHandlers } from './stages.js';
import { today } from '../stages.js';

const inTx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { try { db.exec('ROLLBACK'); } catch { /* no open transaction */ } throw e; } };
const nameOf = id => db.prepare('SELECT name FROM users WHERE id=?').get(id)?.name ?? '';
const hasIndividual = (uid, cid) => !!db.prepare("SELECT 1 FROM research WHERE student_id=? AND course_id=? AND team_id IS NULL AND status<>'rejected'").get(uid, cid);
const idFor = (course, u) => course.show_student_ids ? u.university_id : null;

// Is this student free to be invited / to join a team of the course?
function eligible(u, course) {
  return u && u.role === 'student' && u.active && enrolled(u.id, course.id) && course.team_mode !== 'individual' && !teamFor(u.id, course.id) && !hasIndividual(u.id, course.id);
}
// The caller must be the leader of the team (checked on every team-management call).
function leaderTeam(user, id) {
  const t = getTeam(id);
  return isLeader(user.id, t.id) ? t : fail(403, 'Only the team leader can do this');
}
const memberTeam = (user, id) => { const t = getTeam(id); return isMember(user.id, t.id) ? t : fail(403, 'You are not a member of this team'); };
const newCode = () => randomBytes(8).toString('base64url').replace(/[-_]/g, 'x').slice(0, 8).toUpperCase();
const limited = t => teamLocked(t) ? fail(409, LOCK_MSG) : null;

function myTeamDetail(user, t) {
  const v = teamView(t), leader = isLeader(user.id, t.id), course = getCourse(t.course_id);
  const out = {
    ...v, max_size: course.max_team_size, min_size: course.min_team_size, size: v.members.length, my_role: leader ? 'leader' : 'member', members_can_submit: !!t.members_can_submit,
    pending_change_requests: db.prepare(`SELECT m.id,m.kind,m.status,m.created_at,u.name AS member FROM membership_requests m JOIN users u ON u.id=m.user_id WHERE m.team_id=? AND m.status='pending'`).all(t.id),
  };
  if (leader) {
    out.invite_code = t.invite_code;
    out.invitations = db.prepare(`SELECT i.id,i.status,i.created_at,u.name,u.university_id FROM team_invitations i JOIN users u ON u.id=i.invitee_id WHERE i.team_id=? ORDER BY i.id DESC LIMIT 30`).all(t.id)
      .map(i => ({ ...i, university_id: course.show_student_ids ? i.university_id : null }));
    out.join_requests = db.prepare(`SELECT j.id,j.status,j.message,j.created_at,u.name,u.university_id FROM join_requests j JOIN users u ON u.id=j.user_id WHERE j.team_id=? ORDER BY (j.status='pending') DESC, j.id DESC LIMIT 30`).all(t.id);
  }
  out.members = out.members.map(m => ({ ...m, university_id: course.show_student_ids || m.id === user.id ? m.university_id : null }));
  return out;
}

export const studentTeamHandlers = {
  // ---------- Available students & team discovery ----------
  availableStudents({ user, query }) {
    const course = getCourse(Number(query.get('courseId')));
    if (!enrolled(user.id, course.id)) fail(403, 'You are not enrolled in this course');
    if (course.team_mode === 'individual') return [];
    return db.prepare("SELECT id,name,university_id,role,active FROM users WHERE role='student' AND active=1 AND id<>? ORDER BY name").all(user.id)
      .filter(u => eligible(u, course))
      .map(u => ({ id: u.id, name: u.name, university_id: idFor(course, u), course: course.name, status: 'available' }));
  },
  discoverTeams({ user, query }) {
    const course = getCourse(Number(query.get('courseId')));
    if (!enrolled(user.id, course.id)) fail(403, 'You are not enrolled in this course');
    if (course.team_mode === 'individual') return [];
    const mine = teamFor(user.id, course.id);
    const reqs = new Set(db.prepare("SELECT team_id FROM join_requests WHERE user_id=? AND status='pending'").all(user.id).map(x => x.team_id));
    const invs = new Set(db.prepare("SELECT team_id FROM team_invitations WHERE invitee_id=? AND status='pending'").all(user.id).map(x => x.team_id));
    return db.prepare('SELECT * FROM teams WHERE course_id=? ORDER BY name').all(course.id).map(t => {
      const size = sizeOf(t.id), locked = teamLocked(t), leader = db.prepare('SELECT user_id FROM team_members WHERE team_id=? AND left_at IS NULL AND role=\'leader\'').get(t.id);
      return {
        id: t.id, name: t.name, course: course.name, leader: leader ? nameOf(leader.user_id) : null, members: activeMembers(t.id).map(m => m.name), size, max_size: course.max_team_size,
        places: Math.max(0, course.max_team_size - size), idea: t.idea, accepting: !!t.accepting && !locked && size < course.max_team_size, locked,
        status: locked ? 'locked' : size >= course.max_team_size ? 'full' : t.accepting ? 'accepting' : 'closed',
        requested: reqs.has(t.id), invited: invs.has(t.id), mine: mine?.id === t.id,
      };
    }).filter(t => t.accepting || t.mine || t.requested || t.invited);
  },

  // ---------- Teams of the current student ----------
  listMyTeams({ user }) {
    return db.prepare('SELECT t.* FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=? AND tm.left_at IS NULL ORDER BY t.id DESC').all(user.id).map(t => myTeamDetail(user, t));
  },
  createMyTeam({ user, body }) {
    const course = getCourse(Number(body.courseId));
    if (!enrolled(user.id, course.id)) fail(403, 'You are not enrolled in this course');
    if (course.team_mode === 'individual') fail(409, 'This course only allows individual research');
    const name = need(body.name, 'Team name', 100);
    if (teamFor(user.id, course.id)) fail(409, 'You already belong to a team in this course');
    if (hasIndividual(user.id, course.id)) fail(409, 'You already have an individual research project in this course');
    if (db.prepare('SELECT 1 FROM teams WHERE course_id=? AND lower(name)=lower(?)').get(course.id, name)) fail(409, 'A team with this name already exists in this course');
    const text = (v, label, max) => v == null || v === '' ? null : (str(v, max) ?? fail(400, `${label} is too long (max ${max} chars)`));
    const id = inTx(() => {
      const r = db.prepare('INSERT INTO teams (name,course_id,created_by,idea,description) VALUES (?,?,?,?,?)').run(name, course.id, user.id, text(body.idea, 'Research idea', 200), text(body.description, 'Description', 2000));
      const tid = Number(r.lastInsertRowid);
      history(tid, null, user.id, 'created', { name });
      addMember(getTeam(tid), user.id, { actor: user.id, role: 'leader' }); // the creator becomes the Team Leader
      return tid;
    });
    audit(user, 'team.created', { detail: { id, name, course: course.id, by: 'student' } });
    return { id };
  },
  updateMyTeam({ user, params, body }) {
    const t = leaderTeam(user, Number(params.id));
    const name = body.name === undefined ? t.name : need(body.name, 'Team name', 100);
    if (name.toLowerCase() !== t.name.toLowerCase() && db.prepare('SELECT 1 FROM teams WHERE course_id=? AND lower(name)=lower(?) AND id<>?').get(t.course_id, name, t.id)) fail(409, 'A team with this name already exists in this course');
    const text = (v, cur, label, max) => v === undefined ? cur : (v === null || v === '' ? null : (str(v, max) ?? fail(400, `${label} is too long (max ${max} chars)`)));
    db.prepare('UPDATE teams SET name=?, idea=?, description=?, accepting=?, members_can_submit=? WHERE id=?').run(name, text(body.idea, t.idea, 'Research idea', 200),
      text(body.description, t.description, 'Description', 2000), body.accepting === undefined ? t.accepting : (body.accepting ? 1 : 0), body.membersCanSubmit === undefined ? t.members_can_submit : (body.membersCanSubmit ? 1 : 0), t.id);
    if (name !== t.name) { history(t.id, null, user.id, 'renamed', { from: t.name, to: name }); notifyTeam(t.id, 'n.team.renamed', { name, from: t.name }, user.id); }
    audit(user, 'team.updated', { detail: { id: t.id } });
    return { ok: true };
  },
  deleteMyTeam({ user, params }) {
    const t = leaderTeam(user, Number(params.id));
    if (db.prepare('SELECT 1 FROM research WHERE team_id=?').get(t.id)) fail(409, 'A team with a research project cannot be deleted');
    notifyTeam(t.id, 'n.team.deleted', { name: t.name }, user.id);
    history(t.id, null, user.id, 'deleted', { name: t.name });
    inTx(() => { db.prepare('UPDATE team_members SET left_at=CURRENT_TIMESTAMP WHERE team_id=? AND left_at IS NULL').run(t.id); db.prepare('DELETE FROM teams WHERE id=?').run(t.id); });
    audit(user, 'team.deleted', { detail: { id: t.id, name: t.name } });
    return { ok: true };
  },
  myTeamHistory({ user, params }) {
    const t = memberTeam(user, Number(params.id));
    return db.prepare(`SELECT h.id,h.action,h.detail,h.created_at,u.name AS member,a.name AS actor FROM team_history h LEFT JOIN users u ON u.id=h.user_id LEFT JOIN users a ON a.id=h.actor_id
      WHERE h.team_id=? ORDER BY h.id DESC`).all(t.id).map(x => ({ ...x, detail: x.detail ? JSON.parse(x.detail) : null }));
  },

  // ---------- Invitations (leader -> available student) ----------
  inviteStudent({ user, params, body }) {
    const t = leaderTeam(user, Number(params.id)), course = getCourse(t.course_id);
    limited(t);
    const u = body.userId ? db.prepare('SELECT * FROM users WHERE id=?').get(Number(body.userId))
      : db.prepare('SELECT * FROM users WHERE lower(university_id)=lower(?)').get(need(String(body.universityId ?? ''), 'University ID', 30));
    if (!u || u.role !== 'student' || !u.active) fail(404, 'No active student found with this University ID');
    if (u.id === user.id) fail(400, 'You cannot invite yourself');
    if (!enrolled(u.id, course.id)) fail(409, 'The student is not enrolled in this course');
    if (teamFor(u.id, course.id)) fail(409, 'The student already belongs to a team in this course');
    if (hasIndividual(u.id, course.id)) fail(409, 'The student already has an individual research project in this course');
    if (sizeOf(t.id) >= course.max_team_size) fail(409, 'The team has reached its maximum size');
    if (db.prepare("SELECT 1 FROM team_invitations WHERE team_id=? AND invitee_id=? AND status='pending'").get(t.id, u.id)) fail(409, 'This student already has a pending invitation');
    const id = Number(db.prepare('INSERT INTO team_invitations (team_id,invitee_id,invited_by) VALUES (?,?,?)').run(t.id, u.id, user.id).lastInsertRowid);
    notify(u.id, 'n.invitation.received', { team: t.name, from: user.name });
    audit(user, 'team.invited', { detail: { team: t.id, invitee: u.id, invitation: id } });
    return { id };
  },
  // My invitations (received) and the ones my teams sent.
  listInvitations({ user }) {
    const received = db.prepare(`SELECT i.id,i.status,i.created_at,t.id AS team_id,t.name AS team,t.idea,c.name AS course,inv.name AS invited_by FROM team_invitations i JOIN teams t ON t.id=i.team_id
      JOIN courses c ON c.id=t.course_id JOIN users inv ON inv.id=i.invited_by WHERE i.invitee_id=? ORDER BY (i.status='pending') DESC, i.id DESC LIMIT 50`).all(user.id);
    return received;
  },
  respondInvitation({ user, params, body }) {
    const i = db.prepare('SELECT * FROM team_invitations WHERE id=?').get(Number(params.id)) ?? fail(404, 'Invitation not found');
    if (i.invitee_id !== user.id) fail(403, 'This invitation is not yours');
    if (i.status !== 'pending') fail(409, 'This invitation has already been answered');
    const t = getTeam(i.team_id);
    if (body.accept) {
      inTx(() => { addMember(t, user.id, { actor: user.id }); db.prepare("UPDATE team_invitations SET status='accepted',decided_at=CURRENT_TIMESTAMP WHERE id=?").run(i.id); });
      notify(i.invited_by, 'n.invitation.accepted', { name: user.name, team: t.name });
      notifyTeam(t.id, 'n.team.member_joined', { name: user.name, team: t.name }, user.id);
      audit(user, 'team.invitation_accepted', { detail: { team: t.id, invitation: i.id } });
      return { status: 'accepted' };
    }
    db.prepare("UPDATE team_invitations SET status='rejected',decided_at=CURRENT_TIMESTAMP WHERE id=?").run(i.id);
    notify(i.invited_by, 'n.invitation.rejected', { name: user.name, team: t.name });
    audit(user, 'team.invitation_rejected', { detail: { team: t.id, invitation: i.id } });
    return { status: 'rejected' };
  },
  cancelInvitation({ user, params }) {
    const i = db.prepare('SELECT * FROM team_invitations WHERE id=?').get(Number(params.id)) ?? fail(404, 'Invitation not found');
    leaderTeam(user, i.team_id);
    if (i.status !== 'pending') fail(409, 'This invitation has already been answered');
    db.prepare("UPDATE team_invitations SET status='cancelled',decided_at=CURRENT_TIMESTAMP WHERE id=?").run(i.id);
    audit(user, 'team.invitation_cancelled', { detail: { team: i.team_id, invitation: i.id } });
    return { status: 'cancelled' };
  },

  // ---------- Join requests (student -> team) ----------
  requestToJoin({ user, params, body }) {
    const t = getTeam(Number(params.id)), course = getCourse(t.course_id);
    if (!eligible(user, course)) fail(409, enrolled(user.id, course.id) ? 'You cannot join a team in this course right now (you already have a team or an individual project)' : 'You are not enrolled in this course');
    if (!t.accepting) fail(409, 'This team is not accepting new members');
    if (teamLocked(t)) fail(409, 'This team is locked');
    if (sizeOf(t.id) >= course.max_team_size) fail(409, 'The team has reached its maximum size');
    if (db.prepare("SELECT 1 FROM join_requests WHERE team_id=? AND user_id=? AND status='pending'").get(t.id, user.id)) fail(409, 'You already requested to join this team');
    const message = body.message ? (str(body.message, 500) ?? fail(400, 'Message is too long (max 500 chars)')) : null;
    const id = Number(db.prepare('INSERT INTO join_requests (team_id,user_id,message) VALUES (?,?,?)').run(t.id, user.id, message).lastInsertRowid);
    const leader = db.prepare("SELECT user_id FROM team_members WHERE team_id=? AND left_at IS NULL AND role='leader'").get(t.id);
    if (leader) notify(leader.user_id, 'n.join.request', { name: user.name, team: t.name });
    audit(user, 'team.join_requested', { detail: { team: t.id, request: id } });
    return { id };
  },
  listJoinRequests({ user, params }) {
    const t = leaderTeam(user, Number(params.id)), course = getCourse(t.course_id);
    return db.prepare(`SELECT j.id,j.status,j.message,j.created_at,u.name,u.university_id FROM join_requests j JOIN users u ON u.id=j.user_id WHERE j.team_id=? ORDER BY (j.status='pending') DESC, j.id DESC`).all(t.id)
      .map(j => ({ ...j, university_id: course.show_student_ids ? j.university_id : null }));
  },
  myJoinRequests({ user }) {
    return db.prepare(`SELECT j.id,j.status,j.created_at,t.id AS team_id,t.name AS team,c.name AS course FROM join_requests j JOIN teams t ON t.id=j.team_id JOIN courses c ON c.id=t.course_id
      WHERE j.user_id=? ORDER BY (j.status='pending') DESC, j.id DESC LIMIT 30`).all(user.id);
  },
  respondJoinRequest({ user, params, body }) {
    const j = db.prepare('SELECT * FROM join_requests WHERE id=?').get(Number(params.id)) ?? fail(404, 'Request not found');
    const t = leaderTeam(user, j.team_id);
    if (j.status !== 'pending') fail(409, 'This request has already been answered');
    if (body.accept) {
      inTx(() => { addMember(t, j.user_id, { actor: user.id }); db.prepare("UPDATE join_requests SET status='accepted',decided_at=CURRENT_TIMESTAMP,decided_by=? WHERE id=?").run(user.id, j.id); });
      notify(j.user_id, 'n.join.accepted', { team: t.name });
      notifyTeam(t.id, 'n.team.member_joined', { name: nameOf(j.user_id), team: t.name }, j.user_id);
      audit(user, 'team.join_accepted', { detail: { team: t.id, request: j.id, student: j.user_id } });
      return { status: 'accepted' };
    }
    db.prepare("UPDATE join_requests SET status='rejected',decided_at=CURRENT_TIMESTAMP,decided_by=? WHERE id=?").run(user.id, j.id);
    notify(j.user_id, 'n.join.rejected', { team: t.name });
    audit(user, 'team.join_rejected', { detail: { team: t.id, request: j.id } });
    return { status: 'rejected' };
  },
  cancelJoinRequest({ user, params }) {
    const j = db.prepare('SELECT * FROM join_requests WHERE id=?').get(Number(params.id)) ?? fail(404, 'Request not found');
    if (j.user_id !== user.id) fail(403, 'This request is not yours');
    if (j.status !== 'pending') fail(409, 'This request has already been answered');
    db.prepare("UPDATE join_requests SET status='cancelled',decided_at=CURRENT_TIMESTAMP WHERE id=?").run(j.id);
    return { status: 'cancelled' };
  },

  // ---------- Invitation code ----------
  manageInviteCode({ user, params, body }) {
    const t = leaderTeam(user, Number(params.id));
    const code = body.action === 'disable' ? null : newCode();
    db.prepare('UPDATE teams SET invite_code=? WHERE id=?').run(code, t.id);
    audit(user, 'team.invite_code', { detail: { team: t.id, enabled: !!code } });
    return { invite_code: code };
  },
  joinByCode({ user, body }) {
    const code = need(String(body.code ?? ''), 'Invitation code', 20).toUpperCase();
    const t = db.prepare('SELECT * FROM teams WHERE invite_code=?').get(code) ?? fail(404, 'Invalid invitation code');
    const course = getCourse(t.course_id);
    if (!eligible(user, course)) fail(409, 'You cannot join a team in this course right now');
    if (!t.accepting) fail(409, 'This team is not accepting new members');
    addMember(t, user.id, { actor: user.id });
    notifyTeam(t.id, 'n.team.member_joined', { name: user.name, team: t.name }, user.id);
    audit(user, 'team.joined_by_code', { detail: { team: t.id } });
    return { id: t.id };
  },

  // ---------- Leader: remove members; members: leave ----------
  removeMyMember({ user, params }) {
    const t = leaderTeam(user, Number(params.id)), uid = Number(params.uid);
    if (uid === user.id) fail(400, 'Use "leave team" to leave');
    removeMember(t, uid, { actor: user.id }); // refuses when the team is locked
    notify(uid, 'n.team.removed', { name: t.name });
    notifyTeam(t.id, 'n.team.member_left', { name: nameOf(uid), team: t.name });
    audit(user, 'team.member_removed', { detail: { team: t.id, member: uid } });
    return { ok: true };
  },
  leaveTeam({ user, params }) {
    const t = memberTeam(user, Number(params.id));
    if (isLeader(user.id, t.id) && sizeOf(t.id) > 1) fail(409, 'Assign another team leader before leaving the team');
    if (teamLocked(t)) {
      if (db.prepare("SELECT 1 FROM membership_requests WHERE team_id=? AND kind='leave' AND user_id=? AND status='pending'").get(t.id, user.id)) fail(409, 'You already requested to leave');
      const id = Number(db.prepare("INSERT INTO membership_requests (team_id,kind,user_id,requested_by) VALUES (?,'leave',?,?)").run(t.id, user.id, user.id).lastInsertRowid);
      notifySupervisors(t, 'n.change.request', { team: t.name, name: user.name });
      audit(user, 'team.leave_requested', { detail: { team: t.id, request: id } });
      return { pending: true, id };
    }
    removeMember(t, user.id, { actor: user.id, action: 'left' });
    notifyTeam(t.id, 'n.team.member_left', { name: user.name, team: t.name });
    audit(user, 'team.left', { detail: { team: t.id } });
    return { pending: false };
  },
  // When the team is locked the leader asks the supervisor for a change.
  requestChange({ user, params, body }) {
    const t = leaderTeam(user, Number(params.id));
    if (!['add', 'remove', 'leader'].includes(body.kind)) fail(400, 'kind must be add, remove or leader');
    if (!teamLocked(t)) fail(409, 'The team is not locked; make the change directly');
    const uid = body.userId ? Number(body.userId) : db.prepare('SELECT id FROM users WHERE lower(university_id)=lower(?)').get(String(body.universityId ?? ''))?.id ?? fail(404, 'No active student found with this University ID');
    if (body.kind === 'add') { const u = db.prepare('SELECT * FROM users WHERE id=?').get(uid); if (!eligible(u, getCourse(t.course_id))) fail(409, 'This student cannot join a team in this course'); }
    else if (!isMember(uid, t.id)) fail(400, 'The user is not in this team');
    if (db.prepare("SELECT 1 FROM membership_requests WHERE team_id=? AND kind=? AND user_id=? AND status='pending'").get(t.id, body.kind, uid)) fail(409, 'This change was already requested');
    const id = Number(db.prepare('INSERT INTO membership_requests (team_id,kind,user_id,requested_by,note) VALUES (?,?,?,?,?)').run(t.id, body.kind, uid, user.id, str(body.note, 500)).lastInsertRowid);
    notifySupervisors(t, 'n.change.request', { team: t.name, name: user.name });
    audit(user, 'team.change_requested', { detail: { team: t.id, kind: body.kind, user: uid, request: id } });
    return { id };
  },
  // Supervisor/admin: decide membership change requests of teams they manage.
  listChangeRequests({ user }) {
    const rows = db.prepare(`SELECT m.id,m.team_id,t.name AS team,m.kind,m.status,m.note,m.created_at,u.name AS member,r.name AS requested_by FROM membership_requests m
      JOIN teams t ON t.id=m.team_id JOIN users u ON u.id=m.user_id JOIN users r ON r.id=m.requested_by ORDER BY (m.status='pending') DESC, m.id DESC LIMIT 100`).all();
    return rows.filter(m => { try { manageable(user, m.team_id); return true; } catch { return false; } });
  },
  decideChangeRequest({ user, params, body }) {
    const m = db.prepare('SELECT * FROM membership_requests WHERE id=?').get(Number(params.id)) ?? fail(404, 'Request not found');
    const t = manageable(user, m.team_id);
    if (m.status !== 'pending') fail(409, 'This request has already been decided');
    if (body.approve) {
      inTx(() => {
        if (m.kind === 'add') addMember(t, m.user_id, { actor: user.id, bypassLock: true });
        else if (m.kind === 'leader') setLeader(t, m.user_id, user.id, { bypassLock: true });
        else {
          const mem = db.prepare('SELECT role FROM team_members WHERE team_id=? AND user_id=? AND left_at IS NULL').get(t.id, m.user_id);
          if (mem?.role === 'leader' && sizeOf(t.id) > 1) fail(409, 'Assign another team leader first');
          removeMember(t, m.user_id, { actor: user.id, action: m.kind === 'leave' ? 'left' : 'removed', bypassLock: true });
        }
        db.prepare("UPDATE membership_requests SET status='approved',decided_by=?,decided_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id, m.id);
      });
      notify(m.requested_by, 'n.change.approved', { team: t.name });
      if (m.user_id !== m.requested_by) notify(m.user_id, m.kind === 'add' ? 'n.team' : 'n.change.approved', { team: t.name, name: t.name });
    } else {
      db.prepare("UPDATE membership_requests SET status='rejected',decided_by=?,decided_at=CURRENT_TIMESTAMP WHERE id=?").run(user.id, m.id);
      notify(m.requested_by, 'n.change.rejected', { team: t.name });
    }
    audit(user, body.approve ? 'team.change_approved' : 'team.change_rejected', { detail: { team: t.id, request: m.id, kind: m.kind } });
    return { status: body.approve ? 'approved' : 'rejected' };
  },

  // ---------- Student dashboard ----------
  studentDashboard({ user }) {
    const teams = db.prepare('SELECT t.* FROM team_members tm JOIN teams t ON t.id=tm.team_id WHERE tm.user_id=? AND tm.left_at IS NULL').all(user.id).map(t => myTeamDetail(user, t));
    const courses = db.prepare('SELECT c.* FROM courses c JOIN enrollments e ON e.course_id=c.id WHERE e.user_id=? ORDER BY c.name').all(user.id);
    const researchRows = db.prepare(`SELECT r.* FROM research r WHERE r.student_id=? OR r.team_id IN (SELECT team_id FROM team_members WHERE user_id=? AND left_at IS NULL) ORDER BY r.id DESC`).all(user.id, user.id);
    const reviews = db.prepare(`SELECT v.decision,v.comment,v.created_at,u.name AS reviewer FROM topic_reviews v JOIN users u ON u.id=v.reviewer_id WHERE v.research_id=? ORDER BY v.id DESC LIMIT 5`);
    const research = researchRows.map(r => {
      const st = stageHandlers.researchStages({ user, params: { id: r.id } });
      const g = db.prepare('SELECT score,comment FROM research_grades WHERE research_id=? AND published=1').get(r.id);
      const team = r.team_id ? teams.find(t => t.id === r.team_id) ?? null : null;
      return {
        id: r.id, title: r.title, description: r.description, problem: r.problem, objectives: r.objectives, status: r.status, rejection_reason: r.rejection_reason, course_id: r.course_id,
        course: courses.find(c => c.id === r.course_id)?.name, supervisor: nameOf(r.supervisor_id), team: team ? { id: team.id, name: team.name, my_role: team.my_role } : null,
        i_am_leader: r.team_id ? isLeader(user.id, r.team_id) : r.student_id === user.id, topic_feedback: reviews.all(r.id),
        progress: { approved: st.totals.approved, total: st.totals.stages, percent: st.totals.stages ? Math.round(st.totals.approved / st.totals.stages * 1000) / 10 : null },
        totals: st.totals, final_grade: g?.score ?? null, final_grade_comment: g?.comment ?? null, stages: st.stages,
      };
    });
    const upcoming = research.filter(r => r.status === 'approved').flatMap(r => r.stages.filter(s => s.stage.deadline && s.stage.deadline >= today() && !['approved'].includes(s.status) && s.stage.state !== 'closed')
      .map(s => ({ research_id: r.id, research: r.title, stage_id: s.stage.id, stage: s.stage.name, deadline: s.stage.deadline, display_status: s.display_status }))).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 10);
    const leaderTeamIds = teams.filter(t => t.my_role === 'leader').map(t => t.id);
    const joinRequestsForMe = leaderTeamIds.length ? db.prepare(`SELECT j.id,j.message,j.created_at,u.name,u.university_id,t.name AS team,t.id AS team_id FROM join_requests j JOIN users u ON u.id=j.user_id JOIN teams t ON t.id=j.team_id
      WHERE j.status='pending' AND j.team_id IN (${leaderTeamIds.map(() => '?').join(',')})`).all(...leaderTeamIds) : [];
    const messages = db.prepare(`SELECT m.id,m.kind,m.body,m.created_at,u.name AS sender,m.stage_id FROM messages m JOIN users u ON u.id=m.sender_id
      WHERE m.sender_id<>? AND (m.student_id=? OR m.team_id IN (SELECT team_id FROM team_members WHERE user_id=? AND left_at IS NULL)) ORDER BY m.id DESC LIMIT 5`).all(user.id, user.id, user.id);
    return {
      student: { name: user.name, university_id: user.university_id }, courses: courses.map(c => ({ id: c.id, name: c.name, team_mode: c.team_mode, min_team_size: c.min_team_size, max_team_size: c.max_team_size, teams_locked: !!c.teams_locked })),
      teams, research, upcoming, messages,
      invitations: studentTeamHandlers.listInvitations({ user }).filter(i => i.status === 'pending'),
      join_requests: studentTeamHandlers.myJoinRequests({ user }).filter(j => j.status === 'pending'), join_requests_for_leader: joinRequestsForMe,
      notifications: db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 8').all(user.id),
    };
  },
};

function notifySupervisors(team, key, params) {
  const sup = db.prepare('SELECT DISTINCT supervisor_id AS id FROM research WHERE team_id=?').all(team.id).map(x => x.id);
  if (team.created_by && db.prepare("SELECT 1 FROM users WHERE id=? AND role='supervisor'").get(team.created_by)) sup.push(team.created_by);
  for (const id of new Set(sup)) notify(id, key, params);
  if (!sup.length) for (const a of db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all()) notify(a.id, key, params);
}
