// Supervisor use cases: Approve / reject, Request changes, Review version & add notes, Grade submission.
import { db } from '../db.js';
import { fail, str, need } from '../errors.js';
import { notifyParties } from '../notifications.js';
import { updateStatus, addNoteToLatest, accessible, own } from '../research.js';
import { autoAssign } from '../stages.js';
import { audit } from '../audit.js';

export const reviewHandlers = {
  // Supervisor: Approve / reject proposal (a rejection needs a reason)
  async approve({ user, params, body }) {
    const r = own(await accessible(user, Number(params.id)), user);
    const status = { approve: 'approved', reject: 'rejected' }[body.decision] ?? fail(400, 'decision must be approve or reject');
    const comment = str(body.comment, 1000);
    if (status === 'rejected' && !comment) fail(400, 'A rejection reason is required');
    await updateStatus(r, status);
    await db.prepare('UPDATE research SET rejection_reason=? WHERE id=?').run(status === 'rejected' ? comment : null, r.id);
    if (comment) await addNoteToLatest(r, user, comment);
    await db.prepare('INSERT INTO topic_reviews (research_id,reviewer_id,decision,comment) VALUES (?,?,?,?)').run(r.id, user.id, status, comment);
    if (status === 'approved') await autoAssign(r);
    await notifyParties(r, 'n.' + status, { title: r.title, comment: comment ?? '' });
    await audit(user, `topic.${status}`, { researchId: r.id, detail: { comment } });
    return { status };
  },
  // Supervisor: Request changes («extend» of Approve / reject proposal)
  async requestChanges({ user, params, body }) {
    const r = own(await accessible(user, Number(params.id)), user);
    const comment = str(body.comment, 1000) ?? fail(400, 'Please describe the requested changes');
    await updateStatus(r, 'changes_requested');
    await addNoteToLatest(r, user, comment);
    await db.prepare('INSERT INTO topic_reviews (research_id,reviewer_id,decision,comment) VALUES (?,?,?,?)').run(r.id, user.id, 'changes_requested', comment);
    await notifyParties(r, 'n.changes_requested', { title: r.title, comment });
    await audit(user, 'topic.changes_requested', { researchId: r.id, detail: { comment } });
    return { status: 'changes_requested' };
  },

  // Supervisor: Review version & add notes (includes Send notification)
  async addNote({ user, params, body }) {
    const s = (await db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(params.id))) ?? fail(404, 'Submission not found');
    const r = own(await accessible(user, s.research_id), user);
    const text = need(body.text, 'Note', 2000);
    await db.prepare('INSERT INTO notes (submission_id,author_id,text) VALUES (?,?,?)').run(s.id, user.id, text);
    await notifyParties(r, 'n.note', { n: s.version_no, title: r.title });
    await audit(user, 'topic.note', { researchId: r.id, detail: { version: s.version_no, text } });
    return { ok: true };
  },

  // Supervisor: final research grade 0-100 (the grade belongs to the research: grade 1-1 Research); updates are kept in the history.
  async grade({ user, params, body }) {
    const r = own(await accessible(user, Number(params.id)), user);
    const score = Number(body.score);
    if (body.score === '' || body.score == null || !Number.isFinite(score) || score < 0 || score > 100)
      fail(400, 'Score must be a number between 0 and 100');
    const before = (await db.prepare('SELECT score FROM research_grades WHERE research_id=?').get(r.id))?.score ?? null;
    const comment = str(body.comment, 2000);
    const publish = body.publish === undefined ? null : (body.publish ? 1 : 0);
    await db.prepare(`INSERT INTO research_grades (research_id,score,comment,updated_at,published) VALUES (?,?,?,utc_now(),?)
      ON CONFLICT(research_id) DO UPDATE SET score=excluded.score, comment=excluded.comment, updated_at=utc_now(),
        published=COALESCE(?::int, research_grades.published)`).run(r.id, score, comment, publish ?? 0, publish);
    const published = !!(await db.prepare('SELECT published FROM research_grades WHERE research_id=?').get(r.id)).published;
    if (published) await notifyParties(r, 'n.graded', { title: r.title, score });
    await audit(user, before == null ? 'final.graded' : 'final.grade_updated', { researchId: r.id, detail: { from: before, to: score, comment, published } });
    return { score, published };
  },
  // Publish (or hide) the final research grade: students only see it once published.
  async publishFinalGrade({ user, params, body }) {
    const r = own(await accessible(user, Number(params.id)), user);
    const g = (await db.prepare('SELECT * FROM research_grades WHERE research_id=?').get(r.id)) ?? fail(404, 'There is no grade to publish yet');
    const published = body.published === undefined ? true : !!body.published;
    await db.prepare('UPDATE research_grades SET published=? WHERE research_id=?').run(published ? 1 : 0, r.id);
    if (published && !g.published) await notifyParties(r, 'n.graded', { title: r.title, score: g.score });
    await audit(user, published ? 'final.published' : 'final.hidden', { researchId: r.id, detail: { score: g.score } });
    return { published };
  },
};
