// File store + «Check file (size & type)» — the Filestore of the class diagram.
import { mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { db } from './db.js';
import { fail } from './errors.js';

export const UPLOAD_DIR = process.env.UPLOAD_DIR || 'uploads';
mkdirSync(UPLOAD_DIR, { recursive: true });
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

// ---------- Check file (size & type) — «include» of Upload new version ----------
const MAGIC = {
  pdf: [Buffer.from('%PDF')],
  doc: [Buffer.from('D0CF11E0', 'hex')],
  docx: [Buffer.from('PK\x03\x04', 'latin1')],
};
export function checkFile(filename, base64) {
  if (typeof filename !== 'string' || typeof base64 !== 'string' || !base64)
    fail(400, 'A file is required');
  const ext = filename.split('.').pop().toLowerCase();
  if (!MAGIC[ext]) fail(415, `File type .${ext} not allowed (allowed: ${Object.keys(MAGIC).join(', ')})`);
  const buf = Buffer.from(base64, 'base64');
  if (buf.length === 0) fail(400, 'File is empty');
  if (buf.length > MAX_FILE_BYTES) fail(413, 'File exceeds the 10 MB limit');
  if (!MAGIC[ext].some(m => buf.subarray(0, m.length).equals(m)))
    fail(415, `File content does not match its .${ext} extension`);
  return { buf, ext };
}

// Sequence diagram steps 4-5: create(versionNo + 1) the submission, then saveFile(file).
export function createSubmission(researchId, versionNo, filename, buf) {
  const stored = `${randomUUID()}.bin`;
  const path = join(UPLOAD_DIR, stored);
  const safeName = filename.replace(/[^\w.\- ]+/g, '_').slice(0, 120);
  let id;
  try {
    id = Number(db.prepare(
      'INSERT INTO submissions (research_id,version_no,filename,stored_name,size) VALUES (?,?,?,?,?)')
      .run(researchId, versionNo, safeName, stored, buf.length).lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/.test(e.message)) fail(409, 'Another version was uploaded at the same time; please retry');
    throw e;
  }
  try { saveFile(path, buf); }
  catch (e) { db.prepare('DELETE FROM submissions WHERE id=?').run(id); removeFile(path); throw e; } // never leave a row without a file
  return { id, path };
}
const saveFile = (path, buf) => writeFileSync(path, buf);
// Best-effort cleanup: a file that is already gone is fine, any other failure is reported.
export const removeFile = p => {
  try { unlinkSync(p); }
  catch (e) { if (e.code !== 'ENOENT') console.error('Could not remove file', p, e.message); }
};
