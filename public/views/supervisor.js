// Supervisor views: dashboard, submissions & reviews queue, stage management, grades overview and reports.
import { $, esc, t, badge, toast, fmtDate, fmtDay, state, api, downloadPath, act, courseOpts, render, notifText } from '../core.js';
import { icon, avatar, statCard, th, sortRows, bindSort, dateField, bindDateFields, num, progress, remBadge, pageHeader, empty, setCrumbs, confirmDialog, tabsHtml, paginate, pagerHtml, bindPager, go, modal } from '../ui.js';
import { renderResearchStages, stateBadge } from './stages.js';
import { notifMeta } from './notifications.js';

const FORMATS = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'zip', 'png', 'jpg', 'jpeg', 'txt'];
const openStage = (id, rid = null) => { state.tab = 'stages'; state.openId = null; state.stageForm = null; state.openStageId = id; if (rid) { state.expanded ??= new Set(); state.expanded.add(rid); } render(); };
const openResearch = (id, tab = null) => { state.tab = 'research'; state.openId = id; state.researchTab = tab; render(); };
const lbl = r => esc(r.label ?? r.team ?? r.student);
const tile = (ic, tone, label, v, to = '') => `<${to ? 'button' : 'div'} class="stat ${to ? 'click' : ''}" ${to ? `data-go="${to}"` : ''}><span class="ic ${tone}">${icon(ic)}</span><div><b>${v}</b><span class="l">${label}</span></div></${to ? 'button' : 'div'}>`;

