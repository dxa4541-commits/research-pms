# Supervisor (Doctor) role — requirements traceability
# تتبّع متطلبات دور الدكتور

Every requirement of the supervisor role and where it is implemented. All endpoints are role-checked in `server.js`;
ownership (the supervisor only touches **their own** research, stages, teams and conversations) is checked in the controllers.
Tests: `test/supervisor.test.js` (183 checks) + `test/smoke.test.js` (61 checks) — run `npm test`.

## 1. Research management
| Requirement | Implementation |
|---|---|
| View only assigned research (titles, descriptions, course, students, teams) | `GET /api/research` (scoped by `supervisor_id`), description added at registration |
| Approve / reject (with reason) / request modifications | `POST /api/research/:id/approve` (reject **requires** a reason, stored in `rejection_reason`), `POST …/request-changes` |
| Monitor status & progress | list shows status, versions, stages approved/total, grade; detail shows stages, totals, history |

## 2. Customizable stages (`src/controllers/stages.js`, `public/views/supervisor.js`)
| Requirement | Implementation |
|---|---|
| Create / edit / delete stages that have not started; any number of stages | `POST/PUT/DELETE /api/stages[/:id]` — a stage is "started" when open & past its start date, closed, or has any submission/grade; then edit/delete → 409 |
| Name, description, requirements, start date, deadline | stage fields `name, description, instructions, start_date, deadline` |
| Max grade per stage (+ optional rubric) | `max_grade`; with rubric criteria the max is the sum of the criteria |
| Allowed formats and file size | `allowed_formats` (pdf, doc, docx, ppt, pptx, xls, xlsx, zip, png, jpg, jpeg, txt — content checked), `max_file_mb` ≤ 10 |
| Resubmission on/off, max attempts | `allow_resubmit`, `max_attempts`; the supervisor can grant extra attempts (`+1` button / "Allow resubmission" in a review) |
| Assign to a student or a team | `POST /api/stages/:id/targets`, or "assign to all approved research of the course" (also applied automatically to research approved later) |
| Open / close / postpone | `PUT /api/stages/:id/state` (postponing needs a new start date or deadline; students are notified) |
| Reorder | `PUT /api/stages/reorder` (↑ ↓ in the UI) |
| Submission status of all students/teams per stage | `GET /api/stages/:id` → one row per assigned team/student (not submitted / awaiting / approved / changes / rejected, late, attempts, grade) |
| Independent status, deadline, grade, submissions, feedback, history per stage | tables `stage_targets`, `stage_submissions`, `stage_reviews`, `stage_grades`, `audit_log` |

## 3. Stage submissions
| Requirement | Implementation |
|---|---|
| View / download submissions | `GET /api/stage-submissions/:id/file` (owner team, supervisor, admin only) |
| Review individually: approve, request modifications with feedback, reject | `POST /api/stage-submissions/:id/review` (feedback required for modification/reject; only the latest attempt can be decided; comments allowed on older attempts) |
| Resubmission after modifications; attempts tracking | attempt numbers per (stage, research); limits enforced on upload |
| Timestamps and late detection | `created_at`, `late` flag set when submitted after the deadline; late/“not submitted past deadline” shown everywhere |
| Who has not submitted | stage page, dashboard, reports |
| **Never overwrite earlier versions** | every attempt is a new row + a new random file name; no endpoint deletes or replaces a submission or review |

## 4. Grading
| Requirement | Implementation |
|---|---|
| Grade per stage, max per stage, comments, update when permitted | `PUT /api/stages/:id/targets/:rid/grade`; "permitted" = not locked (`PUT …/grades-lock`) |
| Rubric (Research Content, References, Methodology, Organization, Language and Presentation) | per-stage criteria; "Use default rubric" fills the five criteria; stage grade = sum of criteria scores, each validated against its max |
| Total accumulated grade across stages | `stageTotals()` — earned / max / percent (research detail, student view, reports) |
| Final research grade 0–100 | `PUT /api/research/:id/grade` (+comment; "Use calculated grade" button); every change is kept in the history with the old value |

## 5. Team management (`src/controllers/admin.js`)
Create teams (any course), add/remove students (`PUT /api/teams/:id/members`), assign a leader (`PUT /api/teams/:id/leader`), see members, research and stage progress per team.
A supervisor can only gather students who are free or already in one of their own teams, and can only manage teams they created or whose research they supervise.

## 6. Messaging (`src/controllers/messages.js`, `public/views/messages.js`)
Private threads per (supervisor, team) or (supervisor, individual student): send, reply, history, link to a stage and/or a stage submission, attach a PDF/Word file,
announcement to all or selected teams (one private copy per team), deadline/missing-submission reminders (`POST /api/stages/:id/remind`).
Admin and other supervisors have **no** access to private messages; students see only their team's thread with their supervisor.

## 7. Notifications
Supervisor receives: new topic, stage submitted / resubmitted, late submission, student message, deadline approaching (≤ 2 days) and deadline passed without a submission
(`src/deadlines.js`, hourly + on dashboard/report load, each event fires once). Students/teams receive: stage created/assigned/updated, deadline or state change,
feedback, approval/rejection/modification request, grade, messages, reminders, resubmission allowed. All stored as keys and shown in the viewer's language.

## 8–9. Dashboard and reports
`GET /api/supervisor/dashboard` — assigned research, teams, topics to approve, awaiting review, approved, needing modifications, late, upcoming deadlines (14 days), recent messages, completion and average grade, quick links.
`GET /api/supervisor/reports` and `…/reports/export` (CSV, UTF-8 with BOM for Excel): research progress, per-stage statistics, teams that have not submitted, late teams, grades.

## 10–11. Restrictions and general requirements
- No access to other supervisors' research, stages, teams, threads or files (403) — covered by tests.
- Cannot manage users/roles/courses, set the admin's global deadline, or open admin reports (403).
- Cannot delete submissions, reviews, grades history or messages (no such endpoints); an `audit_log` records topic decisions, stage changes, reviews, grades, team and message actions (`GET /api/research/:id/history`, `/api/stages/:id/history`).
- Arabic (RTL) and English throughout, including notifications and server errors.

## Interpretation notes
- "Assigned courses": courses are global in this system (managed by the admin); a supervisor may create teams for any course.
- "Export reports if supported": CSV export is provided.
- "Attach files if supported": message attachments accept PDF/DOC/DOCX up to 10 MB.
