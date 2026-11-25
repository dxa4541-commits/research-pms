// Teams (supervisor/admin), admin dashboard, reports, users, courses, registrations and approved IDs.
import { $, esc, t, badge, dueBadge, state, api, act, courseOpts, roleLabel, render, fmtDate, fmtDay, toast, notifText } from '../core.js';
import { icon, avatar, num, progress, pageHeader, empty, setCrumbs, confirmDialog, askText, modal, paginate, pagerHtml, bindPager, tabsHtml, go, remBadge } from '../ui.js';

const tile = (ic, tone, label, v, to = '') => `<${to ? 'button' : 'div'} class="stat ${to ? 'click' : ''}" ${to ? `data-go="${to}"` : ''}><span class="ic ${tone}">${icon(ic)}</span><div><b>${v}</b><span class="l">${label}</span></div></${to ? 'button' : 'div'}>`;
const PER = 10;
const filterRows = (rows, q, keys) => q ? rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase()))) : rows;

// ---------- Admin dashboard ----------
export async function renderAdminDashboard(view) {
  const [users, courses, teams, rep, regs] = await Promise.all([api('GET', '/users'), api('GET', '/courses'), api('GET', '/teams'), api('GET', '/reports'), api('GET', '/registrations?status=pending')]);
  const count = r => users.filter(u => u.role === r).length;
  const st = s => rep.byStatus.find(x => x.status === s)?.n ?? 0, total = rep.totals.research || 1;
  view.innerHTML = `${pageHeader({ title: t('nav.dashboard'), sub: t('ad.sub') })}
    ${regs.length ? `<div class="alert warn" style="margin-bottom:16px">${icon('inbox')}<p><b>${t('ad.pendingRegs', { n: regs.length })}</b> <button class="link" data-go="registrations">${t('ad.review')}</button></p></div>` : ''}
    <div class="stats">${tile('users', '', t('rUsers'), users.length, 'users')}${tile('cap', 'teal', t('ad.students'), count('student'), 'users')}${tile('user', '', t('ad.supervisors'), count('supervisor'), 'users')}${tile('book', 'teal', t('nav.courses'), courses.length, 'courses')}
      ${tile('users', '', t('nav.teams'), teams.length)}${tile('layers', 'ok', t('rResearch'), rep.totals.research, 'reports')}${tile('inbox', regs.length ? 'warn' : '', t('ad.pending'), regs.length, 'registrations')}${tile('alert', rep.totals.overdue ? 'bad' : '', t('rOverdue'), rep.totals.overdue, 'reports')}</div>
    <div class="grid g-main"><div class="stack">
      <section class="card"><div class="card-h"><h3>${icon('chart')} ${t('ad.activity')}</h3><button class="link" data-go="reports">${t('nav.reports')}</button></div>
        ${['pending', 'approved', 'changes_requested', 'rejected'].map(s => `<div class="row" style="margin:8px 0;gap:12px"><span style="min-width:140px">${badge(s)}</span><span class="grow">${progress(st(s) / total * 100)}</span><b>${st(s)}</b></div>`).join('')}
        <p class="small mute">${t('rSubmissions')}: <b>${rep.totals.submissions}</b> · ${t('rAvg')}: <b>${rep.averageGrade ?? '—'}</b></p></section>
      <section class="card"><div class="card-h"><h3>${icon('book')} ${t('ad.recent')}</h3></div>${rep.projects.length ? rep.projects.slice(0, 6).map(p => `<div class="todo"><span class="ic">${icon('book')}</span><div class="t"><b>${esc(p.title)}</b><span class="small mute">${esc(p.student)} · ${esc(p.supervisor)}</span></div>${badge(p.status)}</div>`).join('') : empty({ ic: 'book', title: t('noResearch') })}</section>
    </div><div class="stack">
      <section class="card"><div class="card-h"><h3>${icon('inbox')} ${t('regTitle')}</h3><button class="link" data-go="registrations">${t('viewAll')}</button></div>
        ${regs.length ? regs.slice(0, 5).map(r => `<div class="todo">${avatar(r.name, 'sm')}<div class="t"><b>${esc(r.name)}</b><span class="tiny mute" dir="ltr">${esc(r.university_id)}</span></div><button class="ok sm" data-ap="${r.id}">${t('approveBtn')}</button></div>`).join('') : `<p class="mute small">${t('ad.noPending')}</p>`}</section>
      <section class="card"><h3>${icon('users')} ${t('supervisors')}</h3>${rep.perSupervisor.length ? rep.perSupervisor.map(s => `<div class="member">${avatar(s.name)}<div class="t"><b>${esc(s.name)}</b><div class="tiny mute">${t('projects')}: ${s.projects} · ${t('approvedC')}: ${s.approved ?? 0} · ${t('pendingC')}: ${s.pending ?? 0}</div></div></div>`).join('') : `<p class="mute small">${t('noAssigned')}</p>`}</section>
      <section class="card"><h3>${t('sd.quick')}</h3><div class="stack" style="gap:8px"><button class="ghost" data-go="registrations">${icon('inbox')} ${t('nav.registrations')}</button><button class="ghost" data-go="ids">${icon('cap')} ${t('nav.ids')}</button><button class="ghost" data-go="users">${icon('users')} ${t('nav.users')}</button><button class="ghost" data-go="courses">${icon('book')} ${t('nav.courses')}</button></div></section>
    </div></div>`;
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  view.querySelectorAll('[data-ap]').forEach(b => b.onclick = act(async () => { await api('POST', `/registrations/${b.dataset.ap}/approve`, {}); render(); }, 'toast.decided'));
}

