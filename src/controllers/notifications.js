// Notifications inbox.
import { db } from '../db.js';

export const notificationHandlers = {
  // Notifications
  listNotifications({ user }) {
    return db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY id DESC LIMIT 50').all(user.id);
  },
  async readNotifications({ user }) {
    await db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(user.id); return { ok: true };
  },};
