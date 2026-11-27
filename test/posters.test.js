// Project posters: each project fills in its one-slide page, the system builds the .pptx from the template,
// and the supervisor's posters folder lists the projects and downloads one slide or all of them.
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import assert from 'node:assert/strict';

const dir = mkdtempSync(join(tmpdir(), 'pms-poster-'));
process.env.LOG = 'off'; process.env.DB_PATH = join(dir, 'pg'); process.env.UPLOAD_DIR = join(dir, 'up');
const { server } = await import('../server.js');
const { readZip } = await import('../src/zip.js');
const { qrPng, imageSize } = await import('../src/poster.js');
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
async function call(method, path, body, token) {
  const res = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = (res.headers.get('content-type') ?? '').includes('json');
  return { status: res.status, body: json ? await res.json() : Buffer.from(await res.arrayBuffer()), type: res.headers.get('content-type') };
}
const login = async (email, password) => (await call('POST', '/login', { email, password })).body.token;
let n = 0; const ok = name => console.log(`ok ${++n} - ${name}`);
const is = async (p, status, name) => { const r = await p; assert.equal(r.status, status, `${name}: got ${r.status} ${JSON.stringify(r.body)?.slice(0, 200)}`); ok(name); return r; };
const keys = async tok => (await call('GET', '/notifications', null, tok)).body.map(x => JSON.parse(x.message).k);
// a small valid PNG (w × h, one colour)
const png = (w, h) => {
  const { crc32 } = { crc32: b => { let c, crc = 0xffffffff; for (const x of b) { c = (crc ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; } };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td)); return Buffer.concat([l, td, c]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80); for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  return Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
};

// ---- generator pieces ----
assert.deepEqual(imageSize(png(160, 90)), { w: 160, h: 90 }); ok('PNG size read from the header');
const q = qrPng('https://example.com'); assert.ok(imageSize(q).w > 200); ok('QR code rendered as a PNG');

// ---- setup: a team project (leader + member) and an individual one ----
const admin = await login('admin@example.com', 'admin123'), doc = await login('doctor@example.com', 'doctor123');
const lead = await login('20240001', 'student123'), mate = await login('20240002', 'student123');
const course = (await call('GET', '/courses', null, admin)).body[0];
await call('POST', '/users', { name: 'Solo', email: 'solo@example.com', password: 'secret1', role: 'student', courseIds: [course.id] }, admin);
const solo = await login('solo@example.com', 'secret1');
const sup = (await call('GET', '/supervisors', null, lead)).body[0];
const mateId = (await call('GET', `/available-students?courseId=${course.id}`, null, lead)).body.find(s => s.name === 'Lina').id;
const rid = (await call('POST', '/research', { title: 'Team project', courseId: course.id, supervisorId: sup.id, newTeam: { name: 'team1', memberIds: [mateId] } }, lead)).body.id;
const inv = (await call('GET', '/invitations', null, mate)).body.find(i => i.status === 'pending');
await call('POST', `/invitations/${inv.id}/respond`, { accept: true }, mate);
const sid = (await call('POST', '/research', { title: 'Solo project', courseId: course.id, supervisorId: sup.id }, solo)).body.id;

// ---- student fills in the poster ----
let g = await is(call('GET', `/research/${rid}/poster`, null, lead), 200, 'the team reads its (empty) poster');
assert.equal(g.body.can_edit, true); assert.equal(g.body.complete, false); assert.deepEqual(g.body.missing.length, 8); assert.equal(g.body.members.length, 2); ok('every field is listed as missing; team members come from the system');
assert.equal((await call('GET', `/research/${rid}/poster`, null, mate)).body.can_edit, false); ok('a member cannot edit when the team does not allow it');
await is(call('PUT', `/research/${rid}/poster`, { name_ar: 'x' }, mate), 403, 'member edit refused');
await is(call('PUT', `/research/${rid}/poster`, { name_ar: 'x' }, solo), 403, 'another student cannot edit');
await is(call('PUT', `/research/${rid}/poster`, { name_ar: 'x' }, doc), 403, 'supervisors do not edit posters');
await is(call('PUT', `/research/${rid}/poster`, { colleges: ['mars'] }, lead), 400, 'unknown college refused');
await is(call('PUT', `/research/${rid}/poster`, { url: 'not a link' }, lead), 400, 'bad link refused');
await is(call('PUT', `/research/${rid}/poster`, { name_ar: 'x'.repeat(61) }, lead), 400, 'too long name refused');
await is(call('PUT', `/research/${rid}/poster`, { desktop: { filename: 'a.pdf', data: Buffer.from('%PDF-1').toString('base64') } }, lead), 415, 'only png / jpg screenshots');
let s = await is(call('PUT', `/research/${rid}/poster`, { name_ar: 'منصة المشاريع', name_en: 'Projects Hub', audience: 'طلاب الجامعة', description: 'منصة لإدارة المشاريع البحثية.',
  colleges: ['computer', 'other'], other_college: 'الدراسات العليا', url: 'hub.example.com' }, lead), 200, 'the leader saves the text fields');
