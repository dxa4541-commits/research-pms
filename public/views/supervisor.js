// Supervisor views: dashboard, stage management (list / form / detail) and progress reports.
import { $, esc, t, badge, toast, fmtDate, fmtDay, state, api, downloadPath, act, courseOpts, render } from '../core.js';
import { renderResearchStages, stateBadge } from './stages.js';

const num = n => n == null ? '—' : Number.isInteger(+n) ? String(+n) : (+n).toFixed(1);
const FORMATS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'zip', 'png', 'jpg', 'jpeg', 'txt'];
const bar = p => `<div class="bar" role="img" aria-label="${p ?? 0}%"><i style="width:${Math.max(0, Math.min(100, p ?? 0))}%"></i></div>`;
const tile = (k, v, cls = '', go = '') => `<div class="stat ${go ? 'click' : ''}" ${go ? `data-go="${go}"` : ''}><b class="${cls}">${v}</b><span class="small mute">${k}</span></div>`;
const goTab = (tab, extra = {}) => { state.tab = tab; state.openId = null; state.openStageId = null; state.stageForm = null; Object.assign(state, extra); render(); };
const openStage = id => goTab('stages', { openStageId: id });
const openResearch = id => goTab('research', { openId: id });
const label = r => esc(r.label);

// ---------- Dashboard ----------
export async function renderDashboard(view) {
  const d = await api('GET', '/supervisor/dashboard');
  const T = d.totals;
  view.innerHTML = `<div class="stats">
    ${tile(t('dTotalResearch'), T.research, '', 'research')}${tile(t('dTeams'), T.teams, '', 'teams')}${tile(t('dTopics'), T.topics_pending, T.topics_pending ? 'pending' : '', 'research')}
    ${tile(t('dAwaiting'), T.awaiting_review, T.awaiting_review ? 'pending' : '', 'stages')}${tile(t('dApproved'), T.approved, 'approved', 'stages')}
    ${tile(t('dChanges'), T.needs_changes, T.needs_changes ? 'changes_requested' : '', 'stages')}${tile(t('dLate'), T.late, T.late ? 'overdue' : '', 'reports')}${tile(t('dStages'), T.stages, '', 'stages')}</div>
    <div class="card"><h3>${t('dCompletion')}</h3>${bar(d.progress.completion_percent)}<p class="small mute">${d.progress.completion_percent ?? 0}% · ${t('dAvgGrade')}: ${d.progress.avg_stage_percent ?? '—'}%</p>
      <div class="row small">${d.progress.byStatus.map(s => `${badge(s.status)} <b>${s.n}</b>`).join(' &nbsp; ')}</div></div>
    <div class="card"><h3>${t('quick')}</h3><div class="row">${['research', 'stages', 'teams', 'messages', 'reports'].map(k => `<button class="ghost" data-go="${k}">${t('tab.' + k)}</button>`).join('')}</div></div>
    <div class="card"><h3>${t('dAwaiting')}</h3>${d.awaiting.length ? `<table>${d.awaiting.map(a => `<tr class="click" data-stage="${a.stage_id}"><td><b>${esc(a.stage)}</b></td><td>${label(a)}</td>
      <td class="small mute">${fmtDate(a.submitted_at)} ${a.late ? `<span class="badge overdue">${t('late')}</span>` : ''}</td></tr>`).join('')}</table>` : `<p class="mute">${t('dNoAwaiting')}</p>`}</div>
    <div class="card"><h3>${t('dUpcoming')}</h3>${d.upcoming.length ? `<table>${d.upcoming.map(u => `<tr class="click" data-stage="${u.id}"><td><b>${esc(u.name)}</b> ${stateBadge(u.state)}</td><td>${fmtDay(u.deadline)}</td>
      <td class="small ${u.missing ? 'overdue' : 'mute'}">${t('missingOf', { m: u.missing, a: u.assigned })}</td></tr>`).join('')}</table>` : `<p class="mute">${t('dNoUpcoming')}</p>`}</div>
    <div class="card"><h3>${t('dRecent')}</h3>${d.recent_messages.length ? d.recent_messages.map(m => `<div class="note click" data-go="messages"><span class="small mute">${esc(m.sender)} → ${esc(m.with)} · ${fmtDate(m.created_at)}</span><br>${esc(m.body)}</div>`).join('') : `<p class="mute">${t('dNoMsgs')}</p>`}</div>`;
  view.querySelectorAll('[data-go]').forEach(el => el.onclick = () => goTab(el.dataset.go));
  view.querySelectorAll('tr[data-stage]').forEach(tr => tr.onclick = () => openStage(Number(tr.dataset.stage)));
}

