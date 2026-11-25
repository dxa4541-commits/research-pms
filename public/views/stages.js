// Stage entries of one research: submissions with review history, grading (supervisor) and submitting (student).
// Shared by the research detail page and the supervisor's stage page.
import { esc, t, tErr, badge, fmtDate, fmtDay, fmtSize, api, downloadPath, readFile, act } from '../core.js';

export const stateBadge = s => `<span class="badge ${s}">${t('state.' + s)}</span>`;
const statusBadge = (e, role) => role === 'student' ? `<span class="badge ${e.display_status}">${t('ds.' + e.display_status)}</span>` : badge(e.status);
const lateBadge = `<span class="badge overdue">${t('late')}</span>`;
const num = n => Number.isInteger(+n) ? String(+n) : (+n).toFixed(1);

function submissionHtml(sub, role) {
  return `<div class="ver"><div class="row"><b class="grow">${t('attempt')} ${sub.attempt_no}</b>${sub.late ? lateBadge : ''}${badge(sub.status)}
      <span class="small mute">${fmtDate(sub.created_at)}${sub.by ? ` · ${t('byWhom')} ${esc(sub.by)}` : ''}</span>
      <button class="ghost" data-sdl="${sub.id}" data-name="${esc(sub.filename)}">⬇ <span dir="ltr">${esc(sub.filename)}</span> (${fmtSize(sub.size)})</button></div>
    ${sub.student_note ? `<div class="note">${esc(sub.student_note)}</div>` : ''}
    ${sub.reviews.map(v => `<div class="note"><span class="small mute">${esc(v.reviewer)} · ${fmtDate(v.created_at)}${v.decision !== 'comment' ? ' · ' + t('st.' + (v.decision === 'approved' ? 'approved' : v.decision)) : ''}</span>${v.comment ? '<br>' + esc(v.comment) : ''}</div>`).join('')}
    ${role === 'supervisor' ? `<div class="row small" style="margin-top:6px"><input class="grow" placeholder="${t('commentPh')}" data-cmt="${sub.id}"><button class="ghost" data-cmtbtn="${sub.id}">${t('commentOnly')}</button></div>` : ''}</div>`;
}

function gradeBlock(e, role) {
  const { stage, grade, criteria } = e;
  const view = grade ? `<div class="small"><b>${t('stageGrade')}: ${num(grade.score)}/${num(stage.max_grade)}</b>${role === 'supervisor' ? ` <span class="badge ${grade.published ? 'approved' : 'closed'}">${grade.published ? t('published') : t('unpublished')}</span> <button class="ghost" data-pubtoggle="${grade.published ? 0 : 1}">${grade.published ? t('hideGrade') : t('publishGrade')}</button>` : ''}${grade.comment ? ' — ' + esc(grade.comment) : ''}
      ${criteria.length ? `<div class="mute">${criteria.map(c => `${esc(c.name)}: ${num(grade.scores.find(s => s.criterion_id === c.id)?.score ?? 0)}/${num(c.max_score)}`).join(' · ')}</div>` : ''}</div>`
    : (e.grade_pending ? `<div class="small mute">${t('gradePending')}</div>` : `<div class="small mute">${t('notGradedYet')}</div>`);
  if (role !== 'supervisor') return view;
  const dis = stage.grades_locked ? 'disabled' : '';
  return `${view}<div class="gradebox"><div class="row">
    ${criteria.length ? criteria.map(c => `<label class="inl">${esc(c.name)} <span class="mute">(${num(c.max_score)})</span>
        <input type="number" min="0" max="${c.max_score}" step="0.5" style="width:90px" data-crit="${c.id}" value="${grade?.scores.find(s => s.criterion_id === c.id)?.score ?? ''}" ${dis}></label>`).join('')
      : `<label class="inl">${t('scoreOf', { max: num(stage.max_grade) })} <input type="number" min="0" max="${stage.max_grade}" step="0.5" style="width:110px" data-score value="${grade?.score ?? ''}" ${dis}></label>`}
    </div><div class="row" style="margin-top:6px"><input class="grow" placeholder="${t('gradeComment')}" data-gcomment value="${esc(grade?.comment ?? '')}" ${dis}>
    <label class="inl small"><input type="checkbox" data-gpub ${grade?.published ? 'checked' : ''}> ${t('saveAndPublish')}</label><button data-savegrade ${dis}>${t('saveGrade')}</button>${stage.grades_locked ? `<span class="badge closed">${t('locked')}</span>` : ''}</div></div>`;
}

