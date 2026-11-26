// Research stages as a timeline: status, deadlines, submission history, grading and review (supervisor), submitting (student).
// Shared by the research details page, the student's stages page and the supervisor's stage page.
import { esc, t, tErr, badge, fmtDate, fmtDay, api, apiUpload, downloadPath, readFile, act, state, toast } from '../core.js';
import { icon, num, progress, remBadge, remaining, confirmDialog, dropzoneHtml, bindDropzone, empty, fmtBytes, avatar, canView, viewPath } from '../ui.js';

export const stateBadge = s => `<span class="badge ${s}">${t('state.' + s)}</span>`;
const lateBadge = () => `<span class="badge overdue">${icon('alert')}${t('late')}</span>`;
const dsBadge = (e, role) => role === 'student' ? `<span class="badge ${e.display_status}">${t('ds.' + e.display_status)}</span>` : badge(e.status);

// timeline state of one entry (done | review | changes | rejected | overdue | closed | locked | upcoming | open)
export function tlState(e) {
  if (e.phase === 'locked') return 'locked';
  if (e.status === 'approved') return 'done';
  if (e.status === 'rejected') return 'rejected';
  if (e.status === 'changes_requested') return 'changes';
  if (e.status === 'submitted') return 'review';
  if (e.stage.state === 'closed' || e.phase === 'closed' || e.phase === 'completed') return 'closed';
  if (e.late && e.missing) return 'overdue';
  return ['upcoming', 'scheduled', 'postponed'].includes(e.stage.phase) ? 'upcoming' : 'open';
}
const MARK = { done: 'check', review: 'clock', changes: 'edit', rejected: 'x', overdue: 'alert', closed: 'lock', locked: 'lock' };

const openKey = (rid, sid) => `${rid}:${sid}`;
state.stOpen ??= new Set();

// a file of a submission: files stored per submission have their own id; older single-file submissions use the submission's
const fileBtn = (sub, f) => `<span class="filechip">${canView(f.filename) ? `<button class="ghost sm" data-view="${f.id ? `/api/stage-submission-files/${f.id}/file` : `/api/stage-submissions/${sub.id}/file`}" data-name="${esc(f.filename)}">${icon('eye')} ${t('vw.view')}</button>` : ''}<button class="ghost sm" ${f.id ? `data-sfdl="${f.id}"` : `data-sdl="${sub.id}"`} data-name="${esc(f.filename)}">${icon('download')} <span dir="ltr">${esc(f.filename)}</span> · ${fmtBytes(f.size)}</button></span>`;
function submissionHtml(sub, role) {
  const files = sub.files ?? [{ id: null, filename: sub.filename, size: sub.size }];
  return `<div class="ver ${sub.replaced ? 'is-replaced' : ''}"><div class="row"><b class="grow">${t('attempt')} ${sub.attempt_no}</b>${sub.late ? lateBadge() : ''}${sub.replaced ? `<span class="badge closed">${t('sb.replaced')}</span>` : badge(sub.status)}</div>
    <div class="small mute" style="margin:4px 0 8px">${fmtDate(sub.created_at)}${sub.by ? ` · ${t('byWhom')} ${esc(sub.by)}` : ''}</div>
    <div class="row" style="gap:6px">${files.map(f => fileBtn(sub, f)).join('')}</div>
    ${sub.student_note ? `<div class="note"><p>${esc(sub.student_note)}</p></div>` : ''}
    ${sub.reviews.map(v => `<div class="note"><span class="small mute">${esc(v.reviewer)} · ${fmtDate(v.created_at)}${v.decision !== 'comment' ? ' · ' + t('st.' + v.decision) : ''}</span>${v.comment ? `<p>${esc(v.comment)}</p>` : ''}</div>`).join('')}
    ${role === 'supervisor' ? `<div class="row small" style="margin-top:8px"><input class="grow" placeholder="${t('commentPh')}" data-cmt="${sub.id}" aria-label="${t('commentPh')}"><button class="ghost sm" data-cmtbtn="${sub.id}">${t('commentOnly')}</button></div>` : ''}</div>`;
}