// ---------- Dashboard ----------
export async function renderDashboard(view) {
  const [d, rep] = await Promise.all([api('GET', '/supervisor/dashboard'), api('GET', '/supervisor/reports')]);
  const T = d.totals, activity = state.notifs.filter(n => ['submission', 'message'].includes(notifMeta(n).cat)).slice(0, 6);
  view.innerHTML = `${pageHeader({ title: t('nav.dashboard'), sub: t('sup.sub', { n: state.user.name }), actions: `<button class="ghost" data-go="review">${icon('inbox')} ${t('nav.review')}</button><button data-go="newstage">${icon('plus')} ${t('newStage')}</button>` })}
    ${T.topics_pending ? `<div class="alert warn" style="margin-bottom:16px">${icon('alert')}<p><b>${t('sup.topicsPending', { n: T.topics_pending })}</b> <button class="link" data-go="research">${t('sup.goResearch')}</button></p></div>` : ''}
    <div class="stats four">${statCard({ ic: 'inbox', label: t('sup.pending'), value: T.awaiting_review, desc: t('sup.d.pending'), accent: 'var(--amber)', to: 'review', feature: true })}
      ${statCard({ ic: 'book', label: t('dTotalResearch'), value: T.research, desc: t('sup.d.topics', { n: T.topics_pending }), accent: 'var(--primary)', to: 'research' })}${statCard({ ic: 'users', label: t('dTeams'), value: T.teams, desc: t('sup.d.teams'), accent: 'rgb(var(--t))', to: 'teams' })}
      ${statCard({ ic: 'calendar', label: t('sup.upcoming'), value: d.upcoming.length, desc: t('sup.d.upcoming'), accent: 'var(--primary)', to: 'stages' })}${statCard({ ic: 'checkc', label: t('dApproved'), value: T.approved, desc: t('sup.d.approved'), accent: 'var(--ok)', to: 'review' })}
      ${statCard({ ic: 'edit', label: t('dChanges'), value: T.needs_changes, desc: t('sup.d.changes'), accent: 'var(--orange)', to: 'review' })}${statCard({ ic: 'alert', label: t('dLate'), value: T.late, desc: t('sup.d.late'), accent: T.late ? 'var(--bad)' : 'var(--gray)', to: 'reports' })}
      ${statCard({ ic: 'layers', label: t('dStages'), value: T.stages, desc: t('sup.d.stages', { p: d.progress.completion_percent ?? 0 }), accent: 'rgb(var(--t))', to: 'stages' })}</div>
    <div class="grid g-main"><div class="stack">
      <section class="card"><div class="card-h"><h3>${icon('inbox')} ${t('sup.needReview')}</h3><button class="link" data-go="review">${t('viewAll')}</button></div>
        ${d.awaiting.length ? d.awaiting.map(a => `<div class="todo"><span class="ic warn">${icon('upload')}</span><div class="t"><b>${esc(a.label)}</b><span class="small mute">${esc(a.stage)} · ${fmtDate(a.submitted_at)} ${a.late ? `<span class="badge overdue">${t('late')}</span>` : ''}</span></div>
          <button class="sm" data-rev="${a.stage_id}:${a.research_id}">${t('review')} ${icon('arrow')}</button></div>`).join('') : empty({ ic: 'checkc', title: t('dNoAwaiting'), text: t('sup.allCaught') })}</section>
      <section class="card"><div class="card-h"><h3>${icon('chart')} ${t('sup.progress')}</h3><button class="link" data-go="reports">${t('nav.reports')}</button></div>
        ${rep.research.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('title')}</th><th>${t('status')}</th><th>${t('rl.progress')}</th><th>${t('lateC')}</th></tr></thead><tbody>${rep.research.slice(0, 8).map(r => `<tr class="click" data-r="${r.id}"><td data-label="${t('title')}"><b>${esc(r.title)}</b><div class="tiny mute">${esc(r.label)}</div></td><td data-label="${t('status')}">${badge(r.status)}</td>
          <td data-label="${t('rl.progress')}" style="min-width:130px">${progress(r.progress_percent ?? 0)}<span class="tiny mute">${r.approved}/${r.stages}</span></td><td data-label="${t('lateC')}" class="${r.late ? 'overdue' : ''}">${r.late || '—'}</td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'book', title: t('noAssigned') })}</section>
      <section class="card"><div class="card-h"><h3>${icon('calendar')} ${t('dUpcoming')}</h3></div>${d.upcoming.length ? d.upcoming.map(u => `<div class="todo" style="cursor:pointer" data-stage="${u.id}"><span class="ic warn">${icon('flag')}</span><div class="t"><b>${esc(u.name)}</b><span class="small ${u.missing ? 'overdue' : 'mute'}">${t('missingOf', { m: u.missing, a: u.assigned })}</span></div><span class="small">${fmtDay(u.deadline)}</span>${remBadge(u.deadline)}</div>`).join('') : `<p class="mute small">${t('dNoUpcoming')}</p>`}</section>
    </div><div class="stack">
      <section class="card"><h3>${t('sd.quick')}</h3><div class="stack" style="gap:8px"><button data-go="newstage">${icon('plus')} ${t('newStage')}</button><button class="ghost" data-go="review">${icon('inbox')} ${t('nav.review')}</button><button class="ghost" data-go="teams">${icon('users')} ${t('nav.teams')}</button><button class="ghost" data-go="messages">${icon('message')} ${t('nav.messages')}</button><button class="ghost" data-go="reports">${icon('chart')} ${t('nav.reports')}</button></div></section>
      <section class="card"><h3>${icon('clock')} ${t('sup.activity')}</h3>${activity.length ? activity.map(n => { const m = notifMeta(n); return `<div class="todo"><span class="ic ${m.tone}">${icon(m.icon)}</span><div class="t"><span class="small">${esc(notifText(n.message))}</span><span class="tiny mute">${fmtDate(n.created_at)}</span></div></div>`; }).join('') : `<p class="mute small">${t('sup.noActivity')}</p>`}</section>
      <section class="card"><div class="card-h"><h3>${icon('message')} ${t('dRecent')}</h3><button class="link" data-go="messages">${t('viewAll')}</button></div>${d.recent_messages.length ? d.recent_messages.slice(0, 4).map(m => `<div class="todo" style="cursor:pointer" data-go="messages">${avatar(m.sender, 'sm')}<div class="t"><b>${esc(m.sender)} → ${esc(m.with)}</b><span class="small ellip">${esc(m.body)}</span><span class="tiny mute">${fmtDate(m.created_at)}</span></div></div>`).join('') : `<p class="mute small">${t('dNoMsgs')}</p>`}</section>
    </div></div>`;
  view.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { if (b.dataset.go === 'newstage') { go('stages', { stageForm: { id: null } }); } else go(b.dataset.go); });
  view.querySelectorAll('[data-rev]').forEach(b => { const [s, r] = b.dataset.rev.split(':'); b.onclick = () => openStage(Number(s), Number(r)); });
  view.querySelectorAll('[data-stage]').forEach(b => b.onclick = () => openStage(Number(b.dataset.stage)));
  view.querySelectorAll('tr[data-r]').forEach(b => b.onclick = () => openResearch(Number(b.dataset.r)));
}

// ---------- Submissions & reviews queue ----------
export async function renderReviewQueue(view) {
  const stages = await api('GET', '/stages');
  const details = await Promise.all(stages.filter(s => s.counts.assigned).map(s => api('GET', `/stages/${s.id}`)));
  const items = details.flatMap(d => d.targets.map(x => ({ ...x, stage_id: d.stage.id, stage: d.stage.name, deadline: d.stage.deadline })));
  const f = state.qfilter ?? 'review';
  const F = { review: x => x.status === 'submitted', changes: x => x.status === 'changes_requested', approved: x => x.status === 'approved', late: x => x.late, missing: x => x.missing };
  const list = sortRows(items.filter(F[f]).sort((a, b) => (b.submitted_at ?? '').localeCompare(a.submitted_at ?? '')), state.qsort, { submitted: x => x.submitted_at ?? '' });
  const page = state.qpage ?? 1;
  view.innerHTML = `${pageHeader({ title: t('nav.review'), sub: t('rq.sub') })}${tabsHtml(Object.keys(F).map(k => ({ key: k, label: t('rq.' + k), count: items.filter(F[k]).length })), f)}
    <div class="card">${list.length ? `<div class="table-wrap"><table class="rt"><thead><tr>${th(t('target'), 'label', state.qsort)}${th(t('rl.stage'), 'stage', state.qsort)}${th(t('status'), 'status', state.qsort)}${th(t('attempts'), 'attempts', state.qsort)}${th(t('submittedAt'), 'submitted', state.qsort)}${th(t('grade'), 'score', state.qsort)}<th><span class="sr-only">${t('actions')}</span></th></tr></thead><tbody>
      ${paginate(list, page, 10).map(x => `<tr class="click ${x.late ? 'late' : ''}" data-s="${x.stage_id}" data-r="${x.research_id}"><td data-label="${t('target')}"><div class="member" style="padding:0">${avatar(x.label)}<div class="t"><b>${esc(x.label)}</b><div class="tiny mute">${esc(x.title)}</div></div></div></td><td data-label="${t('rl.stage')}">${esc(x.stage)}</td>
        <td data-label="${t('status')}">${badge(x.status)}${x.late ? ` <span class="badge overdue">${t('late')}</span>` : ''}</td><td data-label="${t('attempts')}">${x.attempts}</td><td data-label="${t('submittedAt')}" class="small">${x.submitted_at ? fmtDate(x.submitted_at) : '—'}</td>
        <td data-label="${t('grade')}">${x.score != null ? num(x.score) : '—'}</td><td><button class="sm" data-rev="${x.stage_id}:${x.research_id}">${t('review')} ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>${pagerHtml(list.length, page, 10)}`
      : empty({ ic: 'inbox', title: t('rq.emptyT'), text: t('rq.emptyD') })}</div>`;
  view.querySelectorAll('[data-tabk]').forEach(b => b.onclick = () => { state.qfilter = b.dataset.tabk; state.qpage = 1; render(); });
  view.querySelectorAll('tr.click').forEach(tr => tr.onclick = e => { if (!e.target.closest('button')) openStage(Number(tr.dataset.s), Number(tr.dataset.r)); });
  view.querySelectorAll('[data-rev]').forEach(b => { const [s, r] = b.dataset.rev.split(':'); b.onclick = () => openStage(Number(s), Number(r)); });
  bindPager(view, p => { state.qpage = p; render(); }); bindSort(view, 'qsort', render);
}

