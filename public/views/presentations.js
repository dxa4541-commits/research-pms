// Final presentations: the instructor's schedule (create slots, assign / move / free, lock) and the student's booking.
import { $, esc, t, state, api, act, toast, render, fmtDay } from '../core.js';
import { icon, pageHeader, empty, confirmDialog, dateField, bindDateFields } from '../ui.js';

const day = s => s.starts_at.slice(0, 10), time = s => `${s.starts_at.slice(11)}–${s.ends_at}`;
const byDay = slots => slots.reduce((m, s) => { (m[day(s)] ??= []).push(s); return m; }, {});

// ---------- Instructor ----------
export async function renderPresentations(view) {
  const d = await api('GET', '/presentations' + (state.presCourse ? `?courseId=${state.presCourse}` : ''));
  state.presCourse = d.course_id;
  if (!d.course_id) { view.innerHTML = `${pageHeader({ title: t('pr.title') })}<div class="card">${empty({ ic: 'calendar', title: t('pr.noCourse') })}</div>`; return; }
  const waiting = d.research.filter(r => !r.slot_id), free = d.slots.filter(s => !s.research_id).length;
  const opts = (s) => `<option value="">${t('pr.assign')}…</option>${d.research.map(r => `<option value="${r.id}" ${s.research_id === r.id ? 'selected' : ''}>${esc(r.label)}${r.slot_id && r.slot_id !== s.id ? ' ↺' : ''}</option>`).join('')}`;
  view.innerHTML = `${pageHeader({ title: t('pr.title'), sub: t('pr.sub'), actions: `${d.courses.length > 1 ? `<select id="pc" aria-label="${t('course')}">${d.courses.map(c => `<option value="${c.id}" ${c.id === d.course_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
      <button class="${d.locked ? 'warn' : 'ghost'}" id="lock">${icon('lock')} ${d.locked ? t('pr.unlock') : t('pr.lock')}</button>` })}
    ${d.locked ? `<div class="alert warn" style="margin-bottom:14px">${icon('lock')}<p>${t('pr.lockedSup')}</p></div>` : ''}
    <div class="grid g-main" style="align-items:start"><div class="stack">
      ${d.slots.length ? Object.entries(byDay(d.slots)).map(([dd, list]) => `<section class="card"><div class="card-h"><h3>${icon('calendar')} ${fmtDay(dd)}</h3><span class="small mute">${t('pr.bookedOf', { b: list.filter(s => s.research_id).length, n: list.length })}</span></div>
        ${list.map(s => `<div class="todo"><span class="ic ${s.research_id ? 'ok' : ''}">${icon(s.research_id ? 'users' : 'clock')}</span>
          <div class="t"><b dir="ltr" style="text-align:start">${time(s)}</b><span class="small ${s.research_id ? '' : 'mute'}">${s.research_id ? `${esc(s.label)} — ${esc(s.title)}` : t('pr.free')}</span>${s.location ? `<span class="tiny mute">${icon('flag')} ${esc(s.location)}</span>` : ''}</div>
          <select data-as="${s.id}" aria-label="${t('pr.assign')}" style="max-width:190px">${opts(s)}</select>
          ${s.research_id ? `<button class="ghost sm" data-free="${s.id}">${t('pr.freeIt')}</button>` : ''}<button class="ghost sm icon" data-del="${s.id}" aria-label="${t('del')}" data-tip="${t('del')}">${icon('trash')}</button></div>`).join('')}</section>`).join('')
        : `<div class="card">${empty({ ic: 'calendar', title: t('pr.noSlots'), text: t('pr.noSlotsD') })}</div>`}
    </div><div class="stack">
      <section class="card"><h3>${icon('plus')} ${t('pr.add')}</h3><form id="sf">
        <label for="sdate">${t('pr.date')}</label>${dateField('sdate', '', t('pr.date'))}
        <div class="field-row"><div><label for="sfrom">${t('pr.from')}</label><input id="sfrom" dir="ltr" placeholder="09:00" maxlength="5" required></div><div><label for="sto">${t('pr.to')}</label><input id="sto" dir="ltr" placeholder="12:00" maxlength="5" required></div>
          <div><label for="sev">${t('pr.every')}</label><input id="sev" type="number" min="5" max="240" value="20" required></div></div>
        <label for="sloc">${t('pr.place')}</label><input id="sloc" maxlength="200" placeholder="${t('pr.placePh')}">
        <p class="hint">${t('pr.addHint')}</p><p><button>${icon('plus')} ${t('pr.create')}</button></p></form></section>
      <section class="card"><h3>${icon('users')} ${t('pr.notBooked', { n: waiting.length })}</h3>${waiting.length ? waiting.map(r => `<div class="member"><div class="t"><b>${esc(r.label)}</b><div class="tiny mute">${esc(r.title)}</div></div></div>`).join('')
        : `<p class="small mute">${d.research.length ? t('pr.allBooked') : t('pr.noResearch')}</p>`}${waiting.length && free < waiting.length ? `<p class="hint overdue">${t('pr.notEnough', { f: free })}</p>` : ''}</section>
    </div></div>`;
  bindDateFields(view);
  $('#pc')?.addEventListener('change', e => { state.presCourse = Number(e.target.value); render(); });
  $('#lock').onclick = act(async () => { await api('PUT', '/presentations/lock', { courseId: d.course_id, locked: !d.locked }); render(); });
  $('#sf').onsubmit = act(async e => {
    e.preventDefault();
    const r = await api('POST', '/presentations/slots', { courseId: d.course_id, date: $('#sdate').value, from: $('#sfrom').value.trim(), to: $('#sto').value.trim(), every: Number($('#sev').value), location: $('#sloc').value });
    toast(t('pr.created', { n: r.created })); render();
  });
  view.querySelectorAll('[data-as]').forEach(sel => sel.onchange = act(async () => {
    await api('PUT', `/presentations/slots/${sel.dataset.as}`, { researchId: sel.value ? Number(sel.value) : null }); toast(t('pr.saved')); render();
  }));
  view.querySelectorAll('[data-free]').forEach(b => b.onclick = act(async () => { await api('PUT', `/presentations/slots/${b.dataset.free}`, { researchId: null }); render(); }));
  view.querySelectorAll('[data-del]').forEach(b => b.onclick = act(async () => {
    if (!await confirmDialog({ title: t('del'), text: t('pr.confirmDel'), confirm: t('del'), tone: 'bad' })) return;
    await api('DELETE', `/presentations/slots/${b.dataset.del}`); render();
  }));
}

// ---------- Student ----------
export async function renderStudentPresentation(view) {
  const list = await api('GET', '/presentations');
  if (!list.length) { view.innerHTML = `${pageHeader({ title: t('pr.myTitle') })}<div class="card">${empty({ ic: 'calendar', title: t('pr.notYet'), text: t('pr.notYetD') })}</div>`; return; }
  view.innerHTML = `${pageHeader({ title: t('pr.myTitle'), sub: t('pr.mySub') })}${list.map(x => `<div class="stack" style="margin-bottom:20px">
    <section class="card ${x.my_slot ? '' : 'accent'}"><div class="card-h"><h3>${esc(x.title)}</h3>${x.locked ? `<span class="badge closed">${icon('lock')}${t('pr.lockedL')}</span>` : ''}</div>
      ${x.my_slot ? `<div class="tl-next">${icon('calendar')}<span><b>${t('pr.yourSlot')}:</b> ${fmtDay(day(x.my_slot))} · <span dir="ltr">${time(x.my_slot)}</span>${x.my_slot.location ? ` · ${esc(x.my_slot.location)}` : ''}</span></div>
          ${x.can_book && !x.locked ? `<p style="margin-top:10px"><button class="ghost sm" data-cancel="${x.my_slot.id}" data-r="${x.research_id}">${t('pr.cancel')}</button></p>` : ''}`
        : `<p>${x.slots.length ? (x.can_book ? (x.locked ? t('pr.lockedNoSlot') : t('pr.pick')) : t('pr.leaderBooks')) : t('pr.notYetD')}</p>`}</section>
    ${x.slots.length ? Object.entries(byDay(x.slots)).map(([dd, sl]) => `<section class="card"><h3>${icon('calendar')} ${fmtDay(dd)}</h3>${sl.map(s => `<div class="todo"><span class="ic ${s.mine ? 'ok' : s.research_id ? '' : 'teal'}">${icon(s.mine ? 'checkc' : s.research_id ? 'users' : 'clock')}</span>
      <div class="t"><b dir="ltr" style="text-align:start">${time(s)}</b><span class="small ${s.research_id ? '' : 'mute'}">${s.mine ? t('pr.you') : s.research_id ? esc(s.label) : t('pr.free')}</span>${s.location ? `<span class="tiny mute">${icon('flag')} ${esc(s.location)}</span>` : ''}</div>
      ${!s.research_id && x.can_book && !x.locked ? `<button class="sm" data-book="${s.id}" data-r="${x.research_id}">${x.my_slot ? t('pr.moveHere') : t('pr.book')}</button>` : ''}</div>`).join('')}</section>`).join('') : ''}</div>`).join('')}`;
  view.querySelectorAll('[data-book]').forEach(b => b.onclick = act(async () => {
    await api('POST', `/presentations/slots/${b.dataset.book}/book`, { researchId: Number(b.dataset.r) }); toast(t('pr.booked')); render();
  }));
  view.querySelectorAll('[data-cancel]').forEach(b => b.onclick = act(async () => {
    if (!await confirmDialog({ title: t('pr.cancel'), text: t('pr.confirmCancel'), confirm: t('pr.cancel'), tone: 'warn' })) return;
    await api('POST', `/presentations/slots/${b.dataset.cancel}/cancel`, { researchId: Number(b.dataset.r) }); render();
  }));
}