function gradeBlock(e, role) {
  const { stage, grade, criteria } = e;
  const view = grade ? `<div><b>${t('stageGrade')}: ${num(grade.score)}/${num(stage.max_grade)}</b> ${role === 'supervisor' ? `<span class="badge ${grade.published ? 'published' : 'unpublished'}">${grade.published ? t('published') : t('unpublished')}</span> <button class="ghost sm" data-pubtoggle="${grade.published ? 0 : 1}">${grade.published ? t('hideGrade') : t('publishGrade')}</button>` : ''}
      ${grade.comment ? `<div class="small">${esc(grade.comment)}</div>` : ''}
      ${criteria.length ? `<table style="margin-top:8px"><tbody>${criteria.map(c => { const sc = grade.scores.find(s => s.criterion_id === c.id)?.score ?? 0; return `<tr><td>${esc(c.name)}</td><td style="width:40%">${progress(sc / c.max_score * 100)}</td><td class="nowrap">${num(sc)}/${num(c.max_score)}</td></tr>`; }).join('')}</tbody></table>` : ''}</div>`
    : `<div class="small mute">${e.grade_pending ? t('gradePending') : t('notGradedYet')}</div>`;
  if (role !== 'supervisor') return view;
  const dis = stage.grades_locked ? 'disabled' : '';
  return `${view}<div class="gradebox"><b class="small">${t('gradeStage')}</b><div class="row" style="margin-top:6px">
    ${criteria.length ? criteria.map(c => `<label class="inl">${esc(c.name)} <span class="mute">(${num(c.max_score)})</span>
        <input type="number" min="0" max="${c.max_score}" step="0.5" style="width:90px" data-crit="${c.id}" value="${grade?.scores.find(s => s.criterion_id === c.id)?.score ?? ''}" ${dis}></label>`).join('')
      : `<label class="inl">${t('scoreOf', { max: num(stage.max_grade) })} <input type="number" min="0" max="${stage.max_grade}" step="0.5" style="width:110px" data-score value="${grade?.score ?? ''}" ${dis}></label>`}</div>
    <div class="row" style="margin-top:8px"><input class="grow" placeholder="${t('gradeComment')}" data-gcomment value="${esc(grade?.comment ?? '')}" ${dis} aria-label="${t('gradeComment')}">
    <label class="inl small"><input type="checkbox" data-gpub ${grade?.published ? 'checked' : ''}> ${t('saveAndPublish')}</label><button data-savegrade ${dis}>${t('saveGrade')}</button>${stage.grades_locked ? `<span class="badge closed">${icon('lock')}${t('locked')}</span>` : ''}</div></div>`;
}

function nextAction(e, role, st) {
  if (role === 'student') {
    if (e.can_submit) return e.submissions.length ? t('tl.next.resubmit') : t('tl.next.submit', { d: e.stage.deadline ? fmtDay(e.stage.deadline) : '—' });
    if (st === 'review') return t('tl.next.wait');
  } else if (role === 'supervisor' && st === 'review') return t('tl.next.review', { n: e.submissions[0]?.attempt_no ?? 1 });
  return '';
}

// Student submission box: one or more files (each can be viewed or removed before sending) and an optional note.
// In "replace" mode the files take the place of the submission that is still waiting for review.
function submitBoxHtml(e) {
  const { stage } = e, replace = !e.can_submit && e.can_replace, max = stage.max_files ?? 1;
  return `<div class="gradebox" data-subbox="${replace ? 'replace' : 'submit'}"><b class="small">${replace ? t('sb.replace') : t('submitStageTitle')}</b>
    ${replace ? `<p class="hint">${t('sb.replaceD')}</p>` : ''}
    <div style="margin-top:8px">${dropzoneHtml('z' + stage.id, { formats: stage.formats, maxMb: stage.max_file_mb, label: max > 1 ? `${t('dz.drop')} · ${t('sb.max', { n: max })}` : undefined })}</div>
    <div data-flist class="stack" style="gap:6px;margin-top:8px"></div><div data-fprog hidden style="margin-top:8px"><div class="small mute" data-fpl></div>${progress(0)}</div>
    <label for="nt${stage.id}">${t('submitNote')}</label><input id="nt${stage.id}" data-note maxlength="1000"><p class="row" style="margin-top:10px"><button data-submit disabled>${icon('upload')} ${replace ? t('sb.replaceBtn') : t('upload')}</button>
    ${replace ? '' : `<span class="small mute">${t('tl.attemptNo', { n: e.attempts + 1 })}</span>`}</p></div>`;
}
const gradeInputs = (e, prefix) => e.criteria.length
  ? e.criteria.map(c => `<label class="inl">${esc(c.name)} <span class="mute">(${num(c.max_score)})</span><input type="number" min="0" max="${c.max_score}" step="0.5" style="width:90px" data-${prefix}crit="${c.id}"></label>`).join('')
  : `<label class="inl">${t('scoreOf', { max: num(e.stage.max_grade) })} <input type="number" min="0" max="${e.stage.max_grade}" step="0.5" style="width:110px" data-${prefix}score></label>`;

