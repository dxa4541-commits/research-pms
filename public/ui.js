// Reusable UI components for the redesigned interface (no dependencies).
import { esc, t, tErr, state, toast, render, getToken } from './core.js';

// ---------- Icons (24×24 stroke icons, Feather-style paths) ----------
const P = {
  home: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  tasks: '<polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>',
  inbox: '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  award: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>',
  message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  down: '<polyline points="6 9 12 15 18 9"/>', left: '<polyline points="15 18 9 12 15 6"/>', right: '<polyline points="9 18 15 12 9 6"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  file: '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  checkc: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  xc: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  arrow: '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  mail: '<path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  key: '<path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>',
  cap: '<path d="M22 10L12 5 2 10l10 5 10-5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>',
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  paperclip: '<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/>',
  dash: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="12" cy="5" r="1"/><circle cx="12" cy="19" r="1"/>',
  userPlus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>',
  userCheck: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><polyline points="16 11 18 13 22 9"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
  activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  idcard: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 16h10"/>',
  bookPlus: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><path d="M12 7v6"/><path d="M9 10h6"/>',
  sortv: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>', up: '<path d="m5 12 7-7 7 7"/><path d="M12 19V5"/>', dn: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
  fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sparkle: '<path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z"/>',
};
const FLIP = new Set(['left', 'right', 'arrow', 'send', 'logout']);
export const icon = (name, cls = '') => `<svg class="i ${FLIP.has(name) ? 'i-flip' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${P[name] ?? P.info}</svg>`;

// ---------- Small helpers ----------
export const initials = n => String(n ?? '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
export const avatar = (name, size = '') => `<span class="avatar ${size} c${[...String(name ?? '')].reduce((a, c) => a + c.charCodeAt(0), 0) % 6}" aria-hidden="true">${esc(initials(name))}</span>`;
export const fmtBytes = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.ceil(n / 1024)) + ' KB';
export const num = n => n == null ? '—' : Number.isInteger(+n) ? String(+n) : (+n).toFixed(1);
export const progress = (pct, { lg = false, tone = '' } = {}) => `<div class="bar ${lg ? 'lg' : ''} ${tone}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct ?? 0)}"><i style="width:${Math.max(0, Math.min(100, pct ?? 0))}%"></i></div>`;
export const pill = (cls, label, ic = '') => `<span class="badge ${cls}">${ic ? icon(ic) : ''}${esc(label)}</span>`;
const DAY = 86400000;
const midnight = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
// Remaining time to a YYYY-MM-DD deadline: { days, tone, text }
export function remaining(deadline) {
  if (!deadline) return { days: null, tone: 'neutral', text: '—' };
  const days = Math.round((midnight(deadline + 'T00:00:00') - midnight(new Date())) / DAY);
  if (days < 0) return { days, tone: 'bad', text: t('rem.overdue', { n: -days }) };
  if (days === 0) return { days, tone: 'warn', text: t('rem.today') };
  return { days, tone: days <= 3 ? 'warn' : 'ok', text: t('rem.left', { n: days }) };
}
export const remBadge = deadline => { const r = remaining(deadline); return deadline ? `<span class="badge ${r.tone === 'bad' ? 'overdue' : r.tone === 'warn' ? 'warn' : 'neutral'}">${icon('clock')}${esc(r.text)}</span>` : ''; };

export const pageHeader = ({ title, sub = '', actions = '' }) => `<div class="page-h"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="actions">${actions}</div></div>`;
export const empty = ({ ic = 'inbox', title, text = '', action = '' }) => `<div class="empty"><div class="ic">${icon(ic)}</div><h4>${title}</h4>${text ? `<p>${text}</p>` : ''}${action}</div>`;
export const loading = () => `<div role="status" aria-label="${t('loading')}" aria-busy="true"><div class="skel h"></div><div class="skel" style="width:24%"></div>
  <div class="stats four" style="margin-top:22px">${'<div class="skel box"></div>'.repeat(4)}</div><div class="grid g-main"><div class="skel tall"></div><div class="skel tall"></div></div></div>`;
