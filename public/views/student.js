// Student views: dashboard and the team page (create, invite, join requests, discovery, leader tools).
import { $, esc, t, badge, fmtDate, fmtDay, state, api, act, toast, render, notifText } from '../core.js';

const num = n => n == null ? '—' : Number.isInteger(+n) ? String(+n) : (+n).toFixed(1);
const bar = p => `<div class="bar" role="img" aria-label="${p ?? 0}%"><i style="width:${Math.max(0, Math.min(100, p ?? 0))}%"></i></div>`;
const ds = s => `<span class="badge ${s}">${t('ds.' + s)}</span>`;
const ist = s => `<span class="badge ${s === 'accepted' || s === 'approved' ? 'approved' : s === 'rejected' ? 'rejected' : s === 'cancelled' ? 'closed' : 'pending'}">${t('ist_' + s)}</span>`;
const go = (tab, extra = {}) => { state.tab = tab; state.openId = null; Object.assign(state, extra); render(); };

// ---------- Dashboard ----------
export async function renderStudentDashboard(view) {
  const d = await api('GET', '/student/dashboard');
  const teamBlock = d.teams.length ? d.teams.map(tm => `<div class="card"><div class="row"><h3 class="grow" style="margin:0">${t('sdTeam')}: ${esc(tm.name)}</h3>
      <span class="mute small">${esc(tm.course)}</span>${tm.locked ? `<span class="badge closed">${t('lockedL')}</span>` : ''}<button class="ghost" data-go="myTeam">${t('sdGoTeam')}</button></div>
    <p class="small">${tm.my_role === 'leader' ? t('youLeader') : t('youMember')} · ${t('sizeL')}: ${tm.size}/${tm.max_size}</p>
    <div class="row small">${tm.members.map(m => `<span class="badge ${m.leader ? 'approved' : 'pending'}">${m.leader ? '★ ' : ''}${esc(m.name)}</span>`).join('')}</div></div>`).join('')
    : `<div class="card"><h3>${t('sdTeam')}</h3><p class="mute">${t('individualInfo')}</p><button data-go="myTeam">${t('sdGoTeam')}</button></div>`;
  const researchBlock = d.research.length ? d.research.map(r => `<div class="card"><div class="row"><h3 class="grow" style="margin:0">${esc(r.title)}</h3>${badge(r.status)}<button class="ghost" data-open="${r.id}">${t('sdOpen')}</button></div>
      <p class="small mute">${esc(r.course ?? '')} · ${t('sdSup')}: ${esc(r.supervisor)}${r.team ? ' · ' + t('team') + ': ' + esc(r.team.name) : ''}</p>
      ${r.description ? `<p>${esc(r.description)}</p>` : ''}${r.status === 'rejected' && r.rejection_reason ? `<p class="small"><b class="overdue">${t('rejectionReason')}:</b> ${esc(r.rejection_reason)}</p>` : ''}
      ${r.topic_feedback.length ? `<div class="small"><b>${t('sdTopicFeedback')}:</b>${r.topic_feedback.map(f => `<div class="note"><span class="small mute">${esc(f.reviewer)} · ${fmtDate(f.created_at)}</span><br>${esc(f.comment ?? '')}</div>`).join('')}</div>` : ''}
      <div class="small mute">${t('sdProgress')}: ${r.progress.approved}/${r.progress.total}${r.progress.percent != null ? ` (${r.progress.percent}%)` : ''}</div>${bar(r.progress.percent)}
      <p class="small">${t('sdAccum')}: <b>${num(r.totals.earned)} / ${num(r.totals.total_max)}</b> · ${t('sdFinal')}: <b>${r.final_grade != null ? r.final_grade + '/100' : '—'}</b></p>
      ${r.stages.length ? `<table><tr><th>${t('sdStages')}</th><th>${t('deadline')}</th><th>${t('status')}</th><th>${t('grade')}</th></tr>${r.stages.map(s => `<tr><td><b>${esc(s.stage.name)}</b>${s.stage.instructions ? `<div class="small mute">${esc(s.stage.instructions)}</div>` : ''}</td>
        <td class="small">${s.stage.deadline ? fmtDay(s.stage.deadline) : '—'}${s.late ? ` <span class="badge overdue">${t('late')}</span>` : ''}</td><td>${ds(s.display_status)}</td>
        <td class="small">${s.grade ? `${num(s.grade.score)}/${num(s.stage.max_grade)}` : s.grade_pending ? `<span class="mute">${t('gradePending')}</span>` : '—'}</td></tr>`).join('')}</table>` : ''}</div>`).join('')
    : `<div class="card"><h3>${t('sdResearch')}</h3><p class="mute">${t('sdNoResearch')}</p><button data-go="topic">${t('sdGoTopic')}</button></div>`;
  view.innerHTML = `<h2>${esc(d.student.name)} <span class="mute small" dir="ltr">${esc(d.student.university_id ?? '')}</span></h2>
    ${d.invitations.length ? `<div class="card"><h3>${t('sdInvites')}</h3>${d.invitations.map(i => `<div class="row" style="margin:6px 0"><span class="grow"><b>${esc(i.team)}</b> <span class="mute small">${esc(i.course)} · ${t('invitedBy')} ${esc(i.invited_by)}</span></span>
      <button class="ok" data-inv="${i.id}:1">${t('accept')}</button><button class="bad" data-inv="${i.id}:0">${t('decline')}</button></div>`).join('')}</div>` : ''}
    ${d.join_requests_for_leader.length ? `<div class="card"><h3>${t('sdJoinForLeader')}</h3>${d.join_requests_for_leader.map(j => `<div class="row" style="margin:6px 0"><span class="grow"><b>${esc(j.name)}</b> <span class="mute small" dir="ltr">${esc(j.university_id ?? '')}</span> → ${esc(j.team)}${j.message ? `<div class="small mute">${esc(j.message)}</div>` : ''}</span>
      <button class="ok" data-jr="${j.id}:1">${t('accept')}</button><button class="bad" data-jr="${j.id}:0">${t('decline')}</button></div>`).join('')}</div>` : ''}
    ${d.join_requests.length ? `<div class="card"><h3>${t('sdJoinMine')}</h3>${d.join_requests.map(j => `<div class="row" style="margin:6px 0"><span class="grow">${esc(j.team)} <span class="mute small">${esc(j.course)}</span></span>${ist(j.status)}<button class="ghost" data-jc="${j.id}">${t('cancelRequest')}</button></div>`).join('')}</div>` : ''}
    ${teamBlock}${researchBlock}
    <div class="card"><h3>${t('sdDeadlines')}</h3>${d.upcoming.length ? `<table>${d.upcoming.map(u => `<tr class="click" data-open="${u.research_id}"><td><b>${esc(u.stage)}</b><div class="small mute">${esc(u.research)}</div></td><td>${fmtDay(u.deadline)}</td><td>${ds(u.display_status)}</td></tr>`).join('')}</table>` : `<p class="mute">${t('sdNoDeadlines')}</p>`}</div>
    <div class="card"><h3>${t('sdMsgs')}</h3>${d.messages.length ? d.messages.map(m => `<div class="note click" data-go="messages"><span class="small mute">${esc(m.sender)} · ${fmtDate(m.created_at)}</span><br>${esc(m.body)}</div>`).join('') : `<p class="mute">${t('dNoMsgs')}</p>`}</div>
    <div class="card"><h3>${t('sdNotifs')}</h3>${d.notifications.length ? d.notifications.map(n => `<div class="note ${n.is_read ? '' : 'unreadn'}">${esc(notifText(n.message))}<div class="small mute">${fmtDate(n.created_at)}</div></div>`).join('') : `<p class="mute">${t('noNotifs')}</p>`}</div>`;
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
  view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => go('myResearch', { openId: Number(b.dataset.open) }));
  view.querySelectorAll('[data-inv]').forEach(b => { const [id, a] = b.dataset.inv.split(':'); b.onclick = act(async () => { await api('POST', `/invitations/${id}/respond`, { accept: a === '1' }); render(); }, 'toast.answered'); });
  view.querySelectorAll('[data-jr]').forEach(b => { const [id, a] = b.dataset.jr.split(':'); b.onclick = act(async () => { await api('POST', `/join-requests/${id}/respond`, { accept: a === '1' }); render(); }, 'toast.answered'); });
  view.querySelectorAll('[data-jc]').forEach(b => b.onclick = act(async () => { await api('POST', `/join-requests/${b.dataset.jc}/cancel`); render(); }, 'toast.answered'));
}