assert.deepEqual(s.body.missing, ['desktop', 'mobile']); ok('only the screenshots are still missing');
assert.equal((await call('GET', `/research/${rid}/poster`, null, lead)).body.poster.url, 'https://hub.example.com/'); ok('the link gets https://');
let f = await is(call('GET', '/posters', null, doc), 200, 'the supervisor opens the posters folder');
assert.equal(f.body.items.find(i => i.research_id === rid).state, 'partial'); assert.equal(f.body.items.find(i => i.research_id === sid).state, 'empty'); ok('folder shows partial and empty posters');
await is(call('GET', `/posters/pptx?courseId=${course.id}`, null, doc), 409, 'no complete poster yet → nothing to download');
s = await is(call('PUT', `/research/${rid}/poster`, { desktop: { filename: 'd.png', data: png(320, 200).toString('base64') }, mobile: { filename: 'm.png', data: png(90, 200).toString('base64') } }, lead), 200, 'screenshots uploaded');
assert.equal(s.body.complete, true); ok('the poster is complete');
assert.ok((await keys(doc)).includes('n.poster.done')); ok('the supervisor is notified');
const img = await is(call('GET', `/research/${rid}/poster/image/desktop`, null, mate), 200, 'team members can see the screenshot');
assert.equal(img.type, 'image/png'); ok('served as an image');
await is(call('GET', `/research/${rid}/poster/image/desktop`, null, solo), 403, 'other students cannot');

// ---- the slide ----
const one = await is(call('GET', `/research/${rid}/poster/pptx`, null, lead), 200, 'the team downloads its slide');
let z = readZip(one.body);
const slide = z.get('ppt/slides/slide1.xml').toString();
assert.ok(slide.includes('منصة المشاريع') && slide.includes('Projects Hub') && slide.includes('hub.example.com') && slide.includes('الدراسات العليا')); ok('the slide carries the entered text');
assert.ok(slide.includes('Ahmed') || slide.includes('Lina')); ok('team names come from the team');
assert.ok(!slide.includes('your-project.app') && !slide.includes('ضع لقطة سطح المكتب هنا')); ok('template placeholders are replaced');
assert.ok(z.has('ppt/media/poster1-qr.png') && z.has('ppt/media/poster1-desktop.png') && z.has('ppt/media/poster1-mobile.png')); ok('QR code and screenshots are embedded');
assert.ok(!z.has('ppt/slides/slide2.xml') && !z.has('ppt/notesSlides/notesSlide2.xml')); ok('only the project slide is in the file');

// ---- the folder: download all ----
await call('PUT', `/research/${sid}/poster`, { name_ar: 'مشروع فردي' }, solo);
z = readZip((await is(call('GET', `/posters/pptx?courseId=${course.id}`, null, doc), 200, 'download complete posters')).body);
assert.ok(z.has('ppt/slides/slide1.xml') && !z.has('ppt/slides/slide2.xml')); ok('only complete posters by default');
z = readZip((await is(call('GET', `/posters/pptx?courseId=${course.id}&all=1`, null, doc), 200, 'download every started poster')).body);
assert.ok(z.has('ppt/slides/slide2.xml')); assert.equal((z.get('ppt/presentation.xml').toString().match(/<p:sldId /g) ?? []).length, 2); ok('one slide per project');
await call('POST', '/users', { name: 'Dr. X', email: 'x@example.com', password: 'secret1', role: 'supervisor' }, admin);
const doc2 = await login('x@example.com', 'secret1');
assert.equal((await call('GET', '/posters', null, doc2)).body.items.length, 0); ok("other supervisors do not see these projects");
await is(call('GET', `/posters/pptx?courseId=${course.id}&all=1`, null, doc2), 409, "and cannot download them");
await is(call('GET', '/posters', null, lead), 403, 'students have no folder');
assert.ok((await call('GET', `/research/${rid}/history`, null, doc)).body.map(h => h.action).includes('poster.saved')); ok('changes are in the research history');

// removing a screenshot makes the poster incomplete again
s = await is(call('PUT', `/research/${rid}/poster`, { mobile: null }, lead), 200, 'a screenshot can be removed');
assert.deepEqual(s.body.missing, ['mobile']); ok('poster incomplete again');

console.log(`\nAll ${n} poster checks passed`);
server.close(); process.exit(0);
