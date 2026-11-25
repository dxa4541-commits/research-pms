// Message model: private threads between one supervisor and one team (or one individual student).
import { db } from './db.js';
import { notify } from './notifications.js';

// A research belongs to a team when it has one, otherwise to the individual student.
export const targetOf = r => r.team_id ? { team_id: r.team_id, student_id: null } : { team_id: null, student_id: r.student_id };

export function addMessage({ supervisorId, target, senderId, kind = 'message', body, stageId = null, submissionId = null, file = null }) {
  const r = db.prepare(`INSERT INTO messages (supervisor_id,team_id,student_id,sender_id,kind,body,stage_id,submission_id,filename,stored_name,size)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(supervisorId, target.team_id, target.student_id, senderId, kind, body, stageId, submissionId,
    file?.safeName ?? null, file?.stored ?? null, file?.size ?? null);
  return Number(r.lastInsertRowid);
}
export function targetMembers(target) {
  return target.team_id ? db.prepare('SELECT user_id FROM team_members WHERE team_id=? AND left_at IS NULL').all(target.team_id).map(x => x.user_id) : [target.student_id];
}
export function targetName(target) {
  return target.team_id ? db.prepare('SELECT name FROM teams WHERE id=?').get(target.team_id)?.name
    : db.prepare('SELECT name FROM users WHERE id=?').get(target.student_id)?.name;
}
// Notify the other side of a message: team members/student when the supervisor wrote, the supervisor otherwise.
export function notifyMessage({ sender, supervisorId, target, kind, stageId, preview }) {
  const key = kind === 'reminder' ? 'n.reminder' : kind === 'announcement' ? 'n.announcement' : 'n.message';
  if (sender.id === supervisorId) {
    for (const id of targetMembers(target)) if (id !== sender.id) notify(id, key, { from: sender.name, text: preview });
  } else notify(supervisorId, 'n.message.in', { from: sender.name, team: targetName(target) ?? '', text: preview });
}
export const preview = s => s.length > 80 ? s.slice(0, 77) + '…' : s;
