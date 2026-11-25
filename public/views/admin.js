// Teams, reports, users and courses views.
import { $, esc, t, badge, dueBadge, state, api, act, courseOpts, roleLabel, render } from '../core.js';

// ---------- Supervisor/Admin: form and manage teams ----------
export async function renderTeams(view) {
  const [teams, students, courses] = await Promise.all([api('GET', '/teams'), api('GET', '/students'), api('GET', '/courses')]);
  const free = students.filter(s => !s.team_id);
  view.innerHTML = `<div class="card"><h2>${t('formTeam')}</h2><form id="f">
    <label for="n">${t('teamName')}</label><input id="n" required maxlength="100">
    <label for="c">${t('course')}</label><select id="c">${courseOpts(courses)}</select>
    <label>${t('members')} <span class="mute small">(${t('leaderOpt')}: ◉)</span></label><div class="checks">${students.map(s => `<label><input type="checkbox" value="${s.id}"> ${esc(s.name)} <span class="mute small" dir="ltr">${esc(s.email)}</span>${s.team_id ? ` <span class="mute small">${t('moveWarn')}</span>` : ''}
      <input type="radio" name="leader" value="${s.id}" title="${t('teamLeader')}" style="margin-inline-start:auto"></label>`).join('') || `<span class="mute">${t('noStudents')}</span>`}</div>
    <p><button type="submit">${t('createTeam')}</button></p></form></div>
    ${teams.length ? teams.map(x => `<div class="card"><div class="row"><h3 class="grow" style="margin:0">${esc(x.name)}</h3><span class="mute small">${esc(x.course)}</span>
        ${state.user.role === 'supervisor' ? `<button class="ghost" data-msg="${x.id}">✉ ${t('messageTeam')}</button>` : ''}</div>
      <p class="small mute">${t('teamResearch')}: ${x.research ? `<a href="#" data-r="${x.research.id}">${esc(x.research.title)}</a> ${badge(x.research.status)}` : t('noResearchYet')}</p>
      ${x.research ? `<p class="small">${t('stageProgress', { a: x.stages.approved, t: x.stages.total, p: x.stages.pending_review, m: x.stages.missing, l: x.stages.late })}</p>` : ''}
      <div>${x.members.map(m => `<div class="row" style="margin:4px 0"><span class="grow">${m.leader ? '★ ' : ''}${esc(m.name)} <span class="mute small" dir="ltr">${esc(m.email)}</span>${m.leader ? ` <span class="badge approved">${t('teamLeader')}</span>` : ''}</span>
        ${m.leader ? '' : `<button class="ghost" data-lead="${x.id}:${m.id}">${t('setLeader')}</button>`}<button class="ghost" data-rm="${x.id}:${m.id}" aria-label="${t('removeMember')}">✕</button></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><select data-addsel="${x.id}"><option value="">${t('addMember')}…</option>${free.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <button class="ghost" data-add="${x.id}">${t('add')}</button></div></div>`).join('') : `<div class="card"><span class="mute">${t('noTeams')}</span></div>`}`;
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const memberIds = [...view.querySelectorAll('.checks input[type=checkbox]:checked')].map(i => Number(i.value));
    const lead = view.querySelector('input[name=leader]:checked');
    await api('POST', '/teams', { name: $('#n').value, courseId: $('#c').value, memberIds, leaderId: lead && memberIds.includes(Number(lead.value)) ? Number(lead.value) : undefined }); render();
  }, 'toast.team');
  const upd = (path, body) => act(async () => { await api('PUT', path, body); render(); }, 'toast.teamUpdated');
  view.querySelectorAll('[data-lead]').forEach(b => { const [tid, uid] = b.dataset.lead.split(':'); b.onclick = upd(`/teams/${tid}/leader`, { userId: Number(uid) }); });
  view.querySelectorAll('[data-rm]').forEach(b => { const [tid, uid] = b.dataset.rm.split(':'); b.onclick = () => confirm(t('confirmRemoveMember')) && upd(`/teams/${tid}/members`, { remove: [Number(uid)] })(); });
  view.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const v = view.querySelector(`[data-addsel="${b.dataset.add}"]`).value; if (v) upd(`/teams/${b.dataset.add}/members`, { add: [Number(v)] })();
  });
  view.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => { state.thread = `t${b.dataset.msg}`; state.tab = 'messages'; render(); });
  view.querySelectorAll('[data-r]').forEach(a => a.onclick = e => { e.preventDefault(); state.tab = 'research'; state.openId = Number(a.dataset.r); render(); });
}

// ---------- Admin ----------
export async function renderReports(view) {
  const r = await api('GET', '/reports');
  const n = s => r.byStatus.find(x => x.status === s)?.n ?? 0;
  view.innerHTML = `<div class="stats">
    ${[[t('rResearch'), r.totals.research], [t('rSubmissions'), r.totals.submissions], [t('rUsers'), r.totals.users], [t('rAvg'), r.averageGrade ?? '—'],
      [t('rOverdue'), r.totals.overdue, r.totals.overdue ? 'overdue' : ''], [t('st.pending'), n('pending')], [t('st.approved'), n('approved')],
      [t('st.changes_requested'), n('changes_requested')], [t('st.rejected'), n('rejected')]]
      .map(([k, v, c]) => `<div class="stat"><b class="${c ?? ''}">${v}</b><span class="small mute">${k}</span></div>`).join('')}</div>
    <div class="card wide"><h3>${t('supervisors')}</h3><table><tr><th>${t('name')}</th><th>${t('projects')}</th><th>${t('approvedC')}</th><th>${t('pendingC')}</th></tr>
    ${r.perSupervisor.map(s => `<tr><td>${esc(s.name)}</td><td>${s.projects}</td><td>${s.approved ?? 0}</td><td>${s.pending ?? 0}</td></tr>`).join('')}</table></div>
    <div class="card wide"><h3>${t('allResearch')}</h3>${r.projects.length ? `<table><tr><th>${t('title')}</th><th>${t('status')}</th><th>${t('student')}</th><th>${t('supervisor')}</th><th>${t('grade')}</th><th>${t('deadline')}</th></tr>
    ${r.projects.map(p => `<tr class="${p.overdue ? 'late' : ''}"><td>${esc(p.title)}</td><td>${badge(p.status)}</td><td>${esc(p.student)}</td><td>${esc(p.supervisor)}</td><td>${p.grade ?? '—'}</td>
      <td><div class="row"><input type="date" value="${p.deadline ?? ''}" data-dl="${p.id}" aria-label="${t('deadline')}"><button class="ghost" data-savedl="${p.id}">${t('save')}</button>${dueBadge(p)}</div></td></tr>`).join('')}</table>` : `<span class="mute">${t('noResearch')}</span>`}</div>`;
  view.querySelectorAll('[data-savedl]').forEach(b => b.onclick = act(async () => {
    const v = view.querySelector(`[data-dl="${b.dataset.savedl}"]`).value;
    await api('PUT', `/research/${b.dataset.savedl}/deadline`, { deadline: v || null }); render();
  }, 'toast.deadline'));
}

export async function renderUsers(view) {
  const users = await api('GET', '/users');
  view.innerHTML = `<div class="card"><h2>${t('addUser')}</h2><form id="f" class="row">
    <input class="grow" id="n" placeholder="${t('namePh')}" required><input class="grow" id="e" type="email" dir="ltr" placeholder="${t('email')}" required>
    <input class="grow" id="p" type="password" dir="ltr" placeholder="${t('pwPh')}" required minlength="6">
    <select id="r">${['student', 'supervisor', 'admin'].map(x => `<option value="${x}">${roleLabel(x)}</option>`).join('')}</select><button>${t('add')}</button></form></div>
    <div class="card wide"><h3>${t('usersAuth')}</h3><table><tr><th>${t('name')}</th><th>${t('email')}</th><th>${t('role')}</th><th></th></tr>
    ${users.map(u => `<tr><td>${esc(u.name)}</td><td dir="ltr" style="text-align:end">${esc(u.email)}</td>
      <td><select data-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>${['student', 'supervisor', 'admin'].map(x => `<option value="${x}" ${x === u.role ? 'selected' : ''}>${roleLabel(x)}</option>`).join('')}</select></td>
      <td>${u.id === state.user.id ? '' : `<button class="bad" data-del="${u.id}">${t('del')}</button>`}</td></tr>`).join('')}</table></div>`;
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    await api('POST', '/users', { name: $('#n').value, email: $('#e').value, password: $('#p').value, role: $('#r').value }); render();
  }, 'toast.user');
  view.querySelectorAll('[data-role]').forEach(s => s.onchange = act(async () => {
    await api('PATCH', `/users/${s.dataset.role}/role`, { role: s.value }); render();
  }, 'toast.role'));
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => {
    if (!confirm(t('confirmDel'))) return;
    await api('DELETE', `/users/${b.dataset.del}`); render();
  }, 'toast.deleted'));
}

export async function renderCourses(view) {
  const courses = await api('GET', '/courses');
  view.innerHTML = `<div class="card"><h2>${t('courses')}</h2><form id="f" class="row"><input class="grow" id="n" placeholder="${t('courseName')}" required><button>${t('addCourse')}</button></form>
    <ul>${courses.map(c => `<li>${esc(c.name)}</li>`).join('')}</ul></div>`;
  $('#f').onsubmit = act(async e => { e.preventDefault(); await api('POST', '/courses', { name: $('#n').value }); render(); }, 'toast.course');
}