// ---------- Grades overview ----------
export async function renderSupervisorGrades(view) {
  const rep = await api('GET', '/supervisor/reports');
  const list = await api('GET', '/research?limit=500');
  const final = new Map(list.map(r => [r.id, r.grade]));
  view.innerHTML = `${pageHeader({ title: t('nav.grades'), sub: t('gr.supSub') })}<div class="card">${rep.research.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('title')}</th><th>${t('rd.stageGrades')}</th><th>${t('sdAccum')}</th><th>${t('sdFinal')}</th><th></th></tr></thead><tbody>
    ${rep.research.map(r => `<tr class="click" data-r="${r.id}"><td data-label="${t('title')}"><b>${esc(r.title)}</b><div class="tiny mute">${esc(r.label)}</div></td><td data-label="${t('rd.stageGrades')}">${r.graded}/${r.stages}</td>
      <td data-label="${t('sdAccum')}">${r.stages ? `<b>${num(r.earned)}</b> / ${num(r.total_max)}${r.percent != null ? `<div style="max-width:140px">${progress(r.percent)}</div>` : ''}` : '—'}</td><td data-label="${t('sdFinal')}">${final.get(r.id) ?? '—'}</td>
      <td><button class="ghost sm" data-r="${r.id}">${t('gr.enter')} ${icon('arrow')}</button></td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'award', title: t('rd.noGrades'), text: t('noAssigned') })}</div>`;
  view.querySelectorAll('[data-r]').forEach(b => b.onclick = e => { e.stopPropagation(); openResearch(Number(b.dataset.r), 'grades'); });
}

// ---------- Stages: list ----------
export async function renderStages(view) {
  if (state.stageForm) return renderStageForm(view);
  if (state.openStageId) return renderStageDetail(view, state.openStageId);
  setCrumbs([{ label: t('nav.stages') }]);
  const [stages, wf] = await Promise.all([api('GET', '/stages'), api('GET', '/supervisor/settings').catch(() => ({ not_started: [] }))]);
  const waiting = wf.not_started ?? [];
  view.innerHTML = `${pageHeader({ title: t('stagesTitle'), sub: t('st.sub'), actions: `${stages.length ? `<button class="ghost" id="copy">${icon('layers')} ${t('cp.btn')}</button>` : ''}<button id="new">${icon('plus')} ${t('newStage')}</button>` })}
    ${waiting.length && stages.length ? `<div class="alert warn" style="margin-bottom:16px">${icon('alert')}<div class="grow"><p style="margin:0"><b>${t('wf.pendingT', { n: waiting.length })}</b></p>
      <p class="small" style="margin:4px 0 0">${t('wf.pendingD')} ${waiting.slice(0, 5).map(x => `<span class="chip">${esc(x.label)} — ${esc(x.title)}</span>`).join(' ')}${waiting.length > 5 ? ' …' : ''}</p></div>
      <button class="ok" id="startAll">${icon('layers')} ${t('wf.startAll')}</button></div>` : ''}
    ${stages.length ? stages.map((s, i) => { const c = s.counts; return `<section class="card"><div class="row" style="gap:12px;align-items:flex-start"><span class="avatar c1" aria-hidden="true">${i + 1}</span>
      <div class="grow" style="min-width:200px"><div class="row"><h3 style="margin:0"><a href="#" data-open="${s.id}">${esc(s.name)}</a></h3>${stateBadge(s.phase)}${s.grades_locked ? `<span class="badge closed">${icon('lock')}${t('locked')}</span>` : ''}</div>
        <div class="tl-meta"><span>${icon('book')} ${esc(s.course)}</span><span>${icon('flag')} ${s.deadline ? fmtDay(s.deadline) : '—'}</span>${s.deadline ? remBadge(s.deadline) : ''}<span>${icon('award')} ${num(s.max_grade)}</span>${s.criteria.length ? `<span>${icon('check')} ${t('rubric')}: ${s.criteria.length}</span>` : ''}</div>
        <div class="row small" style="gap:14px"><span>${t('assigned2')}: <b>${c.assigned}</b></span><span>${t('awaitingC')}: <b>${c.pending_review}</b></span><span>${t('approvedC2')}: <b>${c.approved}</b></span><span>${t('changesC')}: <b>${c.changes_requested}</b></span><span>${t('missingC')}: <b>${c.missing}</b></span><span class="${c.late ? 'overdue' : ''}">${t('lateC')}: <b>${c.late}</b></span>${c.locked ? `<span class="mute">${icon('lock')} ${t('sf.lockedC')}: <b>${c.locked}</b></span>` : ''}</div>
        <div style="max-width:320px;margin-top:8px">${progress(c.assigned ? c.approved / c.assigned * 100 : 0)}</div></div>
      <div class="row"><button class="ghost sm icon" data-up="${s.id}" ${i === 0 ? 'disabled' : ''} aria-label="${t('moveUp')}" data-tip="${t('moveUp')}">↑</button><button class="ghost sm icon" data-down="${s.id}" ${i === stages.length - 1 ? 'disabled' : ''} aria-label="${t('moveDown')}" data-tip="${t('moveDown')}">↓</button>
        <button class="ghost sm" data-open="${s.id}">${t('stageTargets')} ${icon('right')}</button><button class="ghost sm" data-edit="${s.id}">${icon('edit')} ${t('edit')}</button>${s.deletable ? `<button class="bad sm" data-del="${s.id}">${icon('trash')} ${t('del')}</button>` : ''}</div></div></section>`; }).join('')
      : `<div class="card">${empty({ ic: 'layers', title: t('noStages'), text: t('tl.noStagesD'), action: `<button id="new2">${icon('plus')} ${t('newStage')}</button>` })}</div>`}`;
  ['new', 'new2'].forEach(id => $('#' + id)?.addEventListener('click', () => { state.stageForm = { id: null }; render(); }));
  $('#copy')?.addEventListener('click', () => openCopy(stages));
  $('#startAll')?.addEventListener('click', act(async () => {
    if (!await confirmDialog({ title: t('wf.startAll'), text: t('wf.confirmAll', { n: waiting.length }), confirm: t('wf.start'), tone: 'ok' })) return;
    const r = await api('POST', '/supervisor/workflow/start-all'); toast(t('wf.startedN', { n: r.started })); render();
  }));
  view.querySelectorAll('[data-open]').forEach(a => a.onclick = e => { e.preventDefault(); openStage(Number(a.dataset.open)); });
  view.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => { state.stageForm = { id: Number(b.dataset.edit) }; render(); });
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => {
    if (!await confirmDialog({ title: t('del'), text: t('confirmDeleteStage'), confirm: t('del'), tone: 'bad' })) return;
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
  const back = () => { state.stageForm = null; render(); };
  setCrumbs([{ label: t('nav.stages'), go: back }, { label: s ? t('editStage') : t('newStage') }]);
  const rows = s ? s.criteria.map(c => ({ name: c.name, max: c.max_score })) : [];
  const frozen = !!s?.started; // started: grade, rubric, file rules and start date stay as they are
  view.innerHTML = `${pageHeader({ title: s ? t('editStage') : t('newStage'), actions: `<button class="ghost" id="cancel">${icon('left')} ${t('back')}</button>` })}
    ${frozen ? `<div class="alert warn" style="margin-bottom:16px">${icon('lock')}<p>${t('sf.partialEdit')}</p></div>` : ''}<form id="f" class="grid g-main" style="align-items:start"><div class="stack">
    <section class="card"><h3>${t('sf.basics')}</h3><label for="n">${t('stageName')}</label><input id="n" required maxlength="120" value="${esc(s?.name ?? '')}">
      <label for="c">${t('course')}</label><select id="c" ${s ? 'disabled' : ''}>${courseOpts(courses)}</select>
      <label for="d">${t('description')}</label><textarea id="d" maxlength="2000">${esc(s?.description ?? '')}</textarea><label for="i">${t('instructions')}</label><textarea id="i" maxlength="4000">${esc(s?.instructions ?? '')}</textarea>
      <div class="field-row"><div><label for="sd">${t('startDate')}</label>${dateField('sd', s?.start_date ?? '', t('startDate'))}</div><div><label for="dl">${t('deadline')}</label>${dateField('dl', s?.deadline ?? '', t('deadline'))}</div>
        <div><label for="mg">${rows.length ? t('maxGradeFromRubric') : t('maxGrade')}</label><input type="number" id="mg" min="1" max="1000" step="0.5" value="${s?.max_grade ?? 100}"></div></div></section>
    <section class="card"><h3>${t('rubric')}</h3><p class="hint">${t('rubricHint')}</p><div id="crits"></div><div class="row" style="margin-top:8px"><button type="button" class="ghost sm" id="addc">${icon('plus')} ${t('addCriterion')}</button><button type="button" class="ghost sm" id="defc">${t('defaultRubric')}</button></div></section></div>
    <div class="stack"><section class="card"><h3>${t('sf.rules')}</h3><label>${t('formats')}</label><div class="row">${FORMATS.map(f => `<label class="inl"><input type="checkbox" data-fmt="${f}" ${(s?.formats ?? ['pdf', 'doc', 'docx']).includes(f) ? 'checked' : ''}> .${f}</label>`).join('')}</div>
      <div class="field-row"><div><label for="mb">${t('maxFileMb')}</label><input type="number" id="mb" min="0.1" max="10" step="0.1" value="${s?.max_file_mb ?? 10}"></div><div><label for="ma">${t('maxAttempts')}</label><input type="number" id="ma" min="1" max="20" value="${s?.max_attempts ?? ''}"></div></div>
      <div class="stack" style="gap:8px;margin-top:12px"><label class="inl"><input type="checkbox" id="rs" ${s?.allow_resubmit ?? true ? 'checked' : ''}> ${t('allowResubmit')}</label><label class="inl"><input type="checkbox" id="al" ${s?.allow_late ?? true ? 'checked' : ''}> ${t('allowLate')}</label>
        <label class="inl"><input type="checkbox" id="aa" ${s?.assign_all ? 'checked' : ''}> ${t('assignAll')}</label></div></section>
      <section class="card"><h3>${t('sf.workflow')}</h3><p class="hint">${icon('info')} ${t('sf.autoNote')}</p>
        <div class="field-row"><div><label for="du">${t('sf.duration')}</label><input type="number" id="du" min="1" max="365" value="${s?.duration_days ?? ''}"></div>
          <div><label for="mf">${t('sf.maxFiles')}</label><input type="number" id="mf" min="1" max="10" value="${s?.max_files ?? 1}"></div>
          <div><label for="wt">${t('sf.weight')}</label><input type="number" id="wt" min="0" max="100" step="0.5" value="${s?.weight ?? ''}"></div></div>
        <p class="hint">${t('sf.weightHint')}</p>
        <p class="hint">${t('sf.durationHint')}</p>
        <label class="inl"><input type="checkbox" id="ar" ${s?.allow_replace ?? true ? 'checked' : ''}> ${t('sf.allowReplace')}</label></section>
      ${s ? '' : `<section class="card"><h3>${t('sf.assign')}</h3><label for="st">${t('initialState')}</label><select id="st"><option value="scheduled">${t('state.scheduled')}</option><option value="open">${t('state.open')}</option></select>
        <label>${t('assignTo')}</label><div class="checks" id="rl">${research.map(r => `<label><input type="checkbox" value="${r.id}"> ${esc(r.team || r.student)} <span class="mute small">— ${esc(r.title)} (${esc(r.course)})</span></label>`).join('') || `<span class="mute">${t('noAssigned')}</span>`}</div></section>`}
      <div class="row"><button type="submit">${icon('check')} ${t('save')}</button><button type="button" class="ghost" id="cancel2">${t('cancel')}</button></div></div></form>`;
  const paint = () => {
    $('#crits').innerHTML = rows.length ? rows.map((c, i) => `<div class="row" style="margin-bottom:8px"><input class="grow" data-cn="${i}" placeholder="${t('criterionName')}" value="${esc(c.name)}" maxlength="100" aria-label="${t('criterionName')}">
      <input type="number" data-cm="${i}" min="0.5" max="1000" step="0.5" style="width:96px" placeholder="${t('criterionMax')}" value="${c.max}" aria-label="${t('criterionMax')}"><button type="button" class="ghost sm icon" data-cx="${i}" aria-label="${t('remove')}">${icon('x')}</button></div>`).join('') : `<p class="mute small">${t('sf.noRubric')}</p>`;
    const sum = rows.reduce((a, c) => a + (Number(c.max) || 0), 0);
    $('#mg').disabled = rows.length > 0; if (rows.length) $('#mg').value = sum;
    document.querySelector('label[for=mg]').textContent = rows.length ? t('maxGradeFromRubric') : t('maxGrade');
    view.querySelectorAll('[data-cn]').forEach(i => i.oninput = () => rows[i.dataset.cn].name = i.value);
    view.querySelectorAll('[data-cm]').forEach(i => i.oninput = () => { rows[i.dataset.cm].max = i.value; $('#mg').value = rows.reduce((a, c) => a + (Number(c.max) || 0), 0); });
    view.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => { rows.splice(Number(b.dataset.cx), 1); paint(); });
  };
  paint(); bindDateFields(view);
  if (frozen) {
    ['#sd', '#mg', '#mb', '#mf'].forEach(q => { const el = $(q); if (el) el.disabled = true; });
    view.querySelector('[data-cal="sd"]')?.setAttribute('disabled', '');
    view.querySelectorAll('[data-fmt], #crits input, #crits button, #addc, #defc').forEach(el => { el.disabled = true; });
  }
  $('#addc').onclick = () => { rows.push({ name: '', max: 10 }); paint(); };
  $('#defc').onclick = () => { rows.length = 0; [40, 20, 20, 10, 10].forEach((m, i) => rows.push({ name: t('crit' + i), max: m })); paint(); };
  $('#cancel').onclick = back; $('#cancel2').onclick = back;
  if (!s) { const byName = () => { const cn = $('#c').selectedOptions[0].textContent; view.querySelectorAll('#rl label').forEach(l => { l.style.display = l.textContent.includes(`(${cn})`) ? '' : 'none'; }); }; $('#c').onchange = byName; byName(); }
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const body = { name: $('#n').value, description: $('#d').value, instructions: $('#i').value, startDate: $('#sd').value || null, deadline: $('#dl').value || null,
      maxGrade: $('#mg').value, formats: [...view.querySelectorAll('[data-fmt]:checked')].map(i => i.dataset.fmt), maxFileMb: $('#mb').value,
      maxAttempts: $('#ma').value || null, allowResubmit: $('#rs').checked, allowLate: $('#al').checked, assignAll: $('#aa').checked,
      durationDays: $('#du').value || null, maxFiles: $('#mf').value || 1, weight: $('#wt').value === '' ? null : $('#wt').value, allowReplace: $('#ar').checked, criteria: rows.filter(r => r.name.trim()).map(r => ({ name: r.name, max: r.max })) };
    if (s) await api('PUT', `/stages/${s.id}`, body);
    else await api('POST', '/stages', { ...body, courseId: $('#c').value, state: $('#st').value, researchIds: [...view.querySelectorAll('#rl input:checked')].map(i => Number(i.value)) });
    back();
  }, 'toast.stage');
}

// ---------- Stage detail: everyone assigned, status, review and grading ----------
async function renderStageDetail(view, id) {
  const d = await api('GET', `/stages/${id}`);
  const s = d.stage, C = d.counts;
  state.expanded ??= new Set();
  const back = () => { state.openStageId = null; render(); };
  setCrumbs([{ label: t('nav.stages'), go: back }, { label: s.name }]);
  const row = r => `<tr class="${r.late ? 'late' : ''}"><td data-label="${t('target')}"><div class="member" style="padding:0">${avatar(r.label)}<div class="t"><b>${esc(r.label)}</b><div class="tiny mute">${esc(r.title)}${r.team ? ' · ' + esc(r.student) : ''}</div></div></div></td>
    <td data-label="${t('status')}">${r.phase && r.phase !== 'active' ? `<span class="badge ${r.phase === 'locked' ? 'locked' : 'closed'}">${r.phase === 'locked' ? icon('lock') : ''}${t('phase.' + r.phase)}</span> ` : ''}${r.phase === 'locked' ? '' : badge(r.status)}${r.late ? ` <span class="badge overdue">${t('late')}</span>` : ''}${r.deadline && r.deadline !== s.deadline && r.phase === 'active' ? `<div class="tiny mute">${icon('flag')} ${fmtDay(r.deadline)}</div>` : ''}</td><td data-label="${t('attempts')}">${r.attempts}${r.attempts_left == null ? '' : ` <span class="mute small">(+${r.attempts_left})</span>`}</td>
    <td data-label="${t('submittedAt')}" class="small">${r.submitted_at ? fmtDate(r.submitted_at) : '—'}</td><td data-label="${t('grade')}">${r.score != null ? `${num(r.score)}/${num(s.max_grade)}` : '—'}</td>
    <td><div class="row"><button class="${state.expanded.has(r.research_id) ? 'ghost' : ''} sm" data-exp="${r.research_id}" aria-expanded="${state.expanded.has(r.research_id)}">${state.expanded.has(r.research_id) ? t('hide') : t('review')}</button>
      <button class="ghost sm" data-more="${r.research_id}" data-tip="${t('allowAnother')}" aria-label="${t('allowAnother')}">＋1</button>${r.attempts || r.score != null ? '' : `<button class="ghost sm" data-un="${r.research_id}">${t('unassign')}</button>`}</div></td></tr>
    <tr class="exprow" ${state.expanded.has(r.research_id) ? '' : 'hidden'}><td colspan="6"><div data-box="${r.research_id}"></div></td></tr>`;
  view.innerHTML = `${pageHeader({ title: esc(s.name), sub: `${esc(s.course)} · ${t('startDate')}: ${s.start_date ? fmtDay(s.start_date) : '—'} · ${t('deadline')}: ${s.deadline ? fmtDay(s.deadline) : '—'} ${s.deadline ? remBadge(s.deadline) : ''}`,
      actions: `<button class="ghost" id="back">${icon('left')} ${t('back')}</button>${s.state !== 'open' ? `<button class="ok" data-st="open">${icon('check')} ${s.state === 'closed' ? t('reopen') : t('open')}</button>` : ''}${s.state !== 'closed' ? `<button class="ghost" data-st="closed">${icon('lock')} ${t('close')}</button>` : ''}` })}
    <div class="card"><div class="row" style="gap:10px">${stateBadge(s.phase)}${s.grades_locked ? `<span class="badge closed">${icon('lock')}${t('locked')}</span>` : ''}<span class="small mute">${t('maxGrade')}: ${num(s.max_grade)} · ${t('limits', { f: s.formats.join(', '), mb: num(s.max_file_mb) })}</span></div>
      ${s.description ? `<p>${esc(s.description)}</p>` : ''}${s.instructions ? `<p class="small"><b>${t('requirements')}:</b> ${esc(s.instructions)}</p>` : ''}
      ${d.criteria.length ? `<p class="small mute">${t('rubric')}: ${d.criteria.map(c => `${esc(c.name)} (${num(c.max_score)})`).join(' · ')}</p>` : ''}${s.started ? `<p class="small mute">${icon('lock')} ${t('sf.partialEditShort')}</p>` : ''}
      <div class="row"><button class="ghost sm" id="pp">${icon('calendar')} ${t('postpone')}</button><button class="ghost sm" id="pa">${icon('award')} ${t('publishAll')}</button><button class="ghost sm" id="lk">${icon('lock')} ${s.grades_locked ? t('unlockGrades') : t('lockGrades')}</button><button class="ghost sm" id="ed">${icon('edit')} ${t('edit')}</button><button class="ghost sm" id="hs">${icon('clock')} ${t('showHistory')}</button></div>
      <div class="row" id="ppbox" hidden style="margin-top:10px"><label class="inl" for="pps">${t('startDate')}</label>${dateField('pps', s.start_date ?? '', t('startDate'))}<label class="inl" for="ppd">${t('newDeadline')}</label>${dateField('ppd', s.deadline ?? '', t('newDeadline'))}<button class="sm" id="ppgo">${t('postpone')}</button></div></div>
    <div class="stats">${[['users', '', t('assigned2'), C.assigned], ['upload', '', t('submittedC'), C.submitted], ['inbox', C.pending_review ? 'warn' : '', t('awaitingC'), C.pending_review], ['checkc', 'ok', t('approvedC2'), C.approved], ['edit', C.changes_requested ? 'warn' : '', t('changesC'), C.changes_requested],
      ['x', '', t('rejectedC'), C.rejected], ['clock', '', t('missingC'), C.missing], ['alert', C.late ? 'bad' : '', t('lateC'), C.late], ['award', 'teal', t('gradedC'), C.graded]].map(([ic, tone, l, v]) => tile(ic, tone, l, v)).join('')}</div>
    <section class="card"><div class="card-h"><h3>${t('stageTargets')}</h3></div>${d.targets.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('target')}</th><th>${t('status')}</th><th>${t('attempts')}</th><th>${t('submittedAt')}</th><th>${t('grade')}</th><th>${t('actions')}</th></tr></thead><tbody>${d.targets.map(row).join('')}</tbody></table></div>
      <div class="row" style="margin-top:14px"><input class="grow" id="rm" placeholder="${t('remindPh')}" maxlength="1000" aria-label="${t('remindPh')}"><button class="ghost" id="rmb">${icon('bell')} ${t('remind')}</button></div>` : empty({ ic: 'users', title: t('noStages'), text: t('sf.noTargets') })}</section>
    <section class="card"><h3>${t('assignMore')}</h3>${d.unassigned.length ? `<div class="checks" id="ul">${d.unassigned.map(r => `<label><input type="checkbox" value="${r.id}"> ${esc(r.team || r.student)} <span class="mute small">— ${esc(r.title)}</span></label>`).join('')}</div><p><button id="asg">${t('assign')}</button></p>` : `<p class="mute small">${t('noUnassigned')}</p>`}</section>
    <section class="card" id="histbox" hidden><h3>${t('history')}</h3><div id="hist"></div></section>`;
  $('#back').onclick = back; bindDateFields(view);
  const setState = (st, withDates = false) => act(async () => {
    if (st === 'closed' && !await confirmDialog({ title: t('close'), text: t('sf.confirmClose'), confirm: t('close'), tone: 'warn' })) return;
    const dates = withDates ? { startDate: $('#pps').value || null, deadline: $('#ppd').value || null } : {};
    await api('PUT', `/stages/${id}/state`, { state: st, ...dates }); render();
  }, 'toast.stageState');
  view.querySelectorAll('[data-st]').forEach(b => b.onclick = setState(b.dataset.st));
  $('#pp').onclick = () => { $('#ppbox').hidden = !$('#ppbox').hidden; };
  $('#ppgo').onclick = setState('postponed', true);
  $('#pa').onclick = act(async () => { if (!await confirmDialog({ title: t('publishAll'), text: t('sf.confirmPublish'), confirm: t('publishAll'), tone: 'ok' })) return; await api('PUT', `/stages/${id}/publish`, { published: true }); render(); }, 'toast.gradeStage');
  $('#lk').onclick = act(async () => { await api('PUT', `/stages/${id}/grades-lock`, { locked: !s.grades_locked }); render(); }, 'toast.lock');
  $('#ed')?.addEventListener('click', () => { state.openStageId = null; state.stageForm = { id }; render(); });
  $('#hs').onclick = act(async () => {
    const h = await api('GET', `/stages/${id}/history`); $('#histbox').hidden = false;
    $('#hist').innerHTML = h.length ? `<div class="table-wrap"><table><tbody>${h.map(x => `<tr><td class="small mute">${fmtDate(x.created_at)}</td><td>${esc(x.actor ?? '—')}</td><td><code>${esc(x.action)}</code></td><td class="small mute">${esc(x.detail ? JSON.stringify(x.detail) : '')}</td></tr>`).join('')}</tbody></table></div>` : `<span class="mute">${t('noHistory')}</span>`;
  });
  view.querySelectorAll('[data-exp]').forEach(b => b.onclick = () => { const rid = Number(b.dataset.exp); state.expanded.has(rid) ? state.expanded.delete(rid) : state.expanded.add(rid); render(); });
  for (const rid of state.expanded) { const box = view.querySelector(`[data-box="${rid}"]`); if (box) renderResearchStages(box, rid, { role: 'supervisor', onlyStageId: id, after: render }); }
  view.querySelectorAll('[data-more]').forEach(b => b.onclick = act(async () => { await api('POST', `/stages/${id}/targets/${b.dataset.more}/allow-resubmit`); render(); }, 'toast.resubmit'));
  view.querySelectorAll('[data-un]').forEach(b => b.onclick = act(async () => {
    if (!await confirmDialog({ title: t('unassign'), text: t('sf.confirmUnassign'), confirm: t('unassign'), tone: 'warn' })) return;
    await api('DELETE', `/stages/${id}/targets/${b.dataset.un}`); render();
  }, 'toast.stageState'));
  $('#rmb')?.addEventListener('click', act(async () => { const r = await api('POST', `/stages/${id}/remind`, { message: $('#rm').value }); toast(t('reminderSent', { n: r.sent })); }));
  $('#asg')?.addEventListener('click', act(async () => { await api('POST', `/stages/${id}/targets`, { researchIds: [...view.querySelectorAll('#ul input:checked')].map(i => Number(i.value)) }); render(); }, 'toast.assigned'));
}

