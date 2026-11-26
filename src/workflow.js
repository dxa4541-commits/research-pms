// Research workflow: what happens automatically between "proposal approved" and "research completed".
//
//   proposal approved ──► every stage of the instructor's course is queued for the research ('locked'),
//                         the first one is activated (its own deadline, team notified)
//   stage approved    ──► that stage is completed, the next queued stage is activated
//   last stage done   ──► the team and the instructor are told the research workflow is complete
//
// Instructors switch the automatic start off in their settings (then approval only attaches "assign to all" stages,
// as before). What a rejected stage submission does is their rejection policy.
import { db } from './db.js';
import { fail } from './errors.js';
import { notify, notifyParties } from './notifications.js';
import { audit } from './audit.js';
import { dueFor } from './stages.js';

export const REJECT_POLICIES = ['resubmit', 'stop', 'advance'];
const DEFAULTS = { auto_first_stage: true, reject_policy: 'resubmit' };

export async function settingsFor(supervisorId) {
  const s = await db.prepare('SELECT * FROM supervisor_settings WHERE user_id=?').get(supervisorId);
  return s ? { auto_first_stage: !!s.auto_first_stage, reject_policy: s.reject_policy } : { ...DEFAULTS };
}
export async function saveSettings(user, body) {
  const cur = await settingsFor(user.id);
  const auto = body.autoFirstStage === undefined ? cur.auto_first_stage : !!body.autoFirstStage;
  const policy = body.rejectPolicy === undefined ? cur.reject_policy : body.rejectPolicy;
  if (!REJECT_POLICIES.includes(policy)) fail(400, 'Rejection policy must be resubmit, stop or advance');
  await db.prepare(`INSERT INTO supervisor_settings (user_id,auto_first_stage,reject_policy,updated_at) VALUES (?,?,?,utc_now())
    ON CONFLICT (user_id) DO UPDATE SET auto_first_stage=excluded.auto_first_stage, reject_policy=excluded.reject_policy, updated_at=utc_now()`)
    .run(user.id, auto ? 1 : 0, policy);
  await audit(user, 'settings.workflow', { detail: { auto_first_stage: auto, reject_policy: policy } });
  return { auto_first_stage: auto, reject_policy: policy };
}

// Legacy behaviour (automatic start switched off): attach every "assign to all" stage of the supervisor/course.
async function attachAssignAll(research) {
  const stages = await db.prepare('SELECT * FROM stages WHERE supervisor_id=? AND course_id=? AND assign_all=1 ORDER BY position, id').all(research.supervisor_id, research.course_id);
  for (const s of stages) {
    const r = await db.prepare('INSERT INTO stage_targets (stage_id,research_id) VALUES (?,?) ON CONFLICT DO NOTHING').run(s.id, research.id);
    if (r.changes) await notifyParties(research, 'n.stage.assigned', { stage: s.name, title: research.title, date: s.deadline ?? '—' });
  }
}

// Called when a proposal is approved. Idempotent: approving an already running research changes nothing.
export async function startWorkflow(research, actor) {
  const r = await db.prepare('SELECT * FROM research WHERE id=?').get(research.id);
  if (r.workflow_started_at) return { started: false };
  const settings = await settingsFor(r.supervisor_id);
  if (!settings.auto_first_stage) { await attachAssignAll(r); return { started: false }; }
  await db.prepare('UPDATE research SET workflow_started_at=utc_now() WHERE id=?').run(r.id);
  r.workflow_started_at = 'now';
  const stages = await db.prepare('SELECT * FROM stages WHERE supervisor_id=? AND course_id=? ORDER BY position, id').all(r.supervisor_id, r.course_id);
  // stages that were assigned by hand before approval cannot exist (only approved research is assignable), so all start queued
  for (const s of stages) await db.prepare("INSERT INTO stage_targets (stage_id,research_id,phase) VALUES (?,?,'locked') ON CONFLICT DO NOTHING").run(s.id, r.id);
  await audit(actor, 'workflow.started', { researchId: r.id, detail: { stages: stages.length } });
  if (!stages.length) { await notify(r.supervisor_id, 'n.workflow.noStages', { title: r.title }, r.id); return { started: true, first: null }; }
  const first = await activateNext(r, actor);
  return { started: true, first: first?.name ?? null };
}

// Activates the next queued stage of the research (in stage order) unless one is already active.
// With nothing left to do, the research workflow is complete.
export async function activateNext(research, actor) {
  if (await db.prepare("SELECT 1 FROM stage_targets WHERE research_id=? AND phase='active'").get(research.id)) return null;
  const next = await db.prepare(`SELECT s.* FROM stage_targets t JOIN stages s ON s.id=t.stage_id
    WHERE t.research_id=? AND t.phase='locked' ORDER BY s.position, s.id LIMIT 1`).get(research.id);
  if (!next) {
    const left = await db.prepare("SELECT COUNT(*) AS n FROM stage_targets WHERE research_id=? AND phase NOT IN ('completed')").get(research.id);
    if (research.workflow_started_at && left.n === 0 && await db.prepare('SELECT 1 FROM stage_targets WHERE research_id=?').get(research.id)) {
      await notifyParties(research, 'n.workflow.done', { title: research.title });
      await notify(research.supervisor_id, 'n.workflow.doneSup', { title: research.title }, research.id);
      await audit(actor, 'workflow.completed', { researchId: research.id });
    }
    return null;
  }
  const due = dueFor(next);
  await db.prepare("UPDATE stage_targets SET phase='active', activated_at=utc_now(), due_date=? WHERE stage_id=? AND research_id=?").run(due, next.id, research.id);
  await notifyParties(research, 'n.stage.activated', { stage: next.name, title: research.title, date: due ?? next.deadline ?? '—' });
  await audit(actor, 'workflow.stage_activated', { researchId: research.id, stageId: next.id, detail: { deadline: due ?? next.deadline } });
  return next;
}

// Ends the research's work on a stage: 'completed' (approved / moved on) or 'closed' (stopped by a rejection).
export async function finishTarget(stage, research, actor, phase) {
  await db.prepare('UPDATE stage_targets SET phase=?, completed_at=utc_now() WHERE stage_id=? AND research_id=?').run(phase, stage.id, research.id);
  await audit(actor, phase === 'completed' ? 'workflow.stage_completed' : 'workflow.stage_closed', { researchId: research.id, stageId: stage.id });
}
