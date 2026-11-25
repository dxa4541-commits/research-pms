// Research stages as a timeline: status, deadlines, submission history, grading and review (supervisor), submitting (student).
// Shared by the research details page, the student's stages page and the supervisor's stage page.
import { esc, t, tErr, badge, fmtDate, fmtDay, api, apiUpload, downloadPath, readFile, act, state, toast } from '../core.js';
import { icon, num, progress, remBadge, remaining, confirmDialog, dropzoneHtml, bindDropzone, empty, fmtBytes, avatar } from '../ui.js';

export const stateBadge = s => `<span class="badge ${s}">${t('state.' + s)}</span>`;
const lateBadge = () => `<span class="badge overdue">${icon('alert')}${t('late')}</span>`;
const dsBadge = (e, role) => role === 'student' ? `<span class="badge ${e.display_status}">${t('ds.' + e.display_status)}</span>` : badge(e.status);

// timeline state of one entry (done | review | changes | rejected | overdue | closed | upcoming | open)
export function tlState(e) {
  if (e.status === 'approved') return 'done';
  if (e.status === 'rejected') return 'rejected';
  if (e.status === 'changes_requested') return 'changes';
  if (e.status === 'submitted') return 'review';
  if (e.stage.state === 'closed') return 'closed';
  if (e.late && e.missing) return 'overdue';
  return ['upcoming', 'scheduled', 'postponed'].includes(e.stage.phase) ? 'upcoming' : 'open';
}
const MARK = { done: 'check', review: 'clock', changes: 'edit', rejected: 'x', overdue: 'alert', closed: 'lock' };

const openKey = (rid, sid) => `${rid}:${sid}`;
state.stOpen ??= new Set();