function cardHtml(e, i, role, rid, isCurrent, expanded) {
  const { stage } = e, st = tlState(e), rem = stage.deadline && !['done', 'closed', 'locked'].includes(st) ? remBadge(stage.deadline) : '';
  const cls = ['tl-item', st === 'done' ? 'done' : st, isCurrent ? 'current' : ''].join(' ');
  const latest = e.submissions[0], hasFeedback = e.submissions.some(s => s.reviews.some(v => v.comment));
  const na = nextAction(e, role, st);
  const attemptsLeft = e.attempts_left == null ? t('unlimited') : e.attempts_left;
  return `<li class="${cls}" data-stage="${stage.id}"><div class="tl-mark" aria-hidden="true">${MARK[st] ? icon(MARK[st]) : i + 1}</div>
    <div class="tl-card"><div class="tl-top"><h3><span class="mute">${t('tl.stage')} ${i + 1} ·</span> ${esc(stage.name)}</h3>${isCurrent ? `<span class="badge teal">${t('tl.current')}</span>` : ''}${['done', 'review', 'changes', 'rejected', 'locked'].includes(st) || (role === 'student' && e.display_status === stage.phase) ? '' : stateBadge(stage.phase)}${dsBadge(e, role)}${e.late ? lateBadge() : ''}${rem}</div>
      <div class="tl-meta"><span>${icon('calendar')} ${t('startDate')}: ${stage.start_date ? fmtDay(stage.start_date) : '—'}</span><span>${icon('flag')} ${t('deadlineShort')}: ${stage.deadline ? fmtDay(stage.deadline) : '—'}</span>
        <span>${icon('award')} ${t('maxGrade')}: ${num(stage.max_grade)}</span><span>${icon('upload')} ${t('tl.sub')}: ${e.attempts ? t('tl.attempts', { n: e.attempts }) : t('st.not_submitted')}</span>
        <span>${icon('message')} ${t('tl.fb')}: ${hasFeedback ? t('tl.fbYes') : t('tl.fbNo')}</span></div>
      ${na ? `<div class="tl-next">${icon('arrow')}<span>${na}</span></div>` : ''}
      ${st === 'locked' ? `<p class="small mute" style="margin:8px 0 0">${icon('lock')} ${t('tl.locked')}</p>`
        : role === 'student' && e.problem && !e.can_submit && st !== 'done' && st !== 'review' ? `<p class="small mute" style="margin:8px 0 0">${icon('info')} ${esc(tErr(e.problem))}</p>` : ''}
      <div style="margin-top:8px"><button class="link" data-toggle="${stage.id}" aria-expanded="${expanded}">${expanded ? t('tl.hide') : t('tl.show')} ${icon('down')}</button></div>
      ${expanded ? `<div class="tl-details">${stage.description ? `<p>${esc(stage.description)}</p>` : ''}${stage.instructions ? `<p class="small"><b>${t('requirements')}:</b> ${esc(stage.instructions)}</p>` : ''}
        <p class="small mute">${t('limits', { f: stage.formats.join(', '), mb: num(stage.max_file_mb) })} · ${t('attemptsLeft', { n: attemptsLeft })}</p>
        <h4>${t('sdGrade')}</h4>${gradeBlock(e, role)}
        <h4 style="margin-top:16px">${t('versionsFeedback')}</h4>${e.submissions.length ? e.submissions.map(s => submissionHtml(s, role)).join('') : `<p class="small mute">${t('noSubmissions')}</p>`}
        ${role === 'supervisor' && latest && !latest.replaced ? `<div class="gradebox"><b class="small">${t('decide')} — ${t('attempt')} ${latest.attempt_no}</b>
          <label for="rc${stage.id}">${t('feedback')}</label><textarea id="rc${stage.id}" data-rcomment placeholder="${t('commentPh')}"></textarea>
          ${latest.status === 'submitted' && !stage.grades_locked ? `<div style="margin-top:8px"><span class="small"><b>${t('rv.gradeNow')}</b></span><div class="row" style="margin-top:6px">${gradeInputs(e, 'a')}
            <label class="inl small"><input type="checkbox" data-apub checked> ${t('rv.publish')}</label></div></div>` : ''}
          ${e.phase === 'active' ? `<p class="hint">${icon('info')} ${t('rv.nextOn')}</p>` : ''}
          <div class="row" style="margin-top:8px"><button class="ok" data-rd="approve">${icon('check')} ${t('approveSub')}</button><button class="warn" data-rd="request_changes">${icon('edit')} ${t('requestChangesSub')}</button><button class="bad" data-rd="reject">${icon('x')} ${t('rejectSub')}</button>
          <label class="inl small"><input type="checkbox" data-rallow> ${t('allowResubmitNow')}</label></div><p class="hint">${t('rejectHint')}</p></div>` : ''}
        ${role === 'student' && (e.can_submit || e.can_replace) ? submitBoxHtml(e) : ''}</div>` : ''}
    </div></li>`;
}

