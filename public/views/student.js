// Student views: dashboard, tasks (derived action items), stages timeline, grades, and the team page.
import { $, esc, t, badge, fmtDate, fmtDay, state, api, act, toast, render, notifText } from '../core.js';
import { icon, avatar, statCard, num, progress, remBadge, remaining, pageHeader, empty, setCrumbs, confirmDialog, askText, go } from '../ui.js';
import { renderResearchStages, tlState, stateBadge } from './stages.js';
import { notifMeta } from './notifications.js';

const dsb = s => `<span class="badge ${s}">${t('ds.' + s)}</span>`;
const ist = s => `<span class="badge ${s === 'accepted' || s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : s === 'cancelled' ? 'closed' : 'pending'}">${t('ist_' + s)}</span>`;
const openResearch = (id, tab = null) => { state.tab = 'myResearch'; state.openId = id; state.researchTab = tab; render(); };

// ---------- Tasks: action items derived from the student's real data (no extra storage) ----------
export function buildTasks(d) {
  const tasks = [];
  const prio = due => { const r = remaining(due); return !due ? 'low' : r.days < 0 || r.days <= 3 ? 'high' : r.days <= 7 ? 'medium' : 'low'; };
  for (const r of d.research) {
    if (r.status === 'changes_requested') tasks.push({ id: `t${r.id}`, title: t('tk.editTopic'), desc: r.title, who: r.i_am_leader ? t('tk.you') : t('tk.leader'), due: null, priority: 'high', status: r.i_am_leader ? 'todo' : 'waiting', progress: 0, tone: 'warn', ic: 'edit', go: () => openResearch(r.id, 'topic') });
    if (r.status === 'pending') tasks.push({ id: `p${r.id}`, title: t('tk.topicReview'), desc: r.title, who: t('tk.supervisor'), due: null, priority: 'low', status: 'review', progress: 50, tone: '', ic: 'clock', go: () => openResearch(r.id, 'topic') });
    if (r.status !== 'approved') continue;
    for (const s of r.stages) {
      const base = { id: `s${r.id}-${s.stage.id}`, desc: `${r.title} · ${s.stage.name}`, due: s.stage.deadline, go: () => { state.openId = null; state.tab = 'stagesS'; state.sRes = r.id; render(); } };
      const ds = s.display_status;
      if (ds === 'approved') tasks.push({ ...base, title: t('tk.done', { s: s.stage.name }), who: '', priority: 'low', status: 'done', progress: 100, tone: 'ok', ic: 'checkc' });
      else if (['submitted', 'under_review', 'resubmitted'].includes(ds)) tasks.push({ ...base, title: t('tk.waitReview', { s: s.stage.name }), who: t('tk.supervisor'), priority: 'low', status: 'review', progress: 60, tone: '', ic: 'clock' });
      else if (ds === 'changes_requested' || ds === 'open') tasks.push({ ...base, title: t(ds === 'open' ? 'tk.submit' : 'tk.resubmit', { s: s.stage.name }), who: s.can_submit ? t('tk.you') : t('tk.leader'), priority: s.late ? 'high' : prio(s.stage.deadline), status: s.can_submit ? 'todo' : 'waiting', progress: ds === 'open' ? 0 : 30, tone: s.late ? 'bad' : ds === 'open' ? 'teal' : 'warn', ic: ds === 'open' ? 'upload' : 'edit', overdue: s.late });
      else if (ds === 'not_started') tasks.push({ ...base, title: t('tk.upcoming', { s: s.stage.name }), who: '', priority: 'low', status: 'upcoming', progress: 0, tone: '', ic: 'calendar' });
    }
  }
  for (const i of d.invitations) tasks.push({ id: `i${i.id}`, title: t('tk.invite', { team: i.team }), desc: `${i.course} · ${t('invitedBy')} ${i.invited_by}`, who: t('tk.you'), due: null, priority: 'medium', status: 'todo', progress: 0, tone: 'teal', ic: 'users', go: () => go('myTeam') });
  for (const j of d.join_requests_for_leader) tasks.push({ id: `j${j.id}`, title: t('tk.joinReq', { name: j.name }), desc: j.team, who: t('tk.you'), due: null, priority: 'medium', status: 'todo', progress: 0, tone: 'teal', ic: 'users', go: () => go('myTeam') });
  if (!d.research.length && !d.invitations.length) tasks.push({ id: 'start', title: t('tk.start'), desc: t('sdNoResearch'), who: t('tk.you'), due: null, priority: 'medium', status: 'todo', progress: 0, tone: 'teal', ic: 'flag', go: () => go('myTeam') });
  const order = { todo: 0, waiting: 1, review: 2, upcoming: 3, done: 4 }, pr = { high: 0, medium: 1, low: 2 };
  return tasks.sort((a, b) => order[a.status] - order[b.status] || pr[a.priority] - pr[b.priority] || (a.due ?? '9').localeCompare(b.due ?? '9'));
}
const prioBadge = p => `<span class="badge ${p === 'high' ? 'overdue' : p === 'medium' ? 'warn' : 'neutral'}">${icon('flag')}${t('tk.p.' + p)}</span>`;
const stBadge = s => `<span class="badge ${{ todo: 'info', waiting: 'warn', review: 'under_review', upcoming: 'scheduled', done: 'approved' }[s]}">${t('tk.s.' + s)}</span>`;
function taskRow(k, i) {
  return `<div class="todo ${k.overdue ? 'is-overdue' : ''}"><span class="ic ${k.tone}">${icon(k.ic)}</span><div class="t"><b>${esc(k.title)}</b><span class="small mute">${esc(k.desc)}</span>
    <span class="tiny mute row" style="gap:10px">${k.who ? `<span>${icon('user')} ${esc(k.who)}</span>` : ''}${k.due ? `<span>${icon('calendar')} ${fmtDay(k.due)} ${remBadge(k.due)}</span>` : ''}</span></div>
    <div class="row" style="gap:8px;justify-content:flex-end">${k.status !== 'done' ? prioBadge(k.priority) : ''}${stBadge(k.status)}${k.go ? `<button class="ghost sm" data-task="${i}" aria-label="${esc(k.title)}">${icon('arrow')}</button>` : ''}</div></div>`;
}
const bindTasks = (root, list) => root.querySelectorAll('[data-task]').forEach(b => b.onclick = () => list[Number(b.dataset.task)].go());