// ---------- Course team rules (supervisor/admin) ----------
function courseRulesCard(courses) {
  return `<section class="card"><div class="card-h"><h3>${icon('settings')} ${t('courseRules')}</h3></div>${courses.map(c => `<form class="row rules" data-course="${c.id}" style="padding:12px 0;border-bottom:1px solid var(--line);align-items:flex-end;gap:12px"><b class="grow" style="min-width:140px">${esc(c.name)}</b>
    <div><label class="small" style="margin-top:0">${t('teamMode')}</label><select data-f="team_mode" aria-label="${t('teamMode')}">${['both', 'team', 'individual'].map(m => `<option value="${m}" ${c.team_mode === m ? 'selected' : ''}>${t(m === 'team' ? 'modeTeam' : m === 'individual' ? 'modeIndividual' : 'modeBoth')}</option>`).join('')}</select></div>
    <div><label class="small" style="margin-top:0">${t('minSize')}</label><input type="number" data-f="min_team_size" aria-label="${t('minSize')}" min="1" max="20" style="width:76px" value="${c.min_team_size}"></div>
    <div><label class="small" style="margin-top:0">${t('maxSize')}</label><input type="number" data-f="max_team_size" aria-label="${t('maxSize')}" min="1" max="20" style="width:76px" value="${c.max_team_size}"></div>
    <label class="inl"><input type="checkbox" data-f="teams_locked" ${c.teams_locked ? 'checked' : ''}> ${t('teamsLockedC')}</label><label class="inl"><input type="checkbox" data-f="show_student_ids" ${c.show_student_ids ? 'checked' : ''}> ${t('showIds')}</label><button class="sm">${t('saveRules')}</button></form>`).join('')}</section>`;
}
function bindCourseRules(view) {
  view.querySelectorAll('form.rules').forEach(f => f.onsubmit = act(async e => {
    e.preventDefault();
    const g = k => f.querySelector(`[data-f=${k}]`);
    await api('PUT', `/courses/${f.dataset.course}/settings`, { team_mode: g('team_mode').value, min_team_size: Number(g('min_team_size').value), max_team_size: Number(g('max_team_size').value), teams_locked: g('teams_locked').checked, show_student_ids: g('show_student_ids').checked }); render();
  }, 'toast.rules'));
}

