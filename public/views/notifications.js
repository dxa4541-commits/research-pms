// Notifications page (grouped, filterable) and the metadata that classifies each notification.
import { esc, t, fmtDate, state, api, act, notifText, render, lang } from '../core.js';
import { icon, empty, pageHeader } from '../ui.js';

const CATS = ['important', 'deadline', 'submission', 'feedback', 'team', 'message'];
// -> { cat, icon, tone }
export function notifMeta(n) {
  let k = ''; try { k = JSON.parse(n.message).k ?? ''; } catch { /* plain text notification */ }
  const is = (...p) => p.some(x => k === x || k.startsWith(x + '.'));
  if (is('n.registration', 'n.team.removed', 'n.team.deleted', 'n.change.rejected', 'n.rejected', 'n.stage.rejected', 'n.deadline.late')) return { cat: 'important', icon: 'alert', tone: 'bad' };
  if (is('n.deadline', 'n.stage.deadline', 'n.stage.state', 'n.deadline.soon')) return { cat: 'deadline', icon: 'clock', tone: 'warn' };
  if (is('n.submitted', 'n.version', 'n.stage.submitted', 'n.stage.resubmitted', 'n.stage.late_submission', 'n.topic.resubmitted')) return { cat: 'submission', icon: 'upload', tone: '' };
  if (is('n.approved', 'n.stage.approved', 'n.graded', 'n.stage.graded', 'n.change.approved')) return { cat: 'feedback', icon: 'checkc', tone: 'ok' };
  if (is('n.changes_requested', 'n.note', 'n.stage.changes', 'n.stage.feedback', 'n.stage.resubmit', 'n.pending')) return { cat: 'feedback', icon: 'edit', tone: 'warn' };
  if (is('n.invitation', 'n.join', 'n.team', 'n.change')) return { cat: 'team', icon: 'users', tone: 'teal' };
  if (is('n.message', 'n.announcement', 'n.reminder')) return { cat: 'message', icon: 'message', tone: 'teal' };
  return { cat: 'other', icon: 'layers', tone: '' };
}
const dayKey = d => (d || '').slice(0, 10);
const todayKey = () => new Date().toISOString().slice(0, 10);
const yesterdayKey = () => new Date(Date.now() - 864e5).toISOString().slice(0, 10);

export async function renderNotifications(view) {
  const list = await api('GET', '/notifications');
  const filter = state.nfilter ?? 'all';
  const counts = Object.fromEntries(CATS.map(c => [c, list.filter(n => notifMeta(n).cat === c).length]));
  const shown = list.filter(n => filter === 'all' || notifMeta(n).cat === filter);
  const unread = list.filter(n => !n.is_read).length;
  const groups = new Map();
  for (const n of shown) { const k = dayKey(n.created_at); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const label = k => k === todayKey() ? t('nt.today') : k === yesterdayKey() ? t('nt.yesterday') : new Date(k + 'T00:00:00').toLocaleDateString(lang === 'ar' ? 'ar' : undefined, { dateStyle: 'medium' });
  view.innerHTML = `${pageHeader({ title: t('nav.notifications'), sub: unread ? t('nt.unread', { n: unread }) : '', actions: `<button class="ghost" id="all" ${unread ? '' : 'disabled'}>${icon('check')} ${t('markAllRead')}</button>` })}
    <div class="chips" role="group" aria-label="${t('nt.filter')}" style="margin-bottom:16px"><button class="${filter === 'all' ? 'on' : ''}" data-f="all">${t('nt.all')} (${list.length})</button>
      ${CATS.map(c => `<button class="${filter === c ? 'on' : ''}" data-f="${c}">${t('nt.cat.' + c)}${counts[c] ? ` (${counts[c]})` : ''}</button>`).join('')}</div>
    ${shown.length ? [...groups].map(([k, items]) => `<div class="card"><h4 class="mute" style="text-transform:uppercase;letter-spacing:.04em">${label(k)}</h4>
      ${items.map(n => { const m = notifMeta(n); return `<div class="todo"><span class="ic ${m.tone}">${icon(m.icon)}</span><div class="t"><span>${esc(notifText(n.message))}</span><span class="tiny mute">${fmtDate(n.created_at)}${m.cat === 'other' ? '' : ' · ' + t('nt.cat.' + m.cat)}</span></div>
        ${n.is_read ? '' : `<span class="badge teal">${t('nt.new')}</span>`}</div>`; }).join('')}</div>`).join('')
      : `<div class="card">${empty({ ic: 'bell', title: t('nt.emptyT'), text: t('nt.emptyD') })}</div>`}`;
  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { state.nfilter = b.dataset.f; render(); });
  view.querySelector('#all').onclick = act(async () => { await api('POST', '/notifications/read'); render(); });
}
