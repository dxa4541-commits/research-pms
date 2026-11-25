# Student role — requirements traceability
# تتبّع متطلبات دور الطالب

Tests: `test/student.test.js` (210 checks) · `test/smoke.test.js` · `test/supervisor.test.js` — run `npm test`.
Server-side code: `src/controllers/registration.js`, `auth.js`, `studentTeams.js`, `research.js`, `stages.js`; model: `src/teams.js`, `src/db.js`.

## 1. Registration & authentication
| Requirement | Implementation |
|---|---|
| Registration page with University ID | login screen → "Register" (`public/views/auth.js`), `POST /api/register` |
| ID must be in the approved list; reject otherwise | `approved_ids` table (admin: **Approved IDs** tab, bulk "ID,Name" lines + courses) → 403 |
| No duplicate requests / accounts | unique index on pending/approved requests, account check → 409 (a rejected student may apply again) |
| Admin approval, status "Pending Approval", decision + timestamp | `registration_requests` (`status`, `decided_by`, `decided_at`, `decision_note`), admin **Registrations** tab; every decision is audited |
| No access while pending / rejected | no account exists until approval; login says "pending"/"rejected" (only when the initial password = the ID is typed, so IDs cannot be probed) |
| Login with University ID + password; initial password = ID | `POST /api/login` accepts the ID (students with an ID cannot use e-mail); approval creates the account with `scrypt(ID)` |
| Forced password change on first login | `must_change_password`; the server refuses every endpoint except `/me`, `/me/password`, `/logout` (403) until changed; the UI shows only the change screen; the new password must differ and cannot be the ID |
| scrypt hashing; brute-force protection | `src/auth.js`; 5 failed attempts per IP+ID and 50 per IP per 15 min → 429; registration: 10 per IP per hour |

## 2. Student dashboard — `GET /api/student/dashboard`, `public/views/student.js`
Team and members, research title/description/status, topic feedback, stages with requirements, deadlines, submission status and history (in "My research"), supervisor feedback,
published stage grades + accumulated total + final grade, notifications, supervisor messages, pending invitations, pending join requests (mine and those awaiting the leader), upcoming deadlines, progress bar.
A student only ever receives data of their own research/teams (membership is checked server-side on every call).

## 3. Available students — `GET /api/available-students?courseId=`
Only active students, enrolled in the course, without a team in it and without an individual project there (and only when the course allows teams); never myself.
Fields: name, University ID (hidden when the course's privacy setting is off), course, status "available" — never e-mail or password data. Joining a team removes the student from the list.

## 4. Team creation — `POST /api/my/teams`
Course, name (unique per course), optional idea and description; the creator becomes the Team Leader. Individual research is allowed unless the course is "teams only";
min/max team size per course (`courses.min_team_size/max_team_size`, set by the supervisor/admin); one team per student per course (DB unique index + checks); all members enrolled in the course; one active research per team per course.

## 5. Invitations — `POST /api/teams/:id/invitations`
By University ID (or from the available list). Checks: active, enrolled, no team in the course, no duplicate, not full, team not locked. Statuses Pending / Accepted / Rejected / Cancelled; the invitee is notified and accepts or rejects;
membership updates on acceptance and the student leaves the available list; the leader can cancel.

## 6. Discovery & join requests
`GET /api/discover-teams` (teams accepting members: name, leader, members, size, max, places, idea, status), `POST /api/teams/:id/join-requests`, leader lists/accepts/rejects (sees name, ID, message), requester may cancel.
Duplicate / second-team / full / not-accepting / locked → refused. Notifications both ways. Invitation code (generate / disable / join by code) is also supported.

## 7–9. Leader, member permissions and membership rules
Leader: edit name/idea/description, accept/stop accepting members, allow members to submit, invite, manage the code, answer join requests, remove members, hand over leadership, register/edit the topic, submit stages and files, delete a team that has no research.
Members: view everything of their team (research, stages, submissions, files, feedback, published grades, history), converse with the supervisor, leave the team.
Members cannot delete the team, add/remove members, change the leader, change the topic, change grades, or see other teams' data (403).
**Locking:** a team is locked by the supervisor/admin, by the course, or automatically once one of its stages has started; while locked, invitations/joins/removals are refused and the leader (or a member leaving) sends a **change request**
that the supervisor/admin approves or rejects (`/api/membership-requests`). Supervisors/admins can always change membership. Every change is kept in `team_history`.

## 10. Topic registration
Title, description, problem, objectives, course, supervisor, optional file (leader only for teams; minimum team size enforced). Statuses Pending / Approved / Rejected / Changes requested; supervisor feedback is kept (`topic_reviews`) and shown;
after "changes requested" the leader edits and resubmits (`PUT /api/research/:id/topic`); an approved topic cannot be changed by students.

## 11–13. Stages, submissions, feedback and grades
Stages show name, description, instructions, start date, deadline, max grade, allowed formats, attempts left, status, feedback per submission version, grade. Student-facing statuses: Not started, Open, Submitted, Under review, Resubmitted, Changes requested, Approved, Rejected, Closed (+ Late flag).
The leader submits for the team (or members, if the leader allows it); format/size/attempts are validated against the stage; **late submissions can be disallowed per stage**; every attempt is kept with who/when/late; nothing is overwritten; all members see the history.
**Grades are visible only when published** (`PUT …/targets/:rid/publish`, "publish all", or "publish when saving"; final grade: `PUT /api/research/:id/grade/publish`); unpublished grades are hidden from every student endpoint and excluded from totals; students can never change feedback or grades.

## 14. Messaging
Private thread per (supervisor, team) or (supervisor, student): view, reply, history, messages linked to a stage/submission, attachments, notifications to all team members. Other teams, other supervisors and the admin cannot read it.

## 15. Notifications
Registration approved (waiting at first login), invitation received/accepted/rejected, join request received/accepted/rejected, member joined/left/removed, new leader, team renamed/deleted, change request decided, supervisor messages,
stage assigned/opened/updated/deadline changed, deadline approaching/missed, submission reviewed, modifications requested, approved/rejected, grade published, topic approved/rejected/changes requested — in Arabic and English.
*A rejected registration cannot be notified in-app (the student has no account); the status is shown when they try to log in.*

## 16–17. Restrictions and security
Students get 403 on every supervisor/admin endpoint, global settings and deadlines, other teams' research, stages, files, conversations and history; IDs in URLs/bodies are always re-checked against team membership.
Sensitive operations are in `audit_log` (registration, approvals, team creation/invitations/requests/changes, topic and stage submissions, grades). Sessions: random tokens, 7 days, deactivating a user ends their sessions. Arabic (RTL) and English everywhere.

## Interpretation notes
- "Approved University ID list": managed by the admin; each ID can be linked to courses, which become the student's enrollments on approval.
- Course team rules (mode, min/max size, lock, ID privacy) are editable by supervisors and admin ("configured by the Supervisor"); creating/deleting courses stays admin-only.
- Students that existed before this feature are enrolled in all existing courses once (admin can edit enrollments in **Users**).