// ---------- Supervisor/Admin: form and manage teams ----------
export async function renderTeams(view) {
  const [teams, students, courses, reqs] = await Promise.all([api('GET', '/teams'), api('GET', '/students'), api('GET', '/courses'), api('GET', '/membership-requests')]);
  const free = cid => students.filter(s => s.active && s.courses.includes(cid) && !s.teams[cid]);
  const pending = reqs.filter(r => r.status === 'pending');
  const kind = r => t('k' + (r.kind === 'leave' ? 'Remove' : r.kind[0].toUpperCase() + r.kind.slice(1)));
  view.innerHTML = `${pageHeader({ title: t('nav.teams'), sub: t('tm.sub'), actions: `<button id="newteam">${icon('plus')} ${t('formTeam')}</button>` })}
    ${pending.length ? `<section class="card accent"><h3>${icon('inbox')} ${t('mreq')}</h3>${pending.map(r => `<div class="todo"><span class="ic warn">${icon('users')}</span><div class="t"><b>${esc(r.team)} — ${esc(r.member)}</b><span class="small mute"><span class="badge pending">${kind(r)}${r.kind === 'leave' ? ' (' + t('leaveTeam') + ')' : ''}</span> ${esc(r.requested_by)}${r.note ? ' · ' + esc(r.note) : ''}</span></div>
      <button class="ok sm" data-cr="${r.id}:1">${t('approveChange')}</button><button class="bad sm" data-cr="${r.id}:0">${t('rejectChange')}</button></div>`).join('')}</section>` : ''}
    <section class="card" id="newbox" hidden><h3>${t('formTeam')}</h3><form id="f"><div class="field-row"><div><label for="n">${t('teamName')}</label><input id="n" required maxlength="100"></div><div><label for="c">${t('course')}</label><select id="c">${courseOpts(courses)}</select></div></div>
      <label>${t('members')} <span class="mute small">(${t('leaderOpt')}: ◉)</span></label><div class="checks" id="ml"></div><p><button type="submit">${t('createTeam')}</button></p></form></section>
    ${teams.length ? `<div class="grid g2">${teams.map(x => `<section class="card"><div class="card-h"><div><h3>${esc(x.name)}</h3><span class="small mute">${esc(x.course)}</span></div><div class="row">${x.locked ? `<span class="badge closed">${icon('lock')}${t('lockedL')}</span>` : ''}
        <button class="ghost sm" data-lock="${x.id}:${x.locked ? 0 : 1}">${x.locked ? t('unlockTeam') : t('lockTeam')}</button></div></div>
      <p class="small">${t('teamResearch')}: ${x.research ? `<a href="#" data-r="${x.research.id}">${esc(x.research.title)}</a> ${badge(x.research.status)}` : `<span class="mute">${t('noResearchYet')}</span>`}</p>
      ${x.research ? `<p class="small mute">${t('stageProgress', { a: x.stages.approved, t: x.stages.total, p: x.stages.pending_review, m: x.stages.missing, l: x.stages.late })}</p>${progress(x.stages.total ? x.stages.approved / x.stages.total * 100 : 0)}` : ''}
      <div style="margin-top:8px">${x.members.map(m => `<div class="member">${avatar(m.name)}<div class="t"><b>${esc(m.name)}</b> <span class="mute small" dir="ltr">${esc(m.university_id ?? '')}</span></div>${m.leader ? `<span class="badge teal">${icon('star')}${t('teamLeader')}</span>` : `<button class="ghost sm" data-lead="${x.id}:${m.id}">${t('setLeader')}</button>`}<button class="ghost sm icon" data-rm="${x.id}:${m.id}" aria-label="${t('removeMember')}" data-tip="${t('removeMember')}">${icon('x')}</button></div>`).join('')}</div>
      <div class="row" style="margin-top:10px"><select data-addsel="${x.id}" aria-label="${t('addMember')}"><option value="">${t('addMember')}…</option>${free(x.course_id).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><button class="ghost sm" data-add="${x.id}">${t('add')}</button>
        ${state.user.role === 'supervisor' ? `<button class="ghost sm" data-msg="${x.id}">${icon('message')} ${t('messageTeam')}</button>` : ''}<button class="ghost sm" data-hist="${x.id}">${icon('clock')} ${t('teamHistory')}</button></div><div id="h${x.id}"></div></section>`).join('')}</div>`
      : `<div class="card">${empty({ ic: 'users', title: t('noTeams'), text: t('tm.emptyD') })}</div>`}
    ${courseRulesCard(courses)}`;
  const paint = () => {
    const cid = Number($('#c').value), list = free(cid);
    $('#ml').innerHTML = list.map(s => `<label><input type="checkbox" value="${s.id}"> ${esc(s.name)} <span class="mute small" dir="ltr">${esc(s.university_id ?? s.email)}</span>
      <input type="radio" name="leader" value="${s.id}" title="${t('teamLeader')}" aria-label="${t('teamLeader')}" style="margin-inline-start:auto"></label>`).join('') || `<span class="mute">${t('noStudents')}</span>`;
  };
  $('#c').onchange = paint; paint();
  $('#newteam').onclick = () => { $('#newbox').hidden = !$('#newbox').hidden; if (!$('#newbox').hidden) $('#n').focus(); };
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const memberIds = [...view.querySelectorAll('#ml input[type=checkbox]:checked')].map(i => Number(i.value));
    const lead = view.querySelector('#ml input[name=leader]:checked');
    await api('POST', '/teams', { name: $('#n').value, courseId: $('#c').value, memberIds, leaderId: lead && memberIds.includes(Number(lead.value)) ? Number(lead.value) : undefined }); render();
  }, 'toast.team');
  bindCourseRules(view);
  const upd = (path, body) => act(async () => { await api('PUT', path, body); render(); }, 'toast.teamUpdated');
  view.querySelectorAll('[data-lead]').forEach(b => { const [tid, uid] = b.dataset.lead.split(':'); b.onclick = upd(`/teams/${tid}/leader`, { userId: Number(uid) }); });
  view.querySelectorAll('[data-rm]').forEach(b => { const [tid, uid] = b.dataset.rm.split(':'); b.onclick = async () => { if (await confirmDialog({ title: t('removeMember'), text: t('confirmRemoveMember'), confirm: t('removeMember'), tone: 'bad' })) upd(`/teams/${tid}/members`, { remove: [Number(uid)] })(); }; });
  view.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { const v = view.querySelector(`[data-addsel="${b.dataset.add}"]`).value; if (v) upd(`/teams/${b.dataset.add}/members`, { add: [Number(v)] })(); });
  view.querySelectorAll('[data-lock]').forEach(b => { const [tid, v] = b.dataset.lock.split(':'); b.onclick = upd(`/teams/${tid}/lock`, { locked: v === '1' }); });
  view.querySelectorAll('[data-cr]').forEach(b => { const [id, a] = b.dataset.cr.split(':'); b.onclick = act(async () => { await api('POST', `/membership-requests/${id}/decide`, { approve: a === '1' }); render(); }, 'toast.decided'); });
  view.querySelectorAll('[data-hist]').forEach(b => b.onclick = act(async () => {
    const h = await api('GET', `/teams/${b.dataset.hist}/history`);
    $(`#h${b.dataset.hist}`).innerHTML = `<div class="table-wrap" style="margin-top:10px"><table><tbody>${h.map(x => `<tr><td class="small mute">${fmtDate(x.created_at)}</td><td>${esc(x.member ?? '—')}</td><td><code>${esc(x.action)}</code></td><td class="small mute">${esc(x.actor ?? '')}</td></tr>`).join('')}</tbody></table></div>`;
  }));
  view.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => go('messages', { thread: `t${b.dataset.msg}` }));
  view.querySelectorAll('[data-r]').forEach(a => a.onclick = e => { e.preventDefault(); go('research', { openId: Number(a.dataset.r) }); });
}

