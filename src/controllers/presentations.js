// Final presentations: the instructor offers time slots for a course, each approved research books one (the team
// leader or individual owner), the instructor can assign / move / free a slot and lock the schedule.
import { db } from '../db.js';
import { fail, str } from '../errors.js';
import { notify, notifyParties } from '../notifications.js';
import { audit } from '../audit.js';
import { accessible, getResearch } from '../research.js';
import { isLeader, getTeam, ENDED } from '../teams.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const toMin = t => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const isLocked = async (sup, course) => !!(await db.prepare('SELECT locked FROM presentation_schedules WHERE supervisor_id=? AND course_id=?').get(sup, course))?.locked;
const slotOf = async id => (await db.prepare('SELECT * FROM presentation_slots WHERE id=?').get(id)) ?? fail(404, 'Time slot not found');
const ownSlot = async (user, id) => { const s = await slotOf(id); return s.supervisor_id === user.id ? s : fail(403, 'Not your time slot'); };
const when = s => `${s.starts_at.slice(0, 10)} ${s.starts_at.slice(11)}`;
const label = r => r.team ?? r.student;

async function slotsFor(supId, courseId) {
  return (await db.prepare(`SELECT p.id,p.starts_at,p.duration_min,p.location,p.research_id,p.booked_at,r.title,t.name AS team,u.name AS student
    FROM presentation_slots p LEFT JOIN research r ON r.id=p.research_id LEFT JOIN teams t ON t.id=r.team_id LEFT JOIN users u ON u.id=r.student_id
    WHERE p.supervisor_id=? AND p.course_id=? ORDER BY p.starts_at`).all(supId, courseId))
    .map(s => ({ ...s, ends_at: hhmm(toMin(s.starts_at.slice(11)) + s.duration_min), label: s.research_id ? label(s) : null }));
}
// approved research of the instructor in the course (the ones that present)
const eligible = (supId, courseId) => db.prepare(`SELECT r.id,r.title,t.name AS team,u.name AS student,
    (SELECT id FROM presentation_slots p WHERE p.research_id=r.id) AS slot_id
  FROM research r JOIN users u ON u.id=r.student_id LEFT JOIN teams t ON t.id=r.team_id
  WHERE r.supervisor_id=? AND r.course_id=? AND r.status='approved' ORDER BY COALESCE(t.name,u.name)`).all(supId, courseId);
async function mayBook(user, r) {
  if (!r.team_id) return r.student_id === user.id ? null : 'Only the owner can book the presentation';
  if (await isLeader(user.id, r.team_id)) return null;
  return (await getTeam(r.team_id)).members_can_submit ? null : 'Only the team leader can book the presentation';
}
async function assertOpenCourse(courseId) {
  if ((await db.prepare('SELECT archived_at FROM courses WHERE id=?').get(courseId))?.archived_at) fail(409, ENDED);
}