// ---------- Reports ----------
export async function renderSupervisorReports(view) {
  const r = await api('GET', '/supervisor/reports');
  const wfl = r.workflow ?? [], wf = state.wfFilter ?? 'all';
  const wfFilters = { all: () => true, instructor: x => x.waiting_on === 'instructor', student: x => x.waiting_on === 'student', late: x => x.late, done: x => x.finished };
  const wfRows = wfl.filter(wfFilters[wf]);
  view.innerHTML = `${pageHeader({ title: t('reportsTitle'), sub: t('rp.sub'), actions: `<button class="ghost" id="csv">${icon('download')} ${t('exportCsv')}</button>` })}
    <section class="card"><div class="card-h"><h3>${icon('layers')} ${t('wr.title')}</h3></div><p class="small mute" style="margin-top:0">${t('wr.sub')}</p>
      <div class="chips" role="group" style="margin-bottom:12px">${Object.keys(wfFilters).map(k => `<button class="${wf === k ? 'on' : ''}" data-wf="${k}">${t('wr.f.' + k)} (${wfl.filter(wfFilters[k]).length})</button>`).join('')}</div>
      ${wfRows.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('title')}</th><th>${t('wr.current')}</th><th>${t('wr.waiting')}</th><th>${t('wr.days')}</th><th>${t('deadline')}</th><th>${t('stagesProgress')}</th></tr></thead><tbody>
      ${wfRows.map(x => `<tr class="click ${x.late ? 'late' : ''}" data-r="${x.id}"><td data-label="${t('title')}"><b>${esc(x.title)}</b><div class="tiny mute">${esc(x.label)}</div></td>
        <td data-label="${t('wr.current')}">${x.current_stage ? `${esc(x.current_stage)} <span class="badge ${x.status}">${t('ds.' + x.status)}</span>` : x.finished ? `<span class="badge approved">${t('sdw.allDone')}</span>` : `<span class="mute small">${t('wr.none')}</span>`}</td>
        <td data-label="${t('wr.waiting')}">${x.waiting_on ? `<span class="badge ${x.waiting_on === 'instructor' ? 'warn' : 'info'}">${icon(x.waiting_on === 'instructor' ? 'inbox' : 'user')}${t('wr.w.' + x.waiting_on)}</span>${x.days_waiting_review != null ? `<div class="tiny mute">${x.days_waiting_review ? t('wr.sinceSub', { n: x.days_waiting_review }) : t('wr.subToday')}</div>` : ''}` : '—'}</td>
        <td data-label="${t('wr.days')}">${x.days_in_stage ?? '—'}</td><td data-label="${t('deadline')}" class="small">${x.deadline ? fmtDay(x.deadline) + ' ' + remBadge(x.deadline) : '—'}${x.late ? ` <span class="badge overdue">${t('late')}</span>` : ''}</td>
        <td data-label="${t('stagesProgress')}" style="min-width:120px">${progress(x.progress_percent ?? 0)}<span class="tiny mute">${x.completed}/${x.stages}</span></td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'layers', title: t('wr.empty') })}</section>
    <section class="card"><div class="card-h"><h3>${t('researchProgress')}</h3></div>${r.research.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('title')}</th><th>${t('status')}</th><th>${t('stagesProgress')}</th><th>${t('missingC')}</th><th>${t('lateC')}</th><th>${t('earned')}</th><th>${t('sdFinal')}</th></tr></thead><tbody>
      ${r.research.map(x => `<tr class="click ${x.late ? 'late' : ''}" data-r="${x.id}"><td data-label="${t('title')}"><b>${esc(x.title)}</b><div class="tiny mute">${esc(x.label)}</div></td><td data-label="${t('status')}">${badge(x.status)}</td>
        <td data-label="${t('stagesProgress')}" style="min-width:130px">${progress(x.progress_percent ?? 0)}<span class="tiny mute">${x.approved}/${x.stages}</span></td><td data-label="${t('missingC')}">${x.missing}</td><td data-label="${t('lateC')}" class="${x.late ? 'overdue' : ''}">${x.late}</td>
        <td data-label="${t('earned')}">${x.stages ? `${num(x.earned)}/${num(x.total_max)}${x.percent != null ? ` (${x.percent}%)` : ''}` : '—'}</td><td data-label="${t('sdFinal')}">${x.final_grade ?? '—'}</td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'chart', title: t('noAssigned') })}</section>
    <section class="card"><div class="card-h"><h3>${t('stageStats')}</h3></div>${r.stages.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('stageName')}</th><th>${t('deadline')}</th><th>${t('assigned2')}</th><th>${t('submittedC')}</th><th>${t('approvedC2')}</th><th>${t('changesC')}</th><th>${t('missingC')}</th><th>${t('lateC')}</th><th>${t('rAvg')}</th></tr></thead><tbody>
      ${r.stages.map(s => `<tr class="click" data-s="${s.id}"><td data-label="${t('stageName')}"><b>${esc(s.name)}</b> ${stateBadge(s.state)}</td><td data-label="${t('deadline')}">${s.deadline ? fmtDay(s.deadline) : '—'}</td><td data-label="${t('assigned2')}">${s.assigned}</td><td data-label="${t('submittedC')}">${s.submitted}</td><td data-label="${t('approvedC2')}">${s.approved}</td><td data-label="${t('changesC')}">${s.changes_requested}</td>
        <td data-label="${t('missingC')}">${s.missing}</td><td data-label="${t('lateC')}" class="${s.late ? 'overdue' : ''}">${s.late}</td><td data-label="${t('rAvg')}">${s.avg_score != null ? `${num(s.avg_score)}/${num(s.max_grade)}` : '—'}</td></tr>`).join('')}</tbody></table></div>` : empty({ ic: 'layers', title: t('noStages') })}</section>
    <section class="card"><div class="card-h"><h3>${t('notSubmittedList')}</h3></div>${r.missing.length ? `<div class="table-wrap"><table class="rt"><tbody>${r.missing.map(m => `<tr class="click ${m.late ? 'late' : ''}" data-s="${m.stage_id}"><td data-label="${t('stageName')}"><b>${esc(m.stage)}</b></td><td data-label="${t('target')}">${esc(m.label)}</td><td data-label="${t('title')}" class="small mute">${esc(m.title)}</td>
        <td data-label="${t('deadline')}">${m.deadline ? fmtDay(m.deadline) : '—'} ${m.late ? `<span class="badge overdue">${t('late')}</span>` : ''}</td></tr>`).join('')}</tbody></table></div>
      ${r.late_teams.length ? `<p class="small"><b>${t('lateTeams')}:</b> ${r.late_teams.map(esc).join('، ')}</p>` : ''}` : empty({ ic: 'checkc', title: t('nothingMissing') })}</section>`;
  $('#csv').onclick = () => downloadPath('/api/supervisor/reports/export', 'supervisor-report.csv');
  view.querySelectorAll('[data-wf]').forEach(b => b.onclick = () => { state.wfFilter = b.dataset.wf; render(); });
  view.querySelectorAll('tr[data-s]').forEach(tr => tr.onclick = () => openStage(Number(tr.dataset.s)));
  view.querySelectorAll('tr[data-r]').forEach(tr => tr.onclick = () => openResearch(Number(tr.dataset.r)));
}

// ---------- Stage templates: copy stages into a course (a new term or another course) ----------
async function openCopy(stages) {
  const courses = await api('GET', '/courses');
  const byCourse = [...new Set(stages.map(s => s.course))];
  const m = modal({ title: t('cp.title'), ic: 'layers', body: `<p class="small mute">${t('cp.sub')}</p>
    <div class="checks" id="cps" style="max-height:240px;overflow:auto">${byCourse.map(c => `<b class="small">${esc(c)}</b>${stages.filter(s => s.course === c).map(s => `<label><input type="checkbox" value="${s.id}" checked> ${esc(s.name)} <span class="mute small">(${num(s.max_grade)}${s.criteria.length ? ' · ' + t('rubric') : ''})</span></label>`).join('')}`).join('')}</div>
    <label for="cpc">${t('cp.to')}</label><select id="cpc">${courseOpts(courses)}</select>
    <label for="cpd">${t('cp.shift')}</label><input type="number" id="cpd" min="-730" max="730" step="1" value="0"><p class="hint">${t('cp.shiftHint')}</p>`,
    actions: `<button class="ghost" data-x>${t('cancel')}</button><button class="ok" data-go>${icon('check')} ${t('cp.go')}</button>` });
  m.el.querySelector('[data-x]').onclick = m.close;
  m.el.querySelector('[data-go]').onclick = act(async () => {
    const stageIds = [...m.el.querySelectorAll('#cps input:checked')].map(i => Number(i.value));
    if (!stageIds.length) throw new Error(t('cp.pick'));
    const r = await api('POST', '/stages/copy', { stageIds, courseId: m.el.querySelector('#cpc').value, shiftDays: m.el.querySelector('#cpd').value || 0 });
    m.close(); toast(t('cp.done', { n: r.created })); render();
  });
}