// Renders all (or one) stage cards of a research into `el`. `after` is called when data changed (default: re-render in place).
export async function renderResearchStages(el, researchId, { role, onlyStageId = null, after = null } = {}) {
  const data = await api('GET', `/research/${researchId}/stages`);
  const list = data.stages.filter(e => !onlyStageId || e.stage.id === onlyStageId);
  const tot = data.totals;
  // the current stage: the first one that is not finished/closed
  const curIdx = list.findIndex(e => !['done', 'closed'].includes(tlState(e)));
  const refresh = async () => { if (after) after(); else await renderResearchStages(el, researchId, { role, onlyStageId }); };
  const isOpen = (e, i) => state.stOpen.has(openKey(researchId, e.stage.id)) || (onlyStageId != null) || (i === curIdx && !state.stClosed?.has(openKey(researchId, e.stage.id)));
  el.innerHTML = `${tot.stages ? `<div class="row small" style="margin-bottom:14px;gap:16px"><span>${icon('award')} ${t('accumulated')}: <b>${num(tot.earned)} / ${num(tot.total_max)}</b>${tot.percent != null ? ` (${tot.percent}%)` : ''}</span><span>${icon('layers')} ${t('stagesProgress')}: <b>${tot.approved}/${tot.stages}</b></span>
      <span class="grow" style="max-width:240px">${progress(tot.stages ? tot.approved / tot.stages * 100 : 0)}</span></div>` : ''}
    ${list.length ? `<ol class="timeline">${list.map((e, i) => cardHtml(e, i, role, researchId, i === curIdx, isOpen(e, i))).join('')}</ol>` : empty({ ic: 'layers', title: t('noStages'), text: t('tl.noStagesD') })}`;
  state.stClosed ??= new Set();
  el.querySelectorAll('[data-toggle]').forEach(b => b.onclick = () => {
    const k = openKey(researchId, Number(b.dataset.toggle)), open = b.getAttribute('aria-expanded') === 'true';
    if (open) { state.stOpen.delete(k); state.stClosed.add(k); } else { state.stOpen.add(k); state.stClosed.delete(k); }
    renderResearchStages(el, researchId, { role, onlyStageId, after });
  });
  el.querySelectorAll('[data-sdl]').forEach(b => b.onclick = () => downloadPath(`/api/stage-submissions/${b.dataset.sdl}/file`, b.dataset.name));
  el.querySelectorAll('[data-sfdl]').forEach(b => b.onclick = () => downloadPath(`/api/stage-submission-files/${b.dataset.sfdl}/file`, b.dataset.name));
  el.querySelectorAll('[data-view]').forEach(b => b.onclick = () => viewPath(b.dataset.view, b.dataset.name));
  list.forEach((e, i) => {
    const b = el.querySelector(`[data-stage="${e.stage.id}"]`); if (!b || !isOpen(e, i)) return;
    const latest = e.submissions[0];
    b.querySelectorAll('[data-cmtbtn]').forEach(btn => btn.onclick = act(async () => {
      await api('POST', `/stage-submissions/${btn.dataset.cmtbtn}/review`, { decision: 'comment', comment: b.querySelector(`[data-cmt="${btn.dataset.cmtbtn}"]`).value }); await refresh();
    }, 'toast.note'));
    b.querySelectorAll('[data-rd]').forEach(btn => btn.onclick = act(async () => {
      const decision = btn.dataset.rd, comment = b.querySelector('[data-rcomment]').value.trim();
      if (decision !== 'approve' && !comment) { b.querySelector('[data-rcomment]').focus(); throw new Error(t('rejectHint')); }
      const tone = decision === 'approve' ? 'ok' : decision === 'reject' ? 'bad' : 'warn';
      if (!await confirmDialog({ title: t('cf.' + decision), text: t('cf.sub', { a: latest.attempt_no, s: e.stage.name }), confirm: t('cf.' + decision + '.btn'), tone })) return;
      const body = { decision, comment, allowResubmit: b.querySelector('[data-rallow]').checked };
      // optional grade entered together with the approval
      if (decision === 'approve') {
        const vals = e.criteria.length ? e.criteria.map(c => ({ id: c.id, score: b.querySelector(`[data-acrit="${c.id}"]`)?.value ?? '' })) : null;
        const score = b.querySelector('[data-ascore]')?.value ?? '';
        if (vals ? vals.some(v => v.score !== '') : score !== '') body.grade = { ...(vals ? { criteria: vals } : { score }), comment, publish: !!b.querySelector('[data-apub]')?.checked };
      }
      const res = await api('POST', `/stage-submissions/${latest.id}/review`, body);
      toast(res.next_stage ? t('toast.next', { s: res.next_stage.name }) : t('toast.review'));
      await refresh();
    }));
    const gb = b.querySelector('[data-savegrade]');
    if (gb) gb.onclick = act(async () => {
      const body = { comment: b.querySelector('[data-gcomment]').value, publish: b.querySelector('[data-gpub]').checked };
      if (e.criteria.length) body.criteria = e.criteria.map(c => ({ id: c.id, score: b.querySelector(`[data-crit="${c.id}"]`).value }));
      else body.score = b.querySelector('[data-score]').value;
      await api('PUT', `/stages/${e.stage.id}/targets/${researchId}/grade`, body); await refresh();
    }, 'toast.gradeStage');
    const pt = b.querySelector('[data-pubtoggle]');
    if (pt) pt.onclick = act(async () => { await api('PUT', `/stages/${e.stage.id}/targets/${researchId}/publish`, { published: pt.dataset.pubtoggle === '1' }); await refresh(); }, 'toast.gradeStage');
    const sb = b.querySelector('[data-submit]');
    if (sb) bindSubmitBox(b, e, researchId, sb, refresh);
  });
}

