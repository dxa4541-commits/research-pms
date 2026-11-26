// Research projects: list with search/filters, details with tabs, topic registration, "my students".
import { $, esc, t, tErr, badge, fmtDate, fmtDay, state, api, apiUpload, download, downloadPath, readFile, act, courseOpts, render, toast, notifText } from '../core.js';
import { icon, avatar, th, sortRows, bindSort, num, progress, remBadge, remaining, pageHeader, tabsHtml, empty, setCrumbs, paginate, pagerHtml, bindPager, confirmDialog, dropzoneHtml, bindDropzone, fmtBytes, go, canView, viewPath } from '../ui.js';
import { renderResearchStages, stateBadge, tlState, auditItem } from './stages.js';

const PER = 10;
const isStudent = () => state.user.role === 'student', isSup = () => state.user.role === 'supervisor';

// ---------- Research list ----------
export async function renderResearchList(view) {
  const role = state.user.role;
  const status = state.rfStatus ?? '', course = state.rfCourse ?? '', team = state.rfTeam ?? '', prog = state.rfProg ?? '', sup = state.rfSup ?? '';
  const page = state.rpage ?? 1, q = state.q ?? '';
  const arch = !!state.rfArchived;
  const all = await api('GET', '/research?limit=500' + (status ? `&status=${status}` : '') + (q ? `&q=${encodeURIComponent(q)}` : '') + (arch ? '&archived=1' : ''));
  const uniq = k => [...new Set(all.map(r => r[k]).filter(Boolean))].sort();
  const pct = r => r.stages_total ? r.stages_approved / r.stages_total * 100 : 0;
  const rows = all.filter(r => (!course || r.course === course) && (!team || r.team === team) && (!sup || r.supervisor === sup)
    && (!prog || (prog === 'none' ? !r.stages_total || pct(r) === 0 : prog === 'done' ? r.stages_total && pct(r) === 100 : r.stages_total && pct(r) > 0 && pct(r) < 100)));
  const sorted = sortRows(rows, state.rlsort, { progress: pct, deadline: r => r.deadline ?? '9999' });
  const pageRows = paginate(sorted, page, PER);
  const sel = (id, label, cur, opts) => `<div><label for="${id}" class="sr-only">${label}</label><select id="${id}" aria-label="${label}"><option value="">${label}</option>${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>`;
  view.innerHTML = `${pageHeader({ title: t(isStudent() ? 'nav.myResearch' : 'nav.research'), sub: t('rl.sub', { n: rows.length }),
      actions: isStudent() ? `<button id="newtopic">${icon('plus')} ${t('nav.topic')}</button>` : '' })}
    <div class="card"><div class="row" style="gap:10px">
      <form class="search grow" id="sf" role="search" style="min-width:220px">${icon('search')}<input id="sq" type="search" value="${esc(q)}" placeholder="${t('searchPh')}" aria-label="${t('searchPh')}"></form>
      ${sel('fs', t('status'), status, ['pending', 'approved', 'changes_requested', 'rejected'].map(s => [s, t('st.' + s)]))}
      ${sel('fc', t('course'), course, uniq('course').map(c => [c, c]))}
      ${sel('ft', t('team'), team, uniq('team').map(c => [c, c]))}
      ${isStudent() ? sel('fu', t('supervisor'), sup, uniq('supervisor').map(c => [c, c])) : ''}
      ${sel('fp', t('rl.progress'), prog, [['none', t('rl.p0')], ['going', t('rl.p1')], ['done', t('rl.p2')]])}
      <label class="inl small"><input type="checkbox" id="farch" ${arch ? 'checked' : ''}> ${t('et.showArchived')}</label>
      ${(status || course || team || prog || sup || q) ? `<button class="ghost" id="clr">${icon('x')} ${t('rl.clear')}</button>` : ''}</div></div>
    <div class="card">${rows.length ? `<div class="table-wrap"><table class="rt"><thead><tr>${th(t('title'), 'title', state.rlsort)}${th(t('team'), 'team', state.rlsort)}${th(t('course'), 'course', state.rlsort)}${th(t(isStudent() ? 'supervisor' : 'student'), isStudent() ? 'supervisor' : 'student', state.rlsort)}<th>${t('rl.stage')}</th>${th(t('rl.progress'), 'progress', state.rlsort)}${th(t('deadline'), 'deadline', state.rlsort)}${th(t('status'), 'status', state.rlsort)}<th><span class="sr-only">${t('actions')}</span></th></tr></thead>
      <tbody>${pageRows.map(r => `<tr class="click ${r.overdue ? 'late' : ''}" data-id="${r.id}"><td data-label="${t('title')}"><b>${esc(r.title)}</b></td>
        <td data-label="${t('team')}">${r.team ? esc(r.team) : `<span class="mute">${t('individual')}</span>`}</td><td data-label="${t('course')}">${esc(r.course)}</td>
        <td data-label="${t(isStudent() ? 'supervisor' : 'student')}">${esc(isStudent() ? r.supervisor : r.student)}</td><td data-label="${t('rl.stage')}" data-cs="${r.id}">${r.stages_total ? '<span class="skel" style="width:90px;display:inline-block"></span>' : '—'}</td>
        <td data-label="${t('rl.progress')}" style="min-width:130px">${r.stages_total ? `${progress(pct(r))}<span class="tiny mute">${r.stages_approved}/${r.stages_total} · ${Math.round(pct(r))}%</span>` : '<span class="mute">—</span>'}</td>
        <td data-label="${t('deadline')}" class="small">${r.deadline ? fmtDay(r.deadline) + ' ' + remBadge(r.deadline) : '—'}</td><td data-label="${t('status')}">${badge(r.status)}</td>
        <td><button class="ghost sm" data-open="${r.id}" aria-label="${t('rl.open')}: ${esc(r.title)}">${t('rl.open')} ${icon('right')}</button></td></tr>`).join('')}</tbody></table></div>${pagerHtml(rows.length, page, PER)}`
      : empty({ ic: 'book', title: t('rl.emptyT'), text: (status || course || team || prog || q) ? t('rl.emptyFilter') : t(isStudent() ? 'rl.emptyStudent' : 'noAssigned'), action: isStudent() && !q ? `<button id="newtopic2">${icon('plus')} ${t('nav.topic')}</button>` : '' })}</div>`;
  const set = (k, v) => { state[k] = v; state.rpage = 1; render(); };
  $('#sf').onsubmit = e => { e.preventDefault(); state.q = $('#sq').value.trim(); state.rpage = 1; render(); };
  [['fs', 'rfStatus'], ['fc', 'rfCourse'], ['ft', 'rfTeam'], ['fp', 'rfProg'], ['fu', 'rfSup']].forEach(([id, k]) => { const el = $('#' + id); if (el) el.onchange = () => set(k, el.value); });
  $('#farch').onchange = e => { state.rfArchived = e.target.checked; state.rpage = 1; render(); };
  $('#clr')?.addEventListener('click', () => { Object.assign(state, { rfStatus: '', rfCourse: '', rfTeam: '', rfProg: '', rfSup: '', q: '', rpage: 1 }); render(); });
  ['newtopic', 'newtopic2'].forEach(id => $('#' + id)?.addEventListener('click', () => go('topic')));
  view.querySelectorAll('tr.click').forEach(tr => tr.onclick = e => { if (!e.target.closest('button')) { state.openId = Number(tr.dataset.id); state.researchTab = null; render(); } });
  view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => { state.openId = Number(b.dataset.open); state.researchTab = null; render(); });
  bindPager(view, p => { state.rpage = p; render(); }); bindSort(view, 'rlsort', render);
  // current stage of the visible rows (one request per visible row)
  for (const r of pageRows) if (r.stages_total) api('GET', `/research/${r.id}/stages`).then(d => {
    const cur = d.stages.find(e => !['done', 'closed'].includes(tlState(e))), cell = view.querySelector(`[data-cs="${r.id}"]`);
    if (cell) cell.innerHTML = cur ? `<span class="small">${esc(cur.stage.name)}</span>` : `<span class="badge approved">${t('rl.allDone')}</span>`;
  }).catch(() => { const c = view.querySelector(`[data-cs="${r.id}"]`); if (c) c.textContent = '—'; });
}