export const errorBox = (msg, retry = true) => `<div class="card"><div class="empty"><div class="ic" style="background:var(--bad-bg);color:var(--bad-ink)">${icon('alert')}</div><h4>${t('err.title')}</h4><p>${esc(msg)}</p>${retry ? `<button data-retry>${icon('refresh')} ${t('err.retry')}</button>` : ''}</div></div>`;
export const tabsHtml = (items, active) => `<div class="tabs" role="tablist">${items.map(i => `<button role="tab" aria-selected="${i.key === active}" class="${i.key === active ? 'on' : ''}" data-tabk="${i.key}">${i.label}${i.count != null ? `<span class="count">${i.count}</span>` : ''}</button>`).join('')}</div>`;

// ---------- Breadcrumbs (set by views) ----------
export function setCrumbs(list) {
  const el = document.getElementById('crumbs'); if (!el) return;
  el.innerHTML = list.map((c, i) => i === list.length - 1 ? `<span class="cur" aria-current="page">${esc(c.label)}</span>`
    : `<button class="link" data-crumb="${i}">${esc(c.label)}</button><span class="sep" aria-hidden="true">${icon('right', 'tiny')}</span>`).join('');
  el.querySelectorAll('[data-crumb]').forEach(b => b.onclick = () => list[Number(b.dataset.crumb)].go?.());
  document.title = `${list[list.length - 1].label} · ${t('appName')}`;
}

// ---------- Dropdowns ----------
export function bindDropdowns(root) {
  root.querySelectorAll('[data-dd]').forEach(btn => {
    const menu = root.querySelector(`#${btn.dataset.dd}`);
    btn.setAttribute('aria-haspopup', 'true'); btn.setAttribute('aria-expanded', 'false');
    btn.onclick = e => { e.stopPropagation(); const open = menu.hidden; closeDropdowns(); menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) btn.dispatchEvent(new CustomEvent('dd-open')); };
  });
}
export function closeDropdowns() { document.querySelectorAll('.dd-menu').forEach(m => { m.hidden = true; }); document.querySelectorAll('[data-dd]').forEach(b => b.setAttribute('aria-expanded', 'false')); }
if (!window.__ddBound) { window.__ddBound = true; document.addEventListener('click', e => { if (!e.target.closest('.dd-menu')) closeDropdowns(); }); document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDropdowns(); }); }

// ---------- Modals ----------
let lastFocus = null;
export function modal({ title, body = '', actions = '', ic = 'info', tone = '' }) {
  lastFocus = document.activeElement;
  const back = document.createElement('div'); back.className = 'modal-back';
  back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="ic ${tone}">${icon(ic)}</div><h3 id="mt">${esc(title)}</h3><div class="mbody">${body}</div><div class="actions">${actions}</div></div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); lastFocus?.focus?.(); };
  back.addEventListener('click', e => { if (e.target === back) close(); });
  back.addEventListener('keydown', e => {
    if (e.key === 'Escape') close();
    if (e.key === 'Tab') { const f = [...back.querySelectorAll('button,input,select,textarea,[href]')].filter(x => !x.disabled); if (!f.length) return; const a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  });
  setTimeout(() => (back.querySelector('[data-autofocus]') ?? back.querySelector('button'))?.focus(), 30);
  return { el: back, close };
}
// Resolves true when confirmed.
export const confirmDialog = ({ title, text = '', confirm = t('ok'), tone = 'info', ic }) => new Promise(res => {
  const m = modal({ title, ic: ic ?? (tone === 'bad' ? 'alert' : tone === 'warn' ? 'alert' : 'info'), tone, body: `<p class="mute">${esc(text)}</p>`,
    actions: `<button class="ghost" data-no>${t('cancel')}</button><button class="${tone === 'bad' ? 'bad' : tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : ''}" data-yes data-autofocus>${esc(confirm)}</button>` });
  m.el.querySelector('[data-no]').onclick = () => { m.close(); res(false); };
  m.el.querySelector('[data-yes]').onclick = () => { m.close(); res(true); };
  m.el.addEventListener('click', e => { if (e.target === m.el) res(false); });
  m.el.addEventListener('keydown', e => { if (e.key === 'Escape') res(false); });
});
// Resolves the entered text, or null when cancelled.
export const askText = ({ title, label = '', confirm = t('ok'), required = false, placeholder = '', tone = 'info', text = '' }) => new Promise(res => {
  const m = modal({ title, tone, ic: tone === 'bad' ? 'alert' : 'edit', body: `${text ? `<p class="mute">${esc(text)}</p>` : ''}<label for="mt-in">${esc(label)}</label><textarea id="mt-in" data-autofocus placeholder="${esc(placeholder)}" maxlength="2000"></textarea><p class="hint overdue" id="mt-err" hidden>${t('err.required')}</p>`,
    actions: `<button class="ghost" data-no>${t('cancel')}</button><button class="${tone === 'bad' ? 'bad' : ''}" data-yes>${esc(confirm)}</button>` });
  m.el.querySelector('[data-no]').onclick = () => { m.close(); res(null); };
  m.el.addEventListener('click', e => { if (e.target === m.el) res(null); });
  m.el.querySelector('[data-yes]').onclick = () => {
    const v = m.el.querySelector('#mt-in').value.trim();
    if (required && !v) { m.el.querySelector('#mt-err').hidden = false; return; }
    m.close(); res(v);
  };
});