function submissionHtml(sub, role) {
  return `<div class="ver"><div class="row"><b class="grow">${t('attempt')} ${sub.attempt_no}</b>${sub.late ? lateBadge() : ''}${badge(sub.status)}</div>
    <div class="small mute" style="margin:4px 0 8px">${fmtDate(sub.created_at)}${sub.by ? ` · ${t('byWhom')} ${esc(sub.by)}` : ''}</div>
    <button class="ghost sm" data-sdl="${sub.id}" data-name="${esc(sub.filename)}">${icon('download')} <span dir="ltr">${esc(sub.filename)}</span> · ${fmtBytes(sub.size)}</button>
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

function cardHtml(e, i, role, rid, isCurrent, expanded) {
  const { stage } = e, st = tlState(e), rem = stage.deadline && !['done', 'closed'].includes(st) ? remBadge(stage.deadline) : '';
  const cls = ['tl-item', st === 'done' ? 'done' : st, isCurrent ? 'current' : ''].join(' ');
  const latest = e.submissions[0], hasFeedback = e.submissions.some(s => s.reviews.some(v => v.comment));
  const na = nextAction(e, role, st);
  const attemptsLeft = e.attempts_left == null ? t('unlimited') : e.attempts_left;
  return `<li class="${cls}" data-stage="${stage.id}"><div class="tl-mark" aria-hidden="true">${MARK[st] ? icon(MARK[st]) : i + 1}</div>
    <div class="tl-card"><div class="tl-top"><h3><span class="mute">${t('tl.stage')} ${i + 1} ·</span> ${esc(stage.name)}</h3>${isCurrent ? `<span class="badge teal">${t('tl.current')}</span>` : ''}${['done', 'review', 'changes', 'rejected'].includes(st) ? '' : stateBadge(stage.phase)}${dsBadge(e, role)}${e.late ? lateBadge() : ''}${rem}</div>
      <div class="tl-meta"><span>${icon('calendar')} ${t('startDate')}: ${stage.start_date ? fmtDay(stage.start_date) : '—'}</span><span>${icon('flag')} ${t('deadlineShort')}: ${stage.deadline ? fmtDay(stage.deadline) : '—'}</span>
        <span>${icon('award')} ${t('maxGrade')}: ${num(stage.max_grade)}</span><span>${icon('upload')} ${t('tl.sub')}: ${e.attempts ? t('tl.attempts', { n: e.attempts }) : t('st.not_submitted')}</span>
        <span>${icon('message')} ${t('tl.fb')}: ${hasFeedback ? t('tl.fbYes') : t('tl.fbNo')}</span></div>
      ${na ? `<div class="tl-next">${icon('arrow')}<span>${na}</span></div>` : ''}
      ${role === 'student' && e.problem && !e.can_submit && st !== 'done' && st !== 'review' ? `<p class="small mute" style="margin:8px 0 0">${icon('info')} ${esc(tErr(e.problem))}</p>` : ''}
      <div style="margin-top:8px"><button class="link" data-toggle="${stage.id}" aria-expanded="${expanded}">${expanded ? t('tl.hide') : t('tl.show')} ${icon('down')}</button></div>
      ${expanded ? `<div class="tl-details">${stage.description ? `<p>${esc(stage.description)}</p>` : ''}${stage.instructions ? `<p class="small"><b>${t('requirements')}:</b> ${esc(stage.instructions)}</p>` : ''}
        <p class="small mute">${t('limits', { f: stage.formats.join(', '), mb: num(stage.max_file_mb) })} · ${t('attemptsLeft', { n: attemptsLeft })}</p>
        <h4>${t('sdGrade')}</h4>${gradeBlock(e, role)}
        <h4 style="margin-top:16px">${t('versionsFeedback')}</h4>${e.submissions.length ? e.submissions.map(s => submissionHtml(s, role)).join('') : `<p class="small mute">${t('noSubmissions')}</p>`}
        ${role === 'supervisor' && latest ? `<div class="gradebox"><b class="small">${t('decide')} — ${t('attempt')} ${latest.attempt_no}</b>
          <label for="rc${stage.id}">${t('feedback')}</label><textarea id="rc${stage.id}" data-rcomment placeholder="${t('commentPh')}"></textarea>
          <div class="row" style="margin-top:8px"><button class="ok" data-rd="approve">${icon('check')} ${t('approveSub')}</button><button class="warn" data-rd="request_changes">${icon('edit')} ${t('requestChangesSub')}</button><button class="bad" data-rd="reject">${icon('x')} ${t('rejectSub')}</button>
          <label class="inl small"><input type="checkbox" data-rallow> ${t('allowResubmitNow')}</label></div><p class="hint">${t('rejectHint')}</p></div>` : ''}
        ${role === 'student' && e.can_submit ? `<div class="gradebox"><b class="small">${t('submitStageTitle')}</b><div style="margin-top:8px">${dropzoneHtml('z' + stage.id, { formats: stage.formats, maxMb: stage.max_file_mb })}</div>
          <label for="nt${stage.id}">${t('submitNote')}</label><input id="nt${stage.id}" data-note maxlength="1000"><p class="row" style="margin-top:10px"><button data-submit disabled>${icon('upload')} ${t('upload')}</button>
          <span class="small mute">${t('tl.attemptNo', { n: e.attempts + 1 })}</span></p></div>` : ''}</div>` : ''}
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
      await api('POST', `/stage-submissions/${latest.id}/review`, { decision, comment, allowResubmit: b.querySelector('[data-rallow]').checked }); await refresh();
    }, 'toast.review'));
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
    if (sb) {
      const dz = bindDropzone(b, 'z' + e.stage.id, { formats: e.stage.formats, maxMb: e.stage.max_file_mb, onChange: f => { sb.disabled = !f; } });
      sb.onclick = act(async () => {
        const f = dz.file(); if (!f) throw new Error(t('chooseFile'));
        sb.disabled = true;
        try {
          dz.progress(2);
          await apiUpload('POST', `/stages/${e.stage.id}/submissions`, { researchId, filename: f.name, data: await readFile(f), note: b.querySelector('[data-note]').value }, dz.progress);
          toast(t('toast.submittedStage')); await refresh();
        } finally { if (sb.isConnected) sb.disabled = !dz.file(); }
      });
    }
  });
}