// ---------- Research details ----------
const TABS = ['overview', 'topic', 'team', 'stages', 'submissions', 'feedback', 'grades', 'messages', 'activity'];
export async function renderDetail(view, id) {
  const role = state.user.role;
  const r = await api('GET', `/research/${id}`);
  const stagesData = await api('GET', `/research/${id}/stages`);
  const teamInfo = r.team_id ? await findTeam(r) : null;
  const tabs = TABS.filter(k => !(k === 'messages' && role === 'admin'));
  const tab = tabs.includes(state.researchTab) ? state.researchTab : 'overview';
  const back = () => { state.openId = null; state.researchTab = null; render(); };
  setCrumbs([{ label: t(isStudent() ? 'nav.myResearch' : 'nav.research'), go: back }, { label: r.title }]);
  const done = stagesData.stages.filter(e => tlState(e) === 'done').length, total = stagesData.stages.length;
  view.innerHTML = `${r.course_archived_at ? `<div class="alert" style="margin-bottom:14px">${icon('lock')}<p>${t('et.readOnly')}</p></div>` : ''}<div class="page-h"><div><div class="row" style="gap:10px"><h1 style="margin:0">${esc(r.title)}</h1>${badge(r.status)}</div>
      <p>${esc(r.course)} · ${r.team ? `${t('team')}: ${esc(r.team)}` : t('individual')} · ${t('supervisor')}: ${esc(r.supervisor)}</p></div>
      <div class="actions"><button class="ghost" id="back">${icon('left')} ${t('back')}</button></div></div>
    ${tabsHtml(tabs.map(k => ({ key: k, label: t('rd.' + k), count: k === 'stages' ? total || null : k === 'submissions' ? (stagesData.stages.reduce((a, e) => a + e.submissions.length, 0) + r.submissions.length) || null : null })), tab)}
    <div id="pane"></div>`;
  $('#back').onclick = back;
  view.querySelectorAll('[data-tabk]').forEach(b => b.onclick = () => { state.researchTab = b.dataset.tabk; render(); });
  const pane = view.querySelector('#pane');
  const ctx = { r, stagesData, teamInfo, role, id, done, total };
  await ({ overview, topic, team: teamTab, stages: stagesTab, submissions, feedback, grades, messages: messagesTab, activity })[tab](pane, ctx);
}
async function findTeam(r) {
  try {
    if (isStudent()) return (await api('GET', '/my/teams')).find(x => x.id === r.team_id) ?? null;
    return (await api('GET', '/teams')).find(x => x.id === r.team_id) ?? null;
  } catch { return null; }
}
const memberList = tm => tm ? tm.members.map(m => `<div class="member">${avatar(m.name)}<div class="t"><b>${esc(m.name)}</b><div class="tiny mute" dir="ltr">${esc(m.university_id ?? '')}</div></div>${m.leader ? `<span class="badge teal">${icon('star')}${t('leaderL')}</span>` : ''}</div>`).join('') : '';