// ---------- Team page ----------
export async function renderTeamPage(view) {
  const courses = await api('GET', '/courses');
  if (!courses.length) { view.innerHTML = `<div class="card"><p class="mute">${t('noAssigned')}</p></div>`; return; }
  const cid = courses.find(c => c.id === state.teamCourse)?.id ?? courses[0].id; state.teamCourse = cid;
  const course = courses.find(c => c.id === cid);
  const [myTeams, invitations, myReqs] = await Promise.all([api('GET', '/my/teams'), api('GET', '/invitations'), api('GET', '/join-requests/mine')]);
  const team = myTeams.find(x => x.course_id === cid);
  const picker = courses.length > 1 ? `<div class="card"><label for="cp">${t('pickCourse')}</label><select id="cp">${courses.map(c => `<option value="${c.id}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>` : '';
  const rules = `<p class="small mute">${esc(course.name)} · ${t('minSize')}: ${course.min_team_size} · ${t('maxSize')}: ${course.max_team_size} · ${t('teamMode')}: ${t(course.team_mode === 'team' ? 'modeTeam' : course.team_mode === 'individual' ? 'modeIndividual' : 'modeBoth')}${course.teams_locked ? ` · <b>${t('lockedL')}</b>` : ''}</p>`;
  const invList = invitations.filter(i => i.status === 'pending');
  const post = (path, body, ok) => act(async () => { await api('POST', path, body); render(); }, ok);
  let html = picker;

  if (team) {
    const leader = team.my_role === 'leader';
    html += `<div class="card"><div class="row"><h2 class="grow" style="margin:0">${esc(team.name)}</h2>${team.locked ? `<span class="badge closed">${t('lockedL')}</span>` : `<span class="badge open">${t('openL')}</span>`}
        ${team.accepting ? `<span class="badge approved">${t('accepting')}</span>` : `<span class="badge closed">${t('closed')}</span>`}</div>${rules}
      <p class="small"><b>${leader ? t('youLeader') : t('youMember')}</b> · ${t('sizeL')}: ${team.size}/${team.max_size} · ${t('placesL')}: ${Math.max(0, team.max_size - team.size)}</p>
      ${team.idea ? `<p><b>${esc(team.idea)}</b></p>` : ''}${team.description ? `<p>${esc(team.description)}</p>` : ''}
      ${team.research ? `<p class="small">${t('teamResearch')}: <a href="#" id="rl">${esc(team.research.title)}</a> ${badge(team.research.status)}</p>` : ''}
      <h4>${t('members')}</h4>${team.members.map(m => `<div class="row" style="margin:4px 0"><span class="grow">${m.leader ? '★ ' : ''}${esc(m.name)} <span class="mute small" dir="ltr">${esc(m.university_id ?? '')}</span> <span class="badge ${m.leader ? 'approved' : 'pending'}">${m.leader ? t('leaderL') : t('memberL')}</span></span>
        ${leader && !m.leader ? `<button class="ghost" data-lead="${m.id}">${t('makeLeader')}</button><button class="ghost" data-rm="${m.id}">${t('removeFromTeam')}</button>` : ''}</div>`).join('')}
      <div class="row" style="margin-top:10px"><button class="ghost" id="leave">${t('leaveTeam')}</button>${leader && !team.research ? `<button class="bad" id="delt">${t('deleteTeam')}</button>` : ''}<button class="ghost" id="hist">${t('teamHistory')}</button></div>
      <div id="histbox"></div>
      ${team.pending_change_requests.length ? `<p class="small"><b>${t('pendingChanges')}:</b> ${team.pending_change_requests.map(c => `${esc(c.member)} (${t('k' + (c.kind === 'leave' ? 'Remove' : c.kind[0].toUpperCase() + c.kind.slice(1))) })`).join('، ')}</p>` : ''}</div>`;
    if (team.locked) html += `<div class="card"><h3>${t('changeReqTitle')}</h3><form id="cf" class="row"><select id="ck">${leader ? `<option value="remove">${t('kRemove')}</option><option value="add">${t('kAdd')}</option><option value="leader">${t('kLeader')}</option>` : ''}</select>
        ${leader ? `<select id="cu" class="grow">${team.members.filter(m => !m.leader).map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><input id="cn" class="grow" placeholder="${t('changeNote')}"><button>${t('sendChange')}</button>` : `<span class="mute small">${t('leaveRequested')}</span>`}</form></div>`;
    if (leader) {
      const avail = team.locked ? [] : await api('GET', `/available-students?courseId=${cid}`);
      html += `<div class="card"><h3>${t('teamIs')}: ${esc(team.name)}</h3><form id="ef"><label for="en">${t('teamNameL')}</label><input id="en" value="${esc(team.name)}" maxlength="100" required>
        <label for="ei">${t('ideaL')}</label><input id="ei" value="${esc(team.idea ?? '')}" maxlength="200"><label for="ed">${t('briefL')}</label><textarea id="ed" maxlength="2000">${esc(team.description ?? '')}</textarea>
        <label class="inl"><input type="checkbox" id="ea" ${team.accepting ? 'checked' : ''}> ${t('acceptingL')}</label> &nbsp; <label class="inl"><input type="checkbox" id="em" ${team.members_can_submit ? 'checked' : ''}> ${t('membersCanSubmit')}</label>
        <p><button>${t('saveTeam')}</button></p></form></div>
        <div class="card"><h3>${t('inviteCode')}</h3><div class="row"><b dir="ltr" class="grow">${esc(team.invite_code ?? t('noCode'))}</b><button class="ghost" id="gc">${t('genCode')}</button>${team.invite_code ? `<button class="ghost" id="dc">${t('disableCode')}</button>` : ''}</div></div>
        <div class="card"><h3>${t('inviteByUid')}</h3>${team.locked ? '' : `<form id="if" class="row"><input id="iu" class="grow" dir="ltr" placeholder="${t('uid')}" required><button>${t('inviteBtn')}</button></form>`}
          ${team.invitations.length ? `<table>${team.invitations.map(i => `<tr><td>${esc(i.name)} <span class="mute small" dir="ltr">${esc(i.university_id ?? '')}</span></td><td>${ist(i.status)}</td><td>${i.status === 'pending' ? `<button class="ghost" data-ci="${i.id}">${t('cancelInv')}</button>` : ''}</td></tr>`).join('')}</table>` : ''}</div>
        <div class="card"><h3>${t('joinReqs')}</h3>${team.join_requests.length ? `<table>${team.join_requests.map(j => `<tr><td><b>${esc(j.name)}</b> <span class="mute small" dir="ltr">${esc(j.university_id ?? '')}</span>${j.message ? `<div class="small mute">${esc(j.message)}</div>` : ''}</td><td>${ist(j.status)}</td>
          <td>${j.status === 'pending' ? `<button class="ok" data-jr="${j.id}:1">${t('accept')}</button> <button class="bad" data-jr="${j.id}:0">${t('decline')}</button>` : ''}</td></tr>`).join('')}</table>` : `<p class="mute">${t('noJoinReqs')}</p>`}</div>
        ${team.locked ? '' : `<div class="card"><h3>${t('availableStudents')}</h3><p class="small mute">${t('availableHint')}</p>${avail.length ? `<table>${avail.map(s => `<tr><td><b>${esc(s.name)}</b> <span class="mute small" dir="ltr">${esc(s.university_id ?? '')}</span></td><td><span class="badge approved">${t('availableStatus')}</span></td><td><button class="ghost" data-iv="${s.id}">${t('invite')}</button></td></tr>`).join('')}</table>` : `<p class="mute">${t('noAvailable')}</p>`}</div>`}`;
    }
  } else {
    const [avail, disc] = await Promise.all([api('GET', `/available-students?courseId=${cid}`), api('GET', `/discover-teams?courseId=${cid}`)]);
    html += `<div class="card"><h2>${t('teamPageTitle')}</h2>${rules}<p class="mute">${course.team_mode === 'individual' ? t('individualOnly') : t('individualInfo')}</p></div>`;
    if (invList.length) html += `<div class="card"><h3>${t('myInvitations')}</h3>${invList.map(i => `<div class="row" style="margin:6px 0"><span class="grow"><b>${esc(i.team)}</b> <span class="mute small">${esc(i.course)} · ${t('invitedBy')} ${esc(i.invited_by)}</span>${i.idea ? `<div class="small">${esc(i.idea)}</div>` : ''}</span>
      <button class="ok" data-inv="${i.id}:1">${t('accept')}</button><button class="bad" data-inv="${i.id}:0">${t('decline')}</button></div>`).join('')}</div>`;
    if (course.team_mode !== 'individual') {
      html += `<div class="card"><h3>${t('createTeamTitle')}</h3><form id="cf2"><label for="cn2">${t('teamNameL')}</label><input id="cn2" required maxlength="100"><label for="ci2">${t('ideaL')}</label><input id="ci2" maxlength="200">
        <label for="cd2">${t('briefL')}</label><textarea id="cd2" maxlength="2000"></textarea><p><button>${t('createTeamBtn')}</button></p></form></div>
        <div class="card"><h3>${t('discover')}</h3>${disc.length ? `<table>${disc.map(x => `<tr><td><b>${esc(x.name)}</b><div class="small mute">${t('leaderL')}: ${esc(x.leader ?? '—')} · ${esc(x.members.join('، '))}</div>${x.idea ? `<div class="small">${esc(x.idea)}</div>` : ''}</td>
          <td class="small">${x.size}/${x.max_size}<div class="mute">${t('placesL')}: ${x.places}</div></td><td>${x.invited ? `<span class="badge pending">${t('invitedL')}</span>` : x.requested ? `<span class="badge pending">${t('requested')}</span>` : `<button class="ghost" data-jt="${x.id}">${t('requestJoin')}</button>`}</td></tr>`).join('')}</table>` : `<p class="mute">${t('noTeamsOpen')}</p>`}</div>
        <div class="card"><h3>${t('joinByCode')}</h3><form id="jf" class="row"><input id="jc" class="grow" dir="ltr" placeholder="${t('codePh')}" required><button>${t('joinBtn')}</button></form></div>
        <div class="card"><h3>${t('availableStudents')}</h3><p class="small mute">${t('availableHint')}</p>${avail.length ? `<table>${avail.map(s => `<tr><td><b>${esc(s.name)}</b> <span class="mute small" dir="ltr">${esc(s.university_id ?? '')}</span></td><td><span class="badge approved">${t('availableStatus')}</span></td></tr>`).join('')}</table>` : `<p class="mute">${t('noAvailable')}</p>`}</div>`;
    }
    const reqs = myReqs.filter(j => j.status === 'pending');
    if (reqs.length) html += `<div class="card"><h3>${t('myRequests')}</h3>${reqs.map(j => `<div class="row" style="margin:6px 0"><span class="grow">${esc(j.team)}</span>${ist(j.status)}<button class="ghost" data-jc="${j.id}">${t('cancelRequest')}</button></div>`).join('')}</div>`;
  }
  view.innerHTML = html;

  // ----- bindings -----
  if ($('#cp')) $('#cp').onchange = () => { state.teamCourse = Number($('#cp').value); render(); };
  view.querySelectorAll('[data-inv]').forEach(b => { const [id, a] = b.dataset.inv.split(':'); b.onclick = act(async () => { await api('POST', `/invitations/${id}/respond`, { accept: a === '1' }); render(); }, 'toast.answered'); });
  view.querySelectorAll('[data-jc]').forEach(b => b.onclick = post(`/join-requests/${b.dataset.jc}/cancel`, {}, 'toast.answered'));
  view.querySelectorAll('[data-jt]').forEach(b => b.onclick = act(async () => {
    const message = prompt(t('joinMsg')) ?? ''; await api('POST', `/teams/${b.dataset.jt}/join-requests`, { message }); render();
  }, 'toast.requestSent'));
  if ($('#cf2')) $('#cf2').onsubmit = act(async e => { e.preventDefault(); await api('POST', '/my/teams', { courseId: cid, name: $('#cn2').value, idea: $('#ci2').value, description: $('#cd2').value }); render(); }, 'toast.teamCreated');
  if ($('#jf')) $('#jf').onsubmit = act(async e => { e.preventDefault(); await api('POST', '/teams/join-by-code', { code: $('#jc').value }); render(); }, 'toast.answered');
  if (!team) return;
  const tid = team.id, leader = team.my_role === 'leader';
  if ($('#rl')) $('#rl').onclick = e => { e.preventDefault(); go('myResearch', { openId: team.research.id }); };
  $('#leave').onclick = act(async () => {
    if (!confirm(t('confirmLeave'))) return;
    const r = await api('POST', `/teams/${tid}/leave`); if (r.pending) toast(t('leaveRequested')); render();
  });
  if ($('#delt')) $('#delt').onclick = act(async () => { if (!confirm(t('confirmDeleteTeam'))) return; await api('DELETE', `/my/teams/${tid}`); render(); }, 'toast.answered');
  $('#hist').onclick = act(async () => {
    const h = await api('GET', `/my/teams/${tid}/history`);
    $('#histbox').innerHTML = `<table>${h.map(x => `<tr><td class="small mute">${fmtDate(x.created_at)}</td><td>${esc(x.member ?? '—')}</td><td><code>${esc(x.action)}</code></td><td class="small mute">${esc(x.actor ?? '')}</td></tr>`).join('')}</table>`;
  });
  if ($('#cf')) $('#cf').onsubmit = act(async e => {
    e.preventDefault(); if (!leader) return;
    await api('POST', `/teams/${tid}/change-requests`, { kind: $('#ck').value, userId: Number($('#cu').value) || undefined, note: $('#cn').value }); toast(t('toast.requestSent')); render();
  });
  if (!leader) return;
  view.querySelectorAll('[data-lead]').forEach(b => b.onclick = act(async () => { await api('PUT', `/teams/${tid}/leader`, { userId: Number(b.dataset.lead) }); render(); }, 'toast.answered'));
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = act(async () => { if (!confirm(t('confirmRemove'))) return; await api('DELETE', `/teams/${tid}/members/${b.dataset.rm}`); render(); }, 'toast.answered'));
  $('#ef').onsubmit = act(async e => {
    e.preventDefault();
    await api('PUT', `/my/teams/${tid}`, { name: $('#en').value, idea: $('#ei').value, description: $('#ed').value, accepting: $('#ea').checked, membersCanSubmit: $('#em').checked }); render();
  }, 'toast.answered');
  $('#gc').onclick = post(`/teams/${tid}/invite-code`, { action: 'generate' }, 'toast.answered');
  if ($('#dc')) $('#dc').onclick = post(`/teams/${tid}/invite-code`, { action: 'disable' }, 'toast.answered');
  if ($('#if')) $('#if').onsubmit = act(async e => { e.preventDefault(); await api('POST', `/teams/${tid}/invitations`, { universityId: $('#iu').value }); render(); }, 'toast.invited');
  view.querySelectorAll('[data-iv]').forEach(b => b.onclick = act(async () => { await api('POST', `/teams/${tid}/invitations`, { userId: Number(b.dataset.iv) }); render(); }, 'toast.invited'));
  view.querySelectorAll('[data-ci]').forEach(b => b.onclick = post(`/invitations/${b.dataset.ci}/cancel`, {}, 'toast.answered'));
  view.querySelectorAll('[data-jr]').forEach(b => { const [id, a] = b.dataset.jr.split(':'); b.onclick = act(async () => { await api('POST', `/join-requests/${id}/respond`, { accept: a === '1' }); render(); }, 'toast.answered'); });
}