// ---------- Dashboard ----------
export async function renderStudentDashboard(view) {
  const d = await api('GET', '/student/dashboard');
  const tasks = buildTasks(d), action = tasks.filter(k => k.status === 'todo');
  const r = d.research.find(x => x.status === 'approved') ?? d.research[0];
  const cur = r?.stages.find(e => !['done', 'closed'].includes(tlState(e)));
  const team = d.teams[0];
  const firstName = d.student.name.split(' ')[0];
  const top = action[0];
  view.innerHTML = `<section class="hero"><div class="grow"><h1>${t('sd.welcome', { n: esc(firstName) })}</h1><p>${top ? t('sd.needAction', { n: action.length }) : t('sd.allGood')}</p>
      <div>${d.student.university_id ? `<span class="chip">${icon('user')}<span dir="ltr">${esc(d.student.university_id)}</span></span>` : ''}${d.courses.map(c => `<span class="chip">${icon('book')}${esc(c.name)}</span>`).join('')}</div></div>
      ${top?.go ? `<button class="teal" id="topAct">${esc(top.title)} ${icon('arrow')}</button>` : ''}</section>
    <div class="stats four">${statCard({ ic: 'activity', label: t('sdProgress'), value: r ? `${r.progress.percent ?? 0}%` : '—', desc: r ? t('sd.d.progress', { a: r.progress.approved, t: r.progress.total }) : t('sdNoResearch').split('.')[0], accent: 'var(--teal)', feature: true, to: r ? 'stagesS' : '' })}
      ${statCard({ ic: 'tasks', label: t('nav.tasks'), value: action.length, desc: t('sd.d.tasks'), accent: action.length ? 'var(--amber)' : 'var(--ok)', to: 'tasks' })}
      ${statCard({ ic: 'calendar', label: t('sdDeadlines'), value: d.upcoming.length, desc: d.upcoming[0] ? `${esc(d.upcoming[0].stage)} · ${fmtDay(d.upcoming[0].deadline)}` : t('sdNoDeadlines'), accent: 'var(--cyan)', to: 'stagesS' })}
      ${statCard({ ic: 'award', label: t('sdAccum'), value: r ? `${num(r.totals.earned)}<span class="mute" style="font-size:.95rem"> / ${num(r.totals.total_max)}</span>` : '—', desc: r?.final_grade != null ? `${t('sdFinal')}: ${r.final_grade}/100` : t('gr.sub'), accent: '#9B7BEA', to: 'grades' })}</div>
    ${action.length ? `<div class="alert warn" style="margin-bottom:20px">${icon('alert')}<p><b>${t('sd.actionTitle')}</b> — ${action.slice(0, 3).map(k => esc(k.title)).join(' · ')}</p></div>` : ''}
    <div class="grid g-main"><div class="stack">
      <section class="card"><div class="card-h"><h3>${icon('book')} ${t('sdResearch')}</h3>${r ? badge(r.status) : ''}</div>
        ${r ? `<h4 style="margin-bottom:2px">${esc(r.title)}</h4><p class="small mute">${esc(r.course ?? '')} · ${t('sdSup')}: ${esc(r.supervisor)}${r.team ? ' · ' + t('team') + ': ' + esc(r.team.name) : ''}</p>
          ${r.status === 'rejected' && r.rejection_reason ? `<div class="alert bad">${icon('x')}<p><b>${t('rejectionReason')}:</b> ${esc(r.rejection_reason)}</p></div>` : ''}
          <div class="row small" style="margin:10px 0 4px"><b class="grow">${t('sdProgress')}</b><span>${r.progress.approved}/${r.progress.total}${r.progress.percent != null ? ` · ${r.progress.percent}%` : ''}</span></div>${progress(r.progress.percent ?? 0, { lg: true })}
          ${cur ? `<div class="tl-next" style="margin-top:14px">${icon('layers')}<span><b>${t('rd.currentStage')}:</b> ${esc(cur.stage.name)} ${dsb(cur.display_status)} ${cur.stage.deadline ? '· ' + remBadge(cur.stage.deadline) : ''}</span></div>` : ''}
          <div class="row" style="margin-top:14px"><button id="openR">${t('sdOpen')} ${icon('arrow')}</button><button class="ghost" id="openS">${icon('layers')} ${t('nav.stages')}</button></div>`
          : empty({ ic: 'book', title: t('sdResearch'), text: t('sdNoResearch'), action: `<button data-go="myTeam">${t('sdGoTeam')}</button> <button class="ghost" data-go="topic">${t('sdGoTopic')}</button>` })}</section>
      <section class="card"><div class="card-h"><h3>${icon('tasks')} ${t('nav.tasks')}</h3><button class="link" data-go="tasks">${t('viewAll')}</button></div>${tasks.filter(k => k.status !== 'done').slice(0, 4).map(taskRow).join('') || `<p class="mute small">${t('tk.none')}</p>`}</section>
      <section class="card"><div class="card-h"><h3>${icon('calendar')} ${t('sdDeadlines')}</h3></div>${d.upcoming.length ? d.upcoming.slice(0, 5).map(u => `<div class="todo"><span class="ic warn">${icon('flag')}</span><div class="t"><b>${esc(u.stage)}</b><span class="small mute">${esc(u.research)}</span></div><div class="row"><span class="small">${fmtDay(u.deadline)}</span>${remBadge(u.deadline)}</div></div>`).join('') : `<p class="mute small">${t('sdNoDeadlines')}</p>`}</section>
    </div><div class="stack">
      <section class="card"><div class="card-h"><h3>${icon('users')} ${t('sdTeam')}</h3><button class="link" data-go="myTeam">${t('sdGoTeam')}</button></div>
        ${team ? `<p class="small mute" style="margin-top:0">${esc(team.name)} · ${esc(team.course)} ${team.locked ? `<span class="badge closed">${icon('lock')}${t('lockedL')}</span>` : ''}</p>
          <div class="seats" aria-hidden="true">${Array.from({ length: team.max_size }, (_, i) => `<i class="${i < team.size ? 'f' : ''}"></i>`).join('')}</div><p class="tiny mute">${team.size}/${team.max_size} · ${t('placesL')}: ${Math.max(0, team.max_size - team.size)}</p>
          ${team.members.map(m => `<div class="member">${avatar(m.name)}<div class="t"><b>${esc(m.name)}</b></div>${m.leader ? `<span class="badge teal">${icon('star')}${t('leaderL')}</span>` : ''}</div>`).join('')}`
          : `<p class="mute small">${t('individualInfo')}</p><button data-go="myTeam">${t('sdGoTeam')}</button>`}</section>
      <section class="card"><div class="card-h"><h3>${icon('message')} ${t('sdMsgs')}</h3><button class="link" data-go="messages">${t('viewAll')}</button></div>
        ${d.messages.length ? d.messages.slice(0, 3).map(m => `<div class="todo" style="cursor:pointer" data-go="messages">${avatar(m.sender, 'sm')}<div class="t"><b>${esc(m.sender)}</b><span class="small ellip">${esc(m.body)}</span><span class="tiny mute">${fmtDate(m.created_at)}</span></div></div>`).join('') : `<p class="mute small">${t('dNoMsgs')}</p>`}</section>
      <section class="card"><div class="card-h"><h3>${icon('bell')} ${t('sdNotifs')}</h3><button class="link" data-go="notifications">${t('viewAll')}</button></div>
        ${d.notifications.slice(0, 4).map(n => { const m = notifMeta(n); return `<div class="todo"><span class="ic ${m.tone}">${icon(m.icon)}</span><div class="t"><span class="small">${esc(notifText(n.message))}</span><span class="tiny mute">${fmtDate(n.created_at)}</span></div></div>`; }).join('') || `<p class="mute small">${t('noNotifs')}</p>`}</section>
      <section class="card"><h3>${t('sd.quick')}</h3><div class="stack" style="gap:8px"><button class="ghost" data-go="topic">${icon('plus')} ${t('nav.topic')}</button><button class="ghost" data-go="myTeam">${icon('users')} ${t('nav.team')}</button><button class="ghost" data-go="messages">${icon('message')} ${t('nav.messages')}</button><button class="ghost" data-go="grades">${icon('award')} ${t('nav.grades')}</button></div></section>
    </div></div>`;
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (b.dataset.go === 'stagesS' && r) state.sRes = r.id; go(b.dataset.go); });
  bindTasks(view, tasks.filter(k => k.status !== 'done').slice(0, 4));
  $('#topAct')?.addEventListener('click', () => top.go());
  $('#openR')?.addEventListener('click', () => openResearch(r.id));
  $('#openS')?.addEventListener('click', () => { state.tab = 'stagesS'; state.sRes = r.id; render(); });
}

