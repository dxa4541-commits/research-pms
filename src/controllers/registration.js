// Student registration: request by University ID (validated against the approved list), admin approval, approved-ID list.
import { db } from '../db.js';
import { fail, need, str } from '../errors.js';
import { hashPassword } from '../auth.js';
import { RateLimiter } from '../ratelimit.js';
import { notify } from '../notifications.js';
import { audit } from '../audit.js';
import { getCourse } from '../teams.js';

const regLimiter = new RateLimiter(10, 3600 * 1000); // per IP per hour
const ID_RE = /^[A-Za-z0-9._-]+$/;
const normId = v => need(String(v ?? ''), 'University ID', 30);
const courseIdsOf = async approvedId => (await db.prepare('SELECT course_id FROM approved_id_courses WHERE approved_id=?').all(approvedId)).map(x => x.course_id);

export const registrationHandlers = {
  // Public: submit a registration request. Needs only the University ID (and optionally a name / contact e-mail).
  async register({ body, ip = 'unknown' }) {
    if (regLimiter.blocked(ip)) fail(429, 'Too many registration requests. Try again later');
    regLimiter.fail(ip);
    const uid = normId(body.universityId);
    if (!ID_RE.test(uid)) fail(400, 'University ID may contain letters, digits and . _ - only');
    const approved = await db.prepare('SELECT * FROM approved_ids WHERE lower(university_id)=lower(?)').get(uid);
    if (!approved) fail(403, 'This University ID is not in the approved list');
    if (await db.prepare('SELECT 1 FROM users WHERE lower(university_id)=lower(?)').get(uid)) fail(409, 'An account already exists for this University ID');
    if (await db.prepare("SELECT 1 FROM registration_requests WHERE lower(university_id)=lower(?) AND status IN ('pending','approved')").get(uid))
      fail(409, 'A registration request for this University ID already exists');
    const name = str(body.name, 100) ?? approved.name ?? fail(400, 'Name is required (max 100 chars)');
    let email = null;
    if (body.email) { email = need(String(body.email), 'Email', 200).toLowerCase(); if (!/^\S+@\S+\.\S+$/.test(email)) fail(400, 'Invalid email'); }
    const id = (await db.prepare('INSERT INTO registration_requests (university_id,name,email) VALUES (?,?,?)').run(approved.university_id, name, email)).lastInsertRowid;
    for (const a of await db.prepare("SELECT id FROM users WHERE role='admin' AND active=1").all()) await notify(a.id, 'n.registration.new', { name, id: approved.university_id });
    await audit(null, 'registration.requested', { detail: { universityId: approved.university_id, request: id } });
    return { id, status: 'pending' };
  },

  // Admin: list / approve / reject registration requests (decision and timestamp are recorded).
  listRegistrations({ query }) {
    const st = query?.get('status');
    if (st && !['pending', 'approved', 'rejected'].includes(st)) fail(400, 'Invalid status filter');
    return db.prepare(`SELECT r.id,r.university_id,r.name,r.email,r.status,r.created_at,r.decided_at,r.decision_note,u.name AS decided_by
      FROM registration_requests r LEFT JOIN users u ON u.id=r.decided_by ${st ? 'WHERE r.status=?' : ''} ORDER BY (r.status='pending') DESC, r.id DESC`).all(...(st ? [st] : []));
  },
  async approveRegistration({ user, params, body }) {
    const r = (await db.prepare('SELECT * FROM registration_requests WHERE id=?').get(Number(params.id))) ?? fail(404, 'Registration request not found');
    if (r.status !== 'pending') fail(409, 'This request has already been decided');
    if (await db.prepare('SELECT 1 FROM users WHERE lower(university_id)=lower(?)').get(r.university_id)) fail(409, 'An account already exists for this University ID');
    const approved = (await db.prepare('SELECT * FROM approved_ids WHERE lower(university_id)=lower(?)').get(r.university_id)) ?? fail(409, 'This University ID is no longer in the approved list');
    const courses = Array.isArray(body.courseIds) ? [...new Set(body.courseIds.map(Number))] : await courseIdsOf(approved.id);
    for (const c of courses) await getCourse(c);
    let email = (r.email ?? `${r.university_id}@students.invalid`).toLowerCase();
    if (await db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) email = `${r.university_id}@students.invalid`.toLowerCase();
    // the initial password is the University ID; it must be changed at first login
    const uid = (await db.prepare('INSERT INTO users (name,email,password_hash,role,university_id,must_change_password) VALUES (?,?,?,?,?,1)')
      .run(r.name, email, hashPassword(r.university_id), 'student', r.university_id)).lastInsertRowid;
    for (const c of courses) await db.prepare('INSERT INTO enrollments (user_id,course_id) VALUES (?,?)').run(uid, c);
    await db.prepare("UPDATE registration_requests SET status='approved',decided_by=?,decided_at=utc_now(),user_id=? WHERE id=?").run(user.id, uid, r.id);
    await notify(uid, 'n.registration.approved', {});
    await audit(user, 'registration.approved', { detail: { request: r.id, universityId: r.university_id, user: uid, courses } });
    return { userId: uid };
  },
  async rejectRegistration({ user, params, body }) {
    const r = (await db.prepare('SELECT * FROM registration_requests WHERE id=?').get(Number(params.id))) ?? fail(404, 'Registration request not found');
    if (r.status !== 'pending') fail(409, 'This request has already been decided');
    const note = str(body.note, 500);
    await db.prepare("UPDATE registration_requests SET status='rejected',decided_by=?,decided_at=utc_now(),decision_note=? WHERE id=?").run(user.id, note, r.id);
    await audit(user, 'registration.rejected', { detail: { request: r.id, universityId: r.university_id, note } });
    return { ok: true };
  },

  // Admin: the approved University ID list (add one or many, edit courses, remove).
  async listApprovedIds() {
    const links = await db.prepare('SELECT approved_id,course_id FROM approved_id_courses').all();
    return (await db.prepare(`SELECT a.id,a.university_id,a.name,a.created_at,
        (SELECT id FROM users u WHERE lower(u.university_id)=lower(a.university_id) LIMIT 1) AS user_id,
        (SELECT status FROM registration_requests r WHERE lower(r.university_id)=lower(a.university_id) ORDER BY r.id DESC LIMIT 1) AS request_status
      FROM approved_ids a ORDER BY a.id DESC`).all()).map(a => ({ ...a, courses: links.filter(l => l.approved_id === a.id).map(l => l.course_id) }));
  },
  // body: { ids: [{universityId, name}] } or { text: "id,name\nid2,name2" }, courseIds: [...]
  async addApprovedIds({ user, body }) {
    let rows = Array.isArray(body.ids) ? body.ids.map(x => ({ id: String(x.universityId ?? '').trim(), name: str(x.name, 100) })) : [];
    if (typeof body.text === 'string') rows = rows.concat(body.text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const [i, ...n] = l.split(/[,;\t]/); return { id: i.trim(), name: str(n.join(' '), 100) }; }));
    if (!rows.length) fail(400, 'Provide at least one University ID');
    if (rows.length > 2000) fail(400, 'Too many IDs at once (max 2000)');
    const courses = [...new Set((body.courseIds ?? []).map(Number))];
    for (const c of courses) await getCourse(c);
    let added = 0; const skipped = [];
    for (const row of rows) {
      if (!row.id || row.id.length > 30 || !ID_RE.test(row.id)) { skipped.push(row.id); continue; }
      const r = await db.prepare('INSERT INTO approved_ids (university_id,name) VALUES (?,?) ON CONFLICT DO NOTHING').run(row.id, row.name);
      if (!r.changes) { skipped.push(row.id); continue; }
      for (const c of courses) await db.prepare('INSERT INTO approved_id_courses (approved_id,course_id) VALUES (?,?)').run(r.lastInsertRowid, c);
      added++;
    }
    await audit(user, 'approved_ids.added', { detail: { added, skipped: skipped.length } });
    return { added, skipped };
  },
  async updateApprovedId({ user, params, body }) {
    const a = (await db.prepare('SELECT * FROM approved_ids WHERE id=?').get(Number(params.id))) ?? fail(404, 'ID not found');
    if (body.name !== undefined) await db.prepare('UPDATE approved_ids SET name=? WHERE id=?').run(str(body.name, 100), a.id);
    if (Array.isArray(body.courseIds)) {
      const courses = [...new Set(body.courseIds.map(Number))]; for (const c of courses) await getCourse(c);
      await db.prepare('DELETE FROM approved_id_courses WHERE approved_id=?').run(a.id);
      for (const c of courses) await db.prepare('INSERT INTO approved_id_courses (approved_id,course_id) VALUES (?,?)').run(a.id, c);
    }
    await audit(user, 'approved_ids.updated', { detail: { id: a.university_id } });
    return { ok: true };
  },
  async deleteApprovedId({ user, params }) {
    const a = (await db.prepare('SELECT * FROM approved_ids WHERE id=?').get(Number(params.id))) ?? fail(404, 'ID not found');
    if (await db.prepare('SELECT 1 FROM users WHERE lower(university_id)=lower(?)').get(a.university_id)) fail(409, 'An account already exists for this University ID');
    await db.prepare('DELETE FROM approved_ids WHERE id=?').run(a.id);
    await audit(user, 'approved_ids.removed', { detail: { id: a.university_id } });
    return { ok: true };
  },
};
