// Internal messaging: private threads between a supervisor and one team (or one individual student).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { fail, need } from '../errors.js';
import { UPLOAD_DIR, checkFile, storeFile, removeFile } from '../files.js';
import { audit } from '../audit.js';
import { isMember, memberIds } from '../teams.js';
import { addMessage, targetOf, targetMembers, targetName, notifyMessage, preview } from '../messages.js';

const MSG_SQL = `SELECT m.id,m.kind,m.body,m.created_at,m.sender_id,u.name AS sender,m.stage_id,st.name AS stage,m.submission_id,
    m.filename,m.size,m.supervisor_id,m.team_id,m.student_id
  FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN stages st ON st.id=m.stage_id`;

// Which (team|student) threads may this user see? Supervisor: only their own; student: their team and themselves.
function mayAccess(user, m) {
  if (user.role === 'supervisor') return m.supervisor_id === user.id;
  if (user.role === 'student') return (!!m.team_id && isMember(user.id, m.team_id)) || m.student_id === user.id;
  return false; // admin has no access to private team messages
}
// Teams/students this supervisor works with: those with assigned research, plus teams they created.
function supervisorTargets(supId) {
  const out = new Map();
  for (const r of db.prepare('SELECT * FROM research WHERE supervisor_id=?').all(supId)) {
    const t = targetOf(r); const k = t.team_id ? `t${t.team_id}` : `s${t.student_id}`; if (!out.has(k)) out.set(k, { ...t, research_id: r.id });
  }
  for (const t of db.prepare('SELECT id FROM teams WHERE created_by=?').all(supId)) out.set(`t${t.id}`, { team_id: t.id, student_id: null });
  return out;
}
const keyOf = t => t.team_id ? `t${t.team_id}` : `s${t.student_id}`;
function parseTarget(q) {
  if (q.get('team')) return { team_id: Number(q.get('team')), student_id: null };
  if (q.get('student')) return { team_id: null, student_id: Number(q.get('student')) };
  return fail(400, 'team or student is required');
}
// A student's conversations: one per (supervisor, team|self) pair found in the research they may access.
function studentTargets(user) {
  const out = new Map();
  const rows = db.prepare(`SELECT supervisor_id,team_id,student_id FROM research WHERE student_id=?
    OR team_id IN (SELECT team_id FROM team_members WHERE user_id=? AND left_at IS NULL)`).all(user.id, user.id);
  for (const r of rows) {
    const t = r.team_id ? { team_id: r.team_id, student_id: null } : { team_id: null, student_id: user.id };
    out.set(`${r.supervisor_id}:${keyOf(t)}`, { supervisor_id: r.supervisor_id, ...t });
  }
  return out;
}
function attachment(body) {
  if (!body.filename && !body.data) return null;
  const { buf } = checkFile(body.filename, body.data);
  return { ...storeFile(body.filename, buf), size: buf.length };
}
function linkChecks(supId, target, body) {
  let stageId = null, submissionId = null;
  if (body.stageId) {
    const st = db.prepare('SELECT * FROM stages WHERE id=? AND supervisor_id=?').get(Number(body.stageId), supId) ?? fail(404, 'Stage not found');
    stageId = st.id;
  }
  if (body.submissionId) {
    const s = db.prepare(`SELECT s.*, r.team_id, r.student_id AS rs, r.supervisor_id AS sup FROM stage_submissions s JOIN research r ON r.id=s.research_id WHERE s.id=?`).get(Number(body.submissionId)) ?? fail(404, 'Submission not found');
    const same = target.team_id ? s.team_id === target.team_id : (!s.team_id && s.rs === target.student_id);
    if (s.sup !== supId || !same) fail(403, 'That submission does not belong to this conversation');
    submissionId = s.id; stageId = stageId ?? s.stage_id;
  }
  return { stageId, submissionId };
}