// Multi-file picker: each chosen file is listed (view in a new tab, remove) before anything is sent. The submission
// carries a token made once per box, so a double click or a retried request is stored only once.
function bindSubmitBox(b, e, researchId, sb, refresh) {
  const box = b.querySelector('[data-subbox]'), replace = box.dataset.subbox === 'replace', max = e.stage.max_files ?? 1;
  const files = [], urls = new Map(), token = crypto.randomUUID?.() ?? String(Date.now()) + Math.random();
  const list = box.querySelector('[data-flist]');
  const paint = () => {
    list.innerHTML = files.length ? `<span class="small mute">${t('sb.files')} (${files.length}/${max})</span>${files.map((f, i) => `<div class="dz-file">${icon('file')}<div class="meta"><b dir="ltr">${esc(f.name)}</b><span class="small mute">${fmtBytes(f.size)}</span></div>
      <a class="ghost sm btn" href="${urls.get(f)}" target="_blank" rel="noopener">${icon('eye')} ${t('sb.view')}</a><button type="button" class="icon" data-rmf="${i}" aria-label="${t('dz.remove')}" data-tip="${t('dz.remove')}">${icon('x')}</button></div>`).join('')}` : '';
    list.querySelectorAll('[data-rmf]').forEach(x => x.onclick = () => { const [f] = files.splice(Number(x.dataset.rmf), 1); URL.revokeObjectURL(urls.get(f)); urls.delete(f); paint(); });
    sb.disabled = !files.length;
    box.querySelector('.dz-wrap').hidden = files.length >= max;
  };
  const dz = bindDropzone(b, 'z' + e.stage.id, { formats: e.stage.formats, maxMb: e.stage.max_file_mb, onChange: f => {
    if (!f) return;
    if (files.length < max && !files.some(x => x.name === f.name && x.size === f.size)) { files.push(f); urls.set(f, URL.createObjectURL(f)); }
    dz.clear(); paint();
  } });
  const prog = pct => { const p = box.querySelector('[data-fprog]'); p.hidden = false; p.querySelector('.bar i').style.width = pct + '%'; p.querySelector('[data-fpl]').textContent = t('dz.uploading', { p: Math.round(pct) }); };
  sb.onclick = act(async () => {
    if (!files.length) throw new Error(t('chooseFile'));
    const ok = await confirmDialog(replace ? { title: t('sb.replaceT'), text: t('sb.replaceD'), confirm: t('sb.replaceBtn'), tone: 'warn' }
      : { title: t('sb.confirmT', { s: e.stage.name }), text: t('sb.confirmD', { n: files.length }), confirm: t('sb.confirm'), tone: 'ok' });
    if (!ok) return;
    sb.disabled = true;
    try {
      prog(2);
      const payload = { researchId, files: await Promise.all(files.map(async f => ({ filename: f.name, data: await readFile(f) }))), note: b.querySelector('[data-note]').value, clientToken: token, replace };
      const res = await apiUpload('POST', `/stages/${e.stage.id}/submissions`, payload, prog);
      toast(res.duplicate ? t('sb.dupe') : replace ? t('toast.replaced') : t('toast.submittedStage'));
      urls.forEach(u => URL.revokeObjectURL(u));
      await refresh();
    } finally { if (sb.isConnected) sb.disabled = !files.length; }
  });
  paint();
}