// ---------- Client-side pagination ----------
export const paginate = (items, page, per) => items.slice((page - 1) * per, page * per);
export function pagerHtml(total, page, per) {
  const pages = Math.max(1, Math.ceil(total / per)); if (total <= per) return '';
  const from = (page - 1) * per + 1, to = Math.min(total, page * per);
  const nums = []; for (let p = 1; p <= pages; p++) if (p === 1 || p === pages || Math.abs(p - page) <= 1) nums.push(p); else if (nums[nums.length - 1] !== '…') nums.push('…');
  return `<nav class="pager" aria-label="${t('pager.label')}"><span>${t('pager.range', { from, to, total })}</span><div class="row">
    <button class="ghost sm" data-pg="${page - 1}" ${page <= 1 ? 'disabled' : ''} aria-label="${t('pager.prev')}">${icon('left')}</button>
    ${nums.map(p => p === '…' ? '<span>…</span>' : `<button class="ghost sm ${p === page ? 'on' : ''}" data-pg="${p}" ${p === page ? 'aria-current="page"' : ''}>${p}</button>`).join('')}
    <button class="ghost sm" data-pg="${page + 1}" ${page >= pages ? 'disabled' : ''} aria-label="${t('pager.next')}">${icon('right')}</button></div></nav>`;
}
export const bindPager = (root, go) => root.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => go(Number(b.dataset.pg)));

// ---------- Drag & drop upload ----------
// html: place anywhere; bind with bindDropzone(root, id, { accept: ['pdf'], maxBytes, onChange })
export const dropzoneHtml = (id, { formats = [], maxMb = 10, label = t('dz.drop') } = {}) => `<div class="dz-wrap" data-dz="${id}">
  <div class="dz" tabindex="0" role="button" aria-label="${esc(label)}"><div class="ic">${icon('upload', 'lg')}</div><b>${esc(label)}</b>
  <div class="small mute"><button type="button" class="link" data-browse>${t('dz.browse')}</button></div>
  <div class="tiny mute">${t('dz.rules', { f: formats.map(f => '.' + f).join(' '), mb: maxMb })}</div></div>
  <input type="file" hidden accept="${formats.map(f => '.' + f).join(',')}"><div class="dz-sel"></div></div>`;
