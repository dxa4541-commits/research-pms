# Research Project Management System

Web app built from the use-case and class diagrams (student / supervisor / admin).
Zero dependencies — needs only Node.js 22.5+ (uses the built-in `node:sqlite`).

## About the project / نبذة عن المشروع
Research Project Management System lets students register research topics and upload versions of their work,
supervisors (doctors) review, comment on and grade that work, and admins manage users, deadlines and progress reports.

نظام لإدارة المشاريع البحثية: يسجّل الطالب موضوع بحثه ويرفع نسخ العمل، ويراجع الدكتور (المشرف) العمل ويعلّق عليه ويقيّمه،
ويدير المسؤول المستخدمين والمواعيد النهائية والتقارير.

## Supervisor (Doctor) permissions / صلاحيات الدكتور
| Permission / الصلاحية | Details |
|---|---|
| Approve or reject a research topic / قبول أو رفض الموضوع | Optional comment; the student is notified |
| Request changes / طلب تعديلات | Comment required; status becomes `changes_requested` |
| Review a version and add notes / مراجعة النسخة وإضافة ملاحظات | Per submission; the student is notified |
| Grade research / تقييم البحث | Score 0–100, one grade per research (can be updated) |
| Download submitted files / تحميل الملفات المرفوعة | For his own research only |
| View my students and their research / عرض طلابي وأبحاثهم | Only research assigned to him |
| Form teams / تكوين الفرق | Group students into a team for a course (also available to admin) |
| View notifications / الإشعارات | New versions, deadlines |
| Change own password / تغيير كلمة المرور | |

**Not allowed for the supervisor / غير مسموح:** managing users or roles, setting deadlines, viewing reports, registering topics or uploading versions,
and accessing research of other supervisors (each action on a research is limited to its assigned supervisor).

```bash
npm start        # http://localhost:3000   (PORT env var to change)
npm test         # end-to-end test of every use case
```

## Demo accounts (created on first run — change them!)
| Role | Email | Password |
|---|---|---|
| Admin | admin@example.com | admin123 |
| Supervisor | doctor@example.com | doctor123 |
| Student | student@example.com | student123 |

## Use cases → where they live
| Use case | Actor | Endpoint / controller fn |
|---|---|---|
| Log in | all | `POST /api/login` |
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

## Structure (MVC, as in the class diagram)
- `public/` — view (client): `app.js` (shell/login), `core.js` (helpers, API client), `views/` (research + admin screens), `i18n.js`
- `server.js` — routing + role checks
- `src/controller.js` + `src/controllers/` — controller (auth, research, review, admin, notifications)
- `src/research.js`, `src/notifications.js`, `src/errors.js` — model helpers
- `src/db.js` — SQL repository (`data/app.db`); `src/files.js` — file store (`uploads/`) and Check file

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
- No orphan files when a submission fails; concurrent version uploads return 409 instead of corrupting numbering.
- SQLite in WAL mode with a busy timeout; expired sessions purged hourly; request logging (`LOG=off` to silence); graceful shutdown on SIGTERM/SIGINT.

## Reset data
Stop the server and delete `data/app.db` and the files in `uploads/`; demo data is re-created on next start.