function overview(pane, { r, stagesData, teamInfo, role, done, total }) {
  const cur = stagesData.stages.find(e => !['done', 'closed'].includes(tlState(e)));
  const pct = total ? done / total * 100 : 0;
  const dec = isSup() && r.status === 'pending' && !r.course_archived_at;
  const notStarted = isSup() && r.status === 'approved' && !r.workflow_started_at && !r.course_archived_at;
  pane.innerHTML = `${dec ? `<div class="alert warn" style="margin-bottom:16px">${icon('alert')}<p><b>${t('rd.decisionNeeded')}</b> <button class="link" data-gotab="topic">${t('rd.goTopic')}</button></p></div>` : ''}
    ${notStarted ? `<div class="alert warn" style="margin-bottom:16px">${icon('layers')}<p class="grow"><b>${t('wf.oneT')}</b><br><span class="small">${t('wf.oneD')}</span></p><button class="ok" id="wfStart">${icon('check')} ${t('wf.start')}</button></div>` : ''}
    ${r.status === 'changes_requested' && isStudent() ? `<div class="alert warn" style="margin-bottom:16px">${icon('edit')}<p><b>${t('changesBanner')}</b> <button class="link" data-gotab="topic">${t('rd.goTopic')}</button></p></div>` : ''}
    <div class="grid g-main"><div class="stack">
      <section class="card"><div class="card-h"><h3>${t('rd.progress')}</h3><span class="small mute">${done}/${total}</span></div>${progress(pct, { lg: true })}
        <p class="small mute" style="margin-top:8px">${t('rd.progressD', { p: Math.round(pct) })}</p></section>
      <section class="card"><div class="card-h"><h3>${t('rd.currentStage')}</h3>${cur ? stateBadge(cur.stage.phase) : ''}</div>
        ${cur ? `<b>${esc(cur.stage.name)}</b><div class="tl-meta"><span>${icon('flag')} ${t('deadlineShort')}: ${cur.stage.deadline ? fmtDay(cur.stage.deadline) : '—'}</span>${cur.stage.deadline ? remBadge(cur.stage.deadline) : ''}<span>${icon('award')} ${t('maxGrade')}: ${num(cur.stage.max_grade)}</span></div>
          <button data-gotab="stages">${t('rd.openStages')} ${icon('arrow')}</button>`
        : empty({ ic: 'layers', title: total ? t('rl.allDone') : t('noStages'), text: total ? '' : t('tl.noStagesD') })}</section>
      <section class="card"><h3>${t('rd.topic')}</h3>${r.description ? `<p>${esc(r.description)}</p>` : `<p class="mute">${t('rd.noDesc')}</p>`}</section>
    </div><div class="stack">
      <section class="card"><div class="card-h"><h3>${t('rd.team')}</h3></div>${teamInfo ? memberList(teamInfo) : `<div class="member">${avatar(r.student)}<div class="t"><b>${esc(r.student)}</b><div class="tiny mute">${t('individual')}</div></div></div>`}</section>
      <section class="card"><h3>${t('nav.grades')}</h3><p class="small">${t('sdAccum')}: <b>${num(stagesData.totals.earned)} / ${num(stagesData.totals.total_max)}</b></p>
        <p class="small">${t('sdFinal')}: <b>${r.grade != null ? r.grade + '/100' : '—'}</b> ${r.grade != null ? `<span class="badge ${r.grade_published ? 'published' : 'unpublished'}">${r.grade_published ? t('published') : t('unpublished')}</span>` : ''}</p></section>
      ${r.deadline ? `<section class="card"><h3>${t('deadline')}</h3><p>${fmtDay(r.deadline)} ${remBadge(r.deadline)}</p></section>` : ''}
    </div></div>`;
  pane.querySelectorAll('[data-gotab]').forEach(b => b.onclick = () => { state.researchTab = b.dataset.gotab; render(); });
  pane.querySelector('#wfStart')?.addEventListener('click', act(async () => {
    const res = await api('POST', `/research/${r.id}/workflow/start`);
    toast(res.first ? t('toast.workflowStarted', { s: res.first }) : t('toast.noStagesYet')); render();
  }));
}

