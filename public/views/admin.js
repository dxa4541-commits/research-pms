// Teams, reports, users and courses views.
import { $, esc, t, badge, dueBadge, state, api, act, courseOpts, roleLabel, render, fmtDate, toast } from '../core.js';

// ---------- Course team rules (supervisor/admin) ----------
function courseRulesCard(courses) {
  return `<div class="card"><h3>${t('courseRules')}</h3>${courses.map(c => `<form class="row rules" data-course="${c.id}" style="margin:8px 0;align-items:end"><b class="grow" style="min-width:140px">${esc(c.name)}</b>
    <label class="inl">${t('teamMode')} <select data-f="team_mode">${['both', 'team', 'individual'].map(m => `<option value="${m}" ${c.team_mode === m ? 'selected' : ''}>${t(m === 'team' ? 'modeTeam' : m === 'individual' ? 'modeIndividual' : 'modeBoth')}</option>`).join('')}</select></label>
    <label class="inl">${t('minSize')} <input type="number" data-f="min_team_size" min="1" max="20" style="width:70px" value="${c.min_team_size}"></label>
    <label class="inl">${t('maxSize')} <input type="number" data-f="max_team_size" min="1" max="20" style="width:70px" value="${c.max_team_size}"></label>
    <label class="inl"><input type="checkbox" data-f="teams_locked" ${c.teams_locked ? 'checked' : ''}> ${t('teamsLockedC')}</label>
    <label class="inl"><input type="checkbox" data-f="show_student_ids" ${c.show_student_ids ? 'checked' : ''}> ${t('showIds')}</label><button>${t('saveRules')}</button></form>`).join('')}</div>`;
}
function bindCourseRules(view) {
  view.querySelectorAll('form.rules').forEach(f => f.onsubmit = act(async e => {
    e.preventDefault();
    const g = k => f.querySelector(`[data-f=${k}]`);
    await api('PUT', `/courses/${f.dataset.course}/settings`, { team_mode: g('team_mode').value, min_team_size: Number(g('min_team_size').value), max_team_size: Number(g('max_team_size').value),
      teams_locked: g('teams_locked').checked, show_student_ids: g('show_student_ids').checked }); render();
  }, 'toast.rules'));
}

