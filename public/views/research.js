// Student / supervisor views: research list, research detail, register topic, my students.
import { $, esc, t, tErr, badge, fmtSize, fmtDate, fmtDay, dueBadge, dueText, state, api, download, readFile, act, courseOpts, render } from '../core.js';

// ---------- Research list (student / supervisor) ----------
export async function renderResearchList(view) {
  const list = await api('GET', '/research');
  const sup = state.user.role === 'supervisor';
  view.innerHTML = `<div class="card"><h2>${sup ? t('assigned') : t('mine')}</h2>
    ${list.length ? `<table><tr><th>${t('title')}</th><th>${t('status')}</th><th>${sup ? t('student') : t('supervisor')}</th><th>${t('deadline')}</th><th>${t('versions')}</th><th>${t('grade')}</th></tr>
    ${list.map(r => `<tr class="click ${r.overdue ? 'late' : ''}" data-id="${r.id}"><td><b>${esc(r.title)}</b><div class="small mute">${esc(r.course)}${r.team ? ' · ' + t('team') + ': ' + esc(r.team) : ''}</div></td>
      <td>${badge(r.status)}</td><td>${esc(sup ? r.student : r.supervisor)}</td><td>${dueText(r)}</td><td>${r.versions}</td>
      <td>${r.grade ?? '—'}</td></tr>`).join('')}</table>`
      : `<p class="mute">${sup ? t('noAssigned') : t('noneSubmitted')}</p>`}</div>`;
  view.querySelectorAll('tr.click').forEach(tr => tr.onclick = () => { state.openId = Number(tr.dataset.id); render(); });
}

// ---------- Research detail ----------
export async function renderDetail(view, id) {
  const r = await api('GET', `/research/${id}`);
  const role = state.user.role;
  const canEdit = role === 'student' && r.status !== 'rejected';
  const overdue = r.deadline && r.deadline < new Date().toISOString().slice(0, 10) && ['pending', 'changes_requested'].includes(r.status);
  view.innerHTML = `<p><button class="ghost" id="back">${t('back')}</button></p>
    <div class="card"><div class="row"><h2 class="grow" style="margin:0">${esc(r.title)}</h2>${badge(r.status)}
        <span class="badge ${r.grade != null ? 'approved' : 'pending'}">${t('grade')}: ${r.grade != null ? r.grade + '/100' : t('notGraded')}</span></div>
      <p class="small mute">${t('student')}: ${esc(r.student)} · ${t('supervisor')}: ${esc(r.supervisor)} · ${t('course')}: ${esc(r.course)}${r.team ? ' · ' + t('team') + ': ' + esc(r.team) : ''}
      ${r.deadline ? ` · ${t('deadline')}: ${fmtDay(r.deadline)}${dueBadge({ overdue })}` : ''}</p>
      ${role === 'supervisor' ? `<label for="cm">${t('comment')}</label><textarea id="cm"></textarea>
        <div class="row"><button class="ok" data-d="approve">${t('approve')}</button><button class="warn" data-d="request_changes">${t('requestChanges')}</button>
        <button class="bad" data-d="reject">${t('reject')}</button></div>
        <div class="row" style="margin-top:12px"><input type="number" min="0" max="100" step="0.5" placeholder="${t('score')}" style="width:110px" id="gs" value="${r.grade ?? ''}">
          <button class="ghost" id="gb">${t('gradeBtn')}</button></div>` : ''}
      ${r.status === 'changes_requested' && role === 'student' ? `<p class="small"><b>${t('changesBanner')}</b></p>` : ''}
    </div>
    ${canEdit ? `<div class="card"><h3>${t('uploadNew')}</h3><div class="row"><input class="grow" type="file" id="nv" accept=".pdf,.doc,.docx">
      <button id="up">${t('upload')}</button></div><p class="small mute">${t('fileHint')}</p></div>` : ''}
    <div class="card"><h3>${t('versionsFeedback')}</h3>${r.submissions.map(s => `
      <div class="ver"><div class="row"><b class="grow">${t('version')} ${s.version_no}</b><span class="small mute">${fmtDate(s.created_at)}</span>
        <button class="ghost" data-dl="${s.id}" data-name="${esc(s.filename)}">⬇ <span dir="ltr">${esc(s.filename)}</span> (${fmtSize(s.size)})</button></div>
        ${s.notes.map(n => `<div class="note"><span class="small mute">${esc(n.author)} · ${fmtDate(n.created_at)}</span><br>${esc(n.text)}</div>`).join('')}
        ${role === 'supervisor' ? `<div class="row" style="margin-top:8px"><input class="grow" placeholder="${t('addNotePh')}" data-note="${s.id}">
          <button data-addnote="${s.id}">${t('addNote')}</button></div>` : ''}
      </div>`).join('')}</div>`;
  $('#back').onclick = () => { state.openId = null; render(); };
  view.querySelectorAll('[data-dl]').forEach(b => b.onclick = () => download(b.dataset.dl, b.dataset.name));
  view.querySelectorAll('[data-d]').forEach(b => b.onclick = act(async () => {
    const comment = $('#cm').value;
    if (b.dataset.d === 'request_changes') await api('POST', `/research/${id}/request-changes`, { comment });
    else await api('POST', `/research/${id}/approve`, { decision: b.dataset.d, comment });
    render();
  }, 'toast.decision'));
  view.querySelectorAll('[data-addnote]').forEach(b => b.onclick = act(async () => {
    await api('POST', `/submissions/${b.dataset.addnote}/notes`, { text: view.querySelector(`[data-note="${b.dataset.addnote}"]`).value }); render();
  }, 'toast.note'));
  if ($('#gb')) $('#gb').onclick = act(async () => {
    await api('PUT', `/research/${id}/grade`, { score: $('#gs').value }); render();
  }, 'toast.grade');
  if ($('#up')) $('#up').onclick = act(async () => {
    const f = $('#nv').files[0]; if (!f) throw new Error(t('chooseFile'));
    if (f.size > 10 * 1048576) throw new Error(tErr('File exceeds the 10 MB limit'));
    $('#up').disabled = true;
    try { await api('POST', `/research/${id}/versions`, { filename: f.name, data: await readFile(f) }); render(); }
    finally { if ($('#up')) $('#up').disabled = false; }
  }, 'toast.version');
}

