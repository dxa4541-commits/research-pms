// Project posters: every project (research) fills in the data of the course's one-slide project page — names, audience,
// description, target colleges, link and two screenshots — and the system builds the slide from the template.
// The supervisor's "posters folder" lists every project of a course with its status and downloads one slide or all.
import { db } from '../db.js';
import { fail, str } from '../errors.js';
import { checkFile, storeFile, readStored, removeFile } from '../files.js';
import { notify } from '../notifications.js';
import { audit } from '../audit.js';
import { accessible } from '../research.js';
import { isLeader, getTeam, activeMembers, courseEnded, ENDED } from '../teams.js';
import { COLLEGES, MAX_MEMBERS, buildDeck } from '../poster.js';

const IMAGE_MAX = 5 * 1024 * 1024;
const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
const LIMITS = { name_ar: 60, name_en: 80, audience: 40, description: 1200, other_college: 30, url: 200 };
export const REQUIRED = ['name_ar', 'name_en', 'audience', 'description', 'colleges', 'url', 'desktop', 'mobile'];

const rowOf = async researchId => (await db.prepare('SELECT * FROM project_posters WHERE research_id=?').get(researchId)) ?? null;
const collegesOf = row => { try { return JSON.parse(row?.colleges ?? '[]').filter(k => k in COLLEGES); } catch { return []; } };
const missingOf = row => REQUIRED.filter(k => k === 'colleges' ? !collegesOf(row).length : k === 'desktop' || k === 'mobile' ? !row?.[`${k}_file`] : !row?.[k]);
const words = s => (s ?? '').trim().split(/\s+/).filter(Boolean).length;

// Team members in the order shown on the slide: the leader first, then by joining.
async function membersOf(r) {
  if (r.team_id) {
    const list = await activeMembers(r.team_id);
    return list.sort((a, b) => (a.role === 'leader' ? -1 : 0) - (b.role === 'leader' ? -1 : 0)).map(m => ({ name: m.name, university_id: m.university_id }));
  }
  const u = await db.prepare('SELECT name, university_id FROM users WHERE id=?').get(r.student_id);
  return [{ name: u.name, university_id: u.university_id }];
}
// Who may edit: the owner of an individual project; in a team the leader, or every member when the team allows it.
async function editProblem(user, r) {
  if (user.role !== 'student') return 'Only the project team can edit its poster';
  if (r.status === 'rejected') return 'This research was rejected';
  if (await courseEnded(r.course_id)) return ENDED;
  if (!r.team_id) return r.student_id === user.id ? null : 'Only the owner can edit the poster';
  if (await isLeader(user.id, r.team_id)) return null;
  return (await getTeam(r.team_id)).members_can_submit ? null : 'Only the team leader can edit the poster';
}
async function slideData(r, row) {
  const img = async k => row?.[`${k}_file`] ? { buf: await readStored(row[`${k}_file`]), ext: row[`${k}_ext`] } : null;
  return {
    name_ar: row?.name_ar ?? r.title, name_en: row?.name_en, audience: row?.audience, description: row?.description ?? r.description,
    colleges: collegesOf(row), other_college: row?.other_college, url: row?.url, members: await membersOf(r),
    desktop: await img('desktop'), mobile: await img('mobile'),
  };
}
const fileName = s => `${String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'poster'}.pptx`;

