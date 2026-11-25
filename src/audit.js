// Append-only history of important actions (grades, reviews, stage changes, messages...). Never updated or deleted.
import { db } from './db.js';

export async function audit(user, action, { researchId = null, stageId = null, detail = null } = {}) {
  await db.prepare('INSERT INTO audit_log (actor_id,action,research_id,stage_id,detail) VALUES (?,?,?,?,?)')
    .run(user?.id ?? null, action, researchId, stageId, detail == null ? null : JSON.stringify(detail));
}