export function bindDropzone(root, id, { formats = [], maxMb = 10, onChange = () => {} } = {}) {
  const wrap = root.querySelector(`[data-dz="${id}"]`), zone = wrap.querySelector('.dz'), input = wrap.querySelector('input'), sel = wrap.querySelector('.dz-sel');
  let file = null;
  const show = () => {
    sel.innerHTML = file ? `<div class="dz-file">${icon('file')}<div class="meta"><b dir="ltr">${esc(file.name)}</b><span class="small mute">${fmtBytes(file.size)}</span></div><button type="button" class="icon" data-clear aria-label="${t('dz.remove')}" data-tip="${t('dz.remove')}">${icon('x')}</button></div>
      <div class="dz-prog" hidden><div class="small mute" data-pl></div>${progress(0)}</div>` : '';
    sel.querySelector('[data-clear]')?.addEventListener('click', e => { e.stopPropagation(); set(null); });
  };
  const set = f => {
    if (f) {
      const ext = f.name.split('.').pop().toLowerCase();
      if (formats.length && !formats.includes(ext)) { toast(t('dz.badType', { f: formats.join(', ') }), true); return; }
      if (f.size > maxMb * 1048576) { toast(t('dz.tooBig', { mb: maxMb }), true); return; }
    }
    file = f; show(); onChange(file);
  };
  zone.onclick = e => { if (!e.target.closest('[data-browse]')) input.click(); };
  wrap.querySelector('[data-browse]').onclick = e => { e.stopPropagation(); input.click(); };
  zone.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } };
  input.onchange = () => { set(input.files[0] ?? null); input.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => zone.addEventListener(ev, e => { e.preventDefault(); zone.classList.remove('over'); }));
  zone.addEventListener('drop', e => { const f = e.dataTransfer?.files?.[0]; if (f) set(f); });
  return {
    file: () => file, clear: () => set(null),
    progress: pct => { const p = sel.querySelector('.dz-prog'); if (!p) return; p.hidden = false; p.querySelector('.bar i').style.width = pct + '%'; p.querySelector('[data-pl]').textContent = t('dz.uploading', { p: Math.round(pct) }); },
  };
}

// run an async action on a button: disables it, shows the error toast
export const withBusy = (btn, fn) => async (...a) => { btn.disabled = true; try { return await fn(...a); } finally { if (btn.isConnected) btn.disabled = false; } };
export const go = (tab, extra = {}) => { state.tab = tab; state.openId = null; state.openStageId = null; state.stageForm = null; Object.assign(state, extra); render(); };

// ---------- Date field (locale-proof) ----------
// The browser's own <input type=date> prints its placeholder in the browser language, which scrambles in an LTR page.
// This field is a plain ISO text box (YYYY-MM-DD, always LTR) plus a calendar button that opens the native picker.
export const dateField = (id, value = '', label = '') => `<div class="datef"><input id="${id}" type="text" dir="ltr" inputmode="numeric" placeholder="YYYY-MM-DD" maxlength="10" autocomplete="off" value="${esc(value ?? '')}" ${label ? `aria-label="${esc(label)}"` : ''}>
  <button type="button" class="ghost icon" data-cal="${id}" aria-label="${t('pickDate')}" data-tip="${t('pickDate')}">${icon('calendar')}</button><input type="date" class="datef-native" tabindex="-1" aria-hidden="true" lang="en" data-for="${id}" value="${esc(value ?? '')}"></div>`;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export function bindDateFields(root) {
  root.querySelectorAll('[data-cal]').forEach(b => {
    const txt = root.querySelector('#' + b.dataset.cal), nat = root.querySelector(`[data-for="${b.dataset.cal}"]`);
    txt.addEventListener('input', () => {
      const d = txt.value.replace(/\D/g, '').slice(0, 8);
      const f = d.length > 6 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : d.length > 4 ? `${d.slice(0, 4)}-${d.slice(4)}` : d;
      if (f !== txt.value) txt.value = f;
      if (ISO.test(txt.value)) nat.value = txt.value;
    });
    nat.onchange = () => { txt.value = nat.value; };
    b.onclick = () => { nat.value = ISO.test(txt.value) ? txt.value : ''; try { nat.showPicker(); } catch { nat.focus(); } };
  });
}

// ---------- Premium stat card ----------
// accent: CSS color (var(--…)); to: data-go target for navigation (real page); desc: one-line explanation
export const statCard = ({ ic, label, value, desc = '', accent = 'var(--primary)', to = '', feature = false }) =>
  `<${to ? 'button' : 'div'} class="stat big ${to ? 'click' : ''} ${feature ? 'feature' : ''}" style="--ac:${accent}" ${to ? `data-go="${to}"` : ''}>
    <div class="top"><span class="ic">${icon(ic)}</span>${to ? `<span class="mute">${icon('arrow')}</span>` : ''}</div>
    <div><b>${value}</b><span class="l">${label}</span>${desc ? `<span class="d">${desc}</span>` : ''}</div></${to ? 'button' : 'div'}>`;

