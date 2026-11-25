// Deadline watcher: "deadline approaching" (within 2 days) and "submission late" notifications for open stages.
// Each (stage, research, kind, deadline) fires once; changing the deadline re-arms it.
import { db } from './db.js';
import { notify, notifyParties } from './notifications.js';
import { targets, today } from './stages.js';

const WARN_DAYS = 2;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// Runs inside the caller's transaction when there is one (API requests), otherwise in its own.
export function checkDeadlines() {
  return db.tx(async () => {
    const now = today(), soon = addDays(now, WARN_DAYS);
    const rows = (await targets("st.state='open' AND st.deadline IS NOT NULL AND (st.start_date IS NULL OR st.start_date<=utc_today())")).filter(r => r.missing);
    const mark = db.prepare('INSERT INTO deadline_events (stage_id,research_id,kind,deadline) VALUES (?,?,?,?) ON CONFLICT DO NOTHING');
    let sent = 0;
    for (const r of rows) {
      const kind = r.deadline < now ? 'late' : r.deadline <= soon ? 'approaching' : null;
      if (!kind || (await mark.run(r.stage_id, r.research_id, kind, r.deadline)).changes === 0) continue;
      const research = await db.prepare('SELECT * FROM research WHERE id=?').get(r.research_id);
      const p = { stage: r.stage_name, title: r.title, who: r.team ?? r.student, date: r.deadline };
      await notify(r.supervisor_id, kind === 'late' ? 'n.deadline.late' : 'n.deadline.soon', p, r.research_id);
      await notifyParties(research, kind === 'late' ? 'n.deadline.late.own' : 'n.deadline.soon.own', p);
      sent++;
    }
    return sent;
  });
}
