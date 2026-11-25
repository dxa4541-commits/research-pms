// Internal messaging: supervisor <-> team/student private threads, announcements and reminders.
import { $, esc, t, state, api, downloadPath, readFile, act, render, fmtDate, toast } from '../core.js';
import { icon, avatar, pageHeader, empty } from '../ui.js';

const kindTag = k => k === 'message' ? '' : `<span class="badge ${k === 'reminder' ? 'warn' : 'info'}">${t(k === 'reminder' ? 'kindReminder' : 'kindAnnouncement')}</span> `;
// "Unread" is tracked per device: the id of the last message seen in each conversation.
const seenKey = () => `msgSeen:${state.user.id}`;
const getSeen = () => { try { return JSON.parse(localStorage.getItem(seenKey()) ?? '{}'); } catch { return {}; } };
const setSeen = (k, id) => { try { const s = getSeen(); s[k] = Math.max(s[k] ?? 0, id); localStorage.setItem(seenKey(), JSON.stringify(s)); } catch { /* storage blocked: indicator only */ } };

export async function renderMessages(view) {
  const sup = state.user.role === 'supervisor';
  const threads = await api('GET', '/messages/threads');
  const seen = getSeen();
  const isUnread = th => th.last && th.last.sender_id !== state.user.id && th.last.id > (seen[th.key] ?? 0);
  const cur = threads.find(th => th.key === state.thread) ?? (state.thread === 'new' && sup ? null : threads[0]);
  const composing = sup && state.thread === 'new';
  if (cur && !composing) state.thread = cur.key;
  const tq = th => th.team_id ? `team=${th.team_id}` : `student=${th.student_id}`;
  const q = th => sup ? tq(th) : `supervisor=${th.supervisor_id}&${tq(th)}`;
  const msgs = cur && !composing ? await api('GET', `/messages?${q(cur)}`) : [];
  if (cur && msgs.length) setSeen(cur.key, msgs[msgs.length - 1].id);
  const stages = sup ? await api('GET', '/stages') : [];
  let subs = [];
  if (sup && cur?.research_id && !composing) subs = (await api('GET', `/research/${cur.research_id}/stages`)).stages.flatMap(e => e.submissions.map(s => ({ ...s, stage_id: e.stage.id, stage: e.stage.name })));

  const side = `<aside class="card threads" aria-label="${t('conversations')}"><div class="card-h"><h3>${t('conversations')}</h3></div>
    ${sup ? `<button class="ghost block" id="newann" style="margin-bottom:10px">${icon('plus')} ${t('newAnnouncement')}</button>` : ''}
    ${threads.length ? threads.map(th => `<div class="thread ${th.key === state.thread && !composing ? 'on' : ''}" data-th="${th.key}" tabindex="0" role="button" aria-label="${esc(th.name)}">${avatar(th.name)}<div class="t"><b class="ellip">${esc(th.name)}${!sup && th.team ? ` <span class="mute small">· ${esc(th.team)}</span>` : ''}</b>
      <div class="small mute ellip">${sup ? (th.team_id ? esc(th.members.join('، ')) : t('individual')) : t('toSupervisor')}</div>${th.last ? `<div class="small ${isUnread(th) ? '' : 'mute'} ellip" ${isUnread(th) ? 'style="font-weight:700"' : ''}>${esc(th.last.body)}</div>` : ''}</div>
      ${isUnread(th) ? `<span class="unread-dot" role="img" aria-label="${t('msg.unread')}"></span>` : ''}</div>`).join('') : empty({ ic: 'message', title: t('noConversations'), text: t('msg.emptyD') })}</aside>`;

  let main;
  if (composing) {
    main = `<section class="card"><h3>${icon('send')} ${t('newAnnouncement')}</h3><form id="af">
      <label>${t('recipients')}</label><div class="checks"><label><input type="checkbox" id="all"> <b>${t('allRecipients')}</b></label>
        ${threads.map(th => `<label><input type="checkbox" data-tg="${th.key}"> ${esc(th.name)} <span class="mute small">${th.team_id ? esc(th.members.join('، ')) : t('individual')}</span></label>`).join('')}</div>
      <div class="field-row"><div><label for="ak">${t('msg.kind')}</label><select id="ak"><option value="announcement">${t('kindAnnouncement')}</option><option value="reminder">${t('kindReminder')}</option></select></div>
        <div><label for="as">${t('linkStage')}</label><select id="as"><option value="">${t('noLink')}</option>${stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div></div>
      <label for="ab">${t('typeMessage')}</label><textarea id="ab" required maxlength="4000"></textarea>
      <label for="af2">${t('attach')}</label><input type="file" id="af2" accept=".pdf,.doc,.docx"><p><button>${icon('send')} ${t('send')}</button></p></form></section>`;
  } else if (!cur) main = `<section class="card">${empty({ ic: 'message', title: t('pickConversation') })}</section>`;
  else {
    main = `<section class="card"><div class="card-h"><div class="member" style="padding:0">${avatar(cur.name, 'lg')}<div class="t"><h3 style="margin:0">${esc(cur.name)}</h3><span class="small mute">${sup ? (cur.team_id ? esc(cur.members.join('، ')) : t('individual')) : esc(cur.team ?? '')}</span></div></div></div>
      <p class="small mute">${icon('lock')} ${t('privateNote')}</p>
      <div class="msgs" id="msgs" role="log" aria-live="polite">${msgs.length ? msgs.map(m => `<div class="msg ${m.sender_id === state.user.id ? 'mine' : ''}"><div class="tiny mute">${esc(m.sender)} · ${fmtDate(m.created_at)}</div>
        <div>${kindTag(m.kind)}${esc(m.body).replace(/\n/g, '<br>')}</div>${m.stage ? `<div class="tiny mute">${icon('layers')} ${t('linkedStage')}: ${esc(m.stage)}${m.submission_id ? ` · ${t('linkedSub')} #${m.submission_id}` : ''}</div>` : ''}
        ${m.filename ? `<button class="ghost sm" data-mf="${m.id}" data-name="${esc(m.filename)}" style="margin-top:6px">${icon('paperclip')} <span dir="ltr">${esc(m.filename)}</span></button>` : ''}</div>`).join('') : `<span class="mute">${t('dNoMsgs')}</span>`}</div>
      <form id="mf"><label for="mb" class="sr-only">${t('typeMessage')}</label><textarea id="mb" required maxlength="4000" placeholder="${t('typeMessage')}" style="min-height:70px"></textarea>
        <div class="row" style="margin-top:8px">${sup ? `<select id="ls" aria-label="${t('linkStage')}"><option value="">${t('linkStage')}: ${t('noLink')}</option>${stages.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select>
          <select id="lu" aria-label="${t('linkSub')}"><option value="">${t('linkSub')}: ${t('noLink')}</option>${subs.map(s => `<option value="${s.id}" data-stage="${s.stage_id}">${esc(s.stage)} — ${t('attempt')} ${s.attempt_no}</option>`).join('')}</select>` : ''}
          <input class="grow" type="file" id="mfile" accept=".pdf,.doc,.docx" title="${t('attach')}" aria-label="${t('attach')}"><button>${icon('send')} ${t('send')}</button></div></form></section>`;
  }
  view.innerHTML = `${pageHeader({ title: t('messagesTitle'), sub: t('msg.sub') })}<div class="msgwrap">${side}<div>${main}</div></div>`;
  const pick = el => { state.thread = el.dataset.th; render(); };
  view.querySelectorAll('[data-th]').forEach(el => { el.onclick = () => pick(el); el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(el); } }; });
  $('#newann')?.addEventListener('click', () => { state.thread = 'new'; render(); });
  view.querySelectorAll('[data-mf]').forEach(b => b.onclick = () => downloadPath(`/api/messages/${b.dataset.mf}/file`, b.dataset.name));
  const box = $('#msgs'); if (box) box.scrollTop = box.scrollHeight;
  const fileOf = async inp => { const f = inp.files[0]; return f ? { filename: f.name, data: await readFile(f) } : {}; };
  if ($('#mf')) $('#mf').onsubmit = act(async e => {
    e.preventDefault();
    const body = { body: $('#mb').value, ...(await fileOf($('#mfile'))) };
    if (sup) { Object.assign(body, cur.team_id ? { teamId: cur.team_id } : { studentId: cur.student_id }); if ($('#ls').value) body.stageId = Number($('#ls').value); if ($('#lu').value) body.submissionId = Number($('#lu').value); }
    else Object.assign(body, { supervisorId: cur.supervisor_id }, cur.team_id ? { teamId: cur.team_id } : { studentId: cur.student_id });
    await api('POST', '/messages', body); render();
  }, 'messageSent');
  $('#lu')?.addEventListener('change', () => { const o = $('#lu').selectedOptions[0]; if (o.dataset.stage) $('#ls').value = o.dataset.stage; });
  if ($('#af')) $('#af').onsubmit = act(async e => {
    e.preventDefault();
    const body = { body: $('#ab').value, kind: $('#ak').value, ...(await fileOf($('#af2'))) };
    if ($('#as').value) body.stageId = Number($('#as').value);
    if ($('#all').checked) body.all = true; else body.targets = [...view.querySelectorAll('[data-tg]:checked')].map(i => i.dataset.tg);
    const r = await api('POST', '/messages/announce', body);
    toast(t('announcementSent', { n: r.sent })); state.thread = null; render();
  });
}