// ---------- Donut chart (SVG, real values) ----------
export function donut(segs, center = '') {
  const total = segs.reduce((a, s) => a + s.value, 0), R = 52, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = total ? segs.filter(s => s.value).map(s => { const len = s.value / total * C; const el = `<circle r="${R}" cx="64" cy="64" fill="none" style="stroke:${s.color}" stroke-width="16" stroke-dasharray="${len - 2} ${C - len + 2}" stroke-dashoffset="${-off}" stroke-linecap="butt"/>`; off += len; return el; }).join('') : '';
  return `<div class="donut-wrap"><div class="donut" role="img" aria-label="${esc(segs.map(s => `${s.label}: ${s.value}`).join(', '))}"><svg viewBox="0 0 128 128"><circle r="${R}" cx="64" cy="64" fill="none" style="stroke:rgb(var(--g) / .14)" stroke-width="16"/>${arcs}</svg>
    <div class="c"><div><b>${total}</b><span>${esc(center)}</span></div></div></div>
    <div class="legend">${segs.map(s => `<div class="li"><span class="sw" style="background:${s.color}"></span><span>${esc(s.label)}</span><span><b>${s.value}</b><span class="pc">${total ? Math.round(s.value / total * 100) : 0}%</span></span></div>`).join('')}</div></div>`;
}

