// Supervisor use cases: Approve / reject, Request changes, Review version & add notes, Grade submission.
import { db } from '../db.js';
import { fail, str, need } from '../errors.js';
import { notifyParties } from '../notifications.js';
import { updateStatus, addNoteToLatest, accessible, own } from '../research.js';
import { autoAssign } from '../stages.js';
import { audit } from '../audit.js';

export const reviewHandlers = {
  // Supervisor: Approve / reject proposal (a rejection needs a reason)
  approve({ user, params, body }) {
    const r = own(accessible(user, Number(params.id)), user);
    const status = { approve: 'approved', reject: 'rejected' }[body.decision] ?? fail(400, 'decision must be approve or reject');
    const comment = str(body.comment, 1000);
    if (status === 'rejected' && !comment) fail(400, 'A rejection reason is required');
    updateStatus(r, status);
    db.prepare('UPDATE research SET rejection_reason=? WHERE id=?').run(status === 'rejected' ? comment : null, r.id);
    if (comment) addNoteToLatest(r, user, comment);
    if (status === 'approved') autoAssign(r);
    notifyParties(r, 'n.' + status, { title: r.title, comment: comment ?? '' });
    audit(user, `topic.${status}`, { researchId: r.id, detail: { comment } });
    return { status };
  },
  // Supervisor: Request changes («extend» of Approve / reject proposal)
  requestChanges({ user, params, body }) {
    const r = own(accessible(user, Number(params.id)), user);
    const comment = str(body.comment, 1000) ?? fail(400, 'Please describe the requested changes');
    updateStatus(r, 'changes_requested');
    addNoteToLatest(r, user, comment);
    notifyParties(r, 'n.changes_requested', { title: r.title, comment });
    audit(user, 'topic.changes_requested', { researchId: r.id, detail: { comment } });
    return { status: 'changes_requested' };
  },

  // Supervisor: Review version & add notes (includes Send notification)
  addNote({ user, params, body }) {
    const s = db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(params.id)) ?? fail(404, 'Submission not found');
    const r = own(accessible(user, s.research_id), user);
    const text = need(body.text, 'Note', 2000);
    db.prepare('INSERT INTO notes (submission_id,author_id,text) VALUES (?,?,?)').run(s.id, user.id, text);
    notifyParties(r, 'n.note', { n: s.version_no, title: r.title });
    audit(user, 'topic.note', { researchId: r.id, detail: { version: s.version_no, text } });
    return { ok: true };
  },

  // Supervisor: final research grade 0-100 (the grade belongs to the research: grade 1-1 Research); updates are kept in the history.
  grade({ user, params, body }) {
    const r = own(accessible(user, Number(params.id)), user);
    const score = Number(body.score);
    if (body.score === '' || body.score == null || !Number.isFinite(score) || score < 0 || score > 100)
      fail(400, 'Score must be a number between 0 and 100');
    const before = db.prepare('SELECT score FROM research_grades WHERE research_id=?').get(r.id)?.score ?? null;
    const comment = str(body.comment, 2000);
    db.prepare(`INSERT INTO research_grades (research_id,score,comment,updated_at) VALUES (?,?,?,CURRENT_TIMESTAMP)
      ON CONFLICT(research_id) DO UPDATE SET score=excluded.score, comment=excluded.comment, updated_at=CURRENT_TIMESTAMP`).run(r.id, score, comment);
    notifyParties(r, 'n.graded', { title: r.title, score });
    audit(user, before == null ? 'final.graded' : 'final.grade_updated', { researchId: r.id, detail: { from: before, to: score, comment } });
    return { score };
  },
};