// ---------- Student: submit research ----------
export async function renderSubmit(view) {
  const [courses, sups] = await Promise.all([api('GET', '/courses'), api('GET', '/supervisors')]);
  view.innerHTML = `<div class="card"><h2>${t('submitTitle')}</h2><form id="f">
    <label for="t">${t('title')}</label><input id="t" required maxlength="200">
    <label for="c">${t('course')}</label><select id="c">${courseOpts(courses)}</select>
    <label for="s">${t('supervisor')}</label><select id="s">${courseOpts(sups)}</select>
    <label for="fl">${t('proposalFile')}</label>
    <input id="fl" type="file" required accept=".pdf,.doc,.docx">
    <p><button type="submit">${t('submit')}</button></p></form></div>`;
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const f = $('#fl').files[0];
    if (f.size > 10 * 1048576) throw new Error(tErr('File exceeds the 10 MB limit'));
    const r = await api('POST', '/research', { title: $('#t').value, courseId: $('#c').value, supervisorId: $('#s').value, filename: f.name, data: await readFile(f) });
    state.tab = 'myResearch'; state.openId = r.id; render();
  }, 'toast.research');
}

// ---------- Supervisor: my students (FR8) ----------
export async function renderStudents(view) {
  const list = await api('GET', '/research');
  const by = new Map();
  for (const r of list) { if (!by.has(r.student)) by.set(r.student, []); by.get(r.student).push(r); }
  view.innerHTML = `<div class="card"><h2>${t('myStudents')}</h2>${by.size ? `<table><tr><th>${t('student')}</th><th>${t('projects')}</th></tr>
    ${[...by].map(([name, rs]) => `<tr><td><b>${esc(name)}</b></td><td>${rs.map(r => `<div><a href="#" data-open="${r.id}">${esc(r.title)}</a> ${badge(r.status)}${dueBadge(r)}</div>`).join('')}</td></tr>`).join('')}</table>`
    : `<p class="mute">${t('noStudentsYet')}</p>`}</div>`;
  view.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); state.tab = 'research'; state.openId = Number(a.dataset.open); render(); });
}