// ---------- Tasks page ----------
export async function renderTasks(view) {
  const d = await api('GET', '/student/dashboard'), all = buildTasks(d);
  const f = state.tfilter ?? 'todo';
  const week = k => k.due && remaining(k.due).days <= 7;
  const filters = { all: () => true, todo: k => ['todo', 'waiting'].includes(k.status), overdue: k => k.overdue || (k.due && remaining(k.due).days < 0 && k.status !== 'done'), week: k => week(k) && k.status !== 'done', review: k => k.status === 'review', done: k => k.status === 'done' };
  const list = all.filter(filters[f]);
  view.innerHTML = `${pageHeader({ title: t('nav.tasks'), sub: t('tk.sub') })}
    <div class="chips" role="group" style="margin-bottom:16px">${Object.keys(filters).map(k => `<button class="${f === k ? 'on' : ''}" data-f="${k}">${t('tk.f.' + k)} (${all.filter(filters[k]).length})</button>`).join('')}</div>
    <div class="card">${list.length ? list.map(taskRow).join('') : empty({ ic: 'tasks', title: t('tk.emptyT'), text: t('tk.emptyD') })}</div>`;
  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.tfilter = b.dataset.f; render(); });
  bindTasks(view, list);
}

// ---------- Stages page (timeline of the selected research) ----------
export async function renderStudentStages(view) {
  const list = (await api('GET', '/research?limit=500')).filter(r => r.status === 'approved' || r.stages_total);
  if (!list.length) { view.innerHTML = `${pageHeader({ title: t('nav.stages') })}<div class="card">${empty({ ic: 'layers', title: t('noStages'), text: t('ss.noApproved'), action: `<button data-go="myResearch">${t('nav.myResearch')}</button>` })}</div>`; view.querySelector('[data-go]').onclick = () => go('myResearch'); return; }
  const cur = list.find(r => r.id === state.sRes) ?? list[0]; state.sRes = cur.id;
  view.innerHTML = `${pageHeader({ title: t('nav.stages'), sub: esc(cur.title), actions: list.length > 1 ? `<select id="rs" aria-label="${t('nav.myResearch')}">${list.map(r => `<option value="${r.id}" ${r.id === cur.id ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>` : '' })}<div id="tl"></div>`;
  $('#rs')?.addEventListener('change', e => { state.sRes = Number(e.target.value); render(); });
  await renderResearchStages(view.querySelector('#tl'), cur.id, { role: 'student', after: render });
}

// ---------- Grades page ----------
export async function renderStudentGrades(view) {
  const d = await api('GET', '/student/dashboard');
  view.innerHTML = `${pageHeader({ title: t('nav.grades'), sub: t('gr.sub') })}${d.research.length ? d.research.map(r => `<section class="card"><div class="card-h"><h3>${esc(r.title)}</h3><button class="ghost sm" data-open="${r.id}">${t('sdOpen')} ${icon('arrow')}</button></div>
      <div class="grid g3" style="margin-bottom:14px"><div class="stat"><span class="ic teal">${icon('award')}</span><div><b>${num(r.totals.earned)}<span class="mute" style="font-size:.9rem"> / ${num(r.totals.total_max)}</span></b><span class="l">${t('sdAccum')}</span></div></div>
        <div class="stat"><span class="ic ok">${icon('star')}</span><div><b>${r.final_grade != null ? r.final_grade : '—'}<span class="mute" style="font-size:.9rem"> / 100</span></b><span class="l">${t('sdFinal')}</span></div></div>
        <div class="stat"><span class="ic">${icon('layers')}</span><div><b>${r.progress.approved}/${r.progress.total}</b><span class="l">${t('sdProgress')}</span></div></div></div>
      ${r.stages.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('rl.stage')}</th><th>${t('maxGrade')}</th><th>${t('grade')}</th><th>${t('status')}</th></tr></thead><tbody>${r.stages.map(s => `<tr><td data-label="${t('rl.stage')}"><b>${esc(s.stage.name)}</b></td><td data-label="${t('maxGrade')}">${num(s.stage.max_grade)}</td>
        <td data-label="${t('grade')}">${s.grade ? `<b>${num(s.grade.score)}</b>` : '—'}</td><td data-label="${t('status')}">${s.grade ? `<span class="badge published">${t('published')}</span>` : s.grade_pending ? `<span class="badge unpublished">${t('gradePending')}</span>` : `<span class="mute small">${t('notGradedYet')}</span>`}</td></tr>`).join('')}</tbody></table></div>` : `<p class="mute small">${t('noStages')}</p>`}</section>`).join('')
      : `<div class="card">${empty({ ic: 'award', title: t('rd.noGrades'), text: t('rd.noGradesD') })}</div>`}`;
  view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openResearch(Number(b.dataset.open), 'grades'));
}

