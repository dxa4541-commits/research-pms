// Log in / session handling (class diagram: User.login()).
import { db } from '../db.js';
import { fail } from '../errors.js';
import { hashPassword, verifyPassword, newToken } from '../auth.js';
import { RateLimiter } from '../ratelimit.js';

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const loginLimiter = new RateLimiter(5, 15 * 60 * 1000);   // per IP + email
const ipLimiter = new RateLimiter(50, 15 * 60 * 1000);     // per IP overall

const publicUser = u => ({ id: u.id, name: u.name, email: u.email, role: u.role, team_id: u.team_id });

export const authHandlers = {
  // Log in
  login({ body, ip = 'unknown' }) {
    const email = String(body.email ?? '').trim().toLowerCase(); // phone keyboards often add a trailing space
    const k1 = `${ip}|${email}`;
    if (loginLimiter.blocked(k1) || ipLimiter.blocked(ip)) fail(429, 'Too many login attempts. Try again in 15 minutes');
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!u || !verifyPassword(String(body.password ?? ''), u.password_hash)) {
      loginLimiter.fail(k1); ipLimiter.fail(ip); fail(401, 'Invalid email or password');
    }
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
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hashPassword(body.newPassword), user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(user.id, token); // sign out other devices
    return { ok: true };
  },
};

export function authenticate(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token=?').get(token);
  if (!s) return null;
  if (Date.now() - s.created_at > SESSION_TTL_MS) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); return null; }
  return db.prepare('SELECT * FROM users WHERE id=?').get(s.user_id) ?? null;
}

// Housekeeping: drop expired sessions and stale limiter entries (does not keep the process alive).
export function cleanup() {
  db.prepare('DELETE FROM sessions WHERE created_at < ?').run(Date.now() - SESSION_TTL_MS);
  loginLimiter.prune(); ipLimiter.prune();
}
