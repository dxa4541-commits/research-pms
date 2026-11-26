import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './src/db.js';
import { storage } from './src/storage.js';
import { handlers, authenticate, HttpError, MAX_TOTAL_BYTES } from './src/controller.js';
import { cleanup } from './src/controllers/auth.js';
import { checkDeadlines } from './src/deadlines.js';

const PUBLIC = join(fileURLToPath(new URL('.', import.meta.url)), 'public');
const MAX_BODY = Math.ceil(MAX_TOTAL_BYTES * 1.4) + 4096; // base64 overhead (a stage submission may carry several files)

const S = 'student', V = 'supervisor', A = 'admin';
// [method, path, handler, allowed roles (null = public, [] = any logged-in user)]
const routes = [
  ['POST', '/api/login', 'login', null],
  ['POST', '/api/register', 'register', null],
  ['POST', '/api/logout', 'logout', []],
  ['GET', '/api/me', 'me', []],
  ['POST', '/api/me/password', 'changePassword', []],
  ['GET', '/api/courses', 'listCourses', []],
  ['POST', '/api/courses', 'createCourse', [A]],
  ['GET', '/api/supervisors', 'listSupervisors', []],
  ['GET', '/api/students', 'listStudents', [V, A]],
  ['GET', '/api/users', 'listUsers', [A]],
  ['POST', '/api/users', 'createUser', [A]],
  ['PATCH', '/api/users/:id', 'updateUser', [A]],
  ['PATCH', '/api/users/:id/role', 'assignRole', [A]],
  ['DELETE', '/api/users/:id', 'deleteUser', [A]],
  ['GET', '/api/research', 'listResearch', []],
  ['POST', '/api/research', 'registerTopic', [S]],
  ['GET', '/api/research/:id', 'getResearchDetail', []],
  ['PUT', '/api/research/:id/deadline', 'setDeadline', [A]],
  ['POST', '/api/research/:id/versions', 'uploadVersion', [S]],
  ['POST', '/api/research/:id/approve', 'approve', [V]],
  ['POST', '/api/research/:id/request-changes', 'requestChanges', [V]],
  ['PUT', '/api/research/:id/grade', 'grade', [V]],
  ['POST', '/api/submissions/:id/notes', 'addNote', [V]],
  ['GET', '/api/submissions/:id/file', 'downloadFile', []],
  ['GET', '/api/teams', 'listTeams', [V, A]],
  ['POST', '/api/teams', 'formTeams', [V, A]],
  ['PUT', '/api/teams/:id/members', 'updateTeamMembers', [V, A]],
  ['PUT', '/api/teams/:id/leader', 'setTeamLeader', [S, V, A]],
  ['PUT', '/api/teams/:id/lock', 'setTeamLock', [V, A]],
  ['GET', '/api/teams/:id/history', 'teamHistory', [V, A]],
  ['GET', '/api/membership-requests', 'listChangeRequests', [V, A]],
  ['POST', '/api/membership-requests/:id/decide', 'decideChangeRequest', [V, A]],
  ['PUT', '/api/courses/:id/settings', 'updateCourseSettings', [V, A]],
  ['GET', '/api/courses/:id/summary', 'courseSummary', [A]],
  ['POST', '/api/courses/:id/end-term', 'endTerm', [A]],
  ['POST', '/api/courses/:id/reopen', 'reopenTerm', [A]],
  // Registration (admin)
  ['GET', '/api/registrations', 'listRegistrations', [A]],
  ['POST', '/api/registrations/:id/approve', 'approveRegistration', [A]],
  ['POST', '/api/registrations/:id/reject', 'rejectRegistration', [A]],
  ['GET', '/api/approved-ids', 'listApprovedIds', [A]],
  ['POST', '/api/approved-ids', 'addApprovedIds', [A]],
  ['PUT', '/api/approved-ids/:id', 'updateApprovedId', [A]],
  ['DELETE', '/api/approved-ids/:id', 'deleteApprovedId', [A]],
  ['PUT', '/api/users/:id/enrollments', 'setEnrollments', [A]],
  // Student: teams, invitations, join requests, dashboard
  ['GET', '/api/student/dashboard', 'studentDashboard', [S]],
  ['GET', '/api/available-students', 'availableStudents', [S]],
  ['GET', '/api/discover-teams', 'discoverTeams', [S]],
  ['GET', '/api/my/teams', 'listMyTeams', [S]],
  ['POST', '/api/my/teams', 'createMyTeam', [S]],
  ['PUT', '/api/my/teams/:id', 'updateMyTeam', [S]],
  ['DELETE', '/api/my/teams/:id', 'deleteMyTeam', [S]],
  ['GET', '/api/my/teams/:id/history', 'myTeamHistory', [S]],
  ['POST', '/api/teams/join-by-code', 'joinByCode', [S]],
  ['POST', '/api/teams/:id/invitations', 'inviteStudent', [S]],
  ['POST', '/api/teams/:id/invite-code', 'manageInviteCode', [S]],
  ['POST', '/api/teams/:id/join-requests', 'requestToJoin', [S]],
  ['GET', '/api/teams/:id/join-requests', 'listJoinRequests', [S]],
  ['DELETE', '/api/teams/:id/members/:uid', 'removeMyMember', [S]],
  ['POST', '/api/teams/:id/leave', 'leaveTeam', [S]],
  ['POST', '/api/teams/:id/change-requests', 'requestChange', [S]],
  ['GET', '/api/invitations', 'listInvitations', [S]],
  ['POST', '/api/invitations/:id/respond', 'respondInvitation', [S]],
  ['POST', '/api/invitations/:id/cancel', 'cancelInvitation', [S]],
  ['GET', '/api/join-requests/mine', 'myJoinRequests', [S]],
  ['POST', '/api/join-requests/:id/respond', 'respondJoinRequest', [S]],
  ['POST', '/api/join-requests/:id/cancel', 'cancelJoinRequest', [S]],
  ['PUT', '/api/research/:id/topic', 'editTopic', [S]],
  ['PUT', '/api/research/:id/grade/publish', 'publishFinalGrade', [V]],
  ['PUT', '/api/stages/:id/publish', 'publishStageGrades', [V]],
  ['PUT', '/api/stages/:id/targets/:rid/publish', 'publishStageGrade', [V]],
  // Stages (supervisor), stage submissions (student), per-research stage view (all roles, access-checked)
  ['GET', '/api/stages', 'listStages', [V, A]],
  ['POST', '/api/stages', 'createStage', [V]],
  ['PUT', '/api/stages/reorder', 'reorderStages', [V]],
  ['POST', '/api/stages/copy', 'copyStages', [V]],
  ['GET', '/api/stages/:id', 'getStageDetail', [V, A]],
  ['PUT', '/api/stages/:id', 'updateStage', [V]],
  ['DELETE', '/api/stages/:id', 'deleteStage', [V]],
  ['PUT', '/api/stages/:id/state', 'setStageState', [V]],
  ['PUT', '/api/stages/:id/grades-lock', 'setGradesLock', [V]],
  ['POST', '/api/stages/:id/targets', 'assignStage', [V]],
  ['DELETE', '/api/stages/:id/targets/:rid', 'unassignStage', [V]],
  ['POST', '/api/stages/:id/targets/:rid/allow-resubmit', 'allowResubmit', [V]],
  ['PUT', '/api/stages/:id/targets/:rid/grade', 'gradeStage', [V]],
  ['POST', '/api/stages/:id/remind', 'remindStage', [V]],
  ['GET', '/api/stages/:id/history', 'stageHistory', [V, A]],
  ['POST', '/api/stages/:id/submissions', 'submitStage', [S]],
  ['GET', '/api/research/:id/stages', 'researchStages', []],
  ['GET', '/api/research/:id/history', 'researchHistory', [V, A]],
  ['GET', '/api/stage-submissions/:id/file', 'downloadStageFile', []],
  ['GET', '/api/stage-submission-files/:id/file', 'downloadStageSubmissionFile', []],
  ['POST', '/api/stage-submissions/:id/review', 'reviewStageSubmission', [V]],
  // Messaging (private team threads; admin has no access)
  ['GET', '/api/messages/threads', 'listThreads', [S, V]],
  ['GET', '/api/messages', 'listMessages', [S, V]],
  ['POST', '/api/messages', 'sendMessage', [S, V]],
  ['POST', '/api/messages/announce', 'announce', [V]],
  ['GET', '/api/messages/:id/file', 'downloadMessageFile', [S, V]],
  // Supervisor dashboard & reports
  ['GET', '/api/supervisor/dashboard', 'dashboard', [V]],
  ['GET', '/api/supervisor/settings', 'getWorkflowSettings', [V]],
  ['GET', '/api/supervisor/proposals', 'proposals', [V]],
  ['PUT', '/api/supervisor/settings', 'updateWorkflowSettings', [V]],
  ['POST', '/api/supervisor/workflow/start-all', 'startAllWorkflows', [V]],
  ['POST', '/api/research/:id/workflow/start', 'startResearchWorkflow', [V]],
  ['GET', '/api/supervisor/reports', 'supervisorReport', [V]],
  ['GET', '/api/supervisor/reports/export', 'exportReport', [V]],
  ['GET', '/api/reports', 'reports', [A]],
  ['GET', '/api/notifications', 'listNotifications', []],
  ['POST', '/api/notifications/read', 'readNotifications', []],
].map(([method, path, handler, roles]) => ({
  method, handler, roles,
  re: new RegExp('^' + path.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'),
}));

// Behind a hosting proxy (Render/Fly/Railway...) set TRUST_PROXY=1 so rate limiting sees the real client IP.
const clientIp = req => process.env.TRUST_PROXY === '1'
  ? (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket.remoteAddress
  : req.socket.remoteAddress;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  // blob: frames/images: submitted PDFs and pictures are shown in the in-page viewer from a local copy (never another site)
  'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; frame-src blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const HSTS = process.env.NODE_ENV === 'production' ? { 'Strict-Transport-Security': 'max-age=31536000' } : {};
const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { ...SECURITY_HEADERS, ...HSTS, ...headers });
  res.end(body);
};
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, tooBig = false;
    req.on('data', c => {
      size += c.length;
      if (tooBig) return; // stop buffering; connection is closed after the 413 is sent
      if (size > MAX_BODY) { tooBig = true; chunks.length = 0; reject(new HttpError(413, 'Request too large')); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (tooBig) return;
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

async function api(req, res, url) {
  const t0 = Date.now();
  if (process.env.LOG !== 'off') res.on('finish', () => console.log(`${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - t0}ms`));
  try {
    const route = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!route) throw new HttpError(404, 'Not found');
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '') || null;
    const user = route.roles === null ? null : await authenticate(token);
    if (route.roles !== null) {
      if (!user) throw new HttpError(401, 'Please log in');
      if (user.must_change_password && !['changePassword', 'me', 'logout'].includes(route.handler)) throw new HttpError(403, 'You must change your initial password first');
      if (route.roles.length && !route.roles.includes(user.role)) throw new HttpError(403, 'Not allowed for your role');
    }
    const params = url.pathname.match(route.re).groups ?? {};
    const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : {};
    // One database transaction per request: a request either completes entirely or leaves nothing behind.
    const out = await db.tx(() => handlers[route.handler]({ user, token, params, body, query: url.searchParams, ip: clientIp(req) }));
    if (out?.file) {
      return send(res, 200, out.file, {
        'Content-Type': out.contentType ?? 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${encodeURIComponent(out.filename)}"`,
      });
    }
    if (out?.total !== undefined) res.setHeader('X-Total-Count', out.total);
    json(res, 200, out);
  } catch (e) {
    if (e instanceof HttpError) {
      if (e.status === 413) { res.setHeader('Connection', 'close'); res.on('finish', () => req.destroy()); }
      return json(res, e.status, { error: e.message });
    }
    console.error(e);
    json(res, 500, { error: 'Internal server error' });
  }
}

async function serveStatic(res, pathname) {
  const rel = normalize(pathname === '/' ? '/index.html' : pathname);
  const file = join(PUBLIC, rel);
  if (!file.startsWith(PUBLIC) || !MIME[extname(file)]) return send(res, 404, 'Not found');
  try { send(res, 200, await readFile(file), { 'Content-Type': MIME[extname(file)], ...(extname(file) === '.woff2' ? { 'Cache-Control': 'public, max-age=31536000, immutable' } : {}) }); }
  catch { send(res, 404, 'Not found'); }
}

export const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) api(req, res, url);
  else serveStatic(res, decodeURIComponent(url.pathname));
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Research PMS running at http://localhost:${port} (database: ${db.kind === 'postgres' ? 'PostgreSQL / Supabase' : 'local PGlite'}, files: ${storage.kind === 'supabase' ? `Supabase Storage bucket "${storage.bucket}"` : 'local folder'})`));
  // Hourly housekeeping: expired sessions + deadline reminders (does not keep the process alive).
  const tick = () => db.tx(async () => { await cleanup(); await checkDeadlines(); }).catch(e => console.error('Housekeeping failed:', e.message));
  tick(); setInterval(tick, 3600 * 1000).unref();
  const stop = () => { server.close(() => db.close().finally(() => process.exit(0))); setTimeout(() => process.exit(1), 5000).unref(); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
