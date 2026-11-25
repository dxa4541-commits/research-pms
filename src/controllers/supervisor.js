// Supervisor dashboard, progress reports (+CSV export) and action history.
import { db } from '../db.js';
import { fail } from '../errors.js';
import { listFor, getResearch } from '../research.js';
import { today, targets, stageTotals, getStage } from '../stages.js';
import { checkDeadlines } from '../deadlines.js';

const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const label = r => r.team ?? r.student;
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : null;

async function overview(supId) {
  const research = await listFor({ role: 'supervisor', id: supId });
  const rows = await targets('st.supervisor_id=?', supId);
  return { research, rows };
}

export const supervisorHandlers = {
  async dashboard({ user }) {
    await checkDeadlines();
    const { research, rows } = await overview(user.id);
    const teams = new Set(research.filter(r => r.team).map(r => r.team));
    for (const t of await db.prepare('SELECT name FROM teams WHERE created_by=?').all(user.id)) teams.add(t.name);
    const now = today(), horizon = addDays(now, 14);
    const upcoming = (await db.prepare(`SELECT id,name,deadline,state FROM stages WHERE supervisor_id=? AND state IN ('open','scheduled','postponed')
      AND deadline IS NOT NULL AND deadline>=? AND deadline<=? ORDER BY deadline`).all(user.id, now, horizon))
      .map(s => ({ ...s, missing: rows.filter(r => r.stage_id === s.id && r.missing).length, assigned: rows.filter(r => r.stage_id === s.id).length }));
    const recent = await db.prepare(`SELECT m.id,m.body,m.kind,m.created_at,m.team_id,m.student_id,u.name AS sender,m.sender_id,
        COALESCE(t.name, s.name) AS "with"
      FROM messages m JOIN users u ON u.id=m.sender_id LEFT JOIN teams t ON t.id=m.team_id LEFT JOIN users s ON s.id=m.student_id
      WHERE m.supervisor_id=? ORDER BY m.id DESC LIMIT 5`).all(user.id);
    const approvedT = rows.filter(r => r.status === 'approved').length;
    const graded = rows.filter(r => r.score != null);
    return {
      totals: {
        research: research.length, teams: teams.size,
        topics_pending: research.filter(r => r.status === 'pending').length,
        awaiting_review: rows.filter(r => r.pending_review).length,
        approved: approvedT,
        needs_changes: rows.filter(r => r.status === 'changes_requested').length,
        late: rows.filter(r => r.late).length,
        stages: (await db.prepare('SELECT COUNT(*) AS n FROM stages WHERE supervisor_id=?').get(user.id)).n,
      },
      progress: {
        completion_percent: pct(approvedT, rows.length),
        avg_stage_percent: graded.length ? Math.round(graded.reduce((a, r) => a + r.score / r.max_grade, 0) / graded.length * 1000) / 10 : null,
        byStatus: ['pending', 'approved', 'changes_requested', 'rejected'].map(s => ({ status: s, n: research.filter(r => r.status === s).length })),
      },
      upcoming, recent_messages: recent,
      awaiting: rows.filter(r => r.pending_review).slice(0, 10).map(r => ({ stage_id: r.stage_id, stage: r.stage_name, research_id: r.research_id, label: label(r), submitted_at: r.submitted_at, late: r.sub_late })),
    };
  },

  async supervisorReport({ user }) {
    await checkDeadlines();
    return buildReport(user.id);
  },
  async exportReport({ user }) {
    const rep = await buildReport(user.id);
    const csv = [];
    const row = a => csv.push(a.map(v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(','));
    row(['Research progress']);
    row(['Title', 'Student/Team', 'Status', 'Stages', 'Approved stages', 'Missing', 'Late', 'Earned', 'Max', 'Percent', 'Final grade']);
    for (const r of rep.research) row([r.title, r.label, r.status, r.stages, r.approved, r.missing, r.late, r.earned, r.total_max, r.percent, r.final_grade]);
    csv.push(''); row(['Stage statistics']);
    row(['Stage', 'Course', 'Deadline', 'State', 'Assigned', 'Submitted', 'Approved', 'Changes requested', 'Rejected', 'Missing', 'Late', 'Average score', 'Max']);
    for (const s of rep.stages) row([s.name, s.course, s.deadline, s.state, s.assigned, s.submitted, s.approved, s.changes_requested, s.rejected, s.missing, s.late, s.avg_score, s.max_grade]);
    csv.push(''); row(['Not submitted / late']);
    row(['Stage', 'Student/Team', 'Research', 'Deadline', 'Late']);
    for (const m of rep.missing) row([m.stage, m.label, m.title, m.deadline, m.late ? 'yes' : '']);
    return { file: Buffer.from('﻿' + csv.join('\r\n'), 'utf8'), filename: 'supervisor-report.csv', contentType: 'text/csv; charset=utf-8' };
  },

  // Append-only history of a research / a stage (reviews, grades, state changes, messages).
  async researchHistory({ user, params }) {
    const r = await getResearch(Number(params.id));
    if (user.role !== 'admin' && r.supervisor_id !== user.id) fail(403, 'Not your research');
    return (await db.prepare(`SELECT a.id,a.action,a.stage_id,a.detail,a.created_at,u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id
      WHERE a.research_id=? ORDER BY a.id DESC LIMIT 500`).all(r.id)).map(x => ({ ...x, detail: x.detail ? JSON.parse(x.detail) : null }));
  },
  async stageHistory({ user, params }) {
    const s = await getStage(Number(params.id));
    if (user.role !== 'admin' && s.supervisor_id !== user.id) fail(403, 'Not your stage');
    return (await db.prepare(`SELECT a.id,a.action,a.research_id,a.detail,a.created_at,u.name AS actor FROM audit_log a LEFT JOIN users u ON u.id=a.actor_id
      WHERE a.stage_id=? ORDER BY a.id DESC LIMIT 500`).all(s.id)).map(x => ({ ...x, detail: x.detail ? JSON.parse(x.detail) : null }));
  },
};

async function buildReport(supId) {
  const { research, rows } = await overview(supId);
  const perResearch = [];
  for (const r of research) {
    const mine = rows.filter(x => x.research_id === r.id), t = await stageTotals(r.id);
    perResearch.push({
      id: r.id, title: r.title, label: r.team ?? r.student, student: r.student, team: r.team, status: r.status, final_grade: r.grade,
      stages: t.stages, approved: t.approved, graded: t.graded, earned: t.earned, total_max: t.total_max, percent: t.percent,
      missing: mine.filter(x => x.missing).length, late: mine.filter(x => x.late).length,
      progress_percent: pct(t.approved, t.stages),
    });
  }
  const stages = (await db.prepare(`SELECT s.*, c.name AS course FROM stages s JOIN courses c ON c.id=s.course_id WHERE s.supervisor_id=? ORDER BY s.position,s.id`).all(supId)).map(s => {
    const mine = rows.filter(x => x.stage_id === s.id), g = mine.filter(x => x.score != null);
    return {
      id: s.id, name: s.name, course: s.course, deadline: s.deadline, state: s.state, max_grade: s.max_grade,
      assigned: mine.length, submitted: mine.filter(x => !x.missing).length, approved: mine.filter(x => x.status === 'approved').length,
      changes_requested: mine.filter(x => x.status === 'changes_requested').length, rejected: mine.filter(x => x.status === 'rejected').length,
      pending_review: mine.filter(x => x.pending_review).length, missing: mine.filter(x => x.missing).length, late: mine.filter(x => x.late).length,
      graded: g.length, avg_score: g.length ? Math.round(g.reduce((a, x) => a + x.score, 0) / g.length * 10) / 10 : null,
    };
  });
  const missing = rows.filter(r => r.missing && (r.state === 'open' || r.late)).map(r => ({
    stage_id: r.stage_id, stage: r.stage_name, research_id: r.research_id, label: label(r), title: r.title, deadline: r.deadline, late: r.late }));
  const lateTeams = [...new Set(rows.filter(r => r.late).map(r => label(r)))];
  return { research: perResearch, stages, missing, late_teams: lateTeams };
}
