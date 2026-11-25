// Log in / session handling (class diagram: User.login()).
import { db } from '../db.js';
import { fail } from '../errors.js';
import { hashPassword, verifyPassword, newToken } from '../auth.js';
import { RateLimiter } from '../ratelimit.js';

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);   // per IP + email
const ipLimiter = new RateLimiter(50, 15 * 60 * 1000);     // per IP overall

const publicUser = u => ({ id: u.id, name: u.name, email: u.role === 'student' && u.university_id ? null : u.email, role: u.role, university_id: u.university_id, must_change_password: !!u.must_change_password });

export const authHandlers = {
  // Log in. Students use their University ID (or the e-mail, only when they have no University ID); staff use their e-mail.
  login({ body, ip = 'unknown' }) {
    const ident = String(body.universityId ?? body.email ?? '').trim(); // phone keyboards often add a trailing space
    const pw = String(body.password ?? '');
    const k1 = `${ip}|${ident.toLowerCase()}`;
    if (loginLimiter.blocked(k1) || ipLimiter.blocked(ip)) fail(429, 'Too many login attempts. Try again in 15 minutes');
    let u = ident ? db.prepare('SELECT * FROM users WHERE lower(university_id)=lower(?)').get(ident) : null;
    if (!u && ident) {
      const byMail = db.prepare('SELECT * FROM users WHERE email=?').get(ident.toLowerCase());
      if (byMail && !(byMail.role === 'student' && byMail.university_id)) u = byMail;
    }
    if (!u || !verifyPassword(pw, u.password_hash)) {
      // someone whose registration is still pending / was rejected: tell them (only when they know the initial password = their ID)
      const reg = !u && ident ? db.prepare("SELECT status FROM registration_requests WHERE lower(university_id)=lower(?) AND status IN ('pending','rejected') ORDER BY id DESC LIMIT 1").get(ident) : null;
      if (reg && pw === ident) fail(403, reg.status === 'pending' ? 'Your registration request is pending approval' : 'Your registration request was rejected');
      loginLimiter.fail(k1); ipLimiter.fail(ip); fail(401, 'Invalid credentials');
    }
    if (!u.active) fail(403, 'Your account is deactivated');
    loginLimiter.reset(k1);
    const token = newToken();
    db.prepare('INSERT INTO sessions (token,user_id,created_at) VALUES (?,?,?)').run(token, u.id, Date.now());
    return { token, user: publicUser(u) };
  },
  logout({ token }) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return { ok: true }; },
  me({ user }) { return publicUser(user); },
  changePassword({ user, token, body }) {
    if (!verifyPassword(String(body.currentPassword ?? ''), user.password_hash)) fail(403, 'Current password is incorrect');
    if (typeof body.newPassword !== 'string' || body.newPassword.length < 6) fail(400, 'Password must be at least 6 characters');
    if (body.newPassword === body.currentPassword) fail(400, 'The new password must be different from the current one');
    if (user.university_id && body.newPassword.toLowerCase() === user.university_id.toLowerCase()) fail(400, 'The new password cannot be your University ID');
    db.prepare('UPDATE users SET password_hash=?, must_change_password=0 WHERE id=?').run(hashPassword(body.newPassword), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id, token); // sign out other devices
    return { ok: true };
  },
};

export function authenticate(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  if (Date.now() - s.created_at > SESSION_TTL_MS) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return null; }
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id);
  return u && u.active ? u : null;
}

// Housekeeping: drop expired sessions and stale limiter entries (does not keep the process alive).
export function cleanup() {
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_TTL_MS);
  loginLimiter.prune(); ipLimiter.prune();
}
