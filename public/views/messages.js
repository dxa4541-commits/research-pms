// Internal messaging: supervisor <-> team/student private threads, announcements and reminders.
import { $, esc, t, state, api, downloadPath, readFile, act, render, fmtDate, toast } from '../core.js';

const kindTag = k => k === 'message' ? '' : `<span class="badge ${k === 'reminder' ? 'changes_requested' : 'pending'}">${t(k === 'reminder' ? 'kindReminder' : 'kindAnnouncement')}</span> `;

export async function renderMessages(view) {
  const sup = state.user.role === 'supervisor';
  const threads = await api('GET', '/messages/threads');
  const keyOf = th => th.key;
  const cur = threads.find(th => keyOf(th) === state.thread) ?? (state.thread === 'new' && sup ? null : threads[0]);
  const composing = sup && state.thread === 'new';
  if (cur && !composing) state.thread = keyOf(cur);
  const tq = th => th.team_id ? `team=${th.team_id}` : `student=${th.student_id}`;
  const q = th => sup ? tq(th) : `supervisor=${th.supervisor_id}&${tq(th)}`;
  const msgs = cur && !composing ? await api('GET', `/messages?${q(cur)}`) : [];
  const stages = sup ? await api('GET', '/stages') : [];
  let subs = [];
  if (sup && cur?.research_id && !composing) subs = (await api('GET', `/research/${cur.research_id}/stages`)).stages.flatMap(e => e.submissions.map(s => ({ ...s, stage_id: e.stage.id, stage: e.stage.name })));

  const side = `<div class="card threads"><h3>${t('conversations')}</h3>
    ${sup ? `<button class="ghost" id="newann" style="width:100%;margin-bottom:8px">＋ ${t('newAnnouncement')}</button>` : ''}
    ${threads.length ? threads.map(th => `<div class="thread ${keyOf(th) === state.thread && !composing ? 'on' : ''}" data-th="${keyOf(th)}"><b>${esc(th.name)}</b>${!sup && th.team ? ` <span class="mute small">· ${esc(th.team)}</span>` : ''}
      <div class="small mute">${sup ? (th.team_id ? esc(th.members.join('، ')) : t('individual')) : t('toSupervisor')}</div>
      ${th.last ? `<div class="small mute ellip">${esc(th.last.body)}</div>` : ''}</div>`).join('') : `<span class="mute">${t('noConversations')}</span>`}</div>`;

  let main;
  if (composing) {
    main = `<div class="card"><h3>${t('newAnnouncement')}</h3><form id="af">
      <label>${t('recipients')}</label><div class="checks"><label><input type="checkbox" id="all"> <b>${t('allRecipients')}</b></label>
        ${threads.map(th => `<label><input type="checkbox" data-tg="${th.key}"> ${esc(th.name)} <span class="mute small">${th.team_id ? esc(th.members.join('، ')) : t('individual')}</span></label>`).join('')}</div>
      <div class="row"><div><label for="ak">${t('status')}</label><select id="ak"><option value="announcement">${t('kindAnnouncement')}</option><option value="reminder">${t('kindReminder')}</option></select></div>
        <div class="grow"><label for="as">${t('linkStage')}</label><select id="as"><option value="">${t('noLink')}</option>${stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div>
      <label for="ab">${t('typeMessage')}</label><textarea id="ab" required maxlength="4000"></textarea>
      <label for="af2">${t('attach')}</label><input type="file" id="af2" accept=".pdf,.doc,.docx">
      <p><button>${t('send')}</button></p></form></div>`;
  } else if (!cur) main = `<div class="card"><p class="mute">${t('pickConversation')}</p></div>`;
  else {
    main = `<div class="card"><h3>${esc(cur.name)}</h3><p class="small mute">${t('privateNote')}</p>
      <div class="msgs" id="msgs">${msgs.length ? msgs.map(m => `<div class="msg ${m.sender_id === state.user.id ? 'mine' : ''}"><div class="small mute">${esc(m.sender)} · ${fmtDate(m.created_at)}</div>
        <div>${kindTag(m.kind)}${esc(m.body).replace(/\n/g, '<br>')}</div>
        ${m.stage ? `<div class="small mute">${t('linkedStage')}: ${esc(m.stage)}${m.submission_id ? ` · ${t('linkedSub')} #${m.submission_id}` : ''}</div>` : ''}
        ${m.filename ? `<button class="ghost" data-mf="${m.id}" data-name="${esc(m.filename)}">⬇ <span dir="ltr">${esc(m.filename)}</span></button>` : ''}</div>`).join('') : `<span class="mute">${t('dNoMsgs')}</span>`}</div>
      <form id="mf"><textarea id="mb" required maxlength="4000" placeholder="${t('typeMessage')}"></textarea>
        <div class="row">${sup ? `<select id="ls"><option value="">${t('linkStage')}: ${t('noLink')}</option>${stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
          <select id="lu"><option value="">${t('linkSub')}: ${t('noLink')}</option>${subs.map(s => `<option value="${s.id}" data-stage="${s.stage_id}">${esc(s.stage)} — ${t('attempt')} ${s.attempt_no}</option>`).join('')}</select>` : ''}
          <input class="grow" type="file" id="mfile" accept=".pdf,.doc,.docx" title="${t('attach')}"><button>${t('send')}</button></div></form></div>`;
  }
  view.innerHTML = `<div class="msgwrap">${side}<div>${main}</div></div>`;
  view.querySelectorAll('[data-th]').forEach(el => el.onclick = () => { state.thread = el.dataset.th; render(); });
  if ($('#newann')) $('#newann').onclick = () => { state.thread = 'new'; render(); };
  view.querySelectorAll('[data-mf]').forEach(b => b.onclick = () => downloadPath(`/api/messages/${b.dataset.mf}/file`, b.dataset.name));
  const box = $('#msgs'); if (box) box.scrollTop = box.scrollHeight;
  const fileOf = async inp => { const f = inp.files[0]; return f ? { filename: f.name, data: await readFile(f) } : {}; };
  if ($('#mf')) $('#mf').onsubmit = act(async e => {
    e.preventDefault();
    const body = { body: $('#mb').value, ...(await fileOf($('#mfile'))) };
    if (sup) { Object.assign(body, cur.team_id ? { teamId: cur.team_id } : { studentId: cur.student_id });
      if ($('#ls').value) body.stageId = Number($('#ls').value); if ($('#lu').value) body.submissionId = Number($('#lu').value); }
    else Object.assign(body, { supervisorId: cur.supervisor_id }, cur.team_id ? { teamId: cur.team_id } : { studentId: cur.student_id });
    await api('POST', '/messages', body); render();
  }, 'messageSent');
  if ($('#lu')) $('#lu').onchange = () => { const o = $('#lu').selectedOptions[0]; if (o.dataset.stage) $('#ls').value = o.dataset.stage; };
  if ($('#af')) $('#af').onsubmit = act(async e => {
    e.preventDefault();
    const body = { body: $('#ab').value, kind: $('#ak').value, ...(await fileOf($('#af2'))) };
    if ($('#as').value) body.stageId = Number($('#as').value);
    if ($('#all').checked) body.all = true; else body.targets = [...view.querySelectorAll('[data-tg]:checked')].map(i => i.dataset.tg);
    const r = await api('POST', '/messages/announce', body);
    toast(t('announcementSent', { n: r.sent })); state.thread = null; render();
  });
}