export const presentationHandlers = {
  // Instructor: the schedule of one of their courses. Student: the schedule of each of their approved research.
  async listPresentations({ user, query }) {
    if (user.role === 'supervisor') {
      const courses = await db.prepare(`SELECT DISTINCT c.id,c.name FROM courses c WHERE c.archived_at IS NULL AND (c.id IN (SELECT course_id FROM research WHERE supervisor_id=?)
        OR c.id IN (SELECT course_id FROM presentation_slots WHERE supervisor_id=?) OR c.id IN (SELECT course_id FROM stages WHERE supervisor_id=?)) ORDER BY c.name`).all(user.id, user.id, user.id);
      const courseId = Number(query?.get('courseId')) || courses[0]?.id;
      if (!courseId) return { courses, course_id: null, slots: [], research: [], locked: false };
      return { courses, course_id: courseId, slots: await slotsFor(user.id, courseId), research: (await eligible(user.id, courseId)).map(r => ({ ...r, label: label(r) })), locked: await isLocked(user.id, courseId) };
    }
    const mine = await db.prepare(`SELECT r.* FROM research r JOIN courses c ON c.id=r.course_id WHERE r.status='approved' AND c.archived_at IS NULL
      AND (r.student_id=? OR r.team_id IN (SELECT team_id FROM team_members WHERE user_id=? AND left_at IS NULL)) ORDER BY r.id DESC`).all(user.id, user.id);
    const out = [];
    for (const r of mine) {
      const slots = await slotsFor(r.supervisor_id, r.course_id);
      out.push({ research_id: r.id, title: r.title, locked: await isLocked(r.supervisor_id, r.course_id), can_book: !await mayBook(user, r),
        my_slot: slots.find(s => s.research_id === r.id) ?? null, slots: slots.map(s => ({ ...s, mine: s.research_id === r.id })) });
    }
    return out;
  },
  // Instructor: create slots — from..to every N minutes on a date (or a single slot when from = to).
  async createSlots({ user, body }) {
    const courseId = Number(body.courseId);
    if (!(await db.prepare('SELECT 1 FROM courses WHERE id=?').get(courseId))) fail(400, 'Choose a valid course');
    await assertOpenCourse(courseId);
    if (!DATE.test(body.date ?? '') || Number.isNaN(Date.parse(body.date))) fail(400, 'Date must be YYYY-MM-DD');
    if (!TIME.test(body.from ?? '') || !TIME.test(body.to ?? '')) fail(400, 'Times must be HH:MM (24-hour)');
    const every = Number(body.every);
    if (!Number.isInteger(every) || every < 5 || every > 240) fail(400, 'Slot length must be 5 to 240 minutes');
    const from = toMin(body.from), to = toMin(body.to);
    if (to < from) fail(400, 'The end time is before the start time');
    const starts = []; for (let m = from; m + every <= Math.max(to, from + every); m += every) starts.push(m);
    if (starts.length > 60) fail(400, 'At most 60 slots at a time');
    const location = body.location == null || body.location === '' ? null : (str(body.location, 200) ?? fail(400, 'Location is too long (max 200 chars)'));
    let created = 0;
    for (const m of starts) created += (await db.prepare(`INSERT INTO presentation_slots (supervisor_id,course_id,starts_at,duration_min,location) VALUES (?,?,?,?,?)
      ON CONFLICT DO NOTHING`).run(user.id, courseId, `${body.date} ${hhmm(m)}`, every, location)).changes;
    await audit(user, 'presentation.slots_created', { detail: { course: courseId, date: body.date, from: body.from, to: body.to, every, created } });
    return { created, skipped: starts.length - created };
  },
  // Instructor: change the place, assign a research (moving it from its old slot) or free the slot.
  async updateSlot({ user, params, body }) {
    const s = await ownSlot(user, Number(params.id));
    await assertOpenCourse(s.course_id);
    if (body.location !== undefined) {
      const loc = body.location === null || body.location === '' ? null : (str(body.location, 200) ?? fail(400, 'Location is too long (max 200 chars)'));
      await db.prepare('UPDATE presentation_slots SET location=? WHERE id=?').run(loc, s.id);
    }
    if (body.researchId !== undefined) {
      const prev = s.research_id;
      if (body.researchId === null) {
        await db.prepare('UPDATE presentation_slots SET research_id=NULL, booked_by=NULL, booked_at=NULL WHERE id=?').run(s.id);
        if (prev) await notifyParties(await getResearch(prev), 'n.pres.freed', { when: when(s) });
      } else {
        const r = await getResearch(Number(body.researchId));
        if (r.supervisor_id !== user.id || r.course_id !== s.course_id) fail(403, 'Not your research');
        if (r.status !== 'approved') fail(409, 'Only approved research can present');
        await db.prepare('UPDATE presentation_slots SET research_id=NULL, booked_by=NULL, booked_at=NULL WHERE research_id=?').run(r.id);
        await db.prepare('UPDATE presentation_slots SET research_id=?, booked_by=?, booked_at=utc_now() WHERE id=?').run(r.id, user.id, s.id);
        if (prev && prev !== r.id) await notifyParties(await getResearch(prev), 'n.pres.freed', { when: when(s) });
        await notifyParties(r, 'n.pres.assigned', { when: when(s), place: s.location ?? '—' });
      }
    }
    await audit(user, 'presentation.slot_updated', { researchId: body.researchId ?? s.research_id ?? null, detail: { slot: s.id, when: s.starts_at, ...body } });
    return { ok: true };
  },
  async deleteSlot({ user, params }) {
    const s = await ownSlot(user, Number(params.id));
    await db.prepare('DELETE FROM presentation_slots WHERE id=?').run(s.id);
    if (s.research_id) await notifyParties(await getResearch(s.research_id), 'n.pres.freed', { when: when(s) });
    await audit(user, 'presentation.slot_deleted', { researchId: s.research_id, detail: { slot: s.id, when: s.starts_at } });
    return { ok: true };
  },
  async lockSchedule({ user, body }) {
    const courseId = Number(body.courseId);
    await db.prepare(`INSERT INTO presentation_schedules (supervisor_id,course_id,locked) VALUES (?,?,?)
      ON CONFLICT (supervisor_id,course_id) DO UPDATE SET locked=excluded.locked`).run(user.id, courseId, body.locked ? 1 : 0);
    await audit(user, body.locked ? 'presentation.locked' : 'presentation.unlocked', { detail: { course: courseId } });
    return { locked: !!body.locked };
  },
  // Student (team leader / owner): book a free slot (moving an earlier booking) or cancel, while the schedule is open.
  async bookSlot({ user, params, body }) {
    const s = await slotOf(Number(params.id));
    const r = await accessible(user, Number(body.researchId));
    if (r.supervisor_id !== s.supervisor_id || r.course_id !== s.course_id) fail(403, 'This time slot is not for your research');
    if (r.status !== 'approved') fail(409, 'Only approved research can present');
    await assertOpenCourse(s.course_id);
    const denied = await mayBook(user, r); if (denied) fail(403, denied);
    if (await isLocked(s.supervisor_id, s.course_id)) fail(409, 'The presentation schedule is locked; ask your supervisor');
    if (s.research_id === r.id) return { ok: true };
    if (s.research_id) fail(409, 'This time slot is already taken');
    await db.prepare('UPDATE presentation_slots SET research_id=NULL, booked_by=NULL, booked_at=NULL WHERE research_id=?').run(r.id);
    const done = await db.prepare('UPDATE presentation_slots SET research_id=?, booked_by=?, booked_at=utc_now() WHERE id=? AND research_id IS NULL').run(r.id, user.id, s.id);
    if (!done.changes) fail(409, 'This time slot is already taken');
    await notify(s.supervisor_id, 'n.pres.booked', { who: r.team ?? r.student, when: when(s) }, r.id);
    await notifyParties(r, 'n.pres.assigned', { when: when(s), place: s.location ?? '—' });
    await audit(user, 'presentation.booked', { researchId: r.id, detail: { slot: s.id, when: s.starts_at } });
    return { ok: true };
  },
  async cancelBooking({ user, params, body }) {
    const s = await slotOf(Number(params.id));
    const r = await accessible(user, Number(body.researchId));
    if (s.research_id !== r.id) fail(409, 'This is not your booking');
    const denied = await mayBook(user, r); if (denied) fail(403, denied);
    if (await isLocked(s.supervisor_id, s.course_id)) fail(409, 'The presentation schedule is locked; ask your supervisor');
    await db.prepare('UPDATE presentation_slots SET research_id=NULL, booked_by=NULL, booked_at=NULL WHERE id=?').run(s.id);
    await notify(s.supervisor_id, 'n.pres.cancelled', { who: r.team ?? r.student, when: when(s) }, r.id);
    await audit(user, 'presentation.cancelled', { researchId: r.id, detail: { slot: s.id, when: s.starts_at } });
    return { ok: true };
  },
};