function topic(pane, { r, role, id }) {
  const mayEdit = r.can_edit_topic, mayUpload = isStudent() && r.is_leader && r.status !== 'rejected';
  pane.innerHTML = `<div class="grid g-main"><div class="stack">
    <section class="card"><div class="card-h"><h3>${t('pt.title')}</h3><span class="tiny mute">${icon('refresh')} ${t('pt.live')}</span></div>${proposalTracker(r, { started: !!r.workflow_started_at })}</section>
    <section class="card"><div class="card-h"><h3>${t('rd.topic')}</h3>${badge(r.status)}</div><h4 style="margin-bottom:2px">${esc(r.title)}</h4>
      <p>${r.description ? esc(r.description) : `<span class="mute">${t('rd.noDesc')}</span>`}</p>
      ${r.problem ? `<h4>${t('problemL')}</h4><p>${esc(r.problem)}</p>` : ''}${r.objectives ? `<h4>${t('objectivesL')}</h4><p>${esc(r.objectives)}</p>` : ''}
      ${r.status === 'rejected' && r.rejection_reason ? `<div class="alert bad">${icon('x')}<p><b>${t('rejectionReason')}:</b> ${esc(r.rejection_reason)}</p></div>` : ''}
      ${isStudent() && r.status === 'approved' ? `<div class="alert">${icon('lock')}<p>${t('approvedFrozen')}</p></div>` : ''}</section>
    ${mayEdit ? `<section class="card"><h3>${t('editTopic')}</h3><form id="tf"><label for="tt">${t('title')}</label><input id="tt" required maxlength="200" value="${esc(r.title)}">
      <label for="td">${t('description')}</label><textarea id="td" maxlength="2000">${esc(r.description ?? '')}</textarea><label for="tp">${t('problemL')}</label><textarea id="tp" maxlength="2000">${esc(r.problem ?? '')}</textarea>
      <label for="to">${t('objectivesL')}</label><textarea id="to" maxlength="2000">${esc(r.objectives ?? '')}</textarea><p><button>${icon('send')} ${t('resubmitTopic')}</button></p></form></section>` : ''}
    ${isSup() && !r.course_archived_at && ['pending', 'changes_requested', 'approved'].includes(r.status) ? `<section class="card"><h3>${t('rd.decision')}</h3><label for="cm">${t('comment')}</label><textarea id="cm"></textarea>
      <div class="row" style="margin-top:10px"><button class="ok" data-d="approve">${icon('check')} ${t('approve')}</button><button class="warn" data-d="request_changes">${icon('edit')} ${t('requestChanges')}</button><button class="bad" data-d="reject">${icon('x')} ${t('reject')}</button></div><p class="hint">${t('rejectHint')}</p></section>` : ''}
    <section class="card"><div class="card-h"><h3>${t('versionsFeedback')}</h3></div>
      ${r.submissions.length ? r.submissions.map(s => `<div class="ver"><div class="row"><b class="grow">${t('version')} ${s.version_no}</b><span class="small mute">${fmtDate(s.created_at)}</span>
          ${canView(s.filename) ? `<button class="ghost sm" data-view="/api/submissions/${s.id}/file" data-name="${esc(s.filename)}">${icon('eye')} ${t('vw.view')}</button>` : ''}<button class="ghost sm" data-dl="${s.id}" data-name="${esc(s.filename)}">${icon('download')} <span dir="ltr">${esc(s.filename)}</span> · ${fmtBytes(s.size)}</button></div>
          ${s.notes.map(n => `<div class="note"><span class="small mute">${esc(n.author)} · ${fmtDate(n.created_at)}</span><p>${esc(n.text)}</p></div>`).join('')}
          ${isSup() ? `<div class="row" style="margin-top:8px"><input class="grow" placeholder="${t('addNotePh')}" data-note="${s.id}" aria-label="${t('addNotePh')}"><button class="ghost sm" data-addnote="${s.id}">${t('addNote')}</button></div>` : ''}</div>`).join('')
        : `<p class="mute">${t('rd.noVersions')}</p>`}
      ${mayUpload ? `<h4 style="margin-top:14px">${t('uploadNew')}</h4>${dropzoneHtml('v', { formats: ['pdf', 'doc', 'docx'], maxMb: 10 })}<p style="margin-top:10px"><button id="up" disabled>${icon('upload')} ${t('upload')}</button></p>` : ''}</section>
    </div><div class="stack"><section class="card"><h3>${t('rd.feedback')}</h3>${r.topic_reviews?.length ? r.topic_reviews.map(v => `<div class="note"><span class="small mute">${esc(v.reviewer)} · ${fmtDate(v.created_at)} · ${t('st.' + v.decision)}</span>${v.comment ? `<p>${esc(v.comment)}</p>` : ''}</div>`).join('') : `<p class="mute small">${t('rd.noFeedback')}</p>`}</section></div></div>`;
  pane.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => download(b.dataset.dl, b.dataset.name));
  pane.querySelectorAll('[data-view]').forEach(b => b.onclick = () => viewPath(b.dataset.view, b.dataset.name));
  pane.querySelectorAll('[data-d]').forEach(b => b.onclick = act(async () => {
    const d = b.dataset.d, comment = $('#cm').value.trim();
    if (d !== 'approve' && !comment) { $('#cm').focus(); throw new Error(t('rejectHint')); }
    if (!await confirmDialog({ title: t('cf.t.' + d), text: t('cf.t.text', { n: r.title }), confirm: t('cf.t.' + d + '.btn'), tone: d === 'approve' ? 'ok' : d === 'reject' ? 'bad' : 'warn' })) return;
    if (d === 'request_changes') { await api('POST', `/research/${id}/request-changes`, { comment }); toast(t('toast.decision')); }
    else {
      const res = await api('POST', `/research/${id}/approve`, { decision: d, comment });
      toast(res.workflow?.first ? t('toast.workflowStarted', { s: res.workflow.first }) : res.workflow?.started ? t('toast.noStagesYet') : t('toast.decision'));
    }
    render();
  }));
  pane.querySelectorAll('[data-addnote]').forEach(b => b.onclick = act(async () => {
    await api('POST', `/submissions/${b.dataset.addnote}/notes`, { text: pane.querySelector(`[data-note="${b.dataset.addnote}"]`).value }); render();
  }, 'toast.note'));
  if ($('#tf')) $('#tf').onsubmit = act(async e => {
    e.preventDefault();
    await api('PUT', `/research/${id}/topic`, { title: $('#tt').value, description: $('#td').value, problem: $('#tp').value, objectives: $('#to').value }); render();
  }, 'toast.topic');
  if ($('#up')) {
    const dz = bindDropzone(pane, 'v', { formats: ['pdf', 'doc', 'docx'], maxMb: 10, onChange: f => { $('#up').disabled = !f; } });
    $('#up').onclick = act(async () => {
      const f = dz.file(); if (!f) throw new Error(t('chooseFile'));
      $('#up').disabled = true;
      try { dz.progress(2); await apiUpload('POST', `/research/${id}/versions`, { filename: f.name, data: await readFile(f) }, dz.progress); toast(t('toast.version')); render(); }
      finally { if ($('#up')) $('#up').disabled = !dz.file(); }
    });
  }
}

