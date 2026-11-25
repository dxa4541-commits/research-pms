// Teams (supervisor/admin), admin dashboard, reports, users, courses, registrations and approved IDs.
import { $, esc, t, badge, dueBadge, state, api, act, courseOpts, roleLabel, render, fmtDate, fmtDay, toast, notifText, lang } from '../core.js';
import { icon, avatar, statCard, donut, th, sortRows, bindSort, rowMenu, bindDropdowns, dateField, bindDateFields, num, progress, pageHeader, empty, setCrumbs, confirmDialog, askText, modal, paginate, pagerHtml, bindPager, tabsHtml, go, remBadge } from '../ui.js';

const tile = (ic, tone, label, v, to = '') => `<${to ? 'button' : 'div'} class="stat ${to ? 'click' : ''}" ${to ? `data-go="${to}"` : ''}><span class="ic ${tone}">${icon(ic)}</span><div><b>${v}</b><span class="l">${label}</span></div></${to ? 'button' : 'div'}>`;
const PER = 10;
const filterRows = (rows, q, keys) => q ? rows.filter(r => keys.some(k => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase()))) : rows;

// ---------- Admin dashboard ----------
const relTime = d => { if (!d) return ''; const ms = Date.now() - new Date(d.replace(' ', 'T') + 'Z').getTime(), m = Math.round(ms / 60000);
  if (m < 1) return t('ago.now'); if (m < 60) return t('ago.m', { n: m }); const h = Math.round(m / 60); if (h < 24) return t('ago.h', { n: h }); return t('ago.d', { n: Math.round(h / 24) }); };
export function regDetails(r, courses = []) {
  const m = modal({ title: t('rg.details'), ic: 'idcard', body: `<div class="member" style="padding-top:0">${avatar(r.name, 'lg')}<div class="t"><b style="font-size:1.05rem">${esc(r.name)}</b><div class="small mute" dir="ltr">${esc(r.university_id)}</div></div></div>
    <dl style="margin-top:12px"><dt>${t('uid')}</dt><dd dir="ltr">${esc(r.university_id)}</dd><dt>${t('contactEmail')}</dt><dd dir="ltr">${esc(r.email ?? '—')}</dd><dt>${t('requestedAt')}</dt><dd>${fmtDate(r.created_at)}</dd>
    <dt>${t('status')}</dt><dd>${regBadge(r.status)}</dd>${r.decided_at ? `<dt>${t('decidedBy')}</dt><dd>${esc(r.decided_by ?? '—')} · ${fmtDate(r.decided_at)}</dd>` : ''}${r.decision_note ? `<dt>${t('rejectNote')}</dt><dd>${esc(r.decision_note)}</dd>` : ''}</dl>`,
    actions: `<button class="ghost" data-no>${t('close')}</button>${r.status === 'pending' ? `<button class="bad" data-rj>${icon('x')} ${t('rejectBtn')}</button><button data-ap>${icon('check')} ${t('approveBtn')}</button>` : ''}` });
  m.el.querySelector('[data-no]').onclick = m.close;
  m.el.querySelector('[data-ap]')?.addEventListener('click', act(async () => { m.close(); await approveReg(r.id); }));
  m.el.querySelector('[data-rj]')?.addEventListener('click', act(async () => { m.close(); await rejectReg(r.id); }));
  void courses;
}
const regBadge = st => `<span class="badge ${st === 'pending' ? 'pending' : st === 'approved' ? 'approved' : 'rejected'}">${t(st === 'pending' ? 'regPending' : st === 'approved' ? 'regApproved' : 'regRejected')}</span>`;
async function approveReg(id) {
  if (!await confirmDialog({ title: t('approveBtn'), text: t('rg.confirmApprove'), confirm: t('approveBtn'), tone: 'ok' })) return;
  await api('POST', `/registrations/${id}/approve`, {}); toast(t('toast.decided')); render();
}
async function rejectReg(id) {
  const note = await askText({ title: t('rejectBtn'), label: t('rejectNote'), confirm: t('rejectBtn'), tone: 'bad' }); if (note == null) return;
  await api('POST', `/registrations/${id}/reject`, { note }); toast(t('toast.decided')); render();
}