// Activity history: one readable line per audit entry (action in words + the details that matter).
const AU_ICON = { topic: 'edit', stage: 'layers', workflow: 'activity', final: 'award', message: 'message', team: 'users' };
export function auditItem(x) {
  const d = x.detail ?? {}, bits = [];
  if (x.stage) bits.push(x.stage);
  if (x.who) bits.push(x.who + (x.title ? ` — ${x.title}` : ''));
  if (d.attempt) bits.push(t('attempt') + ' ' + d.attempt);
  if (d.from != null || d.to != null) bits.push(`${t('grade')}: ${d.from ?? '—'} → ${d.to ?? '—'}`);
  else if (d.score != null) bits.push(`${t('grade')}: ${d.score}`);
  if (Array.isArray(d.files) && d.files.length) bits.push(d.files.join('، '));
  else if (d.file) bits.push(d.file);
  if (d.deadline) bits.push(`${t('deadlineShort')}: ${d.deadline}`);
  if (d.late) bits.push(t('late'));
  if (d.name && !x.stage) bits.push(d.name);
  if (d.comment) bits.push(`«${String(d.comment).slice(0, 140)}»`);
  const key = 'au.' + x.action, label = t(key);
  return { at: x.created_at, who: x.actor, ic: AU_ICON[x.action.split('.')[0]] ?? 'clock', text: label === key ? x.action : label, sub: bits.join(' · ') };
}
