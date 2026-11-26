// Model + Repository layer: PostgreSQL database (see class diagram: model / Repository).
//
// Production: Supabase (or any PostgreSQL) through DATABASE_URL.
// Local development / tests (no DATABASE_URL): PGlite, an embedded PostgreSQL stored in DB_PATH (default data/pgdata;
// ':memory:' keeps it in memory), so the app still runs with nothing to install.
//
// API (all async):  await db.prepare(sql).get(...args) / .all(...args) / .run(...args) -> { changes, lastInsertRowid }
//                   await db.exec(sql)          await db.tx(async () => {...})          await db.close()
// SQL uses `?` placeholders; they are numbered ($1, $2, ...) once per statement.
import { AsyncLocalStorage } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';
import { HttpError } from './errors.js';

const INT8 = 20, NUMERIC = 1700;
const url = process.env.DATABASE_URL;
export const dbKind = url ? 'postgres' : 'pglite';

// ---------- drivers: acquire() gives one connection { query(sql, params) -> {rows, count}, release() } ----------
async function pgDriver() {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(INT8, v => Number(v));      // COUNT(*) etc. are bigint: return plain numbers
  pg.types.setTypeParser(NUMERIC, v => Number(v));
  const u = new URL(url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(u.hostname) || u.searchParams.get('sslmode') === 'disable';
  u.searchParams.delete('sslmode');                  // SSL is configured below (Supabase uses its own CA)
  const pool = new pg.Pool({
    connectionString: u.toString(), max: Number(process.env.DB_POOL_SIZE) || 5,
    ssl: local ? false : { rejectUnauthorized: false }, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000,
  });
  pool.on('error', e => console.error('Database connection error:', e.message)); // idle client dropped by the server
  const wrap = c => ({
    query: async (sql, params) => { const r = await c.query(sql, params); return { rows: r.rows, count: r.rowCount ?? 0 }; },
    release: (err) => c.release(err),
  });
  return {
    acquire: async () => wrap(await pool.connect()),
    query: async (sql, params) => { const r = await pool.query(sql, params); return { rows: r.rows, count: r.rowCount ?? 0 }; },
    exec: sql => pool.query(sql),
    close: () => pool.end(),
  };
}
async function pgliteDriver() {
  const { PGlite } = await import('@electric-sql/pglite');
  const path = process.env.DB_PATH || 'data/pgdata';
  if (path !== ':memory:') mkdirSync(path, { recursive: true });
  const pg = new PGlite(path === ':memory:' ? undefined : path, { parsers: { [INT8]: Number, [NUMERIC]: Number } });
  await pg.waitReady;
  // One embedded connection: a simple FIFO lock gives each transaction (or lone query) the connection to itself.
  let tail = Promise.resolve();
  const lock = () => { let release; const p = new Promise(r => { release = r; }); const prev = tail; tail = prev.then(() => p); return prev.then(() => release); };
  const run = async (sql, params) => { const r = await pg.query(sql, params); return { rows: r.rows, count: r.affectedRows ?? 0 }; };
  return {
    acquire: async () => { const release = await lock(); return { query: run, release: () => release() }; },
    query: async (sql, params) => { const release = await lock(); try { return await run(sql, params); } finally { release(); } },
    exec: async sql => { const release = await lock(); try { return await pg.exec(sql); } finally { release(); } },
    close: () => pg.close(),
  };
}
const driver = await (url ? pgDriver() : pgliteDriver());

// ---------- statements ----------
const txStore = new AsyncLocalStorage();
const compiled = new Map();
function compile(sql) {
  let out = compiled.get(sql);
  if (out) return out;
  let n = 0;
  out = sql.replace(/\?/g, () => '$' + (++n));
  if (/^\s*INSERT\b/i.test(out) && !/\bRETURNING\b/i.test(out)) out += ' RETURNING *';
  compiled.set(sql, out);
  return out;
}
// JS values that PostgreSQL would refuse: booleans -> 0/1 (flags are INTEGER columns), NaN/Infinity -> NULL.
const param = v => typeof v === 'boolean' ? (v ? 1 : 0) : (typeof v === 'number' && !Number.isFinite(v)) ? null : v === undefined ? null : v;

// Errors keep SQLite-style prefixes so callers can test /UNIQUE/, and bad user input becomes a 400 instead of a 500.
function translate(e) {
  if (!e?.code || e instanceof HttpError) return e;
  if (['22P02', '22003', '22021', '22007', '22008'].includes(e.code)) return new HttpError(400, 'Invalid input');
  const prefix = { 23505: 'UNIQUE constraint failed', 23503: 'FOREIGN KEY constraint failed', 23514: 'CHECK constraint failed', 23502: 'NOT NULL constraint failed' }[e.code];
  if (prefix) { const err = new Error(`${prefix}: ${e.constraint ?? ''} ${e.message}`, { cause: e }); err.code = e.code; return err; }
  return e;
}
async function query(sql, args) {
  const text = compile(sql), params = args.map(param);
  const tx = txStore.getStore();
  if (tx) {
    if (tx.done) throw new Error('Query issued after its transaction ended (missing await?)');
    tx.pending++;
    try { return await tx.conn.query(text, params); } catch (e) { throw translate(e); } finally { tx.pending--; }
  }
  try { return await driver.query(text, params); } catch (e) { throw translate(e); }
}

const RETRY_CODES = new Set(['40001', '40P01']); // serialization failure, deadlock: safe to run the whole transaction again
const sleep = ms => new Promise(r => setTimeout(r, ms));

export const db = {
  kind: dbKind,
  prepare(sql) {
    return {
      get: async (...args) => (await query(sql, args)).rows[0],
      all: async (...args) => (await query(sql, args)).rows,
      run: async (...args) => { const r = await query(sql, args); return { changes: r.count, lastInsertRowid: r.rows[0]?.id }; },
    };
  },
  exec: sql => driver.exec(sql),
  // Runs fn in one SERIALIZABLE transaction (every API request does): either all of its writes happen or none.
  // Nested calls become savepoints. Conflicting concurrent transactions are retried automatically.
  async tx(fn) {
    const cur = txStore.getStore();
    if (cur && !cur.done) {
      const sp = `sp${++cur.savepoints}`;
      await cur.conn.query(`SAVEPOINT ${sp}`);
      try { const r = await fn(); await cur.conn.query(`RELEASE SAVEPOINT ${sp}`); return r; }
      catch (e) { await cur.conn.query(`ROLLBACK TO SAVEPOINT ${sp}`).catch(() => {}); throw e; }
    }
    for (let attempt = 1; ; attempt++) {
      const conn = await driver.acquire();
      const ctx = { conn, savepoints: 0, pending: 0, done: false, onRollback: [] };
      let broken = null;
      try {
        await conn.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        const result = await txStore.run(ctx, fn);
        if (ctx.pending) throw new Error('A query of this transaction was not awaited');
        await conn.query('COMMIT');
        ctx.done = true;
        conn.release();
        return result;
      } catch (e) {
        ctx.done = true;
        await conn.query('ROLLBACK').catch(err => { broken = err; });
        conn.release(broken ?? undefined);
        for (const undo of ctx.onRollback.reverse()) await Promise.resolve().then(undo).catch(err => console.error('Rollback cleanup failed:', err.message));
        if (RETRY_CODES.has(e?.code) && attempt < 6) { await sleep(10 * attempt + Math.random() * 40); continue; }
        throw translate(e);
      }
    }
  },
  // Registers an undo step (e.g. delete an uploaded file) that runs if the current transaction rolls back.
  onRollback(fn) { const tx = txStore.getStore(); if (tx && !tx.done) tx.onRollback.push(fn); },
  close: () => driver.close(),
};

// ---------- schema (idempotent; created on first start) ----------
// Dates are kept as text: timestamps 'YYYY-MM-DD HH:MM:SS' (UTC) and dates 'YYYY-MM-DD', compared as strings.
await db.exec(`
CREATE OR REPLACE FUNCTION utc_now() RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS') $$;
CREATE OR REPLACE FUNCTION utc_today() RETURNS text LANGUAGE sql STABLE SET search_path = '' AS $$ SELECT pg_catalog.to_char(pg_catalog.now() AT TIME ZONE 'UTC', 'YYYY-MM-DD') $$;

CREATE TABLE IF NOT EXISTS courses (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL UNIQUE,
  team_mode TEXT NOT NULL DEFAULT 'both',            -- team | individual | both
  min_team_size INTEGER NOT NULL DEFAULT 1, max_team_size INTEGER NOT NULL DEFAULT 4,
  teams_locked INTEGER NOT NULL DEFAULT 0, show_student_ids INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL,
  course_id INTEGER NOT NULL REFERENCES courses(id),
  leader_id INTEGER, created_by INTEGER, idea TEXT, description TEXT,
  accepting INTEGER NOT NULL DEFAULT 1, locked INTEGER NOT NULL DEFAULT 0, invite_code TEXT,
  members_can_submit INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','supervisor','admin')),
  team_id INTEGER REFERENCES teams(id),
  university_id TEXT, must_change_password INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS research (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','changes_requested','approved','rejected')),
  student_id INTEGER NOT NULL REFERENCES users(id),
  supervisor_id INTEGER NOT NULL REFERENCES users(id),
  team_id INTEGER UNIQUE REFERENCES teams(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  created_at TEXT NOT NULL DEFAULT utc_now(),
  description TEXT, rejection_reason TEXT, problem TEXT, objectives TEXT, deadline TEXT
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  research_id INTEGER NOT NULL REFERENCES research(id),
  version_no INTEGER NOT NULL, filename TEXT NOT NULL,
  stored_name TEXT NOT NULL, size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT utc_now(),
  UNIQUE (research_id, version_no)
);
CREATE TABLE IF NOT EXISTS research_grades (
  research_id INTEGER PRIMARY KEY REFERENCES research(id),
  score DOUBLE PRECISION NOT NULL CHECK (score >= 0 AND score <= 100),
  comment TEXT, updated_at TEXT, published INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL, research_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at BIGINT NOT NULL                          -- milliseconds since 1970
);

-- Supervisor features: customizable stages, stage submissions/reviews/grades, team messages, audit history.
-- Nothing here is ever UPDATEd destructively or DELETEd by the API except stages that have not started.
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  supervisor_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  position INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL, description TEXT, instructions TEXT,
  start_date TEXT, deadline TEXT,
  max_grade DOUBLE PRECISION NOT NULL DEFAULT 100 CHECK (max_grade > 0 AND max_grade <= 1000),
  allowed_formats TEXT NOT NULL DEFAULT 'pdf,doc,docx',
  max_file_mb DOUBLE PRECISION NOT NULL DEFAULT 10 CHECK (max_file_mb > 0 AND max_file_mb <= 10),
  allow_resubmit INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER,
  state TEXT NOT NULL DEFAULT 'scheduled' CHECK (state IN ('scheduled','open','closed','postponed')),
  assign_all INTEGER NOT NULL DEFAULT 0,
  grades_locked INTEGER NOT NULL DEFAULT 0,
  allow_late INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE TABLE IF NOT EXISTS stage_criteria (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  name TEXT NOT NULL, max_score DOUBLE PRECISION NOT NULL CHECK (max_score > 0), position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS stage_targets (
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  research_id INTEGER NOT NULL REFERENCES research(id),
  extra_attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT utc_now(),
  PRIMARY KEY (stage_id, research_id)
);
CREATE TABLE IF NOT EXISTS stage_submissions (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  research_id INTEGER NOT NULL REFERENCES research(id),
  attempt_no INTEGER NOT NULL,
  filename TEXT NOT NULL, stored_name TEXT NOT NULL, size INTEGER NOT NULL,
  student_note TEXT, submitted_by INTEGER NOT NULL REFERENCES users(id),
  late INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted','approved','changes_requested','rejected')),
  created_at TEXT NOT NULL DEFAULT utc_now(),
  UNIQUE (stage_id, research_id, attempt_no)
);
CREATE TABLE IF NOT EXISTS stage_reviews (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES stage_submissions(id),
  reviewer_id INTEGER NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('approved','changes_requested','rejected','comment')),
  comment TEXT, created_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE TABLE IF NOT EXISTS stage_grades (
  stage_id INTEGER NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  research_id INTEGER NOT NULL REFERENCES research(id),
  score DOUBLE PRECISION NOT NULL CHECK (score >= 0), comment TEXT,
  graded_by INTEGER REFERENCES users(id), updated_at TEXT NOT NULL DEFAULT utc_now(),
  published INTEGER NOT NULL DEFAULT 0,               -- students see a grade only once it is published
  PRIMARY KEY (stage_id, research_id)
);
CREATE TABLE IF NOT EXISTS stage_grade_scores (
  stage_id INTEGER NOT NULL, research_id INTEGER NOT NULL,
  criterion_id INTEGER NOT NULL REFERENCES stage_criteria(id) ON DELETE CASCADE, score DOUBLE PRECISION NOT NULL CHECK (score >= 0),
  PRIMARY KEY (stage_id, research_id, criterion_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  supervisor_id INTEGER NOT NULL REFERENCES users(id),
  team_id INTEGER REFERENCES teams(id), student_id INTEGER REFERENCES users(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'message' CHECK (kind IN ('message','announcement','reminder')),
  body TEXT NOT NULL,
  stage_id INTEGER REFERENCES stages(id), submission_id INTEGER REFERENCES stage_submissions(id),
  filename TEXT, stored_name TEXT, size INTEGER,
  created_at TEXT NOT NULL DEFAULT utc_now(),
  CHECK ((team_id IS NULL) <> (student_id IS NULL))
);
CREATE TABLE IF NOT EXISTS deadline_events (
  stage_id INTEGER NOT NULL, research_id INTEGER NOT NULL, kind TEXT NOT NULL, deadline TEXT NOT NULL,
  PRIMARY KEY (stage_id, research_id, kind, deadline)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, actor_id INTEGER, action TEXT NOT NULL,
  research_id INTEGER, stage_id INTEGER, detail TEXT,
  created_at TEXT NOT NULL DEFAULT utc_now()
);

-- Student features: identity, registration, enrollment, team life-cycle.
CREATE TABLE IF NOT EXISTS enrollments (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, course_id)
);
CREATE TABLE IF NOT EXISTS approved_ids (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, university_id TEXT NOT NULL UNIQUE, name TEXT,
  created_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE TABLE IF NOT EXISTS approved_id_courses (
  approved_id INTEGER NOT NULL REFERENCES approved_ids(id) ON DELETE CASCADE,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  PRIMARY KEY (approved_id, course_id)
);
CREATE TABLE IF NOT EXISTS registration_requests (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, university_id TEXT NOT NULL, name TEXT NOT NULL, email TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT utc_now(),
  decided_by INTEGER REFERENCES users(id), decided_at TEXT, decision_note TEXT, user_id INTEGER REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS team_members (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('leader','member')),
  joined_at TEXT NOT NULL DEFAULT utc_now(), left_at TEXT
);
CREATE TABLE IF NOT EXISTS team_history (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, team_id INTEGER NOT NULL, user_id INTEGER, actor_id INTEGER,
  action TEXT NOT NULL, detail TEXT, created_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE TABLE IF NOT EXISTS team_invitations (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  invitee_id INTEGER NOT NULL REFERENCES users(id), invited_by INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at TEXT NOT NULL DEFAULT utc_now(), decided_at TEXT
);
CREATE TABLE IF NOT EXISTS join_requests (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id), message TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled')),
  created_at TEXT NOT NULL DEFAULT utc_now(), decided_at TEXT, decided_by INTEGER
);
CREATE TABLE IF NOT EXISTS membership_requests (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('add','remove','leave','leader')), user_id INTEGER NOT NULL REFERENCES users(id),
  requested_by INTEGER NOT NULL REFERENCES users(id), note TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at TEXT NOT NULL DEFAULT utc_now(), decided_by INTEGER, decided_at TEXT
);
CREATE TABLE IF NOT EXISTS topic_reviews (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, research_id INTEGER NOT NULL REFERENCES research(id),
  reviewer_id INTEGER NOT NULL REFERENCES users(id), decision TEXT NOT NULL, comment TEXT,
  created_at TEXT NOT NULL DEFAULT utc_now()
);

-- Research workflow: per-instructor settings, sequential per-research stage progression, multi-file stage submissions.
CREATE TABLE IF NOT EXISTS supervisor_settings (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  auto_first_stage INTEGER NOT NULL DEFAULT 1,       -- approving a proposal starts the course's stage workflow
  reject_policy TEXT NOT NULL DEFAULT 'resubmit',     -- resubmit | stop | advance (what a rejected stage submission does)
  updated_at TEXT NOT NULL DEFAULT utc_now()
);
CREATE TABLE IF NOT EXISTS stage_submission_files (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES stage_submissions(id),
  position INTEGER NOT NULL DEFAULT 0, filename TEXT NOT NULL, stored_name TEXT NOT NULL, size INTEGER NOT NULL
);
-- Added columns (existing rows keep their old behaviour: every target 'active', one file, replacement allowed).
ALTER TABLE research ADD COLUMN IF NOT EXISTS workflow_started_at TEXT;
ALTER TABLE courses ADD COLUMN IF NOT EXISTS archived_at TEXT;               -- term ended: read-only, hidden from lists
ALTER TABLE stages ADD COLUMN IF NOT EXISTS duration_days INTEGER;            -- deadline = activation + N days (per research)
ALTER TABLE stages ADD COLUMN IF NOT EXISTS max_files INTEGER NOT NULL DEFAULT 1;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS allow_replace INTEGER NOT NULL DEFAULT 1; -- replace a submission before review/deadline
ALTER TABLE stages ADD COLUMN IF NOT EXISTS weight DOUBLE PRECISION;          -- share (%) of the final grade; null = by marks
ALTER TABLE stage_targets ADD COLUMN IF NOT EXISTS phase TEXT NOT NULL DEFAULT 'active'; -- locked | active | completed | closed
ALTER TABLE stage_targets ADD COLUMN IF NOT EXISTS activated_at TEXT;
ALTER TABLE stage_targets ADD COLUMN IF NOT EXISTS due_date TEXT;             -- per-research deadline (overrides the stage's)
ALTER TABLE stage_targets ADD COLUMN IF NOT EXISTS completed_at TEXT;
ALTER TABLE stage_submissions ADD COLUMN IF NOT EXISTS replaced INTEGER NOT NULL DEFAULT 0; -- superseded before review
ALTER TABLE stage_submissions ADD COLUMN IF NOT EXISTS client_token TEXT;     -- idempotency: a double click submits once
-- Final presentations: time slots an instructor offers for a course; one slot per research.
CREATE TABLE IF NOT EXISTS presentation_slots (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  supervisor_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES courses(id),
  starts_at TEXT NOT NULL,                              -- 'YYYY-MM-DD HH:MM', the local time the instructor typed
  duration_min INTEGER NOT NULL, location TEXT,
  research_id INTEGER REFERENCES research(id), booked_by INTEGER REFERENCES users(id), booked_at TEXT,
  created_at TEXT NOT NULL DEFAULT utc_now(), UNIQUE (supervisor_id, course_id, starts_at)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pslot_research ON presentation_slots(research_id) WHERE research_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS presentation_schedules (
  supervisor_id INTEGER NOT NULL REFERENCES users(id), course_id INTEGER NOT NULL REFERENCES courses(id),
  locked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (supervisor_id, course_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ssub_token ON stage_submissions(research_id, client_token) WHERE client_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ssfiles_sub ON stage_submission_files(submission_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_university_id ON users(university_id) WHERE university_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_reg_pending ON registration_requests(university_id) WHERE status IN ('pending','approved');
CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_active_user_course ON team_members(user_id, course_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tm_active_team_user ON team_members(team_id, user_id) WHERE left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_inv_pending ON team_invitations(team_id, invitee_id) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_join_pending ON join_requests(team_id, user_id) WHERE status='pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_mreq_pending ON membership_requests(team_id, kind, user_id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_users_uid_lower ON users(lower(university_id));
CREATE INDEX IF NOT EXISTS idx_tm_team ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_th_team ON team_history(team_id, id);
CREATE INDEX IF NOT EXISTS idx_topic_reviews ON topic_reviews(research_id, id);
CREATE INDEX IF NOT EXISTS idx_stages_sup ON stages(supervisor_id, position);
CREATE INDEX IF NOT EXISTS idx_targets_research ON stage_targets(research_id);
CREATE INDEX IF NOT EXISTS idx_ssub_target ON stage_submissions(stage_id, research_id);
CREATE INDEX IF NOT EXISTS idx_sreview_sub ON stage_reviews(submission_id);
CREATE INDEX IF NOT EXISTS idx_msg_team ON messages(team_id, supervisor_id, id);
CREATE INDEX IF NOT EXISTS idx_msg_student ON messages(student_id, supervisor_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_research ON audit_log(research_id, id);
CREATE INDEX IF NOT EXISTS idx_audit_stage ON audit_log(stage_id, id);
CREATE INDEX IF NOT EXISTS idx_research_student ON research(student_id);
CREATE INDEX IF NOT EXISTS idx_research_supervisor ON research(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_notes_submission ON notes(submission_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

-- Supabase publishes the public schema through its REST API. Row level security with no policies keeps every table
-- closed to that API (anon / authenticated keys); this server connects as the table owner and is not affected.
DO $$ DECLARE t text; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND NOT rowsecurity LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
`);

// ---------- seed on first run ----------
if ((await db.prepare('SELECT COUNT(*) AS n FROM users').get()).n === 0) await db.tx(async () => {
  const addUser = db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)');
  if (process.env.NODE_ENV === 'production') {
    // Public deployment: no demo accounts. One admin, password from ADMIN_PASSWORD (or random, printed once).
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    let pw = process.env.ADMIN_PASSWORD;
    if (pw && pw.length < 8) { console.error('ADMIN_PASSWORD must be at least 8 characters'); process.exit(1); }
    if (!pw) { pw = randomBytes(9).toString('base64url'); console.log(`\n*** First-run admin login: ${email} / ${pw}  (change it) ***\n`); }
    await addUser.run('Administrator', email, hashPassword(pw), 'admin');
    await db.prepare('INSERT INTO courses (name) VALUES (?)').run('Software Engineering');
  } else {
    await addUser.run('System Admin', 'admin@example.com', hashPassword('admin123'), 'admin');
    await addUser.run('Dr. Sara', 'doctor@example.com', hashPassword('doctor123'), 'supervisor');
    const cid = (await db.prepare('INSERT INTO courses (name) VALUES (?)').run('Software Engineering')).lastInsertRowid;
    const addStudent = async (name, email, uid) => {
      const id = (await db.prepare('INSERT INTO users (name,email,password_hash,role,university_id) VALUES (?,?,?,?,?)').run(name, email, hashPassword('student123'), 'student', uid)).lastInsertRowid;
      await db.prepare('INSERT INTO enrollments (user_id,course_id) VALUES (?,?)').run(id, cid);
    };
    await addStudent('Ahmed', 'student@example.com', '20240001');
    await addStudent('Lina', 'student2@example.com', '20240002');
    // Approved university IDs (students may register with these; demo: 20240003-20240008).
    for (const [uid, name] of [['20240003', 'Omar'], ['20240004', 'Mona'], ['20240005', 'Khaled'], ['20240006', 'Huda'], ['20240007', 'Yousef'], ['20240008', 'Reem']]) {
      const a = (await db.prepare('INSERT INTO approved_ids (university_id,name) VALUES (?,?)').run(uid, name)).lastInsertRowid;
      await db.prepare('INSERT INTO approved_id_courses (approved_id,course_id) VALUES (?,?)').run(a, cid);
    }
  }
});
