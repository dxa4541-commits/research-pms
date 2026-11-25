// Controller (class diagram): one handler per use case, grouped by responsibility.
import { authHandlers } from './controllers/auth.js';
import { researchHandlers } from './controllers/research.js';
import { reviewHandlers } from './controllers/review.js';
import { adminHandlers } from './controllers/admin.js';
import { notificationHandlers } from './controllers/notifications.js';

export { HttpError } from './errors.js';
export { MAX_FILE_BYTES } from './files.js';
export { authenticate } from './controllers/auth.js';

export const handlers = {
  ...authHandlers, ...researchHandlers, ...reviewHandlers, ...adminHandlers, ...notificationHandlers,
};