// ---------- Supervisor/Admin: form and manage teams ----------
export async function renderTeams(view) {
  const [teams, students, courses, reqs] = await Promise.all([api('GET', '/teams'), api('GET', '/students'), api('GET', '/courses'), api('GET', '/membership-requests')]);
  const free = cid => students.filter(s => s.active && s.courses.includes(cid) && !s.teams[cid]);
  const pending = reqs.filter(r => r.status === 'pending');
  view.innerHTML = `${courseRulesCard(courses)}
    ${pending.length ? `<div class="card"><h3>${t('mreq')}</h3>${pending.map(r => `<div class="row" style="margin:6px 0"><span class="grow"><b>${esc(r.team)}</b> — ${esc(r.member)} <span class="badge pending">${t('k' + (r.kind === 'leave' ? 'Remove' : r.kind[0].toUpperCase() + r.kind.slice(1)))}${r.kind === 'leave' ? ' (' + t('leaveTeam') + ')' : ''}</span>
      <span class="small mute">${esc(r.requested_by)}${r.note ? ' · ' + esc(r.note) : ''}</span></span><button class="ok" data-cr="${r.id}:1">${t('approveChange')}</button><button class="bad" data-cr="${r.id}:0">${t('rejectChange')}</button></div>`).join('')}</div>` : ''}
    <div class="card"><h2>${t('formTeam')}</h2><form id="f">
    <label for="n">${t('teamName')}</label><input id="n" required maxlength="100">
    <label for="c">${t('course')}</label><select id="c">${courseOpts(courses)}</select>
    <label>${t('members')} <span class="mute small">(${t('leaderOpt')}: ◉)</span></label><div class="checks" id="ml"></div>
    <p><button type="submit">${t('createTeam')}</button></p></form></div>
    ${teams.length ? teams.map(x => `<div class="card"><div class="row"><h3 class="grow" style="margin:0">${esc(x.name)}</h3><span class="mute small">${esc(x.course)}</span>${x.locked ? `<span class="badge closed">${t('lockedL')}</span>` : ''}
        <button class="ghost" data-lock="${x.id}:${x.locked ? 0 : 1}">${x.locked ? t('unlockTeam') : t('lockTeam')}</button>
        ${state.user.role === 'supervisor' ? `<button class="ghost" data-msg="${x.id}">✉ ${t('messageTeam')}</button>` : ''}<button class="ghost" data-hist="${x.id}">${t('teamHistory')}</button></div>
      <p class="small mute">${t('teamResearch')}: ${x.research ? `<a href="#" data-r="${x.research.id}">${esc(x.research.title)}</a> ${badge(x.research.status)}` : t('noResearchYet')}</p>
      ${x.research ? `<p class="small">${t('stageProgress', { a: x.stages.approved, t: x.stages.total, p: x.stages.pending_review, m: x.stages.missing, l: x.stages.late })}</p>` : ''}
      <div>${x.members.map(m => `<div class="row" style="margin:4px 0"><span class="grow">${m.leader ? '★ ' : ''}${esc(m.name)} <span class="mute small" dir="ltr">${esc(m.university_id ?? '')}</span>${m.leader ? ` <span class="badge approved">${t('teamLeader')}</span>` : ''}</span>
        ${m.leader ? '' : `<button class="ghost" data-lead="${x.id}:${m.id}">${t('setLeader')}</button>`}<button class="ghost" data-rm="${x.id}:${m.id}" aria-label="${t('removeMember')}">✕</button></div>`).join('')}</div>
      <div class="row" style="margin-top:8px"><select data-addsel="${x.id}"><option value="">${t('addMember')}…</option>${free(x.course_id).map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
        <button class="ghost" data-add="${x.id}">${t('add')}</button></div><div id="h${x.id}"></div></div>`).join('') : `<div class="card"><span class="mute">${t('noTeams')}</span></div>`}`;
  const paint = () => {
    const cid = Number($('#c').value), list = free(cid);
    $('#ml').innerHTML = list.map(s => `<label><input type="checkbox" value="${s.id}"> ${esc(s.name)} <span class="mute small" dir="ltr">${esc(s.university_id ?? s.email)}</span>
      <input type="radio" name="leader" value="${s.id}" title="${t('teamLeader')}" style="margin-inline-start:auto"></label>`).join('') || `<span class="mute">${t('noStudents')}</span>`;
  };
  $('#c').onchange = paint; paint();
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const memberIds = [...view.querySelectorAll('#ml input[type=checkbox]:checked')].map(i => Number(i.value));
    const lead = view.querySelector('#ml input[name=leader]:checked');
    await api('POST', '/teams', { name: $('#n').value, courseId: $('#c').value, memberIds, leaderId: lead && memberIds.includes(Number(lead.value)) ? Number(lead.value) : undefined }); render();
  }, 'toast.team');
  bindCourseRules(view);
  const upd = (path, body) => act(async () => { await api('PUT', path, body); render(); }, 'toast.teamUpdated');
  view.querySelectorAll('[data-lead]').forEach(b => { const [tid, uid] = b.dataset.lead.split(':'); b.onclick = upd(`/teams/${tid}/leader`, { userId: Number(uid) }); });
  view.querySelectorAll('[data-rm]').forEach(b => { const [tid, uid] = b.dataset.rm.split(':'); b.onclick = () => confirm(t('confirmRemoveMember')) && upd(`/teams/${tid}/members`, { remove: [Number(uid)] })(); });
  view.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    const v = view.querySelector(`[data-addsel="${b.dataset.add}"]`).value; if (v) upd(`/teams/${b.dataset.add}/members`, { add: [Number(v)] })();
  });
  view.querySelectorAll('[data-lock]').forEach(b => { const [tid, v] = b.dataset.lock.split(':'); b.onclick = upd(`/teams/${tid}/lock`, { locked: v === '1' }); });
  view.querySelectorAll('[data-cr]').forEach(b => { const [id, a] = b.dataset.cr.split(':'); b.onclick = act(async () => { await api('POST', `/membership-requests/${id}/decide`, { approve: a === '1' }); render(); }, 'toast.decided'); });
  view.querySelectorAll('[data-hist]').forEach(b => b.onclick = act(async () => {
    const h = await api('GET', `/teams/${b.dataset.hist}/history`);
    $(`#h${b.dataset.hist}`).innerHTML = `<table>${h.map(x => `<tr><td class="small mute">${x.created_at}</td><td>${esc(x.member ?? '—')}</td><td><code>${esc(x.action)}</code></td><td class="small mute">${esc(x.actor ?? '')}</td></tr>`).join('')}</table>`;
  }));
  view.querySelectorAll('[data-msg]').forEach(b => b.onclick = () => { state.thread = `t${b.dataset.msg}`; state.tab = 'messages'; render(); });
  view.querySelectorAll('[data-r]').forEach(a => a.onclick = e => { e.preventDefault(); state.tab = 'research'; state.openId = Number(a.dataset.r); render(); });
}

