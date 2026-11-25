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