// ---------- Admin: registration requests and approved IDs ----------
export async function renderRegistrations(view) {
  state.regFilter ??= 'pending';
  const f = state.regFilter, page = state.regPage ?? 1, q = state.regQ ?? '';
  const all = await api('GET', `/registrations?status=${f}`);
  const list = filterRows(all, q, ['university_id', 'name', 'email']);
  view.innerHTML = `${pageHeader({ title: t('regTitle'), sub: t('rg.sub') })}${tabsHtml(['pending', 'approved', 'rejected'].map(s => ({ key: s, label: t(s === 'pending' ? 'regPending' : s === 'approved' ? 'regApproved' : 'regRejected') })), f)}
    <div class="card"><form class="search" id="sf" style="margin-bottom:12px;max-width:340px">${icon('search')}<input id="sq" type="search" value="${esc(q)}" placeholder="${t('rg.search')}" aria-label="${t('rg.search')}"></form>
    ${list.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('uid')}</th><th>${t('name')}</th><th>${t('requestedAt')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>${paginate(list, page, PER).map(r => `<tr><td data-label="${t('uid')}" dir="ltr" style="text-align:start"><b>${esc(r.university_id)}</b></td><td data-label="${t('name')}">${esc(r.name)}${r.email ? `<div class="small mute" dir="ltr">${esc(r.email)}</div>` : ''}</td>
      <td data-label="${t('requestedAt')}" class="small">${fmtDate(r.created_at)}</td><td data-label="${t('status')}">${r.status === 'pending' ? `<span class="badge pending">${t('regPending')}</span>` : `<span class="badge ${r.status === 'approved' ? 'approved' : 'rejected'}">${t(r.status === 'approved' ? 'regApproved' : 'regRejected')}</span><div class="small mute">${t('decidedBy')}: ${esc(r.decided_by ?? '—')} · ${r.decided_at ? fmtDate(r.decided_at) : ''}${r.decision_note ? '<br>' + esc(r.decision_note) : ''}</div>`}</td>
      <td>${r.status === 'pending' ? `<div class="row"><button class="ok sm" data-ap="${r.id}">${icon('check')} ${t('approveBtn')}</button><button class="bad sm" data-rj="${r.id}">${icon('x')} ${t('rejectBtn')}</button></div>` : ''}</td></tr>`).join('')}</tbody></table></div>${pagerHtml(list.length, page, PER)}` : empty({ ic: 'inbox', title: t('noRegs') })}</div>`;
  view.querySelectorAll('[data-tabk]').forEach(b => b.onclick = () => { state.regFilter = b.dataset.tabk; state.regPage = 1; render(); });
  $('#sf').onsubmit = e => { e.preventDefault(); state.regQ = $('#sq').value.trim(); state.regPage = 1; render(); };
  bindPager(view, p => { state.regPage = p; render(); });
  view.querySelectorAll('[data-ap]').forEach(b => b.onclick = act(async () => {
    if (!await confirmDialog({ title: t('approveBtn'), text: t('rg.confirmApprove'), confirm: t('approveBtn'), tone: 'ok' })) return;
    await api('POST', `/registrations/${b.dataset.ap}/approve`, {}); render();
  }, 'toast.decided'));
  view.querySelectorAll('[data-rj]').forEach(b => b.onclick = act(async () => {
    const note = await askText({ title: t('rejectBtn'), label: t('rejectNote'), confirm: t('rejectBtn'), tone: 'bad' }); if (note == null) return;
    await api('POST', `/registrations/${b.dataset.rj}/reject`, { note }); render();
  }, 'toast.decided'));
}

export async function renderApprovedIds(view) {
  const [ids, courses] = await Promise.all([api('GET', '/approved-ids'), api('GET', '/courses')]);
  const page = state.idPage ?? 1, q = state.idQ ?? '', list = filterRows(ids.map(i => ({ ...i, st: i.user_id ? 'registered' : i.request_status ?? '' })), q, ['university_id', 'name']);
  view.innerHTML = `${pageHeader({ title: t('idsTitle'), sub: t('idsAddHint'), actions: `<button id="addbtn">${icon('plus')} ${t('idsAdd')}</button>` })}
    <section class="card" id="addbox" hidden><form id="f"><label for="tx">${t('idsAddHint')}</label><textarea id="tx" required placeholder="20240101,Name&#10;20240102"></textarea>
      <label>${t('idsCourses')}</label><div class="row">${courses.map(c => `<label class="inl"><input type="checkbox" data-c="${c.id}" checked> ${esc(c.name)}</label>`).join('')}</div><p><button>${t('idsAdd')}</button></p></form></section>
    <div class="card"><form class="search" id="sf" style="margin-bottom:12px;max-width:340px">${icon('search')}<input id="sq" type="search" value="${esc(q)}" placeholder="${t('rg.search')}" aria-label="${t('rg.search')}"></form>
    ${list.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('uid')}</th><th>${t('name')}</th><th>${t('enrollments')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>${paginate(list, page, PER).map(i => `<tr><td data-label="${t('uid')}" dir="ltr" style="text-align:start"><b>${esc(i.university_id)}</b></td><td data-label="${t('name')}">${esc(i.name ?? '')}</td>
      <td data-label="${t('enrollments')}" class="small">${i.courses.map(cid => esc(courses.find(c => c.id === cid)?.name ?? cid)).join('، ') || '—'}</td><td data-label="${t('status')}">${i.user_id ? `<span class="badge approved">${t('registered')}</span>` : i.request_status ? `<span class="badge ${i.request_status === 'pending' ? 'pending' : 'rejected'}">${t(i.request_status === 'pending' ? 'regPending' : 'regRejected')}</span>` : '<span class="mute">—</span>'}</td>
      <td>${i.user_id ? '' : `<button class="bad sm" data-del="${i.id}" aria-label="${t('del')}">${icon('trash')}</button>`}</td></tr>`).join('')}</tbody></table></div>${pagerHtml(list.length, page, PER)}` : empty({ ic: 'cap', title: t('noIds') })}</div>`;
  $('#addbtn').onclick = () => { $('#addbox').hidden = !$('#addbox').hidden; if (!$('#addbox').hidden) $('#tx').focus(); };
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const r = await api('POST', '/approved-ids', { text: $('#tx').value, courseIds: [...view.querySelectorAll('[data-c]:checked')].map(i => Number(i.dataset.c)) });
    toast(t('idsAdded', { a: r.added, s: r.skipped.length })); render();
  });
  $('#sf').onsubmit = e => { e.preventDefault(); state.idQ = $('#sq').value.trim(); state.idPage = 1; render(); };
  bindPager(view, p => { state.idPage = p; render(); });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => { if (!await confirmDialog({ title: t('del'), text: t('confirmDel'), confirm: t('del'), tone: 'bad' })) return; await api('DELETE', `/approved-ids/${b.dataset.del}`); render(); }, 'toast.deleted'));
}