// ---------- Team page ----------
export async function renderTeamPage(view) {
  setCrumbs([{ label: t('nav.team') }]);
  const courses = await api('GET', '/courses');
  if (!courses.length) { view.innerHTML = `${pageHeader({ title: t('nav.team') })}<div class="card">${empty({ ic: 'users', title: t('noAssigned') })}</div>`; return; }
  const cid = courses.find(c => c.id === state.teamCourse)?.id ?? courses[0].id; state.teamCourse = cid;
  const course = courses.find(c => c.id === cid);
  const [myTeams, invitations, myReqs] = await Promise.all([api('GET', '/my/teams'), api('GET', '/invitations'), api('GET', '/join-requests/mine')]);
  const team = myTeams.find(x => x.course_id === cid);
  const mode = t(course.team_mode === 'team' ? 'modeTeam' : course.team_mode === 'individual' ? 'modeIndividual' : 'modeBoth');
  const rules = `<div class="row small mute" style="gap:14px"><span>${icon('book')} ${esc(course.name)}</span><span>${icon('users')} ${t('minSize')}: ${course.min_team_size} · ${t('maxSize')}: ${course.max_team_size}</span><span>${icon('info')} ${mode}</span>${course.teams_locked ? `<span class="badge closed">${icon('lock')}${t('lockedL')}</span>` : ''}</div>`;
  const invList = invitations.filter(i => i.status === 'pending');
  const post = (path, body, ok) => act(async () => { await api('POST', path, body); render(); }, ok);
  const header = pageHeader({ title: t('teamPageTitle'), sub: rules, actions: courses.length > 1 ? `<select id="cp" aria-label="${t('pickCourse')}">${courses.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : '' });
  let html = header;

  if (team) {
    const leader = team.my_role === 'leader';
    html += `<div class="grid g-main"><div class="stack"><section class="card"><div class="card-h"><div><h2 style="margin:0">${esc(team.name)}</h2>${team.idea ? `<div class="mute">${esc(team.idea)}</div>` : ''}</div>
        <div class="row">${team.locked ? `<span class="badge closed">${icon('lock')}${t('lockedL')}</span>` : `<span class="badge open">${t('openL')}</span>`}${team.accepting ? `<span class="badge approved">${t('accepting')}</span>` : `<span class="badge closed">${t('closed')}</span>`}</div></div>
      ${team.description ? `<p>${esc(team.description)}</p>` : ''}
      ${team.research ? `<p class="small">${t('teamResearch')}: <a href="#" id="rl">${esc(team.research.title)}</a> ${badge(team.research.status)}</p>` : ''}
      <h4>${t('members')}</h4>${team.members.map(m => `<div class="member">${avatar(m.name)}<div class="t"><b>${esc(m.name)}</b> <span class="mute small" dir="ltr">${esc(m.university_id ?? '')}</span></div>
        <span class="badge ${m.leader ? 'teal' : 'neutral'}">${m.leader ? icon('star') : ''}${m.leader ? t('leaderL') : t('memberL')}</span>
        ${leader && !m.leader ? `<button class="ghost sm" data-lead="${m.id}">${t('makeLeader')}</button><button class="ghost sm" data-rm="${m.id}" aria-label="${t('removeFromTeam')}" data-tip="${t('removeFromTeam')}">${icon('x')}</button>` : ''}</div>`).join('')}
      <div class="row" style="margin-top:12px"><button class="ghost" id="leave">${icon('logout')} ${t('leaveTeam')}</button>${leader && !team.research ? `<button class="bad" id="delt">${icon('trash')} ${t('deleteTeam')}</button>` : ''}<button class="ghost" id="hist">${icon('clock')} ${t('teamHistory')}</button></div><div id="histbox"></div>
      ${team.pending_change_requests.length ? `<div class="alert warn" style="margin-top:12px">${icon('clock')}<p><b>${t('pendingChanges')}:</b> ${team.pending_change_requests.map(c => `${esc(c.member)} (${t('k' + (c.kind === 'leave' ? 'Remove' : c.kind[0].toUpperCase() + c.kind.slice(1)))})`).join('، ')}</p></div>` : ''}</section>
    ${team.locked ? `<section class="card"><h3>${icon('lock')} ${t('changeReqTitle')}</h3><form id="cf" class="row">${leader ? `<select id="ck" aria-label="${t('changeKind')}"><option value="remove">${t('kRemove')}</option><option value="add">${t('kAdd')}</option><option value="leader">${t('kLeader')}</option></select>
      <select id="cu" class="grow" aria-label="${t('members')}">${team.members.filter(m => !m.leader).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><input id="cn" class="grow" placeholder="${t('changeNote')}" aria-label="${t('changeNote')}"><button>${t('sendChange')}</button>` : `<span class="mute small">${t('leaveRequested')}</span>`}</form></section>` : ''}`;
    if (leader) {
      const avail = team.locked ? [] : await api('GET', `/available-students?courseId=${cid}`);
      html += `<section class="card"><h3>${icon('edit')} ${t('teamIs')}</h3><form id="ef"><label for="en">${t('teamNameL')}</label><input id="en" value="${esc(team.name)}" maxlength="100" required>
        <label for="ei">${t('ideaL')}</label><input id="ei" value="${esc(team.idea ?? '')}" maxlength="200"><label for="ed">${t('briefL')}</label><textarea id="ed" maxlength="2000">${esc(team.description ?? '')}</textarea>
        <div class="row" style="margin-top:12px;gap:18px"><label class="inl"><input type="checkbox" id="ea" ${team.accepting ? 'checked' : ''}> ${t('acceptingL')}</label><label class="inl"><input type="checkbox" id="em" ${team.members_can_submit ? 'checked' : ''}> ${t('membersCanSubmit')}</label></div>
        <p><button>${t('saveTeam')}</button></p></form></section>
      <section class="card"><h3>${icon('users')} ${t('availableStudents')}</h3><p class="small mute">${t('availableHint')}</p>${avail.length ? avail.map(s => `<div class="member">${avatar(s.name)}<div class="t"><b>${esc(s.name)}</b> <span class="mute small" dir="ltr">${esc(s.university_id ?? '')}</span></div><span class="badge approved">${t('availableStatus')}</span><button class="ghost sm" data-iv="${s.id}">${icon('plus')} ${t('invite')}</button></div>`).join('') : empty({ ic: 'users', title: t('noAvailable') })}</section>`;
    }
    html += `</div><div class="stack"><section class="card"><h3>${t('rd.capacity')}</h3><div class="seats" aria-hidden="true">${Array.from({ length: team.max_size }, (_, i) => `<i class="${i < team.size ? 'f' : ''}"></i>`).join('')}</div>
        <p class="small">${t('sizeL')}: <b>${team.size}/${team.max_size}</b> · ${t('placesL')}: <b>${Math.max(0, team.max_size - team.size)}</b></p><p class="small mute">${leader ? t('youLeader') : t('youMember')}</p></section>`;
    if (leader) html += `<section class="card"><h3>${icon('key')} ${t('inviteCode')}</h3><div class="row"><b dir="ltr" class="grow" style="font-size:1.2rem;letter-spacing:.1em">${esc(team.invite_code ?? '—')}</b></div><div class="row" style="margin-top:8px"><button class="ghost sm" id="gc">${t('genCode')}</button>${team.invite_code ? `<button class="ghost sm" id="dc">${t('disableCode')}</button>` : ''}</div></section>
      <section class="card"><h3>${icon('mail')} ${t('inviteByUid')}</h3>${team.locked ? `<p class="mute small">${t('changeReqTitle')}</p>` : `<form id="if" class="row"><input id="iu" class="grow" dir="ltr" placeholder="${t('uid')}" required aria-label="${t('uid')}"><button>${t('inviteBtn')}</button></form>`}
        ${team.invitations.length ? team.invitations.map(i => `<div class="member"><div class="t">${esc(i.name)} <span class="mute small" dir="ltr">${esc(i.university_id ?? '')}</span></div>${ist(i.status)}${i.status === 'pending' ? `<button class="ghost sm" data-ci="${i.id}">${t('cancelInv')}</button>` : ''}</div>`).join('') : ''}</section>
      <section class="card"><h3>${icon('inbox')} ${t('joinReqs')}</h3>${team.join_requests.length ? team.join_requests.map(j => `<div class="member">${avatar(j.name)}<div class="t"><b>${esc(j.name)}</b> <span class="mute small" dir="ltr">${esc(j.university_id ?? '')}</span>${j.message ? `<div class="small mute">${esc(j.message)}</div>` : ''}</div>${ist(j.status)}
        ${j.status === 'pending' ? `<button class="ok sm" data-jr="${j.id}:1">${t('accept')}</button><button class="bad sm" data-jr="${j.id}:0">${t('decline')}</button>` : ''}</div>`).join('') : `<p class="mute small">${t('noJoinReqs')}</p>`}</section>`;
    html += '</div></div>';
  } else {
    const [avail, disc] = await Promise.all([api('GET', `/available-students?courseId=${cid}`), api('GET', `/discover-teams?courseId=${cid}`)]);
    html += `<div class="alert" style="margin-bottom:16px">${icon('info')}<p>${course.team_mode === 'individual' ? t('individualOnly') : t('individualInfo')}</p></div>`;
    if (invList.length) html += `<section class="card accent"><h3>${icon('mail')} ${t('myInvitations')}</h3>${invList.map(i => `<div class="member"><span class="ic todo" style="padding:0"></span><div class="t"><b>${esc(i.team)}</b><div class="small mute">${esc(i.course)} · ${t('invitedBy')} ${esc(i.invited_by)}${i.idea ? ' · ' + esc(i.idea) : ''}</div></div>
      <button class="ok sm" data-inv="${i.id}:1">${t('accept')}</button><button class="bad sm" data-inv="${i.id}:0">${t('decline')}</button></div>`).join('')}</section>`;
    if (course.team_mode !== 'individual') {
      html += `<div class="grid g2" style="align-items:start"><div class="stack"><section class="card"><h3>${icon('plus')} ${t('createTeamTitle')}</h3><form id="cf2"><label for="cn2">${t('teamNameL')}</label><input id="cn2" required maxlength="100"><label for="ci2">${t('ideaL')}</label><input id="ci2" maxlength="200">
        <label for="cd2">${t('briefL')}</label><textarea id="cd2" maxlength="2000"></textarea><p><button class="block">${t('createTeamBtn')}</button></p></form></section>
        <section class="card"><h3>${icon('key')} ${t('joinByCode')}</h3><form id="jf" class="row"><input id="jc" class="grow" dir="ltr" placeholder="${t('codePh')}" required aria-label="${t('codePh')}"><button>${t('joinBtn')}</button></form></section></div>
        <div class="stack"><section class="card"><h3>${icon('users')} ${t('discover')}</h3>${disc.length ? disc.map(x => `<div class="member" style="align-items:flex-start">${avatar(x.name)}<div class="t"><b>${esc(x.name)}</b><div class="small mute">${t('leaderL')}: ${esc(x.leader ?? '—')} · ${esc(x.members.join('، '))}</div>${x.idea ? `<div class="small">${esc(x.idea)}</div>` : ''}
          <div class="seats" aria-hidden="true" style="max-width:160px">${Array.from({ length: x.max_size }, (_, i) => `<i class="${i < x.size ? 'f' : ''}"></i>`).join('')}</div><span class="tiny mute">${x.size}/${x.max_size} · ${t('placesL')}: ${x.places}</span></div>
          ${x.invited ? `<span class="badge pending">${t('invitedL')}</span>` : x.requested ? `<span class="badge pending">${t('requested')}</span>` : `<button class="ghost sm" data-jt="${x.id}">${t('requestJoin')}</button>`}</div>`).join('') : empty({ ic: 'users', title: t('noTeamsOpen') })}</section>
        <section class="card"><h3>${t('availableStudents')}</h3><p class="small mute">${t('availableHint')}</p>${avail.length ? avail.map(s => `<div class="member">${avatar(s.name)}<div class="t"><b>${esc(s.name)}</b> <span class="mute small" dir="ltr">${esc(s.university_id ?? '')}</span></div><span class="badge approved">${t('availableStatus')}</span></div>`).join('') : `<p class="mute small">${t('noAvailable')}</p>`}</section></div></div>`;
    }
    const reqs = myReqs.filter(j => j.status === 'pending');
    if (reqs.length) html += `<section class="card"><h3>${t('myRequests')}</h3>${reqs.map(j => `<div class="member"><div class="t">${esc(j.team)}</div>${ist(j.status)}<button class="ghost sm" data-jc="${j.id}">${t('cancelRequest')}</button></div>`).join('')}</section>`;
  }
  view.innerHTML = html;

  // ----- bindings -----
  $('#cp')?.addEventListener('change', () => { state.teamCourse = Number($('#cp').value); render(); });
  view.querySelectorAll('[data-inv]').forEach(b => { const [id, a] = b.dataset.inv.split(':'); b.onclick = act(async () => { await api('POST', `/invitations/${id}/respond`, { accept: a === '1' }); render(); }, 'toast.answered'); });
  view.querySelectorAll('[data-jc]').forEach(b => b.onclick = post(`/join-requests/${b.dataset.jc}/cancel`, {}, 'toast.answered'));
  view.querySelectorAll('[data-jt]').forEach(b => b.onclick = act(async () => {
    const message = await askText({ title: t('requestJoin'), label: t('joinMsg'), confirm: t('requestJoin') }); if (message == null) return;
    await api('POST', `/teams/${b.dataset.jt}/join-requests`, { message }); render();
  }, 'toast.requestSent'));
  if ($('#cf2')) $('#cf2').onsubmit = act(async e => { e.preventDefault(); await api('POST', '/my/teams', { courseId: cid, name: $('#cn2').value, idea: $('#ci2').value, description: $('#cd2').value }); render(); }, 'toast.teamCreated');
  if ($('#jf')) $('#jf').onsubmit = act(async e => { e.preventDefault(); await api('POST', '/teams/join-by-code', { code: $('#jc').value }); render(); }, 'toast.answered');
  if (!team) return;
  const tid = team.id, leader = team.my_role === 'leader';
  $('#rl')?.addEventListener('click', e => { e.preventDefault(); openResearch(team.research.id); });
  $('#leave').onclick = act(async () => {
    if (!await confirmDialog({ title: t('leaveTeam'), text: t('confirmLeave'), confirm: t('leaveTeam'), tone: 'bad' })) return;
    const r = await api('POST', `/teams/${tid}/leave`); if (r.pending) toast(t('leaveRequested')); render();
  });
  $('#delt')?.addEventListener('click', act(async () => { if (!await confirmDialog({ title: t('deleteTeam'), text: t('confirmDeleteTeam'), confirm: t('deleteTeam'), tone: 'bad' })) return; await api('DELETE', `/my/teams/${tid}`); render(); }, 'toast.answered'));
  $('#hist').onclick = act(async () => {
    const h = await api('GET', `/my/teams/${tid}/history`);
    $('#histbox').innerHTML = `<div class="table-wrap" style="margin-top:10px"><table><tbody>${h.map(x => `<tr><td class="small mute">${fmtDate(x.created_at)}</td><td>${esc(x.member ?? '—')}</td><td><code>${esc(x.action)}</code></td><td class="small mute">${esc(x.actor ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
  });
  $('#cf')?.addEventListener('submit', act(async e => {
    e.preventDefault(); if (!leader) return;
    await api('POST', `/teams/${tid}/change-requests`, { kind: $('#ck').value, userId: Number($('#cu').value) || undefined, note: $('#cn').value }); toast(t('toast.requestSent')); render();
  }));
  if (!leader) return;
  view.querySelectorAll('[data-lead]').forEach(b => b.onclick = act(async () => { await api('PUT', `/teams/${tid}/leader`, { userId: Number(b.dataset.lead) }); render(); }, 'toast.answered'));
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = act(async () => {
    if (!await confirmDialog({ title: t('removeFromTeam'), text: t('confirmRemove'), confirm: t('removeFromTeam'), tone: 'bad' })) return;
    await api('DELETE', `/teams/${tid}/members/${b.dataset.rm}`); render();
  }, 'toast.answered'));
  $('#ef').onsubmit = act(async e => {
    e.preventDefault();
    await api('PUT', `/my/teams/${tid}`, { name: $('#en').value, idea: $('#ei').value, description: $('#ed').value, accepting: $('#ea').checked, membersCanSubmit: $('#em').checked }); render();
  }, 'toast.answered');
  $('#gc')?.addEventListener('click', post(`/teams/${tid}/invite-code`, { action: 'generate' }, 'toast.answered'));
  $('#dc')?.addEventListener('click', post(`/teams/${tid}/invite-code`, { action: 'disable' }, 'toast.answered'));
  $('#if')?.addEventListener('submit', act(async e => { e.preventDefault(); await api('POST', `/teams/${tid}/invitations`, { universityId: $('#iu').value }); render(); }, 'toast.invited'));
  view.querySelectorAll('[data-iv]').forEach(b => b.onclick = act(async () => { await api('POST', `/teams/${tid}/invitations`, { userId: Number(b.dataset.iv) }); render(); }, 'toast.invited'));
  view.querySelectorAll('[data-ci]').forEach(b => b.onclick = post(`/invitations/${b.dataset.ci}/cancel`, {}, 'toast.answered'));
  view.querySelectorAll('[data-jr]').forEach(b => { const [id, a] = b.dataset.jr.split(':'); b.onclick = act(async () => { await api('POST', `/join-requests/${id}/respond`, { accept: a === '1' }); render(); }, 'toast.answered'); });
}
