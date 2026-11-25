// Supabase Storage backend, tested against a small fake of the Supabase Storage REST API.
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';

// ---------- fake Supabase Storage ----------
const KEY = 'sb_secret_test_key';
const buckets = new Map(); // id -> { public, objects: Map(name -> Buffer) }
const seen = [];
const fake = http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const reply = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  seen.push(`${req.method} ${req.url}`);
  if (req.headers.apikey !== KEY) return reply(401, { message: 'Invalid API key' });
  if (req.headers.authorization) return reply(401, { message: 'secret keys must not be sent as a Bearer token' });
  const url = new URL(req.url, 'http://x');
  if (req.method === 'POST' && url.pathname === '/storage/v1/bucket') {
    const { id, public: pub } = JSON.parse(body);
    if (buckets.has(id)) return reply(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    buckets.set(id, { public: pub, objects: new Map() }); return reply(200, { name: id });
  }
  const m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)(?:\/(.+))?$/);
  const bucket = m && buckets.get(m[1]);
  if (!bucket) return reply(400, { statusCode: '404', error: 'Bucket not found', message: 'Bucket not found' });
  const name = m[2] && decodeURIComponent(m[2]);
  if (req.method === 'POST' && name) {
    if (bucket.objects.has(name)) return reply(400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
    bucket.objects.set(name, body); return reply(200, { Key: `${m[1]}/${name}` });
  }
  if (req.method === 'GET' && name) {
    if (!bucket.objects.has(name)) return reply(400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
    res.writeHead(200, { 'Content-Type': 'application/octet-stream' }); return res.end(bucket.objects.get(name));
  }
  if (req.method === 'DELETE' && !name) {
    const { prefixes } = JSON.parse(body); for (const p of prefixes) bucket.objects.delete(p); return reply(200, []);
  }
  reply(404, { message: 'unknown route' });
});
await new Promise(r => fake.listen(0, r));

// ---------- the app, configured for Supabase Storage ----------
const dir = mkdtempSync(join(tmpdir(), 'pms-'));
process.env.LOG = 'off';
if (!process.env.DATABASE_URL) process.env.DB_PATH = join(dir, 'pg');
process.env.SUPABASE_URL = `http://localhost:${fake.address().port}/`;
process.env.SUPABASE_SERVICE_ROLE_KEY = KEY;
process.env.SUPABASE_BUCKET = 'research-files';
const { server } = await import('../server.js');
const { storage } = await import('../src/storage.js');
await new Promise(r => server.listen(0, r));
const base = `http://localhost:${server.address().port}`;
async function call(method, path, body, token) {
  const res = await fetch(base + '/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined });
  const ct = res.headers.get('content-type') ?? '';
  return { status: res.status, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
let n = 0; const ok = name => console.log(`ok ${++n} - ${name}`);
const objects = () => buckets.get('research-files').objects;

assert.equal(storage.kind, 'supabase'); ok('Supabase Storage selected from the environment');
assert.equal(buckets.get('research-files')?.public, false); ok('private bucket created on first start');

const stu = (await call('POST', '/login', { email: '20240001', password: 'student123' })).body.token;
const doc = (await call('POST', '/login', { email: 'doctor@example.com', password: 'doctor123' })).body.token;
const sup = (await call('GET', '/supervisors', null, stu)).body[0], course = (await call('GET', '/courses', null, stu)).body[0];
const content = Buffer.from('%PDF-1.4 stored in supabase');
const r1 = await call('POST', '/research', { title: 'Cloud', courseId: course.id, supervisorId: sup.id, filename: 'p.pdf', data: content.toString('base64') }, stu);
assert.equal(r1.status, 200); assert.equal(objects().size, 1); ok('upload goes to the bucket');

const d = (await call('GET', `/research/${r1.body.id}`, null, doc)).body;
const dl = await call('GET', `/submissions/${d.submissions[0].id}/file`, null, doc);
assert.equal(dl.status, 200); assert.deepEqual(dl.body, content); ok('download reads the file back from the bucket');

// a request that fails after storing its file leaves nothing behind (rows rolled back, object deleted again)
const { db } = await import('../src/db.js');
const { storeFile } = await import('../src/files.js');
await assert.rejects(db.tx(async () => { await storeFile('late.pdf', content); assert.equal(objects().size, 2); throw new Error('boom'); }), /boom/);
assert.equal(objects().size, 1); assert.ok(seen.some(x => x.startsWith('DELETE /storage/v1/object/research-files'))); ok('rolled-back request deletes its uploaded object');

objects().clear();
assert.equal((await call('GET', `/submissions/${d.submissions[0].id}/file`, null, doc)).status, 404); ok('missing object -> 404');

console.log(`\nAll ${n} storage checks passed`);
server.close(); fake.close();
await db.close();