// ---------- Sortable data (state-driven, for paginated tables) ----------
// sort = { key, dir: 1|-1 }; get = { key: row => value }
export function sortRows(rows, sort, get = {}) {
  if (!sort?.key) return rows;
  const f = get[sort.key] ?? (r => r[sort.key]);
  return [...rows].sort((a, b) => { const x = f(a) ?? '', y = f(b) ?? ''; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sort.dir; });
}
export const th = (label, key, sort) => key ? `<th data-sort="${key}" ${sort?.key === key ? `aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''} tabindex="0">${label}<span class="sort">${icon(sort?.key === key ? (sort.dir > 0 ? 'up' : 'dn') : 'sortv')}</span></th>` : `<th>${label}</th>`;
export function bindSort(root, stateKey, rerender) {
  root.querySelectorAll('th[data-sort]').forEach(h => {
    const go = () => { const cur = state[stateKey]; state[stateKey] = { key: h.dataset.sort, dir: cur?.key === h.dataset.sort ? -cur.dir : 1 }; rerender(); };
    h.onclick = go; h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}
// Client-side sorting for small, non-paginated tables (whole table is in the DOM).
export function enhanceTables(root) {
  root.querySelectorAll('table').forEach(tbl => {
    if (tbl.dataset.enhanced || tbl.querySelector('th[data-sort]') || tbl.querySelector('.exprow')) return;
    const heads = [...tbl.querySelectorAll('thead th')], body = tbl.tBodies[0];
    if (!heads.length || !body || body.rows.length < 3) return;
    tbl.dataset.enhanced = '1';
    heads.forEach((h, i) => {
      if (!h.textContent.trim()) return;
      h.dataset.sort = String(i); h.tabIndex = 0; h.insertAdjacentHTML('beforeend', `<span class="sort">${icon('sortv')}</span>`);
      const go = () => {
        const dir = h.getAttribute('aria-sort') === 'ascending' ? -1 : 1;
        heads.forEach(x => { x.removeAttribute('aria-sort'); const s = x.querySelector('.sort'); if (s) s.innerHTML = icon('sortv'); });
        h.setAttribute('aria-sort', dir > 0 ? 'ascending' : 'descending'); h.querySelector('.sort').innerHTML = icon(dir > 0 ? 'up' : 'dn');
        const val = r => { const c = r.cells[i]; const t = (c?.dataset.v ?? c?.textContent ?? '').trim(); const n = parseFloat(t.replace(/[^\d.-]/g, '')); return /^[\d.\s/%-]+$/.test(t) && !Number.isNaN(n) ? n : t; };
        [...body.rows].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir; }).forEach(r => body.appendChild(r));
      };
      h.onclick = go; h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
  });
}

// ---------- Forms: required markers + searchable checklists ----------
export function enhanceForms(root) {
  root.querySelectorAll('input[required],select[required],textarea[required]').forEach(i => { if (i.id) root.querySelector(`label[for="${i.id}"]`)?.classList.add('req'); });
  root.querySelectorAll('.checks').forEach(box => {
    if (box.dataset.enhanced || box.querySelectorAll('label').length < 7) return;
    box.dataset.enhanced = '1';
    const f = document.createElement('div'); f.className = 'search checks-filter';
    f.innerHTML = `${icon('search')}<input type="search" placeholder="${t('filterList')}" aria-label="${t('filterList')}">`;
    box.before(f);
    f.querySelector('input').oninput = e => { const q = e.target.value.trim().toLowerCase(); box.querySelectorAll('label').forEach(l => { l.style.display = !q || l.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
  });
}

// ---------- Row action menu (kebab) ----------
// items: [{ label, ic, attrs, danger }] — attrs are data-* attributes the page binds to real actions
let ddSeq = 0;
export const rowMenu = items => { const id = `rm${++ddSeq}`; return `<div class="dd"><button class="ghost icon kebab" data-dd="${id}" aria-label="${t('actions')}" data-tip="${t('actions')}">${icon('more')}</button>
  <div class="dd-menu" id="${id}" hidden>${items.map(x => `<button ${x.attrs} class="${x.danger ? 'danger' : ''}">${icon(x.ic)} ${esc(x.label)}</button>`).join('')}</div></div>`; };

// ---------- File viewer: a panel beside the page (PDF, images, text), so a submission can be read next to the review form ----------
const VIEWABLE = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain;charset=utf-8' };
export const canView = name => String(name).split('.').pop().toLowerCase() in VIEWABLE;
let viewerUrl = null, collapsedByViewer = false;
export function closeViewer() {
  document.querySelector('.viewer')?.remove(); document.body.classList.remove('viewer-open');
  if (collapsedByViewer) { document.querySelector('#shell')?.classList.remove('collapsed'); collapsedByViewer = false; }
  if (viewerUrl) { URL.revokeObjectURL(viewerUrl); viewerUrl = null; }
}
export async function viewPath(path, name) {
  const ext = String(name).split('.').pop().toLowerCase();
  const res = await fetch(path, { headers: { Authorization: 'Bearer ' + getToken() } });
  if (!res.ok) { let m = 'Request failed'; try { m = (await res.json()).error; } catch { /* not JSON */ } return toast(tErr(m), true); }
  closeViewer();
  viewerUrl = URL.createObjectURL(new Blob([await res.arrayBuffer()], { type: VIEWABLE[ext] ?? 'application/octet-stream' }));
  const panel = document.createElement('aside');
  panel.className = 'viewer'; panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', name);
  panel.innerHTML = `<div class="viewer-h"><b class="grow" dir="ltr">${esc(name)}</b>
      <a class="btn ghost sm" href="${viewerUrl}" download="${esc(name)}" aria-label="${t('vw.download')}" data-tip="${t('vw.download')}">${icon('download')}<span class="vl">${t('vw.download')}</span></a>
      <a class="btn ghost sm" href="${viewerUrl}" target="_blank" rel="noopener" aria-label="${t('vw.newTab')}" data-tip="${t('vw.newTab')}">${icon('eye')}</a>
      <button class="ghost sm icon" data-vclose aria-label="${t('vw.close')}" data-tip="${t('vw.close')}">${icon('x')}</button></div>
    ${ext.startsWith('jp') || ext === 'png' ? `<div class="viewer-b img"><img src="${viewerUrl}" alt="${esc(name)}"></div>` : `<iframe class="viewer-b" src="${viewerUrl}" title="${esc(name)}"></iframe>`}`;
  document.body.appendChild(panel); document.body.classList.add('viewer-open');
  // give the page beside the viewer as much room as possible: fold the sidebar to icons while the viewer is open
  const shell = document.querySelector('#shell');
  if (shell && !shell.classList.contains('collapsed')) { shell.classList.add('collapsed'); collapsedByViewer = true; }
  panel.querySelector('[data-vclose]').onclick = closeViewer;
  panel.addEventListener('keydown', e => { if (e.key === 'Escape') closeViewer(); });
  panel.querySelector('[data-vclose]').focus();
}