function teamTab(pane, { r, teamInfo }) {
  pane.innerHTML = `<div class="grid g2"><section class="card"><div class="card-h"><h3>${t('rd.team')}</h3>${teamInfo?.locked ? `<span class="badge closed">${icon('lock')}${t('lockedL')}</span>` : ''}</div>
    ${teamInfo ? `<p class="small mute">${esc(teamInfo.name)} · ${esc(teamInfo.course)}${teamInfo.size != null ? ` · ${t('sizeL')}: ${teamInfo.size}/${teamInfo.max_size}` : ''}</p>${memberList(teamInfo)}
      ${isStudent() ? `<button class="ghost" data-go="myTeam">${icon('users')} ${t('sdGoTeam')}</button>` : isSup() ? `<button class="ghost" data-go="teams">${icon('users')} ${t('nav.teams')}</button>` : ''}`
      : `<div class="member">${avatar(r.student)}<div class="t"><b>${esc(r.student)}</b><div class="tiny mute">${t('individual')}</div></div></div><p class="small mute">${t('rd.noTeam')}</p>`}</section>
    ${teamInfo?.max_size ? `<section class="card"><h3>${t('rd.capacity')}</h3><div class="seats" aria-hidden="true">${Array.from({ length: teamInfo.max_size }, (_, i) => `<i class="${i < teamInfo.size ? 'f' : ''}"></i>`).join('')}</div>
      <p class="small">${t('sizeL')}: <b>${teamInfo.size}/${teamInfo.max_size}</b> · ${t('placesL')}: <b>${Math.max(0, teamInfo.max_size - teamInfo.size)}</b></p></section>` : ''}</div>`;
  pane.querySelectorAll('[data-go]').forEach(b => b.onclick = () => go(b.dataset.go));
}

async function stagesTab(pane, { role, id }) {
  const box = document.createElement('div'); pane.appendChild(box);
  await renderResearchStages(box, id, { role, after: render });
}

