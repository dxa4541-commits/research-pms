// Supervisor use cases: Approve / reject, Request changes, Review version & add notes, Grade submission.
import { db } from '../db.js';
import { fail, str, need } from '../errors.js';
import { notify } from '../notifications.js';
import { updateStatus, addNoteToLatest, accessible, own } from '../research.js';

export const reviewHandlers = {
  // Supervisor: Approve / reject proposal
  approve({ user, params, body }) {
    const r = own(accessible(user, Number(params.id)), user);
    const status = { approve: 'approved', reject: 'rejected' }[body.decision] ?? fail(400, 'decision must be approve or reject');
    const comment = str(body.comment, 1000);
    updateStatus(r, status);
    if (comment) addNoteToLatest(r, user, comment);
    notify(r.student_id, 'n.' + status, { title: r.title, comment: comment ?? '' }, r.id);
    return { status };
  },
  // Supervisor: Request changes («extend» of Approve / reject proposal)
  requestChanges({ user, params, body }) {
    const r = own(accessible(user, Number(params.id)), user);
    const comment = str(body.comment, 1000) ?? fail(400, 'Please describe the requested changes');
    updateStatus(r, 'changes_requested');
    addNoteToLatest(r, user, comment);
    notify(r.student_id, 'n.changes_requested', { title: r.title, comment }, r.id);
    return { status: 'changes_requested' };
  },

  // Supervisor: Review version & add notes (includes Send notification)
  addNote({ user, params, body }) {
    const s = db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(params.id)) ?? fail(404, 'Submission not found');
    const r = own(accessible(user, s.research_id), user);
    const text = need(body.text, 'Note', 2000);
    db.prepare('INSERT INTO notes (submission_id,author_id,text) VALUES (?,?,?)').run(s.id, user.id, text);
    notify(r.student_id, 'n.note', { n: s.version_no, title: r.title }, r.id);
    return { ok: true };
  },

  // Supervisor: Grade submission (the grade belongs to the research: grade 1-1 Research)
  grade({ user, params, body }) {
    const r = own(accessible(user, Number(params.id)), user);
    const score = Number(body.score);
    if (body.score === '' || body.score == null || !Number.isFinite(score) || score < 0 || score > 100)
      fail(400, 'Score must be a number between 0 and 100');
    db.prepare(`INSERT INTO research_grades (research_id,score) VALUES (?,?)
      ON CONFLICT(research_id) DO UPDATE SET score=excluded.score`).run(r.id, score);
    notify(r.student_id, 'n.graded', { title: r.title, score }, r.id);
    return { score };
  },
};
