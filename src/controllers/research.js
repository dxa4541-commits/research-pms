// Student use cases: Register research topic, Upload new version, View status & feedback (+ Set deadlines).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db.js';
import { fail, str, need, intParam } from '../errors.js';
import { UPLOAD_DIR, checkFile, createSubmission, removeFile } from '../files.js';
import { audit } from '../audit.js';
import { enrolled, teamFor, isLeader, sizeOf } from '../teams.js';
import { stageTotals } from '../stages.js';
import { notify, notifySupervisor } from '../notifications.js';
import { updateStatus, getResearch, accessible, listFor, STATUSES, MAX_PAGE } from '../research.js';

export const researchHandlers = {
  // Student: Register research topic. A student in a team of the course registers for the team (leader only);
  // otherwise it is an individual project, if the course allows it. One active research per team/student per course.
  registerTopic({ user, body }) {
    const title = need(body.title, 'Title', 200);
    const course = db.prepare('SELECT * FROM courses WHERE id=?').get(Number(body.courseId)) ?? fail(400, 'Choose a valid course');
    if (!enrolled(user.id, course.id)) fail(403, 'You are not enrolled in this course');
    const sup = db.prepare("SELECT id FROM users WHERE id=? AND role='supervisor' AND active=1").get(Number(body.supervisorId)) ?? fail(400, 'Choose a valid supervisor');
    const team = teamFor(user.id, course.id) ?? null;
    if (team) {
      if (!isLeader(user.id, team.id)) fail(403, 'Only the team leader can register the research topic');
      const size = sizeOf(team.id);
      if (size < course.min_team_size) fail(409, `The team needs at least ${course.min_team_size} members before registering a topic`);
      if (db.prepare("SELECT 1 FROM research WHERE team_id=? AND status<>'rejected'").get(team.id)) fail(409, 'Your team already has a research project');
    } else {
      if (course.team_mode === 'team') fail(409, 'This course requires team research: create or join a team first');
      if (db.prepare("SELECT 1 FROM research WHERE student_id=? AND course_id=? AND team_id IS NULL AND status<>'rejected'").get(user.id, course.id)) fail(409, 'You already have a research project in this course');
    }
    const text = (v, label, max) => v == null || v === '' ? null : (str(v, max) ?? fail(400, `${label} is too long (max ${max} chars)`));
    const description = text(body.description, 'Description', 2000), problem = text(body.problem, 'Research problem', 2000), objectives = text(body.objectives, 'Objectives', 2000);
    const hasFile = !!(body.filename || body.data);
    const file = hasFile ? checkFile(body.filename, body.data) : null; // validate before inserting anything
    db.exec('BEGIN');
    let created;
    try {
      const r = db.prepare('INSERT INTO research (title,description,problem,objectives,student_id,supervisor_id,team_id,course_id) VALUES (?,?,?,?,?,?,?,?)')
        .run(title, description, problem, objectives, user.id, sup.id, team?.id ?? null, course.id);
      const id = Number(r.lastInsertRowid);
      if (file) created = createSubmission(id, 1, body.filename, file.buf);
      db.exec('COMMIT');
      notify(sup.id, 'n.submitted', { student: team ? team.name : user.name, title }, id);
      audit(user, 'topic.registered', { researchId: id, detail: { team: team?.id ?? null, title } });
      return { id };
    } catch (e) { db.exec('ROLLBACK'); if (created) removeFile(created.path); throw e; }
  },
  // Leader / owner: edit and resubmit a topic after the supervisor asked for changes (approved topics are frozen).
  editTopic({ user, params, body }) {
    const r = accessible(user, Number(params.id));
    if (r.team_id ? !isLeader(user.id, r.team_id) : r.student_id !== user.id) fail(403, 'Only the team leader can edit the research topic');
    if (r.status === 'approved') fail(409, "An approved topic can only be changed with your supervisor's approval");
    if (r.status === 'pending') fail(409, 'The topic is waiting for review');
    if (r.status === 'rejected') fail(409, 'This proposal was rejected');
    const title = need(body.title, 'Title', 200);
    const text = (v, label, max) => v == null || v === '' ? null : (str(v, max) ?? fail(400, `${label} is too long (max ${max} chars)`));
    db.prepare('UPDATE research SET title=?,description=?,problem=?,objectives=? WHERE id=?')
      .run(title, text(body.description, 'Description', 2000), text(body.problem, 'Research problem', 2000), text(body.objectives, 'Objectives', 2000), r.id);
    updateStatus(r, 'pending');
    notifySupervisor(r, 'n.topic.resubmitted', { student: user.name, title });
    audit(user, 'topic.edited', { researchId: r.id, detail: { title } });
    return { status: 'pending' };
  },

  // Student: Upload new version (sequence diagram: checkFile -> create -> saveFile -> updateStatus -> notifySupervisor)
  uploadVersion({ user, params, body }) {
    const r = accessible(user, Number(params.id));
    if (r.team_id ? !isLeader(user.id, r.team_id) : r.student_id !== user.id) fail(403, 'Only the team leader can upload files');
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
    const student = user.role === 'student';
    const g = db.prepare('SELECT score,comment,published FROM research_grades WHERE research_id=?').get(r.id);
    const shown = g && (!student || g.published) ? g : null;
    const reviews = db.prepare(`SELECT v.id,v.decision,v.comment,v.created_at,u.name AS reviewer FROM topic_reviews v JOIN users u ON u.id=v.reviewer_id WHERE v.research_id=? ORDER BY v.id`).all(r.id);
    return { ...r, grade: shown?.score ?? null, grade_comment: shown?.comment ?? null, grade_published: g ? !!g.published : false, submissions: subs,
      topic_reviews: reviews, stage_totals: stageTotals(r.id, student),
      can_edit_topic: student && r.status === 'changes_requested' && (r.team_id ? isLeader(user.id, r.team_id) : r.student_id === user.id),
      is_leader: student && (r.team_id ? isLeader(user.id, r.team_id) : r.student_id === user.id) };
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