function allSubmissions(stagesData) {
  return stagesData.stages.flatMap(e => e.submissions.map(s => ({ ...s, stage: e.stage.name })));
}
function submissions(pane, { r, stagesData }) {
  const rows = allSubmissions(stagesData).sort((a, b) => b.created_at.localeCompare(a.created_at));
  pane.innerHTML = `<section class="card"><div class="card-h"><h3>${t('rd.submissions')}</h3></div>${rows.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('rl.stage')}</th><th>${t('attempt')}</th><th>${t('lastFile')}</th><th>${t('submittedAt')}</th><th>${t('status')}</th><th></th></tr></thead><tbody>
    ${rows.map(s => `<tr><td data-label="${t('rl.stage')}"><b>${esc(s.stage)}</b></td><td data-label="${t('attempt')}">#${s.attempt_no}</td><td data-label="${t('lastFile')}" dir="ltr">${esc(s.filename)} <span class="mute small">${fmtBytes(s.size)}</span></td>
      <td data-label="${t('submittedAt')}" class="small">${fmtDate(s.created_at)}${s.by ? `<div class="mute">${esc(s.by)}</div>` : ''}</td><td data-label="${t('status')}">${badge(s.status)}${s.late ? ` <span class="badge overdue">${t('late')}</span>` : ''}</td>
      <td><button class="ghost sm" data-sdl="${s.id}" data-name="${esc(s.filename)}" aria-label="${t('rd.download')}">${icon('download')}</button></td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'upload', title: t('noSubmissions'), text: t('rd.noSubD') })}
    ${r.submissions.length ? `<h4 style="margin-top:18px">${t('rd.proposalFiles')}</h4>${r.submissions.map(s => `<div class="ver row"><b class="grow">${t('version')} ${s.version_no} · <span dir="ltr">${esc(s.filename)}</span></b><span class="small mute">${fmtDate(s.created_at)}</span><button class="ghost sm" data-dl="${s.id}" data-name="${esc(s.filename)}">${icon('download')}</button></div>`).join('')}` : ''}</section>`;
  pane.querySelectorAll('[data-sdl]').forEach(b => b.onclick = () => downloadPath(`/api/stage-submissions/${b.dataset.sdl}/file`, b.dataset.name));
  pane.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => download(b.dataset.dl, b.dataset.name));
}

function feedbackItems({ r, stagesData }) {
  const items = [];
  for (const v of r.topic_reviews ?? []) items.push({ at: v.created_at, who: v.reviewer, what: `${t('rd.topic')} · ${t('st.' + v.decision)}`, text: v.comment });
  for (const s of r.submissions) for (const n of s.notes) items.push({ at: n.created_at, who: n.author, what: `${t('rd.topic')} · ${t('version')} ${s.version_no}`, text: n.text });
  for (const e of stagesData.stages) for (const s of e.submissions) for (const v of s.reviews) items.push({ at: v.created_at, who: v.reviewer, what: `${e.stage.name} · ${t('attempt')} ${s.attempt_no}${v.decision !== 'comment' ? ' · ' + t('st.' + v.decision) : ''}`, text: v.comment });
  return items.filter(i => i.text).sort((a, b) => b.at.localeCompare(a.at));
}
function feedback(pane, ctx) {
  const items = feedbackItems(ctx);
  pane.innerHTML = `<section class="card"><div class="card-h"><h3>${t('rd.feedback')}</h3></div>${items.length ? items.map(i => `<div class="todo">${avatar(i.who, 'sm')}<div class="t"><b>${esc(i.who)}</b><span class="tiny mute">${esc(i.what)} · ${fmtDate(i.at)}</span><div>${esc(i.text)}</div></div></div>`).join('')
    : empty({ ic: 'message', title: t('rd.noFeedback'), text: t('rd.noFeedbackD') })}</section>`;
}

function grades(pane, { r, stagesData, id }) {
  const tot = stagesData.totals;
  pane.innerHTML = `<div class="grid g-main"><section class="card"><div class="card-h"><h3>${t('rd.stageGrades')}</h3></div>${stagesData.stages.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('rl.stage')}</th><th>${t('maxGrade')}</th><th>${t('grade')}</th><th>${t('status')}</th></tr></thead><tbody>
    ${stagesData.stages.map(e => `<tr><td data-label="${t('rl.stage')}"><b>${esc(e.stage.name)}</b>${e.grade && e.criteria.length ? `<div style="margin-top:6px">${e.criteria.map(c => { const sc = e.grade.scores.find(s => s.criterion_id === c.id)?.score ?? 0; return `<div class="tiny mute row" style="gap:8px"><span style="min-width:120px">${esc(c.name)}</span><span class="grow" style="max-width:120px">${progress(sc / c.max_score * 100)}</span><span>${num(sc)}/${num(c.max_score)}</span></div>`; }).join('')}</div>` : ''}</td>
      <td data-label="${t('maxGrade')}">${num(e.stage.max_grade)}</td><td data-label="${t('grade')}">${e.grade ? `<b>${num(e.grade.score)}</b>` : '—'}</td>
      <td data-label="${t('status')}">${e.grade ? `<span class="badge ${e.grade.published ? 'published' : 'unpublished'}">${e.grade.published ? t('published') : t('unpublished')}</span>` : e.grade_pending ? `<span class="badge unpublished">${t('gradePending')}</span>` : `<span class="mute small">${t('notGradedYet')}</span>`}</td></tr>`).join('')}</tbody></table></div>`
      : empty({ ic: 'award', title: t('rd.noGrades'), text: t('rd.noGradesD') })}</section>
    <div class="stack"><section class="card"><h3>${t('sdAccum')}</h3><div style="font-size:1.8rem;font-weight:700;color:var(--navy)">${num(tot.earned)}<span class="mute" style="font-size:1rem"> / ${num(tot.total_max)}</span></div>${tot.percent != null ? progress(tot.percent) : ''}${tot.percent != null ? `<p class="small mute">${tot.percent}%</p>` : ''}</section>
      <section class="card"><h3>${t('sdFinal')}</h3><div style="font-size:1.8rem;font-weight:700;color:var(--navy)">${r.grade != null ? r.grade : '—'}<span class="mute" style="font-size:1rem"> / 100</span></div>
        ${r.grade != null ? `<span class="badge ${r.grade_published ? 'published' : 'unpublished'}">${r.grade_published ? t('published') : t('unpublished')}</span>` : `<p class="small mute">${isStudent() ? t('gradePending') : t('notGradedYet')}</p>`}${r.grade_comment ? `<p class="small">${esc(r.grade_comment)}</p>` : ''}</section>
      ${isSup() ? `<section class="card"><h3>${t('finalGrade')}</h3>${r.suggested_final ? `<div class="note"><span class="small"><b>${t('fg.suggested')}: ${num(r.suggested_final.score)} / 100</b></span>
          <p class="small mute" style="margin:4px 0 0">${t('fg.m.' + r.suggested_final.method)} · ${t('fg.graded', { g: r.suggested_final.graded, n: r.suggested_final.stages })}${r.suggested_final.complete ? '' : ` · <span class="overdue">${t('fg.incomplete')}</span>`}</p></div>` : ''}
        <div class="row"><input type="number" min="0" max="100" step="0.5" placeholder="${t('score')}" style="width:110px" id="fgs" value="${r.grade ?? ''}" aria-label="${t('score')}">${r.suggested_final ? `<button class="ghost" id="gcalc">${t('fg.use')}</button>` : ''}</div>
        <label for="gcm">${t('gradeComment')}</label><input id="gcm" value="${esc(r.grade_comment ?? '')}"><div class="row" style="margin-top:10px"><label class="inl small"><input type="checkbox" id="gpub" ${r.grade_published ? 'checked' : ''}> ${t('saveAndPublish')}</label><button id="gb">${t('gradeBtn')}</button>
        ${r.grade != null ? `<button class="ghost" id="gpb">${r.grade_published ? t('hideGrade') : t('publishGrade')}</button>` : ''}</div></section>` : ''}</div></div>`;
  if ($('#gb')) $('#gb').onclick = act(async () => { await api('PUT', `/research/${id}/grade`, { score: $('#fgs').value, comment: $('#gcm').value, publish: $('#gpub').checked }); render(); }, 'toast.grade');
  if ($('#gpb')) $('#gpb').onclick = act(async () => { await api('PUT', `/research/${id}/grade/publish`, { published: !r.grade_published }); render(); }, 'toast.grade');
  if ($('#gcalc')) $('#gcalc').onclick = () => { $('#fgs').value = r.suggested_final.score; };
}

