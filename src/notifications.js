// Send notification — «include» of Review version & add notes.
import { db } from './db.js';

// Send notification — «include» of Review version & add notes
// Stored as {k: key, p: params} so each user sees it in their own language.
export function notify(userId, key, params = {}, researchId = null) {
  db.prepare('INSERT INTO notifications (user_id,message,research_id) VALUES (?,?,?)')
    .run(userId, JSON.stringify({ k: key, p: params }), researchId);
}

// Sequence diagram step: notifySupervisor()
export function notifySupervisor(research, key, params) { notify(research.supervisor_id, key, params, research.id); }

// Everyone who works on a research: the registering student plus all members of its team.
export function parties(research) {
  const ids = new Set([research.student_id]);
  if (research.team_id) for (const m of db.prepare('SELECT user_id FROM team_members WHERE team_id=? AND left_at IS NULL').all(research.team_id)) ids.add(m.user_id);
  return [...ids];
}
export function notifyParties(research, key, params = {}) { for (const id of parties(research)) notify(id, key, params, research.id); }