function entryHtml(e, role, researchId) {
  const { stage } = e, latest = e.submissions[0];
  const attemptsLeft = e.attempts_left == null ? t('unlimited') : e.attempts_left;
  return `<div class="stagebox" data-stage="${stage.id}"><div class="row"><b class="grow">${esc(stage.name)}</b>${stateBadge(stage.phase)}${statusBadge(e, role)}${e.late ? lateBadge : ''}</div>
    <p class="small mute">${t('deadlineShort')}: ${stage.deadline ? fmtDay(stage.deadline) : '—'}${stage.start_date ? ` · ${t('startDate')}: ${fmtDay(stage.start_date)}` : ''} · ${t('maxGrade')}: ${num(stage.max_grade)}
      · ${t('limits', { f: stage.formats.join(', '), mb: num(stage.max_file_mb) })} · ${t('attemptsLeft', { n: attemptsLeft })}</p>
    ${stage.description ? `<p>${esc(stage.description)}</p>` : ''}${stage.instructions ? `<p class="small"><b>${t('requirements')}:</b> ${esc(stage.instructions)}</p>` : ''}
    ${gradeBlock(e, role)}
    <h4>${t('versionsFeedback')}</h4>${e.submissions.length ? e.submissions.map(s => submissionHtml(s, role)).join('') : `<p class="small mute">${t('noSubmissions')}</p>`}
    ${role === 'supervisor' && latest ? `<div class="gradebox"><b class="small">${t('decide')} — ${t('attempt')} ${latest.attempt_no}</b>
        <textarea data-rcomment placeholder="${t('commentPh')}"></textarea>
        <div class="row"><button class="ok" data-rd="approve">${t('approveSub')}</button><button class="warn" data-rd="request_changes">${t('requestChangesSub')}</button><button class="bad" data-rd="reject">${t('rejectSub')}</button>
        <label class="inl small"><input type="checkbox" data-rallow> ${t('allowResubmitNow')}</label></div><p class="small mute">${t('rejectHint')}</p></div>` : ''}
    ${role === 'student' ? (e.can_submit ? `<div class="gradebox"><b class="small">${t('submitStageTitle')}</b><div class="row"><input class="grow" type="file" data-file accept="${stage.formats.map(f => '.' + f).join(',')}">
        <input class="grow" data-note placeholder="${t('submitNote')}" maxlength="1000"><button data-submit>${t('upload')}</button></div></div>`
      : (e.problem ? `<p class="small mute">${esc(tErr(e.problem))}</p>` : '')) : ''}</div>`;
}

// Renders all (or one) stage entries of a research into `el`. `after` is called when data changed.
export async function renderResearchStages(el, researchId, { role, onlyStageId = null, after = null } = {}) {
  const data = await api('GET', `/research/${researchId}/stages`);
  const list = data.stages.filter(e => !onlyStageId || e.stage.id === onlyStageId);
  const tot = data.totals;
  el.innerHTML = `${tot.stages ? `<p class="small mute">${t('accumulated')}: <b>${num(tot.earned)} / ${num(tot.total_max)}</b>${tot.percent != null ? ` (${tot.percent}%)` : ''} · ${t('stagesProgress')}: ${tot.approved}/${tot.stages}</p>` : ''}
    ${list.length ? list.map(e => entryHtml(e, role, researchId)).join('') : `<p class="mute">${t('noStages')}</p>`}`;
  const refresh = async () => { if (after) after(); else await renderResearchStages(el, researchId, { role, onlyStageId }); };
  const box = id => el.querySelector(`[data-stage="${id}"]`);
  el.querySelectorAll('[data-sdl]').forEach(b => b.onclick = () => downloadPath(`/api/stage-submissions/${b.dataset.sdl}/file`, b.dataset.name));
  for (const e of list) {
    const b = box(e.stage.id), latest = e.submissions[0];
    b.querySelectorAll('[data-cmtbtn]').forEach(btn => btn.onclick = act(async () => {
      await api('POST', `/stage-submissions/${btn.dataset.cmtbtn}/review`, { decision: 'comment', comment: b.querySelector(`[data-cmt="${btn.dataset.cmtbtn}"]`).value }); await refresh();
    }, 'toast.note'));
    b.querySelectorAll('[data-rd]').forEach(btn => btn.onclick = act(async () => {
      await api('POST', `/stage-submissions/${latest.id}/review`, { decision: btn.dataset.rd, comment: b.querySelector('[data-rcomment]').value, allowResubmit: b.querySelector('[data-rallow]').checked }); await refresh();
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
    if (sb) sb.onclick = act(async () => {
      const f = b.querySelector('[data-file]').files[0]; if (!f) throw new Error(t('chooseFile'));
      if (f.size > e.stage.max_file_mb * 1048576) throw new Error(tErr(`File exceeds the ${num(e.stage.max_file_mb)} MB limit`));
      sb.disabled = true;
      try { await api('POST', `/stages/${e.stage.id}/submissions`, { researchId, filename: f.name, data: await readFile(f), note: b.querySelector('[data-note]').value }); await refresh(); }
      finally { sb.disabled = false; }
    }, 'toast.submittedStage');
  }
}
