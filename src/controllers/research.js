// Student use cases: Register research topic, Upload new version, View status & feedback (+ Set deadlines).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { fail, str, need, intParam } from '../errors.js';
import { UPLOAD_DIR, checkFile, createSubmission, removeFile } from '../files.js';
import { stageTotals } from '../stages.js';
import { notify, notifySupervisor } from '../notifications.js';
import { updateStatus, getResearch, accessible, listFor, STATUSES, MAX_PAGE } from '../research.js';

export const researchHandlers = {
  // Student: Register research topic
  registerTopic({ user, body }) {
    const title = need(body.title, 'Title', 200);
    const course = db.prepare('SELECT id FROM courses WHERE id=?').get(Number(body.courseId)) ?? fail(400, 'Choose a valid course');
    const sup = db.prepare("SELECT id FROM users WHERE id=? AND role='supervisor'").get(Number(body.supervisorId)) ?? fail(400, 'Choose a valid supervisor');
    if (user.team_id && db.prepare('SELECT 1 FROM research WHERE team_id=?').get(user.team_id))
      fail(409, 'Your team already has a research project');
    const description = body.description == null || body.description === '' ? null : (str(body.description, 2000) ?? fail(400, 'Description is too long (max 2000 chars)'));
    const { buf } = checkFile(body.filename, body.data); // validate before inserting anything
    db.exec('BEGIN');
    let created;
    try {
      const r = db.prepare('INSERT INTO research (title,description,student_id,supervisor_id,team_id,course_id) VALUES (?,?,?,?,?,?)')
        .run(title, description, user.id, sup.id, user.team_id ?? null, course.id);
      const id = Number(r.lastInsertRowid);
      created = createSubmission(id, 1, body.filename, buf);
      db.exec('COMMIT');
      notify(sup.id, 'n.submitted', { student: user.name, title }, id);
      return { id };
    } catch (e) { db.exec('ROLLBACK'); if (created) removeFile(created.path); throw e; }
  },

  // Student: Upload new version (sequence diagram: checkFile -> create -> saveFile -> updateStatus -> notifySupervisor)
  uploadVersion({ user, params, body }) {
    const r = accessible(user, Number(params.id));
    if (r.status === 'rejected') fail(409, 'This proposal was rejected; no new versions allowed');
    const { buf } = checkFile(body.filename, body.data);                                   // 3: checkFile(size, type)
    const next = db.prepare('SELECT COALESCE(MAX(version_no),0)+1 AS n FROM submissions WHERE research_id=?').get(r.id).n;
    createSubmission(r.id, next, body.filename, buf);                                      // 4-5: create(versionNo + 1), saveFile(file)
    if (r.status === 'changes_requested') updateStatus(r, 'pending');                      // 8: updateStatus()
    notifySupervisor(r, 'n.version', { student: user.name, n: next, title: r.title });     // 9: notifySupervisor()
    return { versionNo: next };
  },

  // Student/Supervisor/Admin: lists & details (View status & feedback)
  listResearch({ user, query }) {
    const status = query?.get('status') || null;
    if (status && !STATUSES.includes(status)) fail(400, 'Invalid status filter');
    return listFor(user, {
      status, q: str(query?.get('q') ?? '', 100),
      limit: intParam(query?.get('limit'), MAX_PAGE, 1, MAX_PAGE), offset: intParam(query?.get('offset'), 0, 0, 1e9),
    });
  },
  getResearchDetail({ user, params }) {
    const r = accessible(user, Number(params.id));
    const subs = db.prepare(`SELECT s.id,s.version_no,s.filename,s.size,s.created_at
      FROM submissions s WHERE s.research_id=? ORDER BY s.version_no DESC`).all(r.id);
    const notes = db.prepare(`SELECT n.id,n.text,n.created_at,u.name AS author FROM notes n
      JOIN users u ON u.id=n.author_id WHERE n.submission_id=? ORDER BY n.id`);
    for (const s of subs) s.notes = notes.all(s.id);
    const g = db.prepare('SELECT score,comment FROM research_grades WHERE research_id=?').get(r.id);
    return { ...r, grade: g?.score ?? null, grade_comment: g?.comment ?? null, submissions: subs, stage_totals: stageTotals(r.id) };
  },
  downloadFile({ user, params }) {
    const s = db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(params.id)) ?? fail(404, 'File not found');
    accessible(user, s.research_id);
    const p = join(UPLOAD_DIR, s.stored_name);
    if (!existsSync(p)) fail(404, 'File missing on disk');
    return { file: readFileSync(p), filename: s.filename };
  },
  // Admin: set deadline (FR9)
  setDeadline({ params, body }) {
    const r = getResearch(Number(params.id));
    const d = body.deadline;
    if (d !== null && (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))))
      fail(400, 'Deadline must be a date (YYYY-MM-DD) or null');
    db.prepare('UPDATE research SET deadline=? WHERE id=?').run(d, r.id);
    if (d) { notify(r.student_id, 'n.deadline', { title: r.title, date: d }, r.id); notify(r.supervisor_id, 'n.deadline', { title: r.title, date: d }, r.id); }
    return { deadline: d };
  },
};