// ---------- Admin: registration requests and approved IDs ----------
export async function renderRegistrations(view) {
  state.regFilter ??= 'pending';
  const list = await api('GET', `/registrations?status=${state.regFilter}`);
  view.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">${t('regTitle')}</h2>
      ${['pending', 'approved', 'rejected'].map(s => `<button class="${state.regFilter === s ? '' : 'ghost'}" data-f="${s}">${t(s === 'pending' ? 'regPending' : s === 'approved' ? 'regApproved' : 'regRejected')}</button>`).join('')}</div></div>
    <div class="card wide">${list.length ? `<table><tr><th>${t('uid')}</th><th>${t('name')}</th><th>${t('requestedAt')}</th><th>${t('status')}</th><th></th></tr>${list.map(r => `<tr><td dir="ltr" style="text-align:start"><b>${esc(r.university_id)}</b></td><td>${esc(r.name)}${r.email ? `<div class="small mute" dir="ltr">${esc(r.email)}</div>` : ''}</td>
      <td class="small">${fmtDate(r.created_at)}</td><td>${r.status === 'pending' ? `<span class="badge pending">${t('regPending')}</span>` : `<span class="badge ${r.status === 'approved' ? 'approved' : 'rejected'}">${t(r.status === 'approved' ? 'regApproved' : 'regRejected')}</span>
        <div class="small mute">${t('decidedBy')}: ${esc(r.decided_by ?? '—')} · ${r.decided_at ? fmtDate(r.decided_at) : ''}${r.decision_note ? '<br>' + esc(r.decision_note) : ''}</div>`}</td>
      <td>${r.status === 'pending' ? `<div class="row"><button class="ok" data-ap="${r.id}">${t('approveBtn')}</button><input data-note="${r.id}" placeholder="${t('rejectNote')}" style="width:150px"><button class="bad" data-rj="${r.id}">${t('rejectBtn')}</button></div>` : ''}</td></tr>`).join('')}</table>` : `<p class="mute">${t('noRegs')}</p>`}</div>`;
  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.regFilter = b.dataset.f; render(); });
  view.querySelectorAll('[data-ap]').forEach(b => b.onclick = act(async () => { await api('POST', `/registrations/${b.dataset.ap}/approve`, {}); render(); }, 'toast.decided'));
  view.querySelectorAll('[data-rj]').forEach(b => b.onclick = act(async () => {
    await api('POST', `/registrations/${b.dataset.rj}/reject`, { note: view.querySelector(`[data-note="${b.dataset.rj}"]`).value }); render();
  }, 'toast.decided'));
}

export async function renderApprovedIds(view) {
  const [ids, courses] = await Promise.all([api('GET', '/approved-ids'), api('GET', '/courses')]);
  view.innerHTML = `<div class="card"><h2>${t('idsTitle')}</h2><p class="small mute">${t('idsAddHint')}</p><form id="f"><textarea id="tx" required placeholder="20240101,Name&#10;20240102"></textarea>
    <label>${t('idsCourses')}</label><div class="row">${courses.map(c => `<label class="inl"><input type="checkbox" data-c="${c.id}" checked> ${esc(c.name)}</label>`).join('')}</div><p><button>${t('idsAdd')}</button></p></form></div>
    <div class="card wide">${ids.length ? `<table><tr><th>${t('uid')}</th><th>${t('name')}</th><th>${t('enrollments')}</th><th>${t('status')}</th><th></th></tr>${ids.map(i => `<tr><td dir="ltr" style="text-align:start"><b>${esc(i.university_id)}</b></td><td>${esc(i.name ?? '')}</td>
      <td class="small">${i.courses.map(cid => esc(courses.find(c => c.id === cid)?.name ?? cid)).join('، ') || '—'}</td><td>${i.user_id ? `<span class="badge approved">${t('registered')}</span>` : i.request_status ? `<span class="badge ${i.request_status === 'pending' ? 'pending' : 'rejected'}">${t(i.request_status === 'pending' ? 'regPending' : 'regRejected')}</span>` : t('notRegistered')}</td>
      <td>${i.user_id ? '' : `<button class="bad" data-del="${i.id}">${t('del')}</button>`}</td></tr>`).join('')}</table>` : `<p class="mute">${t('noIds')}</p>`}</div>`;
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const r = await api('POST', '/approved-ids', { text: $('#tx').value, courseIds: [...view.querySelectorAll('[data-c]:checked')].map(i => Number(i.dataset.c)) });
    toast(t('idsAdded', { a: r.added, s: r.skipped.length })); render();
  });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => { await api('DELETE', `/approved-ids/${b.dataset.del}`); render(); }, 'toast.deleted'));
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
  const [users, courses] = await Promise.all([api('GET', '/users'), api('GET', '/courses')]);
  view.innerHTML = `<div class="card"><h2>${t('addUser')}</h2><form id="f" class="row">
    <input class="grow" id="n" placeholder="${t('namePh')}" required><input class="grow" id="e" type="email" dir="ltr" placeholder="${t('email')}">
    <input class="grow" id="ui" dir="ltr" placeholder="${t('uid')} ${t('optional')}"><input class="grow" id="p" type="password" dir="ltr" placeholder="${t('pwPh')}" minlength="6">
    <select id="r">${['student', 'supervisor', 'admin'].map(x => `<option value="${x}">${roleLabel(x)}</option>`).join('')}</select>
    <span class="small mute">${t('enrollments')}:</span>${courses.map(c => `<label class="inl"><input type="checkbox" data-c="${c.id}"> ${esc(c.name)}</label>`).join('')}<button>${t('add')}</button></form>
    <p class="small mute">${t('idsAddHint').split('.')[0]}.</p></div>
    <div class="card wide"><h3>${t('usersAuth')}</h3><table><tr><th>${t('name')}</th><th>${t('uid')} / ${t('email')}</th><th>${t('role')}</th><th>${t('enrollments')}</th><th></th></tr>
    ${users.map(u => `<tr><td>${esc(u.name)}${u.must_change_password ? `<div class="small mute">${t('mustChange')}</div>` : ''}${u.active ? '' : ` <span class="badge closed">${t('inactive')}</span>`}</td><td dir="ltr" style="text-align:start">${esc(u.university_id ?? u.email)}</td>
      <td><select data-role="${u.id}" ${u.id === state.user.id ? 'disabled' : ''}>${['student', 'supervisor', 'admin'].map(x => `<option value="${x}" ${x === u.role ? 'selected' : ''}>${roleLabel(x)}</option>`).join('')}</select></td>
      <td>${u.role === 'student' ? `<div class="row small">${courses.map(c => `<label class="inl"><input type="checkbox" data-en="${u.id}:${c.id}" ${u.courses.includes(c.id) ? 'checked' : ''}> ${esc(c.name)}</label>`).join('')}<button class="ghost" data-saveen="${u.id}">${t('saveCourses')}</button></div>` : ''}</td>
      <td>${u.id === state.user.id ? '' : `<button class="ghost" data-act="${u.id}:${u.active ? 0 : 1}">${u.active ? t('deactivate') : t('activate')}</button> <button class="bad" data-del="${u.id}">${t('del')}</button>`}</td></tr>`).join('')}</table></div>`;
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    await api('POST', '/users', { name: $('#n').value, email: $('#e').value || undefined, universityId: $('#ui').value || undefined, password: $('#p').value || undefined, role: $('#r').value,
      courseIds: [...view.querySelectorAll('#f [data-c]:checked')].map(i => Number(i.dataset.c)) }); render();
  }, 'toast.user');
  view.querySelectorAll('[data-role]').forEach(s => s.onchange = act(async () => {
    await api('PATCH', `/users/${s.dataset.role}/role`, { role: s.value }); render();
  }, 'toast.role'));
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => {
    if (!confirm(t('confirmDel'))) return;
    await api('DELETE', `/users/${b.dataset.del}`); render();
  }, 'toast.deleted'));
  view.querySelectorAll('[data-act]').forEach(b => { const [id, v] = b.dataset.act.split(':'); b.onclick = act(async () => { await api('PATCH', `/users/${id}`, { active: v === '1' }); render(); }, 'toast.role'); });
  view.querySelectorAll('[data-saveen]').forEach(b => b.onclick = act(async () => {
    const id = b.dataset.saveen;
    await api('PUT', `/users/${id}/enrollments`, { courseIds: [...view.querySelectorAll(`[data-en^="${id}:"]:checked`)].map(i => Number(i.dataset.en.split(':')[1])) }); render();
  }, 'toast.courses'));
}

export async function renderCourses(view) {
  const courses = await api('GET', '/courses');
  view.innerHTML = `<div class="card"><h2>${t('courses')}</h2><form id="f" class="row"><input class="grow" id="n" placeholder="${t('courseName')}" required><button>${t('addCourse')}</button></form></div>${courseRulesCard(courses)}`;
  $('#f').onsubmit = act(async e => { e.preventDefault(); await api('POST', '/courses', { name: $('#n').value }); render(); }, 'toast.course');
  bindCourseRules(view);
}