export const messageHandlers = {
  // Conversations list. Supervisor: one per team/student they work with. Student: one per supervisor.
  listThreads({ user }) {
    const lastOf = (sup, target) => db.prepare(`${MSG_SQL} WHERE m.supervisor_id=? AND (${target.team_id ? 'm.team_id=?' : 'm.student_id=?'}) ORDER BY m.id DESC LIMIT 1`).get(sup, target.team_id ?? target.student_id) ?? null;
    const membersOf = target => target.team_id ? memberIds(target.team_id).map(id => db.prepare('SELECT name FROM users WHERE id=?').get(id).name)
      : [db.prepare('SELECT name FROM users WHERE id=?').get(target.student_id).name];
    if (user.role === 'student') {
      return [...studentTargets(user).values()].map(t => ({
        key: `${t.supervisor_id}:${keyOf(t)}`, supervisor_id: t.supervisor_id, team_id: t.team_id, student_id: t.student_id,
        name: db.prepare('SELECT name FROM users WHERE id=?').get(t.supervisor_id).name, team: targetName(t), members: membersOf(t), last: lastOf(t.supervisor_id, t),
      })).sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));
    }
    const out = [];
    for (const [key, target] of supervisorTargets(user.id))
      out.push({ key, research_id: target.research_id ?? null, team_id: target.team_id, student_id: target.student_id, name: targetName(target), members: membersOf(target), last: lastOf(user.id, target) });
    return out.sort((a, b) => (b.last?.id ?? 0) - (a.last?.id ?? 0));
  },
  // Messages of one conversation. Supervisor passes ?team=ID or ?student=ID; a student also passes ?supervisor=ID.
  listMessages({ user, query }) {
    let sup, target;
    if (user.role === 'supervisor') { sup = user.id; target = parseTarget(query); if (!supervisorTargets(user.id).has(keyOf(target))) fail(403, 'Not your conversation'); }
    else {
      sup = Number(query.get('supervisor')); target = query.get('team') || query.get('student') ? parseTarget(query) : null;
      const mine = studentTargets(user);
      if (!target) { const only = [...mine.values()].filter(t => t.supervisor_id === sup); if (only.length !== 1) fail(403, 'Not your conversation'); target = only[0]; }
      if (!mine.has(`${sup}:${keyOf(target)}`)) fail(403, 'Not your conversation');
    }
    const rows = db.prepare(`${MSG_SQL} WHERE m.supervisor_id=? AND ${target.team_id ? 'm.team_id=?' : 'm.student_id=?'} ORDER BY m.id`).all(sup, target.team_id ?? target.student_id);
    return rows.filter(m => mayAccess(user, m));
  },
  // Send a message. Supervisor: {teamId|studentId, ...}. Student: {supervisorId, teamId|studentId?, ...} (only to their own teams/self).
  sendMessage({ user, body }) {
    const text = need(body.body, 'Message', 4000);
    let sup, target;
    if (user.role === 'supervisor') {
      sup = user.id;
      target = body.teamId ? { team_id: Number(body.teamId), student_id: null } : body.studentId ? { team_id: null, student_id: Number(body.studentId) } : fail(400, 'Choose a team or student');
      if (!supervisorTargets(user.id).has(keyOf(target))) fail(403, 'Not your conversation');
    } else {
      const mine = [...studentTargets(user).values()];
      if (!mine.length) fail(403, 'Not your supervisor');
      const pick = mine.filter(t => (!body.supervisorId || t.supervisor_id === Number(body.supervisorId)) && (!body.teamId || t.team_id === Number(body.teamId)) && (!body.studentId || t.student_id === Number(body.studentId)));
      if (pick.length > 1) fail(400, 'Choose a supervisor');
      if (!pick.length) fail(403, 'Not your supervisor');
      sup = pick[0].supervisor_id; target = { team_id: pick[0].team_id, student_id: pick[0].student_id };
    }
    const links = user.role === 'supervisor' ? linkChecks(sup, target, body) : { stageId: null, submissionId: null };
    const file = attachment(body);
    let id;
    try { id = addMessage({ supervisorId: sup, target, senderId: user.id, body: text, ...links, file }); }
    catch (e) { if (file) removeFile(file.path); throw e; }
    notifyMessage({ sender: user, supervisorId: sup, target, kind: 'message', preview: preview(text) });
    audit(user, 'message.sent', { detail: { id, to: keyOf(target) } });
    return { id };
  },
  // Supervisor: one private copy per selected team/student, or to every team/student they supervise ({all:true}).
  announce({ user, body }) {
    const text = need(body.body, 'Message', 4000);
    const all = supervisorTargets(user.id);
    const keys = body.all ? [...all.keys()] : (Array.isArray(body.targets) ? body.targets.map(String) : fail(400, 'Choose at least one team or student'));
    if (!keys.length) fail(400, 'Choose at least one team or student');
    if (keys.some(k => !all.has(k))) fail(403, 'Not your conversation');
    const links = linkChecks(user.id, { team_id: null, student_id: -1 }, { stageId: body.stageId });
    const kind = body.kind === 'reminder' ? 'reminder' : 'announcement';
    const file = attachment(body);
    try {
      for (const k of keys) {
        const target = all.get(k);
        // each target gets its own row (and its own copy of the file reference) so threads stay private
        addMessage({ supervisorId: user.id, target, senderId: user.id, kind, body: text, stageId: links.stageId, file });
        notifyMessage({ sender: user, supervisorId: user.id, target, kind, preview: preview(text) });
      }
    } catch (e) { if (file) removeFile(file.path); throw e; }
    audit(user, `message.${kind}`, { stageId: links.stageId, detail: { targets: keys } });
    return { sent: keys.length };
  },
  downloadMessageFile({ user, params }) {
    const m = db.prepare('SELECT * FROM messages WHERE id=?').get(Number(params.id)) ?? fail(404, 'File not found');
    if (!m.stored_name || !mayAccess(user, m)) fail(m.stored_name ? 403 : 404, m.stored_name ? 'Not allowed' : 'File not found');
    const p = join(UPLOAD_DIR, m.stored_name);
    if (!existsSync(p)) fail(404, 'File missing on disk');
    return { file: readFileSync(p), filename: m.filename };
  },
};
