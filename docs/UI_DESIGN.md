# UI/UX redesign — design system and page map
# نظام التصميم وخريطة الصفحات

The redesign touched **only the front end** (`public/`) and one line of `server.js` (MIME types for the self-hosted fonts).
No API, database schema, permission or business rule changed; `npm test` (457 checks) passes unchanged, and the browser scenarios exercise every flow through the new UI.

## Design tokens (`public/style.css`)
Navy `#173B57` (primary, sidebar), teal `#2D8C7C` (accents/progress), background `#F3F6FA`, surface `#FFFFFF`, text `#243447` / `#64748B`, success `#16A34A`, warning `#F59E0B`, error `#DC2626`, border `#E2E8F0`.
Status badges use darker "ink" variants of success/warning/error so text keeps contrast on the tinted backgrounds, and every badge carries a text label (status is never conveyed by color alone).
Fonts are self-hosted in `public/fonts/` (Inter for English, Tajawal for Arabic; no external requests, works offline and under the CSP).

## Components (`public/ui.js` + CSS)
Buttons (primary/ghost/teal/ok/warn/bad/small/icon), cards, status badges, progress bars, tabs and filter chips, modal + confirmation dialogs (`confirmDialog`, `askText`, focus-trapped, Esc to close), dropdown menus, forms and inputs, search bars,
responsive tables (cards on phones) with client-side pagination, tooltips, toasts, empty / loading / error states, avatars, timeline stage cards, drag-and-drop upload with progress (`dropzone`, `apiUpload`), breadcrumbs, 40+ inline SVG icons.

## Layout
Role-based **sidebar** (collapsible, remembered per device, off-canvas drawer on phones, RTL aware) and **top bar** (breadcrumbs, research search, language switch, notification bell with unread count and dropdown, avatar menu with settings and logout).
Navigation per role — student: Dashboard, My research, Research stages, My team, Tasks, Grades, Messages, Notifications, Settings · supervisor: Dashboard, Research projects, Research stages, My students, Teams, Submissions & reviews, Grades, Messages, Notifications, Reports, Settings · admin: Dashboard, Registrations, Approved IDs, Users, Courses, Reports, Notifications, Settings.

## Pages
| Page | What it shows |
|---|---|
| Student dashboard | welcome hero + next action, research card with status/progress/current stage, tasks, upcoming deadlines, team (avatars + capacity), supervisor messages, notifications, quick actions |
| Supervisor dashboard | 7 summary cards, submissions requiring review (with Review buttons), research & team progress, upcoming deadlines, recent student activity, recent messages, quick actions |
| Admin dashboard | users/students/supervisors/courses/teams/research/pending registrations tiles, research activity by status, pending requests with quick approve, supervisor workload |
| Research projects | search + filters (status, course, team, supervisor, progress), table/cards with current stage, progress, deadline, status, open action, pagination |
| Research details | tabs: Overview, Topic, Team, Stages, Submissions, Feedback, Grades, Messages, Activity |
| Research stages | **timeline** with Completed / Current / Upcoming / Overdue / Under review / Changes requested / Approved / Closed states, remaining time, max grade, submission and feedback status, next required action |
| Submission | drag-and-drop zone, allowed formats and size, progress bar, attempt number, full history (never overwritten) |
| Review (supervisor) | submissions queue; per-submission panel with history, previous feedback, rubric grade inputs, publish toggle, Approve / Request changes / Reject with confirmation dialogs |
| Teams | member cards with avatars, leader badge, capacity seats, status, invitations, join requests, invitation code, history; supervisors manage teams, locks and change requests |
| Grades | stage grades with rubric breakdown, accumulated total, final grade, published/unpublished state (students only ever receive published grades from the API) |
| Messages | conversation list with avatars and unread dot, history, composer, attachments, stage/submission links, announcements |
| Notifications | grouped by day, filter chips (Important, Deadlines, Submissions, Feedback, Teams, Messages), mark all read |
| Settings | profile, language, change password |

## Honest notes (nothing is faked)
- **Tasks** has no backend of its own, so it is built from real data: stages to submit/resubmit, topic changes, invitations and join requests, with due date, derived priority and status. There is no free-form task creation or Kanban board.
- **Message "unread"** is tracked per browser (last message seen in each conversation), because the API has no read receipts.
- **Admin "system activity"** shows research activity by status and recent research; the API exposes no admin audit feed.
- **Search** in the top bar searches research titles (students and supervisors).
- The previous automatic dark theme was replaced by the single light palette requested.

## Accessibility
Skip link, landmarks (`nav`, `main`), one `h1` per page with a valid heading outline, labelled fields, named icon buttons with tooltips, visible focus rings, keyboard-operable dialogs/dropdowns/dropzone, `aria-current` on navigation, progress bars with `role=progressbar`, reduced-motion support, status shown as text.
An automated pass (unnamed controls, unlabeled fields, heading order, landmarks, language) over every page of all three roles reports no issues; no horizontal overflow at 1360 px, 820 px or 390 px.
