# Research Project Management System

Web app built from the use-case and class diagrams (student / supervisor / admin).
Node.js 22.9+. Data lives in **Supabase** (PostgreSQL + Storage) — setup guide: [docs/SUPABASE.md](docs/SUPABASE.md) (بالعربية).
Without Supabase settings it runs locally with an embedded PostgreSQL (PGlite), so `npm install && npm start` is all you need to try it.

## About the project / نبذة عن المشروع
Research Project Management System lets students register research topics and upload versions of their work,
supervisors (doctors) review, comment on and grade that work, and admins manage users, deadlines and progress reports.

نظام لإدارة المشاريع البحثية: يسجّل الطالب موضوع بحثه ويرفع نسخ العمل، ويراجع الدكتور (المشرف) العمل ويعلّق عليه ويقيّمه،
ويدير المسؤول المستخدمين والمواعيد النهائية والتقارير.

Full description: [docs/PROJECT_DESCRIPTION.md](docs/PROJECT_DESCRIPTION.md) — الوصف الكامل للمشروع.  
Requirements traceability: [supervisor](docs/SUPERVISOR_REQUIREMENTS.md) · [student](docs/STUDENT_REQUIREMENTS.md) · UI design system: [docs/UI_DESIGN.md](docs/UI_DESIGN.md).

## Supervisor (Doctor) permissions / صلاحيات الدكتور
Research (own only): approve, reject **with reason**, request changes · custom stages (any number, formats, size, attempts, deadlines, rubric, assignment to students/teams, open/close/postpone, reorder) ·
review and download every submission (all attempts kept), approve/modify/reject with feedback, allow resubmission · grade each stage (rubric) and the final research (0–100) ·
manage teams (members, leader) · private messages, announcements and reminders · notifications · dashboard and reports (CSV) · history of every action.
Not allowed: users/roles/course creation (team rules of a course can be set), global deadlines, other supervisors' data, deleting submissions or history.
Details and mapping to code: [docs/SUPERVISOR_REQUIREMENTS.md](docs/SUPERVISOR_REQUIREMENTS.md).

Approved University IDs for trying the registration flow (non-production): `20240003` … `20240008`
(register → the admin approves under **Registrations** → first login with password = the ID → forced password change).

## Use cases → where they live
| Use case | Actor | Endpoint / controller fn |
|---|---|---|
| Log in (University ID for students, e-mail for staff) | all | `POST /api/login` |
| Register by University ID (checked against the approved list) | visitor | `POST /api/register` |
| Approve / reject registration, manage approved IDs and enrollments | admin | `/api/registrations…`, `/api/approved-ids…`, `PUT /api/users/:id/enrollments` |
| First-login password change (forced) | student | `POST /api/me/password`, gate in `server.js` |
| Available students, create team, invitations, join requests, invitation code, leave/remove/lock + change requests | student | `src/controllers/studentTeams.js` |
| Student dashboard | student | `GET /api/student/dashboard` |
| Edit & resubmit a topic, publish grades | student / supervisor | `PUT /api/research/:id/topic`, `…/grade/publish`, `…/targets/:rid/publish` |
| Register research topic | student | `POST /api/research` → `registerTopic` |
| Upload new version (+ Check file) | student | `POST /api/research/:id/versions` → `uploadVersion`, `checkFile` |
| View status & feedback | student | `GET /api/research[/:id]` |
| Approve / reject | supervisor | `POST /api/research/:id/approve` → `approve` |
| Request changes («extend») | supervisor | `POST /api/research/:id/request-changes` → `requestChanges` |
| Review version & add notes (+ Send notification) | supervisor | `POST /api/submissions/:id/notes` → `addNote`, `notify` |
| Grade submission (one grade per research) | supervisor | `PUT /api/research/:id/grade` → `grade` |
| Form teams | supervisor/admin | `POST /api/teams` → `formTeams` |
| Manage users | admin | `/api/users` → `createUser`, `updateUser`, `deleteUser` |
| Assign authorization | admin | `PATCH /api/users/:id/role` → `assignRole` |
| View progress reports | admin | `GET /api/reports` |
| Set deadlines / identify overdue research (FR9) | admin | `PUT /api/research/:id/deadline` → `setDeadline`; `overdue` flag in lists & reports |
| View my students and their research (FR8) | supervisor | «My students» tab |
| Custom stages: create/edit/delete, assign, open/close/postpone, reorder | supervisor | `/api/stages…` → `src/controllers/stages.js` |
| Submit a stage (per-stage formats/size/attempts) | student | `POST /api/stages/:id/submissions` → `submitStage` |
| Review stage submission, stage grading (rubric), allow resubmission | supervisor | `POST /api/stage-submissions/:id/review`, `PUT /api/stages/:id/targets/:rid/grade` |
| Team management (members, leader) | supervisor/admin | `PUT /api/teams/:id/members`, `PUT /api/teams/:id/leader` |
| Private team messaging, announcements, reminders | supervisor/student | `/api/messages…` → `src/controllers/messages.js` |
| Supervisor dashboard, progress reports (+CSV), history | supervisor | `/api/supervisor/dashboard`, `/reports`, `/reports/export` |

## Structure (MVC, as in the class diagram)
- `public/` — view (client; design system in `style.css` + `ui.js`, fonts in `fonts/`): `app.js` (shell/login), `core.js` (helpers, API client), `views/` (research, stages, supervisor dashboard/reports, messages, admin screens), `i18n.js`
- `server.js` — routing + role checks
- `src/controller.js` + `src/controllers/` — controller (auth, research, review, admin, notifications)
- `src/research.js`, `src/stages.js`, `src/messages.js`, `src/notifications.js`, `src/audit.js`, `src/deadlines.js`, `src/errors.js` — model helpers (stages, messaging, history, deadline watcher)
- `src/db.js` — PostgreSQL repository (Supabase via `DATABASE_URL`, else embedded PGlite in `data/pgdata`) + schema; `src/storage.js` — Supabase Storage (else `uploads/`); `src/files.js` — Check file and stored files

## Rules enforced
- File check: allowed types pdf/doc/docx only (per requirements), ≤ 10 MB, content (magic bytes) must match the extension.
- Students see only their own / their team's research; supervisors only their assigned research; admin sees all.
- Passwords hashed with scrypt; sessions expire after 7 days.

## Non-functional requirements
- Role-based access on every endpoint; stored files get random names and versions are unique per research, so nothing is overwritten.
- Arabic + RTL (default) and English, switchable from the header (`public/i18n.js`); notifications are stored as keys and shown in each viewer's language.
- SQL indexes on the foreign keys used by every list query.

## Backend hardening
- Login rate limit: 5 failed attempts per IP+email / 50 per IP per 15 min → HTTP 429.
- Security headers (CSP, X-Frame-Options, nosniff, no-referrer) and `Cache-Control: no-store` on the API.
- `GET /api/research?status=&q=&limit=&offset=` — filter/search/page (max 500); total in `X-Total-Count`.
- `POST /api/me/password` — change own password (other sessions are signed out).
- Every API request is one `SERIALIZABLE` transaction (retried on conflicts): a failed request leaves no rows and no uploaded files behind, and concurrent uploads get distinct version numbers.
- Row level security on every table (Supabase's public REST API cannot read them); expired sessions purged hourly; request logging (`LOG=off` to silence); graceful shutdown on SIGTERM/SIGINT.

## Reset data
Local (no Supabase): stop the server and delete `data/pgdata` and `uploads/`; demo data is re-created on next start.
Supabase: see «تصفير البيانات» in [docs/SUPABASE.md](docs/SUPABASE.md).
