// Model + Repository layer: SQL database (see class diagram: model / Repository).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { hashPassword } from './auth.js';

const path = process.env.DB_PATH || 'data/app.db';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
export const db = new DatabaseSync(path);

db.exec(`
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
${path === ':memory:' ? '' : 'PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;'}
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  course_id INTEGER NOT NULL REFERENCES courses(id)
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','supervisor','admin')),
  team_id INTEGER REFERENCES teams(id)
);
CREATE TABLE IF NOT EXISTS research (
  id INTEGER PRIMARY KEY, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','changes_requested','approved','rejected')),
  student_id INTEGER NOT NULL REFERENCES users(id),
  supervisor_id INTEGER NOT NULL REFERENCES users(id),
  team_id INTEGER UNIQUE REFERENCES teams(id),
  course_id INTEGER NOT NULL REFERENCES courses(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY,
  research_id INTEGER NOT NULL REFERENCES research(id),
  version_no INTEGER NOT NULL, filename TEXT NOT NULL,
  stored_name TEXT NOT NULL, size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (research_id, version_no)
);
CREATE TABLE IF NOT EXISTS research_grades (
  research_id INTEGER PRIMARY KEY REFERENCES research(id),
  score REAL NOT NULL CHECK (score >= 0 AND score <= 100)
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY,
  submission_id INTEGER NOT NULL REFERENCES submissions(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  message TEXT NOT NULL, research_id INTEGER,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);
`);

// Migration: deadline column (added after v1) + indexes for scale.
if (!db.prepare("SELECT 1 FROM pragma_table_info('research') WHERE name='deadline'").get())
  db.exec('ALTER TABLE research ADD COLUMN deadline TEXT');
db.exec(`
CREATE INDEX IF NOT EXISTS idx_research_student ON research(student_id);
CREATE INDEX IF NOT EXISTS idx_research_supervisor ON research(supervisor_id);
CREATE INDEX IF NOT EXISTS idx_research_team ON research(team_id);
CREATE INDEX IF NOT EXISTS idx_notes_submission ON notes(submission_id);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, id);
CREATE INDEX IF NOT EXISTS idx_users_team ON users(team_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

// Migration: the grade now belongs to the Research (class diagram: grade 1-1 Research), not to each version.
// Older databases keep their per-version `grades` table; its latest graded version becomes the research grade.
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='grades'").get()) {
  db.exec(`INSERT OR IGNORE INTO research_grades (research_id, score)
    SELECT s.research_id, g.score FROM grades g JOIN submissions s ON s.id=g.submission_id
    WHERE s.version_no = (SELECT MAX(s2.version_no) FROM submissions s2 JOIN grades g2 ON g2.submission_id=s2.id
                          WHERE s2.research_id=s.research_id)`);
}

// Seed on first run.
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n === 0) {
  const addUser = db.prepare(
    'INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)');
  if (process.env.NODE_ENV === 'production') {
    // Public deployment: no demo accounts. One admin, password from ADMIN_PASSWORD (or random, printed once).
    const email = (process.env.ADMIN_EMAIL || 'admin@example.com').toLowerCase();
    let pw = process.env.ADMIN_PASSWORD;
    if (pw && pw.length < 8) { console.error('ADMIN_PASSWORD must be at least 8 characters'); process.exit(1); }
    if (!pw) { pw = randomBytes(9).toString('base64url'); console.log(`\n*** First-run admin login: ${email} / ${pw}  (change it) ***\n`); }
    addUser.run('Administrator', email, hashPassword(pw), 'admin');
    db.prepare('INSERT INTO courses (name) VALUES (?)').run('Software Engineering');
  } else {
    addUser.run('System Admin', 'admin@example.com', hashPassword('admin123'), 'admin');
    addUser.run('Dr. Sara', 'doctor@example.com', hashPassword('doctor123'), 'supervisor');
    addUser.run('Ahmed', 'student@example.com', hashPassword('student123'), 'student');
    addUser.run('Lina', 'student2@example.com', hashPassword('student123'), 'student');
    db.prepare('INSERT INTO courses (name) VALUES (?)').run('Software Engineering');
  }
}