async function messagesTab(pane, { r }) {
  const sup = isSup(); const q = r.team_id ? `team=${r.team_id}` : `student=${r.student_id}`;
  let list = [];
  try { list = await api('GET', `/messages?${sup ? q : `supervisor=${r.supervisor_id}&${q}`}`); } catch { /* no conversation yet */ }
  pane.innerHTML = `<section class="card"><div class="card-h"><h3>${t('rd.messages')}</h3><button class="link" id="allm">${t('viewAll')}</button></div><p class="small mute">${t('privateNote')}</p>
    <div class="msgs" id="msgs">${list.length ? list.map(m => `<div class="msg ${m.sender_id === state.user.id ? 'mine' : ''}"><div class="tiny mute">${esc(m.sender)} · ${fmtDate(m.created_at)}</div><div>${esc(m.body).replace(/\n/g, '<br>')}</div></div>`).join('') : `<span class="mute">${t('dNoMsgs')}</span>`}</div>
    <form id="mf"><label for="mb" class="sr-only">${t('typeMessage')}</label><div class="row"><input class="grow" id="mb" required maxlength="4000" placeholder="${t('typeMessage')}"><button>${icon('send')} ${t('send')}</button></div></form></section>`;
  const box = $('#msgs'); if (box) box.scrollTop = box.scrollHeight;
  $('#allm').onclick = () => go('messages');
  $('#mf').onsubmit = act(async e => {
    e.preventDefault();
    await api('POST', '/messages', { body: $('#mb').value, ...(r.team_id ? { teamId: r.team_id } : { studentId: r.student_id }), ...(sup ? {} : { supervisorId: r.supervisor_id }) }); render();
  }, 'messageSent');
}

async function activity(pane, { r, stagesData, id, role }) {
  let items;
  if (role === 'student') {
    items = [];
    for (const v of r.topic_reviews ?? []) items.push({ at: v.created_at, who: v.reviewer, text: `${t('rd.topic')}: ${t('st.' + v.decision)}`, ic: 'edit' });
    for (const e of stagesData.stages) for (const s of e.submissions) {
      items.push({ at: s.created_at, who: s.by, text: `${e.stage.name}: ${t('tl.attempts', { n: s.attempt_no })}${s.late ? ' · ' + t('late') : ''}`, ic: 'upload' });
      for (const v of s.reviews) items.push({ at: v.created_at, who: v.reviewer, text: `${e.stage.name}: ${v.decision === 'comment' ? t('commentOnly') : t('st.' + v.decision)}`, ic: 'checkc' });
    }
  } else {
    const h = await api('GET', `/research/${id}/history`);
    items = h.map(auditItem);
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  pane.innerHTML = `<section class="card"><div class="card-h"><h3>${t('rd.activity')}</h3></div>${items.length ? items.map(i => `<div class="todo"><span class="ic">${icon(i.ic)}</span><div class="t"><b>${esc(i.text)}</b>${i.sub ? `<span class="small">${esc(i.sub)}</span>` : ''}<span class="tiny mute">${esc(i.who ?? '—')} · ${fmtDate(i.at)}</span></div></div>`).join('') : empty({ ic: 'clock', title: t('noHistory') })}</section>`;
}

// ---------- Proposal status tracker (student dashboard and the topic tab) ----------
// Submitted → Instructor review → Approved / Revision requested / Rejected → Stages started
export function proposalTracker(r, { started = false } = {}) {
  const s = r.status;
  const mid = s === 'rejected' ? ['rejected', 'xc'] : s === 'changes_requested' ? ['revision', 'edit'] : ['approved', 'checkc'];
  const steps = [['submitted', 'send', 'done'], ['review', 'inbox', s === 'pending' ? 'current' : 'done'], [mid[0], mid[1], s === 'pending' ? 'upnext' : s === 'approved' ? 'done' : s === 'rejected' ? 'bad' : 'current']];
  if (s !== 'rejected') steps.push(['workflow', 'layers', started ? 'done' : 'upnext']);
  return `<div class="ptrack" role="list" aria-label="${t('pt.title')}">${steps.map(([k, ic, st]) => `<div class="ptrack-step ${st}" role="listitem" ${st === 'current' ? 'aria-current="step"' : ''}><span class="ptrack-dot">${icon(ic)}</span><span class="small">${t('pt.' + k)}</span></div>`).join('')}</div>
    <p class="small mute" style="margin:8px 0 0">${t('pt.d.' + s)}</p>`;
}

// ---------- Student: register a research topic (individual, existing team, or a new team with chosen members) ----------
export async function renderSubmit(view) {
  const [courses, sups, teams] = await Promise.all([api('GET', '/courses'), api('GET', '/supervisors'), api('GET', '/my/teams')]);
  setCrumbs([{ label: t('nav.myResearch'), go: () => go('myResearch') }, { label: t('nav.topic') }]);
  if (!courses.length) { view.innerHTML = `<div class="card">${empty({ ic: 'book', title: t('noAssigned') })}</div>`; return; }
  view.innerHTML = `${pageHeader({ title: t('submitTitle'), sub: t('topic.sub') })}<div class="grid g-main"><form class="card" id="f">
    <label for="c">${t('course')}</label><select id="c">${courseOpts(courses)}</select><div id="who" style="margin-top:8px"></div>
    <label for="t">${t('title')}</label><input id="t" required maxlength="200">
    <label for="ds">${t('description')}</label><textarea id="ds" maxlength="2000" placeholder="${t('descriptionPh')}"></textarea>
    <label for="pb">${t('problemL')}</label><textarea id="pb" maxlength="2000"></textarea>
    <label for="ob">${t('objectivesL')}</label><textarea id="ob" maxlength="2000"></textarea>
    <label for="s">${t('supervisor')}</label><select id="s">${courseOpts(sups)}</select>
    <label>${t('topicFile')}</label>${dropzoneHtml('t', { formats: ['pdf', 'doc', 'docx'], maxMb: 10 })}
    <p style="margin-top:14px"><button type="submit" id="go">${icon('send')} ${t('submit')}</button></p></form>
    <aside class="card"><h3>${t('topic.tipsT')}</h3><ul class="small mute" style="padding-inline-start:18px"><li>${t('topic.tip1')}</li><li>${t('topic.tip2')}</li><li>${t('topic.tip3')}</li><li>${t('ws.autoHint')}</li></ul></aside></div>`;
  const dz = bindDropzone(view, 't', { formats: ['pdf', 'doc', 'docx'], maxMb: 10 });
  let kind = 'individual';
  const who = async () => {
    const course = courses.find(c => c.id === Number($('#c').value));
    const team = teams.find(x => x.course_id === course.id);
    $('#go').disabled = false;
    if (team) {
      kind = 'existing';
      $('#who').innerHTML = `<div class="alert ${team.my_role === 'leader' ? '' : 'warn'}">${icon('users')}<p><b>${t('yourTeamFor', { team: esc(team.name) })}</b>${team.my_role === 'leader' ? '' : `<br>${t('onlyLeaderTopic')}`}</p></div>`;
      $('#go').disabled = team.my_role !== 'leader';
      return;
    }
    const modes = course.team_mode === 'team' ? ['team'] : course.team_mode === 'individual' ? ['individual'] : ['individual', 'team'];
    if (!modes.includes(kind)) kind = modes[0];
    const avail = modes.includes('team') ? await api('GET', `/available-students?courseId=${course.id}`).catch(() => []) : [];
    $('#who').innerHTML = `${modes.length > 1 ? `<span class="small"><b>${t('pf.kind')}</b></span><div class="chips" role="radiogroup" aria-label="${t('pf.kind')}" style="margin:6px 0 8px">${modes.map(m => `<button type="button" role="radio" aria-checked="${kind === m}" class="${kind === m ? 'on' : ''}" data-kind="${m}">${icon(m === 'team' ? 'users' : 'user')} ${t('pf.' + m)}</button>`).join('')}</div>` : ''}
      ${kind === 'team' ? `<div class="gradebox"><label for="tn">${t('pf.teamName')}</label><input id="tn" maxlength="100" required>
        <label>${t('pf.members')} <span class="mute small">— ${t('pf.maxMembers', { n: course.max_team_size })}</span></label>
        ${avail.length ? `<div class="checks" id="tm">${avail.map(u => `<label><input type="checkbox" value="${u.id}"> ${esc(u.name)}${u.university_id ? ` <span class="mute small" dir="ltr">${esc(u.university_id)}</span>` : ''}</label>`).join('')}</div>` : `<p class="small mute">${t('pf.noAvail')}</p>`}
        <p class="hint">${t('pf.membersHint')}</p></div>` : `<div class="alert">${icon('user')}<p>${t('individualFor')}</p></div>`}`;
    view.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { kind = b.dataset.kind; who(); });
    const boxes = [...view.querySelectorAll('#tm input')];
    boxes.forEach(x => x.onchange = () => { const n = boxes.filter(y => y.checked).length; boxes.forEach(y => { y.disabled = !y.checked && n + 1 >= course.max_team_size; }); });
  };
  $('#c').onchange = () => { kind = 'individual'; who(); }; await who();
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const f = dz.file();
    const body = { title: $('#t').value, description: $('#ds').value, problem: $('#pb').value, objectives: $('#ob').value, courseId: $('#c').value, supervisorId: $('#s').value };
    if (kind === 'team') {
      const memberIds = [...view.querySelectorAll('#tm input:checked')].map(i => Number(i.value));
      if (!memberIds.length) throw new Error(t('pf.pickOne'));
      body.newTeam = { name: $('#tn').value, memberIds };
    }
    if (f) Object.assign(body, { filename: f.name, data: await readFile(f) });
    $('#go').disabled = true;
    try {
      const r = await apiUpload('POST', '/research', body, dz.progress);
      toast(r.invited ? t('toast.researchTeam', { n: r.invited }) : t('toast.research'));
      state.tab = 'myResearch'; state.openId = r.id; state.researchTab = 'topic'; render();
    } finally { if ($('#go')) $('#go').disabled = false; }
  });
}

