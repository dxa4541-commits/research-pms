// Controller (class diagram): one handler per use case, grouped by responsibility.
import { authHandlers } from './controllers/auth.js';
import { researchHandlers } from './controllers/research.js';
import { reviewHandlers } from './controllers/review.js';
import { adminHandlers } from './controllers/admin.js';
import { notificationHandlers } from './controllers/notifications.js';
import { stageHandlers } from './controllers/stages.js';
import { messageHandlers } from './controllers/messages.js';
import { supervisorHandlers } from './controllers/supervisor.js';
import { registrationHandlers } from './controllers/registration.js';
import { studentTeamHandlers } from './controllers/studentTeams.js';
import { presentationHandlers } from './controllers/presentations.js';
import { posterHandlers } from './controllers/posters.js';

export { HttpError } from './errors.js';
export { MAX_FILE_BYTES, MAX_TOTAL_BYTES } from './files.js';
export { authenticate } from './controllers/auth.js';

export const handlers = {
  ...authHandlers, ...researchHandlers, ...reviewHandlers, ...adminHandlers, ...notificationHandlers,
  ...stageHandlers, ...messageHandlers, ...supervisorHandlers, ...registrationHandlers, ...studentTeamHandlers, ...presentationHandlers, ...posterHandlers,
};