export async function renderAdminDashboard(view) {
  const [users, courses, teams, rep, regs, research] = await Promise.all([api('GET', '/users'), api('GET', '/courses'), api('GET', '/teams'), api('GET', '/reports'), api('GET', '/registrations'), api('GET', '/research?limit=500')]);
  const pending = regs.filter(r => r.status === 'pending');
  const sups = users.filter(u => u.role === 'supervisor'), studs = users.filter(u => u.role === 'student');
  const st = s => rep.byStatus.find(x => x.status === s)?.n ?? 0;
  const alerts = rep.totals.overdue + users.filter(u => !u.active).length;
  const today = new Date().toLocaleDateString(lang === 'ar' ? 'ar' : undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  // activity timeline from real records: registration requests/decisions and newly registered research
  const feed = [
    ...regs.map(r => ({ at: r.created_at, ic: 'userPlus', tone: '', text: t('act.reg', { n: r.name, id: r.university_id }), who: r.name })),
    ...regs.filter(r => r.decided_at).map(r => ({ at: r.decided_at, ic: r.status === 'approved' ? 'userCheck' : 'x', tone: r.status === 'approved' ? 'ok' : 'bad', text: t(r.status === 'approved' ? 'act.regOk' : 'act.regNo', { n: r.name }), who: r.decided_by })),
    ...research.map(p => ({ at: p.created_at, ic: 'fileText', tone: 'teal', text: t('act.research', { n: p.title }), who: p.team ?? p.student })),
  ].filter(x => x.at).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 7);
  const supRows = sups.map(u => { const mine = research.filter(p => p.supervisor === u.name); return { ...u, n: mine.length, courses: [...new Set(mine.map(p => p.course))] }; }).sort((a, b) => b.n - a.n);
  const pct = p => p.stages_total ? Math.round(p.stages_approved / p.stages_total * 100) : 0;
  view.innerHTML = `<section class="hero"><div class="grow"><div class="date">${icon('calendar')} ${esc(today)}</div><h1>${t('ad.welcome')}</h1><p>${t('ad.welcomeSub', { name: esc(state.user.name) })}</p>
      <div><span class="chip">${icon('users')} ${t('ad.chipUsers', { n: users.length })}</span><span class="chip">${icon('fileText')} ${t('ad.chipResearch', { n: rep.totals.research })}</span><span class="chip">${icon('userCheck')} ${t('ad.chipPending', { n: pending.length })}</span></div></div>
      <div class="row">${pending.length ? `<button data-go="registrations">${icon('userCheck')} ${t('ad.reviewNow')}</button>` : ''}<button class="ghost" data-qa="adduser">${icon('userPlus')} ${t('addUser')}</button></div></section>
    <div class="stats four">
      ${statCard({ ic: 'users', label: t('rUsers'), value: users.length, desc: t('ad.d.users', { n: users.filter(u => u.active).length }), accent: 'var(--primary)', to: 'users', feature: true })}
      ${statCard({ ic: 'cap', label: t('ad.students'), value: studs.length, desc: t('ad.d.students', { n: studs.filter(u => u.must_change_password).length }), accent: 'var(--teal)', to: 'users' })}
      ${statCard({ ic: 'shield', label: t('ad.supervisors'), value: sups.length, desc: t('ad.d.sups', { n: supRows.filter(x => x.n).length }), accent: '#9B7BEA', to: 'users' })}
      ${statCard({ ic: 'book', label: t('nav.courses'), value: courses.length, desc: t('ad.d.courses', { n: courses.filter(c => c.team_mode !== 'individual').length }), accent: 'var(--cyan)', to: 'courses' })}
      ${statCard({ ic: 'users', label: t('nav.teams'), value: teams.length, desc: t('ad.d.teams', { n: teams.filter(x => x.locked).length }), accent: '#22B8CF' })}
      ${statCard({ ic: 'fileText', label: t('rResearch'), value: rep.totals.research, desc: t('ad.d.research', { n: st('approved') }), accent: 'var(--ok)', to: 'research' })}
      ${statCard({ ic: 'userCheck', label: t('ad.pending'), value: pending.length, desc: t('ad.d.pending'), accent: 'var(--amber)', to: 'registrations' })}
      ${statCard({ ic: 'alert', label: t('ad.alerts'), value: alerts, desc: t('ad.d.alerts', { o: rep.totals.overdue, i: users.filter(u => !u.active).length }), accent: alerts ? 'var(--bad)' : 'var(--gray)', to: 'reports' })}</div>
    <div class="grid g-main" style="margin-bottom:18px;align-items:start">
      <section class="card"><div class="card-h"><h3>${icon('userCheck')} ${t('regTitle')} ${pending.length ? `<span class="badge pending">${pending.length}</span>` : ''}</h3><button class="link" data-go="registrations">${t('viewAll')} ${icon('arrow')}</button></div>
        ${pending.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('name')}</th><th>${t('requestedAt')}</th><th>${t('status')}</th><th><span class="sr-only">${t('actions')}</span></th></tr></thead><tbody>
          ${pending.slice(0, 5).map(r => `<tr><td data-label="${t('name')}"><div class="member" style="padding:0">${avatar(r.name, 'sm')}<div class="t"><b>${esc(r.name)}</b><div class="tiny mute" dir="ltr">${esc(r.university_id)}</div></div></div></td>
            <td data-label="${t('requestedAt')}" class="small mute">${relTime(r.created_at)}</td><td data-label="${t('status')}">${regBadge(r.status)}</td>
            <td><div class="row" style="justify-content:flex-end;flex-wrap:nowrap"><button class="ok sm" data-ap="${r.id}" aria-label="${t('approveBtn')}" data-tip="${t('approveBtn')}">${icon('check')}</button><button class="bad sm" data-rj="${r.id}" aria-label="${t('rejectBtn')}" data-tip="${t('rejectBtn')}">${icon('x')}</button><button class="ghost sm" data-det="${r.id}" aria-label="${t('rg.details')}" data-tip="${t('rg.details')}">${icon('eye')}</button></div></td></tr>`).join('')}</tbody></table></div>`
          : empty({ ic: 'userCheck', title: t('ad.noPendingT'), text: t('ad.noPending') })}</section>
      <section class="card"><div class="card-h"><h3>${icon('pie')} ${t('ad.analytics')}</h3><button class="link" data-go="reports">${t('nav.reports')}</button></div>
        ${donut([{ label: t('ad.s.review'), value: st('pending'), color: '#FBBF24' }, { label: t('st.approved'), value: st('approved'), color: '#34D399' }, { label: t('st.changes_requested'), value: st('changes_requested'), color: '#FB923C' }, { label: t('st.rejected'), value: st('rejected'), color: '#F87171' }], t('rResearch'))}
        <div class="divider"></div><div class="row small mute" style="gap:16px"><span>${t('rSubmissions')}: <b style="color:var(--ink)">${rep.totals.submissions}</b></span><span>${t('rAvg')}: <b style="color:var(--ink)">${rep.averageGrade ?? '—'}</b></span><span>${t('rOverdue')}: <b style="color:var(--ink)">${rep.totals.overdue}</b></span></div></section></div>
    <div class="grid g-main" style="margin-bottom:18px;align-items:start">
      <section class="card"><div class="card-h"><h3>${icon('fileText')} ${t('ad.recentResearch')}</h3><button class="link" data-go="research">${t('viewAll')} ${icon('arrow')}</button></div>
        ${research.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('title')}</th><th>${t('supervisor')}</th><th>${t('status')}</th><th>${t('rl.progress')}</th><th>${t('deadline')}</th></tr></thead><tbody>
          ${research.slice(0, 6).map(p => `<tr class="click" data-r="${p.id}"><td data-label="${t('title')}"><b>${esc(p.title)}</b><div class="tiny mute">${p.team ? esc(p.team) : t('individual')} · ${esc(p.course)}</div></td><td data-label="${t('supervisor')}">${esc(p.supervisor)}</td>
            <td data-label="${t('status')}">${badge(p.status)}</td><td data-label="${t('rl.progress')}" style="min-width:120px" data-v="${pct(p)}">${progress(pct(p))}<span class="tiny mute">${pct(p)}%</span></td>
            <td data-label="${t('deadline')}" class="small">${p.deadline ? fmtDay(p.deadline) : '—'}</td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'fileText', title: t('noResearch') })}</section>
      <section class="card"><div class="card-h"><h3>${icon('activity')} ${t('ad.activityT')}</h3></div>${feed.length ? `<ul class="feed">${feed.map(f => `<li><span class="ic ${f.tone}">${icon(f.ic)}</span><div><div class="small">${esc(f.text)}</div><div class="tiny mute">${esc(f.who ?? '')}</div></div><span class="when">${relTime(f.at)}</span></li>`).join('')}</ul>` : empty({ ic: 'activity', title: t('sup.noActivity') })}</section></div>
    <div class="grid g-main" style="align-items:start">
      <section class="card"><div class="card-h"><h3>${icon('shield')} ${t('ad.supsT')}</h3><button class="link" data-go="users">${t('nav.users')}</button></div>${supRows.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('name')}</th><th>${t('ad.courses')}</th><th>${t('projects')}</th><th>${t('status')}</th></tr></thead><tbody>
        ${supRows.map(u => `<tr><td data-label="${t('name')}"><div class="member" style="padding:0">${avatar(u.name)}<div class="t"><b>${esc(u.name)}</b><div class="tiny mute" dir="ltr">${esc(u.email)}</div></div></div></td><td data-label="${t('ad.courses')}" class="small">${u.courses.map(esc).join('، ') || '<span class="mute">—</span>'}</td>
          <td data-label="${t('projects')}"><b>${u.n}</b></td><td data-label="${t('status')}"><span class="badge ${u.active ? 'active' : 'inactive'}">${u.active ? t('active') : t('inactive')}</span></td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'shield', title: t('ad.noSups'), action: `<button data-qa="adduser">${icon('userPlus')} ${t('addUser')}</button>` })}</section>
      <section class="card"><div class="card-h"><h3>${icon('sparkle')} ${t('sd.quick')}</h3></div><div class="qa">
        <button data-qa="adduser"><span class="ic">${icon('userPlus')}</span><b>${t('addUser')}</b><span>${t('qa.addUser')}</span></button>
        <button data-qa="course"><span class="ic">${icon('bookPlus')}</span><b>${t('addCourse')}</b><span>${t('qa.course')}</span></button>
        <button data-go="registrations"><span class="ic">${icon('userCheck')}</span><b>${t('qa.approve')}</b><span>${t('qa.approveD', { n: pending.length })}</span></button>
        <button data-qa="import"><span class="ic">${icon('upload')}</span><b>${t('qa.import')}</b><span>${t('qa.importD')}</span></button>
        <button data-go="reports"><span class="ic">${icon('chart')}</span><b>${t('qa.reports')}</b><span>${t('qa.reportsD')}</span></button>
        <button data-go="research"><span class="ic">${icon('fileText')}</span><b>${t('nav.research')}</b><span>${t('qa.researchD')}</span></button></div></section></div>`;
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  view.querySelectorAll('[data-qa]').forEach(b => b.onclick = () => ({ adduser: () => go('users', { openAddUser: true }), course: () => go('courses', { focusCourse: true }), import: () => go('ids', { openAddIds: true }) })[b.dataset.qa]());
  view.querySelectorAll('[data-ap]').forEach(b => b.onclick = act(() => approveReg(Number(b.dataset.ap))));
  view.querySelectorAll('[data-rj]').forEach(b => b.onclick = act(() => rejectReg(Number(b.dataset.rj))));
  view.querySelectorAll('[data-det]').forEach(b => b.onclick = () => regDetails(regs.find(r => r.id === Number(b.dataset.det))));
  view.querySelectorAll('tr[data-r]').forEach(tr => tr.onclick = () => go('research', { openId: Number(tr.dataset.r) }));
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
  const list = sortRows(filterRows(all, q, ['university_id', 'name', 'email']), state.rsort ?? { key: 'created_at', dir: -1 });
  view.innerHTML = `${pageHeader({ title: t('regTitle'), sub: t('rg.sub') })}${tabsHtml(['pending', 'approved', 'rejected'].map(s => ({ key: s, label: t(s === 'pending' ? 'regPending' : s === 'approved' ? 'regApproved' : 'regRejected') })), f)}
    <div class="card"><form class="search" id="sf" style="margin-bottom:12px;max-width:340px">${icon('search')}<input id="sq" type="search" value="${esc(q)}" placeholder="${t('rg.search')}" aria-label="${t('rg.search')}"></form>
    ${list.length ? `<div class="table-wrap"><table class="rt"><thead><tr>${th(t('uid'), 'university_id', state.rsort ?? { key: 'created_at', dir: -1 })}${th(t('name'), 'name', state.rsort)}${th(t('requestedAt'), 'created_at', state.rsort ?? { key: 'created_at', dir: -1 })}<th>${t('status')}</th><th><span class="sr-only">${t('actions')}</span></th></tr></thead><tbody>${paginate(list, page, PER).map(r => `<tr><td data-label="${t('uid')}" dir="ltr" style="text-align:start"><b>${esc(r.university_id)}</b></td><td data-label="${t('name')}">${esc(r.name)}${r.email ? `<div class="small mute" dir="ltr">${esc(r.email)}</div>` : ''}</td>
      <td data-label="${t('requestedAt')}" class="small">${fmtDate(r.created_at)}</td><td data-label="${t('status')}">${r.status === 'pending' ? `<span class="badge pending">${t('regPending')}</span>` : `<span class="badge ${r.status === 'approved' ? 'approved' : 'rejected'}">${t(r.status === 'approved' ? 'regApproved' : 'regRejected')}</span><div class="small mute">${t('decidedBy')}: ${esc(r.decided_by ?? '—')} · ${r.decided_at ? fmtDate(r.decided_at) : ''}${r.decision_note ? '<br>' + esc(r.decision_note) : ''}</div>`}</td>
      <td><div class="row" style="justify-content:flex-end">${r.status === 'pending' ? `<button class="ok sm" data-ap="${r.id}">${icon('check')} ${t('approveBtn')}</button><button class="bad sm" data-rj="${r.id}">${icon('x')} ${t('rejectBtn')}</button>` : ''}<button class="ghost sm" data-det="${r.id}" aria-label="${t('rg.details')}" data-tip="${t('rg.details')}">${icon('eye')}</button></div></td></tr>`).join('')}</tbody></table></div>${pagerHtml(list.length, page, PER)}` : empty({ ic: 'inbox', title: t('noRegs') })}</div>`;
  view.querySelectorAll('[data-tabk]').forEach(b => b.onclick = () => { state.regFilter = b.dataset.tabk; state.regPage = 1; render(); });
  $('#sf').onsubmit = e => { e.preventDefault(); state.regQ = $('#sq').value.trim(); state.regPage = 1; render(); };
  bindPager(view, p => { state.regPage = p; render(); }); bindSort(view, 'rsort', render);
  view.querySelectorAll('[data-det]').forEach(b => b.onclick = () => regDetails(all.find(r => r.id === Number(b.dataset.det))));
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
  const page = state.idPage ?? 1, q = state.idQ ?? '', list = sortRows(filterRows(ids.map(i => ({ ...i, st: i.user_id ? 'registered' : i.request_status ?? '' })), q, ['university_id', 'name']), state.isort);
  view.innerHTML = `${pageHeader({ title: t('idsTitle'), sub: t('idsAddHint'), actions: `<button id="addbtn">${icon('plus')} ${t('idsAdd')}</button>` })}
    <section class="card" id="addbox" hidden><form id="f"><label for="tx">${t('idsAddHint')}</label><textarea id="tx" required placeholder="20240101,Name&#10;20240102"></textarea>
      <label>${t('idsCourses')}</label><div class="row">${courses.map(c => `<label class="inl"><input type="checkbox" data-c="${c.id}" checked> ${esc(c.name)}</label>`).join('')}</div><p><button>${t('idsAdd')}</button></p></form></section>
    <div class="card"><form class="search" id="sf" style="margin-bottom:12px;max-width:340px">${icon('search')}<input id="sq" type="search" value="${esc(q)}" placeholder="${t('rg.search')}" aria-label="${t('rg.search')}"></form>
    ${list.length ? `<div class="table-wrap"><table class="rt"><thead><tr>${th(t('uid'), 'university_id', state.isort)}${th(t('name'), 'name', state.isort)}<th>${t('enrollments')}</th>${th(t('status'), 'st', state.isort)}<th><span class="sr-only">${t('actions')}</span></th></tr></thead><tbody>${paginate(list, page, PER).map(i => `<tr><td data-label="${t('uid')}" dir="ltr" style="text-align:start"><b>${esc(i.university_id)}</b></td><td data-label="${t('name')}">${esc(i.name ?? '')}</td>
      <td data-label="${t('enrollments')}" class="small">${i.courses.map(cid => esc(courses.find(c => c.id === cid)?.name ?? cid)).join('، ') || '—'}</td><td data-label="${t('status')}">${i.user_id ? `<span class="badge approved">${t('registered')}</span>` : i.request_status ? `<span class="badge ${i.request_status === 'pending' ? 'pending' : 'rejected'}">${t(i.request_status === 'pending' ? 'regPending' : 'regRejected')}</span>` : '<span class="mute">—</span>'}</td>
      <td>${i.user_id ? '' : `<button class="bad sm" data-del="${i.id}" aria-label="${t('del')}">${icon('trash')}</button>`}</td></tr>`).join('')}</tbody></table></div>${pagerHtml(list.length, page, PER)}` : empty({ ic: 'cap', title: t('noIds') })}</div>`;
  $('#addbtn').onclick = () => { $('#addbox').hidden = !$('#addbox').hidden; if (!$('#addbox').hidden) $('#tx').focus(); };
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const r = await api('POST', '/approved-ids', { text: $('#tx').value, courseIds: [...view.querySelectorAll('[data-c]:checked')].map(i => Number(i.dataset.c)) });
    toast(t('idsAdded', { a: r.added, s: r.skipped.length })); render();
  });
  $('#sf').onsubmit = e => { e.preventDefault(); state.idQ = $('#sq').value.trim(); state.idPage = 1; render(); };
  bindPager(view, p => { state.idPage = p; render(); }); bindSort(view, 'isort', render);
  if (state.openAddIds) { state.openAddIds = false; $('#addbox').hidden = false; $('#tx').focus(); }
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
        <td data-label="${t('deadline')}"><div class="row">${dateField('dl' + p.id, p.deadline ?? '', t('deadline'))}<button class="ghost sm" data-savedl="${p.id}">${t('save')}</button>${dueBadge(p)}</div></td></tr>`).join('')}</tbody></table></div>${pagerHtml(r.projects.length, page, PER)}` : empty({ ic: 'book', title: t('noResearch') })}</section>`;
  bindPager(view, p => { state.arPage = p; render(); }); bindDateFields(view);
  view.querySelectorAll('[data-savedl]').forEach(b => b.onclick = act(async () => {
    const v = view.querySelector(`#dl${b.dataset.savedl}`).value;
    await api('PUT', `/research/${b.dataset.savedl}/deadline`, { deadline: v || null }); render();
  }, 'toast.deadline'));
}

