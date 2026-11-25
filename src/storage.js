// Where uploaded files live (the Filestore of the class diagram).
// Supabase Storage when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (private bucket SUPABASE_BUCKET, default "uploads");
// otherwise a local folder (UPLOAD_DIR, default "uploads"). Files are only ever read through the API, which checks access.
import { mkdirSync } from 'node:fs';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').replace(/\/+$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? '';
const BUCKET = process.env.SUPABASE_BUCKET || 'uploads';

function localStore() {
  const dir = process.env.UPLOAD_DIR || 'uploads';
  mkdirSync(dir, { recursive: true });
  return {
    kind: 'local', dir,
    put: (name, buf) => writeFile(join(dir, name), buf),
    get: async name => { try { return await readFile(join(dir, name)); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } },
    remove: async name => { try { await unlink(join(dir, name)); } catch (e) { if (e.code !== 'ENOENT') throw e; } },
  };
}

function supabaseStore() {
  // Legacy service_role keys are JWTs (sent as apikey + Bearer); new secret keys (sb_secret_...) go in the apikey header only.
  const headers = { apikey: KEY, ...(KEY.startsWith('eyJ') ? { Authorization: `Bearer ${KEY}` } : {}) };
  const api = (path, init = {}) => fetch(`${SUPABASE_URL}/storage/v1/${path}`, { ...init, headers: { ...headers, ...init.headers } });
  const objectPath = name => `object/${BUCKET}/${encodeURIComponent(name)}`;
  const failure = async (what, res) => new Error(`Supabase Storage ${what} failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return {
    kind: 'supabase', bucket: BUCKET,
    // Create the private bucket on first start (an existing bucket is fine).
    async init() {
      const res = await api('bucket', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: BUCKET, name: BUCKET, public: false }) });
      if (res.ok) return;
      const text = await res.text();
      if (res.status === 409 || /already exists|Duplicate/i.test(text)) return;
      throw new Error(`Supabase Storage bucket "${BUCKET}" could not be created: ${res.status} ${text.slice(0, 200)}`);
    },
    async put(name, buf) {
      const res = await api(objectPath(name), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-upsert': 'false' }, body: buf });
      if (!res.ok) throw await failure('upload', res);
    },
    async get(name) {
      const res = await api(objectPath(name));
      if (res.ok) return Buffer.from(await res.arrayBuffer());
      const text = await res.text();
      if (res.status === 404 || (res.status === 400 && /not.?found/i.test(text))) return null;
      throw new Error(`Supabase Storage download failed: ${res.status} ${text.slice(0, 200)}`);
    },
    async remove(name) {
      const res = await api(`object/${BUCKET}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [name] }) });
      if (!res.ok && res.status !== 404) throw await failure('delete', res);
    },
  };
}

if (SUPABASE_URL && !KEY) throw new Error('SUPABASE_URL is set but SUPABASE_SERVICE_ROLE_KEY is missing');
export const storage = SUPABASE_URL ? supabaseStore() : localStore();
if (storage.init) await storage.init();