// ---------- Admin: research reports ----------
export async function renderReports(view) {
  const r = await api('GET', '/reports');
  const n = s => r.byStatus.find(x => x.status === s)?.n ?? 0;
  const page = state.arPage ?? 1;
  view.innerHTML = `${pageHeader({ title: t('nav.reports'), sub: t('ad.reportsSub') })}<div class="stats">
    ${tile('book', '', t('rResearch'), r.totals.research)}${tile('upload', '', t('rSubmissions'), r.totals.submissions)}${tile('users', '', t('rUsers'), r.totals.users)}${tile('award', 'teal', t('rAvg'), r.averageGrade ?? '—')}${tile('alert', r.totals.overdue ? 'bad' : '', t('rOverdue'), r.totals.overdue)}
    ${tile('clock', '', t('st.pending'), n('pending'))}${tile('checkc', 'ok', t('st.approved'), n('approved'))}${tile('edit', 'warn', t('st.changes_requested'), n('changes_requested'))}${tile('x', '', t('st.rejected'), n('rejected'))}</div>
    <section class="card"><div class="card-h"><h3>${t('supervisors')}</h3></div><div class="table-wrap"><table class="rt"><thead><tr><th>${t('name')}</th><th>${t('projects')}</th><th>${t('approvedC')}</th><th>${t('pendingC')}</th></tr></thead><tbody>
      ${r.perSupervisor.map(s => `<tr><td data-label="${t('name')}"><div class="member" style="padding:0">${avatar(s.name)}<b>${esc(s.name)}</b></div></td><td data-label="${t('projects')}">${s.projects}</td><td data-label="${t('approvedC')}">${s.approved ?? 0}</td><td data-label="${t('pendingC')}">${s.pending ?? 0}</td></tr>`).join('')}</tbody></table></div></section>
    <section class="card"><div class="card-h"><h3>${t('allResearch')}</h3></div>${r.projects.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('title')}</th><th>${t('status')}</th><th>${t('student')}</th><th>${t('supervisor')}</th><th>${t('grade')}</th><th>${t('deadline')}</th></tr></thead><tbody>
      ${paginate(r.projects, page, PER).map(p => `<tr class="${p.overdue ? 'late' : ''}"><td data-label="${t('title')}"><b>${esc(p.title)}</b></td><td data-label="${t('status')}">${badge(p.status)}</td><td data-label="${t('student')}">${esc(p.student)}</td><td data-label="${t('supervisor')}">${esc(p.supervisor)}</td><td data-label="${t('grade')}">${p.grade ?? '—'}</td>
        <td data-label="${t('deadline')}"><div class="row"><input type="date" value="${p.deadline ?? ''}" data-dl="${p.id}" aria-label="${t('deadline')}" style="min-height:34px"><button class="ghost sm" data-savedl="${p.id}">${t('save')}</button>${dueBadge(p)}</div></td></tr>`).join('')}</tbody></table></div>${pagerHtml(r.projects.length, page, PER)}` : empty({ ic: 'book', title: t('noResearch') })}</section>`;
  bindPager(view, p => { state.arPage = p; render(); });
  view.querySelectorAll('[data-savedl]').forEach(b => b.onclick = act(async () => {
    const v = view.querySelector(`[data-dl="${b.dataset.savedl}"]`).value;
    await api('PUT', `/research/${b.dataset.savedl}/deadline`, { deadline: v || null }); render();
  }, 'toast.deadline'));
}

// ---------- Admin: users ----------
export async function renderUsers(view) {
  const [users, courses] = await Promise.all([api('GET', '/users'), api('GET', '/courses')]);
  const page = state.upage ?? 1, q = state.uq ?? '', rf = state.urole ?? '';
  const list = filterRows(users.filter(u => !rf || u.role === rf), q, ['name', 'email', 'university_id']);
  view.innerHTML = `${pageHeader({ title: t('usersAuth'), sub: t('us.sub'), actions: `<button id="addu">${icon('plus')} ${t('addUser')}</button>` })}
    <div class="card"><div class="row" style="gap:10px;margin-bottom:12px"><form class="search grow" id="sf" style="max-width:340px">${icon('search')}<input id="sq" type="search" value="${esc(q)}" placeholder="${t('us.search')}" aria-label="${t('us.search')}"></form>
      <select id="rf" aria-label="${t('role')}"><option value="">${t('role')}</option>${['student', 'supervisor', 'admin'].map(x => `<option value="${x}" ${rf === x ? 'selected' : ''}>${roleLabel(x)}</option>`).join('')}</select></div>
    ${list.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('name')}</th><th>${t('uid')} / ${t('email')}</th><th>${t('role')}</th><th>${t('enrollments')}</th><th></th></tr></thead><tbody>${paginate(list, page, PER).map(u => `<tr><td data-label="${t('name')}"><div class="member" style="padding:0">${avatar(u.name)}<div class="t"><b>${esc(u.name)}</b>${u.active ? '' : ` <span class="badge closed">${t('inactive')}</span>`}${u.must_change_password ? `<div class="tiny mute">${t('mustChange')}</div>` : ''}</div></div></td>
      <td data-label="${t('uid')}" dir="ltr" style="text-align:start">${esc(u.university_id ?? u.email)}</td><td data-label="${t('role')}"><select data-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''} aria-label="${t('role')}">${['student', 'supervisor', 'admin'].map(x => `<option value="${x}" ${x === u.role ? 'selected' : ''}>${roleLabel(x)}</option>`).join('')}</select></td>
      <td data-label="${t('enrollments')}" class="small">${u.role === 'student' ? `${u.courses.map(c => esc(courses.find(x => x.id === c)?.name ?? c)).join('، ') || '—'} <button class="link" data-en="${u.id}">${t('edit')}</button>` : ''}</td>
      <td>${u.id === state.user.id ? '' : `<div class="row"><button class="ghost sm" data-act="${u.id}:${u.active ? 0 : 1}">${u.active ? t('deactivate') : t('activate')}</button><button class="bad sm" data-del="${u.id}" aria-label="${t('del')}">${icon('trash')}</button></div>`}</td></tr>`).join('')}</tbody></table></div>${pagerHtml(list.length, page, PER)}` : empty({ ic: 'users', title: t('us.empty') })}</div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); state.uq = $('#sq').value.trim(); state.upage = 1; render(); };
  $('#rf').onchange = () => { state.urole = $('#rf').value; state.upage = 1; render(); };
  bindPager(view, p => { state.upage = p; render(); });
  $('#addu').onclick = () => {
    const m = modal({ title: t('addUser'), ic: 'user', body: `<form id="uf"><label for="n">${t('name')}</label><input id="n" required data-autofocus><div class="field-row"><div><label for="r">${t('role')}</label><select id="r">${['student', 'supervisor', 'admin'].map(x => `<option value="${x}">${roleLabel(x)}</option>`).join('')}</select></div><div><label for="ui">${t('uid')} ${t('optional')}</label><input id="ui" dir="ltr"></div></div>
      <label for="e">${t('email')}</label><input id="e" type="email" dir="ltr"><label for="p">${t('pwPh')}</label><input id="p" type="password" dir="ltr" minlength="6"><label>${t('enrollments')}</label><div class="row">${courses.map(c => `<label class="inl"><input type="checkbox" data-c="${c.id}"> ${esc(c.name)}</label>`).join('')}</div></form>`,
      actions: `<button class="ghost" data-no>${t('cancel')}</button><button data-yes>${t('add')}</button>` });
    m.el.querySelector('[data-no]').onclick = m.close;
    m.el.querySelector('[data-yes]').onclick = act(async () => {
      const g = id => m.el.querySelector('#' + id);
      await api('POST', '/users', { name: g('n').value, email: g('e').value || undefined, universityId: g('ui').value || undefined, password: g('p').value || undefined, role: g('r').value, courseIds: [...m.el.querySelectorAll('[data-c]:checked')].map(i => Number(i.dataset.c)) });
      m.close(); render();
    }, 'toast.user');
  };
  view.querySelectorAll('[data-en]').forEach(b => b.onclick = () => {
    const u = users.find(x => x.id === Number(b.dataset.en));
    const m = modal({ title: `${t('enrollments')} — ${u.name}`, ic: 'book', body: `<div class="checks">${courses.map(c => `<label><input type="checkbox" data-c="${c.id}" ${u.courses.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}</div>`, actions: `<button class="ghost" data-no>${t('cancel')}</button><button data-yes>${t('saveCourses')}</button>` });
    m.el.querySelector('[data-no]').onclick = m.close;
    m.el.querySelector('[data-yes]').onclick = act(async () => { await api('PUT', `/users/${u.id}/enrollments`, { courseIds: [...m.el.querySelectorAll('[data-c]:checked')].map(i => Number(i.dataset.c)) }); m.close(); render(); }, 'toast.courses');
  });
  view.querySelectorAll('[data-role]').forEach(s => s.onchange = act(async () => { await api('PATCH', `/users/${s.dataset.role}/role`, { role: s.value }); render(); }, 'toast.role'));
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => { if (!await confirmDialog({ title: t('del'), text: t('confirmDel'), confirm: t('del'), tone: 'bad' })) return; await api('DELETE', `/users/${b.dataset.del}`); render(); }, 'toast.deleted'));
  view.querySelectorAll('[data-act]').forEach(b => { const [id, v] = b.dataset.act.split(':'); b.onclick = act(async () => { await api('PATCH', `/users/${id}`, { active: v === '1' }); render(); }, 'toast.role'); });
}

export async function renderCourses(view) {
  const courses = await api('GET', '/courses');
  view.innerHTML = `${pageHeader({ title: t('courses'), sub: t('co.sub') })}<section class="card"><form id="f" class="row"><input class="grow" id="n" placeholder="${t('courseName')}" required aria-label="${t('courseName')}"><button>${icon('plus')} ${t('addCourse')}</button></form></section>${courses.length ? courseRulesCard(courses) : `<div class="card">${empty({ ic: 'book', title: t('co.empty') })}</div>`}`;
  $('#f').onsubmit = act(async e => { e.preventDefault(); await api('POST', '/courses', { name: $('#n').value }); render(); }, 'toast.course');
  bindCourseRules(view);
}