// ---------- Admin: users ----------
export async function renderUsers(view) {
  const [users, courses] = await Promise.all([api('GET', '/users'), api('GET', '/courses')]);
  const page = state.upage ?? 1, q = state.uq ?? '', rf = state.urole ?? '';
  const list = sortRows(filterRows(users.filter(u => !rf || u.role === rf), q, ['name', 'email', 'university_id']), state.usort, { uid: u => u.university_id ?? u.email, status: u => u.active ? 0 : 1 });
  view.innerHTML = `${pageHeader({ title: t('usersAuth'), sub: t('us.sub'), actions: `<button id="addu">${icon('plus')} ${t('addUser')}</button>` })}
    <div class="card"><div class="row" style="gap:10px;margin-bottom:12px"><form class="search grow" id="sf" style="max-width:340px">${icon('search')}<input id="sq" type="search" value="${esc(q)}" placeholder="${t('us.search')}" aria-label="${t('us.search')}"></form>
      <select id="rf" aria-label="${t('role')}"><option value="">${t('role')}</option>${['student', 'supervisor', 'admin'].map(x => `<option value="${x}" ${rf === x ? 'selected' : ''}>${roleLabel(x)}</option>`).join('')}</select></div>
    ${list.length ? `<div class="table-wrap"><table class="rt"><thead><tr>${th(t('name'), 'name', state.usort)}${th(`${t('uid')} / ${t('email')}`, 'uid', state.usort)}${th(t('role'), 'role', state.usort)}<th>${t('enrollments')}</th>${th(t('status'), 'status', state.usort)}<th><span class="sr-only">${t('actions')}</span></th></tr></thead><tbody>${paginate(list, page, PER).map(u => `<tr><td data-label="${t('name')}"><div class="member" style="padding:0">${avatar(u.name)}<div class="t"><b>${esc(u.name)}</b>${u.must_change_password ? `<div class="tiny mute">${t('mustChange')}</div>` : ''}</div></div></td>
      <td data-label="${t('uid')}" dir="ltr" style="text-align:start">${esc(u.university_id ?? u.email)}</td><td data-label="${t('role')}"><select data-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''} aria-label="${t('role')}">${['student', 'supervisor', 'admin'].map(x => `<option value="${x}" ${x === u.role ? 'selected' : ''}>${roleLabel(x)}</option>`).join('')}</select></td>
      <td data-label="${t('enrollments')}" class="small">${u.role === 'student' ? (u.courses.map(c => esc(courses.find(x => x.id === c)?.name ?? c)).join('، ') || '—') : '<span class="mute">—</span>'}</td>
      <td data-label="${t('status')}"><span class="badge ${u.active ? 'active' : 'inactive'}">${u.active ? t('active') : t('inactive')}</span></td>
      <td>${u.id === state.user.id ? '' : rowMenu([...(u.role === 'student' ? [{ label: t('enrollments'), ic: 'book', attrs: `data-en="${u.id}"` }] : []), { label: u.active ? t('deactivate') : t('activate'), ic: u.active ? 'lock' : 'check', attrs: `data-act="${u.id}:${u.active ? 0 : 1}"` }, { label: t('del'), ic: 'trash', attrs: `data-del="${u.id}"`, danger: true }])}</td></tr>`).join('')}</tbody></table></div>${pagerHtml(list.length, page, PER)}` : empty({ ic: 'users', title: t('us.empty') })}</div>`;
  $('#sf').onsubmit = e => { e.preventDefault(); state.uq = $('#sq').value.trim(); state.upage = 1; render(); };
  $('#rf').onchange = () => { state.urole = $('#rf').value; state.upage = 1; render(); };
  bindSort(view, 'usort', render); bindDropdowns(view);
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
  if (state.openAddUser) { state.openAddUser = false; setTimeout(() => $('#addu')?.click(), 0); }
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
  if (state.focusCourse) { state.focusCourse = false; setTimeout(() => $('#n')?.focus(), 0); }
}