// ---------- Supervisor: my students (FR8) ----------
export async function renderStudents(view) {
  const list = await api('GET', '/research?limit=500');
  const by = new Map();
  for (const r of list) { if (!by.has(r.student)) by.set(r.student, []); by.get(r.student).push(r); }
  view.innerHTML = `${pageHeader({ title: t('nav.students'), sub: t('myStudents') })}${by.size ? `<div class="grid g2">${[...by].map(([name, rs]) => `<section class="card"><div class="member" style="padding-top:0">${avatar(name, 'lg')}<div class="t"><b style="font-size:1.05rem">${esc(name)}</b><div class="small mute">${t('projects')}: ${rs.length}</div></div></div>
    ${rs.map(r => `<div class="todo"><div class="t"><a href="#" data-open="${r.id}"><b>${esc(r.title)}</b></a><span class="tiny mute">${esc(r.course)}${r.team ? ' · ' + esc(r.team) : ''}</span>${r.stages_total ? `<div style="max-width:200px;margin-top:4px">${progress(r.stages_approved / r.stages_total * 100)}</div>` : ''}</div>${badge(r.status)}</div>`).join('')}</section>`).join('')}</div>`
    : `<div class="card">${empty({ ic: 'user', title: t('noStudentsYet') })}</div>`}`;
  view.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); state.tab = 'research'; state.openId = Number(a.dataset.open); state.researchTab = null; render(); });
}