export const posterHandlers = {
  async getPoster({ user, params }) {
    const r = await accessible(user, Number(params.id));
    const row = await rowOf(r.id), problem = await editProblem(user, r), members = await membersOf(r);
    return {
      research_id: r.id, title: r.title, course: r.course, status: r.status,
      poster: {
        name_ar: row?.name_ar ?? '', name_en: row?.name_en ?? '', audience: row?.audience ?? '', description: row?.description ?? '',
        colleges: collegesOf(row), other_college: row?.other_college ?? '', url: row?.url ?? '',
        has_desktop: !!row?.desktop_file, has_mobile: !!row?.mobile_file, updated_at: row?.updated_at ?? null,
      },
      members, members_cut: Math.max(0, members.length - MAX_MEMBERS), colleges: Object.keys(COLLEGES),
      missing: missingOf(row), complete: !missingOf(row).length, can_edit: !problem, edit_problem: problem,
      suggest: { name_ar: r.title, description: r.description ?? '' },
    };
  },

  // Student: save the fields that were sent; a screenshot is { filename, data (base64) } to replace, null to remove.
  async savePoster({ user, params, body }) {
    const r = await accessible(user, Number(params.id));
    const problem = await editProblem(user, r); if (problem) fail(403, problem);
    const before = await rowOf(r.id);
    const next = { ...(before ?? {}) };
    for (const k of Object.keys(LIMITS)) {
      if (body[k] === undefined) continue;
      if (body[k] === null || (typeof body[k] === 'string' && !body[k].trim())) { next[k] = null; continue; }
      next[k] = str(body[k], LIMITS[k]) ?? fail(400, `Poster field ${k} is too long (max ${LIMITS[k]} chars)`);
    }
    if (next.description && words(next.description) > 160) fail(400, 'The project description must be at most 160 words');
    if (next.url) {
      if (!/^https?:\/\//i.test(next.url)) next.url = 'https://' + next.url;
      let u; try { u = new URL(next.url); } catch { u = null; }
      if (!u || !/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) fail(400, 'The project link must be a web address (https://…)');
      next.url = u.href.length <= LIMITS.url ? u.href : fail(400, `Poster field url is too long (max ${LIMITS.url} chars)`);
    }
    if (body.colleges !== undefined) {
      if (!Array.isArray(body.colleges) || body.colleges.some(k => !(k in COLLEGES))) fail(400, 'Choose target colleges from the list');
      next.colleges = JSON.stringify([...new Set(body.colleges)]);
    }
    const replaced = [];
    for (const k of ['desktop', 'mobile']) {
      if (body[k] === undefined) continue;
      if (before?.[`${k}_file`]) replaced.push(before[`${k}_file`]);
      if (body[k] === null) { next[`${k}_file`] = null; next[`${k}_ext`] = null; continue; }
      const { buf, ext } = checkFile(body[k]?.filename, body[k]?.data, { formats: ['png', 'jpg', 'jpeg'], maxBytes: IMAGE_MAX });
      next[`${k}_file`] = (await storeFile(body[k].filename, buf)).stored;
      next[`${k}_ext`] = ext === 'png' ? 'png' : 'jpg';
    }
    await db.prepare(`INSERT INTO project_posters (research_id,name_ar,name_en,audience,description,colleges,other_college,url,desktop_file,desktop_ext,mobile_file,mobile_ext,updated_by,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,utc_now()) ON CONFLICT (research_id) DO UPDATE SET name_ar=excluded.name_ar,name_en=excluded.name_en,audience=excluded.audience,
      description=excluded.description,colleges=excluded.colleges,other_college=excluded.other_college,url=excluded.url,desktop_file=excluded.desktop_file,desktop_ext=excluded.desktop_ext,
      mobile_file=excluded.mobile_file,mobile_ext=excluded.mobile_ext,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .run(r.id, next.name_ar ?? null, next.name_en ?? null, next.audience ?? null, next.description ?? null, next.colleges ?? '[]', next.other_college ?? null, next.url ?? null,
        next.desktop_file ?? null, next.desktop_ext ?? null, next.mobile_file ?? null, next.mobile_ext ?? null, user.id);
    for (const f of replaced) db.onCommit(() => removeFile(f));
    const missing = missingOf(next);
    if (!missing.length && (!before || missingOf(before).length)) await notify(r.supervisor_id, 'n.poster.done', { title: r.title, who: r.team ?? r.student }, r.id);
    await audit(user, 'poster.saved', { researchId: r.id, detail: { fields: Object.keys(body).filter(k => k in LIMITS || ['colleges', 'desktop', 'mobile'].includes(k)), complete: !missing.length } });
    return { ok: true, missing, complete: !missing.length };
  },

  async posterImage({ user, params }) {
    const r = await accessible(user, Number(params.id));
    if (!['desktop', 'mobile'].includes(params.kind)) fail(404, 'Not found');
    const row = await rowOf(r.id), name = row?.[`${params.kind}_file`] ?? fail(404, 'File not found');
    const ext = row[`${params.kind}_ext`];
    return { file: await readStored(name), filename: `${params.kind}.${ext}`, contentType: ext === 'png' ? 'image/png' : 'image/jpeg' };
  },

  // The project's slide as a .pptx (works while incomplete: the template's placeholders show what is missing).
  async posterPptx({ user, params }) {
    const r = await accessible(user, Number(params.id));
    const row = await rowOf(r.id);
    const file = buildDeck([await slideData(r, row)], { title: row?.name_ar ?? r.title });
    await audit(user, 'poster.downloaded', { researchId: r.id });
    return { file, filename: fileName(row?.name_ar || r.title), contentType: PPTX };
  },

  // Supervisor (own projects) / admin (all): the posters folder of one course.
  async listPosters({ user, query }) {
    const own = user.role === 'supervisor';
    const courses = await db.prepare(`SELECT DISTINCT c.id,c.name FROM courses c JOIN research r ON r.course_id=c.id
      WHERE c.archived_at IS NULL AND r.status<>'rejected' ${own ? 'AND r.supervisor_id=?' : ''} ORDER BY c.name`).all(...(own ? [user.id] : []));
    const courseId = Number(query?.get('courseId')) || courses[0]?.id;
    if (!courseId) return { courses, course_id: null, items: [] };
    const rows = await db.prepare(`SELECT r.id,r.title,r.status,r.team_id,t.name AS team,u.name AS student,p.* ,r.id AS research_id
      FROM research r JOIN users u ON u.id=r.student_id LEFT JOIN teams t ON t.id=r.team_id LEFT JOIN project_posters p ON p.research_id=r.id
      WHERE r.course_id=? AND r.status<>'rejected' ${own ? 'AND r.supervisor_id=?' : ''} ORDER BY COALESCE(t.name,u.name)`).all(courseId, ...(own ? [user.id] : []));
    const items = rows.map(x => {
      const started = !!x.updated_at, missing = missingOf(started ? x : null);
      return { research_id: x.research_id, title: x.title, status: x.status, label: x.team ?? x.student, name_ar: x.name_ar, name_en: x.name_en,
        state: !started ? 'empty' : missing.length ? 'partial' : 'complete', missing, updated_at: x.updated_at };
    });
    return { courses, course_id: courseId, items };
  },

  // All posters of a course in one deck: complete ones by default, or every started one with ?all=1.
  async postersPptx({ user, query }) {
    const courseId = Number(query?.get('courseId')) || fail(400, 'Choose a valid course');
    const own = user.role === 'supervisor', all = query.get('all') === '1';
    const course = (await db.prepare('SELECT name FROM courses WHERE id=?').get(courseId)) ?? fail(404, 'Course not found');
    const list = await db.prepare(`SELECT r.id FROM research r JOIN project_posters p ON p.research_id=r.id LEFT JOIN teams t ON t.id=r.team_id JOIN users u ON u.id=r.student_id
      WHERE r.course_id=? AND r.status<>'rejected' ${own ? 'AND r.supervisor_id=?' : ''} ORDER BY COALESCE(p.name_ar, r.title)`).all(courseId, ...(own ? [user.id] : []));
    const slides = [];
    for (const { id } of list) {
      const r = await accessible(user, id), row = await rowOf(id);
      if (all || !missingOf(row).length) slides.push(await slideData(r, row));
    }
    if (!slides.length) fail(409, all ? 'No project has filled in its poster yet' : 'No project has completed its poster yet');
    await audit(user, 'poster.folder_downloaded', { detail: { course: courseId, slides: slides.length, all } });
    return { file: buildDeck(slides, { title: `ملصقات المشاريع — ${course.name}` }), filename: fileName(`ملصقات المشاريع - ${course.name}`), contentType: PPTX };
  },
};
