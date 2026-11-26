// Student use cases: Register research topic, Upload new version, View status & feedback (+ Set deadlines).
import { db } from '../db.js';
import { fail, str, need, intParam } from '../errors.js';
import { checkFile, createSubmission, readStored } from '../files.js';
import { audit } from '../audit.js';
import { enrolled, teamFor, isLeader, sizeOf, getTeam } from '../teams.js';
import { studentTeamHandlers } from './studentTeams.js';
import { stageTotals, suggestedFinal } from '../stages.js';
import { notify, notifySupervisor } from '../notifications.js';
import { updateStatus, getResearch, accessible, listFor, STATUSES, MAX_PAGE } from '../research.js';

export const researchHandlers = {
  // Student: Register research topic. A student in a team of the course registers for the team (leader only);
  // otherwise it is an individual project, if the course allows it. One active research per team/student per course.
  // body.newTeam = { name, memberIds } creates a group project in one step: a new team led by the student, with an
  // invitation to each chosen classmate (they join when they accept; invited members count towards the minimum size).
  async registerTopic({ user, body }) {
    const title = need(body.title, 'Title', 200);
    const course = (await db.prepare('SELECT * FROM courses WHERE id=?').get(Number(body.courseId))) ?? fail(400, 'Choose a valid course');
    if (!await enrolled(user.id, course.id)) fail(403, 'You are not enrolled in this course');
    const sup = (await db.prepare("SELECT id FROM users WHERE id=? AND role='supervisor' AND active=1").get(Number(body.supervisorId))) ?? fail(400, 'Choose a valid supervisor');
    let team = (await teamFor(user.id, course.id)) ?? null, invited = 0;
    if (!team && body.newTeam) {
      need(body.title, 'Title', 200);
      const ids = Array.isArray(body.newTeam.memberIds) ? [...new Set(body.newTeam.memberIds.map(Number))] : [];
      if (!ids.length) fail(400, 'Choose at least one team member');
      if (ids.length + 1 > course.max_team_size) fail(409, `A team can have at most ${course.max_team_size} members`);
      const { id } = await studentTeamHandlers.createMyTeam({ user, body: { courseId: course.id, name: body.newTeam.name, idea: str(body.title, 200) } });
      for (const uid of ids) await studentTeamHandlers.inviteStudent({ user, params: { id }, body: { userId: uid } });
      team = await getTeam(id); invited = ids.length;
    }
    if (team) {
      if (!await isLeader(user.id, team.id)) fail(403, 'Only the team leader can register the research topic');
      const size = await sizeOf(team.id) + invited;
      if (size < course.min_team_size) fail(409, `The team needs at least ${course.min_team_size} members before registering a topic`);
      if (await db.prepare("SELECT 1 FROM research WHERE team_id=? AND status<>'rejected'").get(team.id)) fail(409, 'Your team already has a research project');
    } else {
      if (course.team_mode === 'team') fail(409, 'This course requires team research: create or join a team first');
      if (await db.prepare("SELECT 1 FROM research WHERE student_id=? AND course_id=? AND team_id IS NULL AND status<>'rejected'").get(user.id, course.id)) fail(409, 'You already have a research project in this course');
    }
    const text = (v, label, max) => v == null || v === '' ? null : (str(v, max) ?? fail(400, `${label} is too long (max ${max} chars)`));
    const description = text(body.description, 'Description', 2000), problem = text(body.problem, 'Research problem', 2000), objectives = text(body.objectives, 'Objectives', 2000);
    const hasFile = !!(body.filename || body.data);
    const file = hasFile ? checkFile(body.filename, body.data) : null; // validate before inserting anything
    // The request runs in one transaction: if storing the file fails, the research row is rolled back too.
    const r = await db.prepare('INSERT INTO research (title,description,problem,objectives,student_id,supervisor_id,team_id,course_id) VALUES (?,?,?,?,?,?,?,?)')
      .run(title, description, problem, objectives, user.id, sup.id, team?.id ?? null, course.id);
    const id = r.lastInsertRowid;
    if (file) await createSubmission(id, 1, body.filename, file.buf);
    await notify(sup.id, 'n.submitted', { student: team ? team.name : user.name, title }, id);
    await audit(user, 'topic.registered', { researchId: id, detail: { team: team?.id ?? null, title, invited } });
    return { id, team_id: team?.id ?? null, invited };
  },
  // Leader / owner: edit and resubmit a topic after the supervisor asked for changes (approved topics are frozen).
  async editTopic({ user, params, body }) {
    const r = await accessible(user, Number(params.id));
    if (r.team_id ? !await isLeader(user.id, r.team_id) : r.student_id !== user.id) fail(403, 'Only the team leader can edit the research topic');
    if (r.status === 'approved') fail(409, "An approved topic can only be changed with your supervisor's approval");
    if (r.status === 'pending') fail(409, 'The topic is waiting for review');
    if (r.status === 'rejected') fail(409, 'This proposal was rejected');
    const title = need(body.title, 'Title', 200);
    const text = (v, label, max) => v == null || v === '' ? null : (str(v, max) ?? fail(400, `${label} is too long (max ${max} chars)`));
    await db.prepare('UPDATE research SET title=?,description=?,problem=?,objectives=? WHERE id=?')
      .run(title, text(body.description, 'Description', 2000), text(body.problem, 'Research problem', 2000), text(body.objectives, 'Objectives', 2000), r.id);
    await updateStatus(r, 'pending');
    await notifySupervisor(r, 'n.topic.resubmitted', { student: user.name, title });
    await audit(user, 'topic.edited', { researchId: r.id, detail: { title } });
    return { status: 'pending' };
  },

  // Student: Upload new version (sequence diagram: checkFile -> create -> saveFile -> updateStatus -> notifySupervisor)
  async uploadVersion({ user, params, body }) {
    const r = await accessible(user, Number(params.id));
    if (r.team_id ? !await isLeader(user.id, r.team_id) : r.student_id !== user.id) fail(403, 'Only the team leader can upload files');
    if (r.status === 'rejected') fail(409, 'This proposal was rejected; no new versions allowed');
    const { buf } = checkFile(body.filename, body.data);                                   // 3: checkFile(size, type)
    const next = (await db.prepare('SELECT COALESCE(MAX(version_no),0)+1 AS n FROM submissions WHERE research_id=?').get(r.id)).n;
    await createSubmission(r.id, next, body.filename, buf);                                // 4-5: create(versionNo + 1), saveFile(file)
    if (r.status === 'changes_requested') await updateStatus(r, 'pending');                // 8: updateStatus()
    await notifySupervisor(r, 'n.version', { student: user.name, n: next, title: r.title }); // 9: notifySupervisor()
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
  async getResearchDetail({ user, params }) {
    const r = await accessible(user, Number(params.id));
    const subs = await db.prepare(`SELECT s.id,s.version_no,s.filename,s.size,s.created_at
      FROM submissions s WHERE s.research_id=? ORDER BY s.version_no DESC`).all(r.id);
    const notes = await db.prepare(`SELECT n.id,n.submission_id,n.text,n.created_at,u.name AS author FROM notes n
      JOIN users u ON u.id=n.author_id JOIN submissions s ON s.id=n.submission_id WHERE s.research_id=? ORDER BY n.id`).all(r.id);
    for (const s of subs) s.notes = notes.filter(n => n.submission_id === s.id).map(({ submission_id, ...n }) => n);
    const student = user.role === 'student';
    const g = await db.prepare('SELECT score,comment,published FROM research_grades WHERE research_id=?').get(r.id);
    const shown = g && (!student || g.published) ? g : null;
    const reviews = await db.prepare(`SELECT v.id,v.decision,v.comment,v.created_at,u.name AS reviewer FROM topic_reviews v JOIN users u ON u.id=v.reviewer_id WHERE v.research_id=? ORDER BY v.id`).all(r.id);
    const leader = student && (r.team_id ? await isLeader(user.id, r.team_id) : r.student_id === user.id);
    return { ...r, grade: shown?.score ?? null, grade_comment: shown?.comment ?? null, grade_published: g ? !!g.published : false, submissions: subs,
      topic_reviews: reviews, stage_totals: await stageTotals(r.id, student), suggested_final: student ? null : await suggestedFinal(r.id),
      can_edit_topic: student && r.status === 'changes_requested' && leader,
      is_leader: leader };
  },
  async downloadFile({ user, params }) {
    const s = (await db.prepare('SELECT * FROM submissions WHERE id=?').get(Number(params.id))) ?? fail(404, 'File not found');
    await accessible(user, s.research_id);
    return { file: await readStored(s.stored_name), filename: s.filename };
  },
  // Admin: set deadline (FR9)
  async setDeadline({ params, body }) {
    const r = await getResearch(Number(params.id));
    const d = body.deadline;
    if (d !== null && (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(d))))
      fail(400, 'Deadline must be a date (YYYY-MM-DD) or null');
    await db.prepare('UPDATE research SET deadline=? WHERE id=?').run(d, r.id);
    if (d) { await notify(r.student_id, 'n.deadline', { title: r.title, date: d }, r.id); await notify(r.supervisor_id, 'n.deadline', { title: r.title, date: d }, r.id); }
    return { deadline: d };
  },
};
