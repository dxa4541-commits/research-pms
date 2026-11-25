// Deadline watcher: "deadline approaching" (within 2 days) and "submission late" notifications for open stages.
// Each (stage, research, kind, deadline) fires once; changing the deadline re-arms it.
import { db } from './db.js';
import { notify, notifyParties } from './notifications.js';
import { targets, today } from './stages.js';

const WARN_DAYS = 2;
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function checkDeadlines() {
  const now = today(), soon = addDays(now, WARN_DAYS);
  const rows = targets("st.state='open' AND st.deadline IS NOT NULL AND (st.start_date IS NULL OR st.start_date<=date('now'))").filter(r => r.missing);
  const mark = db.prepare('INSERT OR IGNORE INTO deadline_events (stage_id,research_id,kind,deadline) VALUES (?,?,?,?)');
  let sent = 0;
  for (const r of rows) {
    const kind = r.deadline < now ? 'late' : r.deadline <= soon ? 'approaching' : null;
    if (!kind || mark.run(r.stage_id, r.research_id, kind, r.deadline).changes === 0) continue;
    const research = db.prepare('SELECT * FROM research WHERE id=?').get(r.research_id);
    const p = { stage: r.stage_name, title: r.title, who: r.team ?? r.student, date: r.deadline };
    notify(r.supervisor_id, kind === 'late' ? 'n.deadline.late' : 'n.deadline.soon', p, r.research_id);
    notifyParties(research, kind === 'late' ? 'n.deadline.late.own' : 'n.deadline.soon.own', p);
    sent++;
  }
  return sent;
}