// ---------- Stages: list ----------
export async function renderStages(view) {
  if (state.stageForm) return renderStageForm(view);
  if (state.openStageId) return renderStageDetail(view, state.openStageId);
  const stages = await api('GET', '/stages');
  view.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">${t('stagesTitle')}</h2><button id="new">${t('newStage')}</button></div></div>
    ${stages.length ? stages.map((s, i) => `<div class="card stagecard"><div class="row"><b class="grow"><a href="#" data-open="${s.id}">${i + 1}. ${esc(s.name)}</a></b>${stateBadge(s.phase)}
        <button class="ghost" data-up="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="${t('moveUp')}">↑</button><button class="ghost" data-down="${s.id}" ${i === stages.length - 1 ? 'disabled' : ''} aria-label="${t('moveDown')}">↓</button></div>
      <p class="small mute">${esc(s.course)} · ${t('deadlineShort')}: ${s.deadline ? fmtDay(s.deadline) : '—'} · ${t('maxGrade')}: ${num(s.max_grade)}${s.criteria.length ? ` · ${t('rubric')}: ${s.criteria.length}` : ''}</p>
      <div class="row small"><span>${t('assigned2')}: <b>${s.counts.assigned}</b></span><span>${t('awaitingC')}: <b>${s.counts.pending_review}</b></span><span>${t('approvedC2')}: <b>${s.counts.approved}</b></span>
        <span>${t('changesC')}: <b>${s.counts.changes_requested}</b></span><span>${t('missingC')}: <b>${s.counts.missing}</b></span><span class="${s.counts.late ? 'overdue' : ''}">${t('lateC')}: <b>${s.counts.late}</b></span></div>
      <div class="row" style="margin-top:8px"><button class="ghost" data-open="${s.id}">${t('stageTargets')}</button>
        ${s.started ? '' : `<button class="ghost" data-edit="${s.id}">${t('edit')}</button><button class="bad" data-del="${s.id}">${t('del')}</button>`}</div></div>`).join('')
      : `<div class="card"><p class="mute">${t('noStages')}</p></div>`}`;
  $('#new').onclick = () => { state.stageForm = { id: null }; render(); };
  view.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); openStage(Number(a.dataset.open)); });
  view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { state.stageForm = { id: Number(b.dataset.edit) }; render(); });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => {
    if (!confirm(t('confirmDeleteStage'))) return;
    await api('DELETE', `/stages/${b.dataset.del}`); render();
  }, 'toast.stageDeleted'));
  const move = (id, dir) => act(async () => {
    const ids = stages.map(s => s.id), i = ids.indexOf(id); [ids[i], ids[i + dir]] = [ids[i + dir], ids[i]];
    await api('PUT', '/stages/reorder', { ids }); render();
  }, 'toast.order');
  view.querySelectorAll('[data-up]').forEach(b => b.onclick = move(Number(b.dataset.up), -1));
  view.querySelectorAll('[data-down]').forEach(b => b.onclick = move(Number(b.dataset.down), 1));
}

// ---------- Stages: create / edit form ----------
async function renderStageForm(view) {
  const [courses, research, stages] = await Promise.all([api('GET', '/courses'), api('GET', '/research?status=approved'), api('GET', '/stages')]);
  const id = state.stageForm.id, s = id ? stages.find(x => x.id === id) : null;
  const rows = s ? s.criteria.map(c => ({ name: c.name, max: c.max_score })) : [];
  view.innerHTML = `<p><button class="ghost" id="cancel">${t('back')}</button></p><div class="card"><h2>${s ? t('editStage') : t('newStage')}</h2><form id="f">
    <label for="n">${t('stageName')}</label><input id="n" required maxlength="120" value="${esc(s?.name ?? '')}">
    <label for="c">${t('course')}</label><select id="c" ${s ? 'disabled' : ''}>${courseOpts(courses)}</select>
    <label for="d">${t('description')}</label><textarea id="d" maxlength="2000">${esc(s?.description ?? '')}</textarea>
    <label for="i">${t('instructions')}</label><textarea id="i" maxlength="4000">${esc(s?.instructions ?? '')}</textarea>
    <div class="row"><div><label for="sd">${t('startDate')}</label><input type="date" id="sd" value="${s?.start_date ?? ''}"></div>
      <div><label for="dl">${t('deadline')}</label><input type="date" id="dl" value="${s?.deadline ?? ''}"></div>
      <div><label for="mg">${rows.length ? t('maxGradeFromRubric') : t('maxGrade')}</label><input type="number" id="mg" min="1" max="1000" step="0.5" style="width:120px" value="${s?.max_grade ?? 100}"></div></div>
    <label>${t('formats')}</label><div class="row">${FORMATS.map(f => `<label class="inl"><input type="checkbox" data-fmt="${f}" ${(s?.formats ?? ['pdf', 'doc', 'docx']).includes(f) ? 'checked' : ''}> .${f}</label>`).join('')}</div>
    <div class="row"><div><label for="mb">${t('maxFileMb')}</label><input type="number" id="mb" min="0.1" max="10" step="0.1" style="width:120px" value="${s?.max_file_mb ?? 10}"></div>
      <div><label for="ma">${t('maxAttempts')}</label><input type="number" id="ma" min="1" max="20" style="width:120px" value="${s?.max_attempts ?? ''}"></div>
      <label class="inl" style="margin-top:22px"><input type="checkbox" id="rs" ${s?.allow_resubmit ?? true ? 'checked' : ''}> ${t('allowResubmit')}</label></div>
    <label>${t('rubric')}</label><p class="small mute">${t('rubricHint')}</p><div id="crits"></div>
    <div class="row"><button type="button" class="ghost" id="addc">${t('addCriterion')}</button><button type="button" class="ghost" id="defc">${t('defaultRubric')}</button></div>
    <label class="inl" style="margin-top:12px"><input type="checkbox" id="aa" ${s?.assign_all ? 'checked' : ''}> ${t('assignAll')}</label>
    ${s ? '' : `<label for="st">${t('initialState')}</label><select id="st"><option value="scheduled">${t('state.scheduled')}</option><option value="open">${t('state.open')}</option></select>
      <label>${t('assignTo')}</label><div class="checks" id="rl">${research.map(r => `<label><input type="checkbox" value="${r.id}"> ${esc(r.team || r.student)} <span class="mute small">— ${esc(r.title)} (${esc(r.course)})</span></label>`).join('') || `<span class="mute">${t('noAssigned')}</span>`}</div>`}
    <p class="row"><button type="submit">${t('save')}</button><button type="button" class="ghost" id="cancel2">${t('cancel')}</button></p></form></div>`;
  const paint = () => {
    $('#crits').innerHTML = rows.map((c, i) => `<div class="row" style="margin-bottom:6px"><input class="grow" data-cn="${i}" placeholder="${t('criterionName')}" value="${esc(c.name)}" maxlength="100">
      <input type="number" data-cm="${i}" min="0.5" max="1000" step="0.5" style="width:90px" placeholder="${t('criterionMax')}" value="${c.max}"><button type="button" class="ghost" data-cx="${i}">✕</button></div>`).join('');
    const sum = rows.reduce((a, c) => a + (Number(c.max) || 0), 0);
    $('#mg').disabled = rows.length > 0; if (rows.length) $('#mg').value = sum;
    document.querySelector('label[for=mg]').textContent = rows.length ? t('maxGradeFromRubric') : t('maxGrade');
    view.querySelectorAll('[data-cn]').forEach(i => i.oninput = () => rows[i.dataset.cn].name = i.value);
    view.querySelectorAll('[data-cm]').forEach(i => i.oninput = () => { rows[i.dataset.cm].max = i.value; $('#mg').value = rows.reduce((a, c) => a + (Number(c.max) || 0), 0); });
    view.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => { rows.splice(Number(b.dataset.cx), 1); paint(); });
  };
  paint();
  $('#addc').onclick = () => { rows.push({ name: '', max: 10 }); paint(); };
  $('#defc').onclick = () => { rows.length = 0; [40, 20, 20, 10, 10].forEach((m, i) => rows.push({ name: t('crit' + i), max: m })); paint(); };
  const back = () => { state.stageForm = null; render(); };
  $('#cancel').onclick = back; $('#cancel2').onclick = back;
  if (!s) {
    // the research list carries the course name, so filter the checklist by it
    const byName = () => { const cn = $('#c').selectedOptions[0].textContent; view.querySelectorAll('#rl label').forEach(l => l.style.display = l.textContent.includes(`(${cn})`) ? '' : 'none'); };
    $('#c').onchange = byName; byName();
  }
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const body = {
      name: $('#n').value, description: $('#d').value, instructions: $('#i').value, startDate: $('#sd').value || null, deadline: $('#dl').value || null,
      maxGrade: $('#mg').value, formats: [...view.querySelectorAll('[data-fmt]:checked')].map(i => i.dataset.fmt), maxFileMb: $('#mb').value,
      maxAttempts: $('#ma').value || null, allowResubmit: $('#rs').checked, assignAll: $('#aa').checked,
      criteria: rows.filter(r => r.name.trim()).map(r => ({ name: r.name, max: r.max })),
    };
    if (s) await api('PUT', `/stages/${s.id}`, body);
    else await api('POST', '/stages', { ...body, courseId: $('#c').value, state: $('#st').value, researchIds: [...view.querySelectorAll('#rl input:checked')].map(i => Number(i.value)) });
    back();
  }, 'toast.stage');
}

// ---------- Stage detail: everyone assigned, their status, review and grading ----------
async function renderStageDetail(view, id) {
  const d = await api('GET', `/stages/${id}`);
  const s = d.stage, C = d.counts;
  state.expanded ??= new Set();
  const row = r => `<tr class="${r.late ? 'late' : ''}"><td><b>${esc(r.label)}</b><div class="small mute">${esc(r.title)}${r.team ? ' · ' + esc(r.student) : ''}</div></td>
    <td>${badge(r.status)}${r.late ? ` <span class="badge overdue">${t('late')}</span>` : ''}</td><td>${r.attempts}${r.attempts_left == null ? '' : ` <span class="mute small">(+${r.attempts_left})</span>`}</td>
    <td class="small">${r.submitted_at ? fmtDate(r.submitted_at) : '—'}</td><td>${r.score != null ? `${num(r.score)}/${num(s.max_grade)}` : '—'}</td>
    <td><div class="row"><button class="ghost" data-exp="${r.research_id}">${state.expanded.has(r.research_id) ? t('hide') : t('review')}</button>
      <button class="ghost" data-more="${r.research_id}" title="${t('allowAnother')}">＋1</button>
      ${r.attempts || r.score != null ? '' : `<button class="ghost" data-un="${r.research_id}">${t('unassign')}</button>`}</div></td></tr>
    <tr class="exprow" ${state.expanded.has(r.research_id) ? '' : 'hidden'}><td colspan="6"><div data-box="${r.research_id}"></div></td></tr>`;
  view.innerHTML = `<p><button class="ghost" id="back">${t('back')}</button></p>
    <div class="card"><div class="row"><h2 class="grow" style="margin:0">${esc(s.name)}</h2>${stateBadge(s.phase)}${s.grades_locked ? `<span class="badge closed">${t('locked')}</span>` : ''}</div>
      <p class="small mute">${esc(s.course)} · ${t('startDate')}: ${s.start_date ? fmtDay(s.start_date) : '—'} · ${t('deadline')}: ${s.deadline ? fmtDay(s.deadline) : '—'} · ${t('maxGrade')}: ${num(s.max_grade)} · ${t('limits', { f: s.formats.join(', '), mb: num(s.max_file_mb) })}</p>
      ${s.description ? `<p>${esc(s.description)}</p>` : ''}${s.instructions ? `<p class="small"><b>${t('requirements')}:</b> ${esc(s.instructions)}</p>` : ''}
      ${d.criteria.length ? `<p class="small mute">${t('rubric')}: ${d.criteria.map(c => `${esc(c.name)} (${num(c.max_score)})`).join(' · ')}</p>` : ''}
      ${s.started ? `<p class="small mute">${t('editLocked')}</p>` : ''}
      <div class="row">${s.state !== 'open' ? `<button class="ok" data-st="open">${s.state === 'closed' ? t('reopen') : t('open')}</button>` : ''}${s.state !== 'closed' ? `<button class="ghost" data-st="closed">${t('close')}</button>` : ''}
        <button class="ghost" id="pp">${t('postpone')}</button><button class="ghost" id="lk">${s.grades_locked ? t('unlockGrades') : t('lockGrades')}</button>
        ${s.started ? '' : `<button class="ghost" id="ed">${t('edit')}</button>`}<button class="ghost" id="hs">${t('showHistory')}</button></div>
      <div class="row" id="ppbox" hidden style="margin-top:8px"><label class="inl">${t('startDate')} <input type="date" id="pps" value="${s.start_date ?? ''}"></label>
        <label class="inl">${t('newDeadline')} <input type="date" id="ppd" value="${s.deadline ?? ''}"></label><button id="ppgo">${t('postpone')}</button></div></div>
    <div class="stats">${[[t('assigned2'), C.assigned], [t('submittedC'), C.submitted], [t('awaitingC'), C.pending_review], [t('approvedC2'), C.approved], [t('changesC'), C.changes_requested],
      [t('rejectedC'), C.rejected], [t('missingC'), C.missing], [t('lateC'), C.late, C.late ? 'overdue' : ''], [t('gradedC'), C.graded]].map(([k, v, c]) => tile(k, v, c)).join('')}</div>
    <div class="card wide"><h3>${t('stageTargets')}</h3>${d.targets.length ? `<table><tr><th>${t('target')}</th><th>${t('status')}</th><th>${t('attempts')}</th><th>${t('submittedAt')}</th><th>${t('grade')}</th><th>${t('actions')}</th></tr>${d.targets.map(row).join('')}</table>
      <div class="row" style="margin-top:10px"><input class="grow" id="rm" placeholder="${t('remindPh')}" maxlength="1000"><button class="ghost" id="rmb">${t('remind')}</button></div>` : `<p class="mute">${t('noStages')}</p>`}</div>
    <div class="card"><h3>${t('assignMore')}</h3>${d.unassigned.length ? `<div class="checks" id="ul">${d.unassigned.map(r => `<label><input type="checkbox" value="${r.id}"> ${esc(r.team || r.student)} <span class="mute small">— ${esc(r.title)}</span></label>`).join('')}</div>
      <p><button id="asg">${t('assign')}</button></p>` : `<p class="mute">${t('noUnassigned')}</p>`}</div>
    <div class="card" id="histbox" hidden><h3>${t('history')}</h3><div id="hist"></div></div>`;
  $('#back').onclick = () => { state.openStageId = null; render(); };
  const setState = (st, withDates = false) => act(async () => {
    const dates = withDates ? { startDate: $('#pps').value || null, deadline: $('#ppd').value || null } : {};
    await api('PUT', `/stages/${id}/state`, { state: st, ...dates }); render();
  }, 'toast.stageState');
  view.querySelectorAll('[data-st]').forEach(b => b.onclick = setState(b.dataset.st));
  $('#pp').onclick = () => { $('#ppbox').hidden = !$('#ppbox').hidden; };
  $('#ppgo').onclick = setState('postponed', true);

  $('#lk').onclick = act(async () => { await api('PUT', `/stages/${id}/grades-lock`, { locked: !s.grades_locked }); render(); }, 'toast.lock');
  if ($('#ed')) $('#ed').onclick = () => { state.openStageId = null; state.stageForm = { id }; render(); };
  $('#hs').onclick = act(async () => {
    const h = await api('GET', `/stages/${id}/history`); $('#histbox').hidden = false;
    $('#hist').innerHTML = h.length ? `<table>${h.map(x => `<tr><td class="small mute">${fmtDate(x.created_at)}</td><td>${esc(x.actor ?? '—')}</td><td><code>${esc(x.action)}</code></td><td class="small mute">${esc(x.detail ? JSON.stringify(x.detail) : '')}</td></tr>`).join('')}</table>` : `<span class="mute">${t('noHistory')}</span>`;
  });
  view.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => {
    const rid = Number(b.dataset.exp); state.expanded.has(rid) ? state.expanded.delete(rid) : state.expanded.add(rid); render();
  });
  for (const rid of state.expanded) {
    const box = view.querySelector(`[data-box="${rid}"]`);
    if (box) renderResearchStages(box, rid, { role: 'supervisor', onlyStageId: id, after: render });
  }
  view.querySelectorAll('[data-more]').forEach(b => b.onclick = act(async () => { await api('POST', `/stages/${id}/targets/${b.dataset.more}/allow-resubmit`); render(); }, 'toast.resubmit'));
  view.querySelectorAll('[data-un]').forEach(b => b.onclick = act(async () => { await api('DELETE', `/stages/${id}/targets/${b.dataset.un}`); render(); }, 'toast.stageState'));
  if ($('#rmb')) $('#rmb').onclick = act(async () => {
    const r = await api('POST', `/stages/${id}/remind`, { message: $('#rm').value });
    toast(t('reminderSent', { n: r.sent }));
  });
  if ($('#asg')) $('#asg').onclick = act(async () => {
    await api('POST', `/stages/${id}/targets`, { researchIds: [...view.querySelectorAll('#ul input:checked')].map(i => Number(i.value)) }); render();
  }, 'toast.assigned');
}

// ---------- Reports ----------
export async function renderSupervisorReports(view) {
  const r = await api('GET', '/supervisor/reports');
  view.innerHTML = `<div class="card"><div class="row"><h2 class="grow" style="margin:0">${t('reportsTitle')}</h2><button class="ghost" id="csv">⬇ ${t('exportCsv')}</button></div></div>
    <div class="card wide"><h3>${t('researchProgress')}</h3>${r.research.length ? `<table><tr><th>${t('title')}</th><th>${t('status')}</th><th>${t('stagesProgress')}</th><th>${t('missingC')}</th><th>${t('lateC')}</th><th>${t('earned')}</th><th>${t('finalGrade').split(' (')[0]}</th></tr>
      ${r.research.map(x => `<tr class="click ${x.late ? 'late' : ''}" data-r="${x.id}"><td><b>${esc(x.title)}</b><div class="small mute">${esc(x.label)}</div></td><td>${badge(x.status)}</td>
        <td>${x.approved}/${x.stages}${bar(x.progress_percent)}</td><td>${x.missing}</td><td class="${x.late ? 'overdue' : ''}">${x.late}</td><td>${x.stages ? `${num(x.earned)}/${num(x.total_max)}${x.percent != null ? ` (${x.percent}%)` : ''}` : '—'}</td><td>${x.final_grade ?? '—'}</td></tr>`).join('')}</table>` : `<span class="mute">${t('noAssigned')}</span>`}</div>
    <div class="card wide"><h3>${t('stageStats')}</h3>${r.stages.length ? `<table><tr><th>${t('stageName')}</th><th>${t('deadline')}</th><th>${t('assigned2')}</th><th>${t('submittedC')}</th><th>${t('approvedC2')}</th><th>${t('changesC')}</th><th>${t('missingC')}</th><th>${t('lateC')}</th><th>${t('rAvg')}</th></tr>
      ${r.stages.map(s => `<tr class="click" data-s="${s.id}"><td><b>${esc(s.name)}</b> ${stateBadge(s.state)}</td><td>${s.deadline ? fmtDay(s.deadline) : '—'}</td><td>${s.assigned}</td><td>${s.submitted}</td><td>${s.approved}</td><td>${s.changes_requested}</td>
        <td>${s.missing}</td><td class="${s.late ? 'overdue' : ''}">${s.late}</td><td>${s.avg_score != null ? `${num(s.avg_score)}/${num(s.max_grade)}` : '—'}</td></tr>`).join('')}</table>` : `<span class="mute">${t('noStages')}</span>`}</div>
    <div class="card wide"><h3>${t('notSubmittedList')}</h3>${r.missing.length ? `<table>${r.missing.map(m => `<tr class="click ${m.late ? 'late' : ''}" data-s="${m.stage_id}"><td><b>${esc(m.stage)}</b></td><td>${esc(m.label)}</td><td class="small mute">${esc(m.title)}</td>
        <td>${m.deadline ? fmtDay(m.deadline) : '—'} ${m.late ? `<span class="badge overdue">${t('late')}</span>` : ''}</td></tr>`).join('')}</table>
      ${r.late_teams.length ? `<p class="small"><b>${t('lateTeams')}:</b> ${r.late_teams.map(esc).join('، ')}</p>` : ''}` : `<span class="mute">${t('nothingMissing')}</span>`}</div>`;
  $('#csv').onclick = () => downloadPath('/api/supervisor/reports/export', 'supervisor-report.csv');
  view.querySelectorAll('tr[data-s]').forEach(tr => tr.onclick = () => openStage(Number(tr.dataset.s)));
  view.querySelectorAll('tr[data-r]').forEach(tr => tr.onclick = () => openResearch(Number(tr.dataset.r)));
}
