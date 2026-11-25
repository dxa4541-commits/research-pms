// Shared helpers: i18n, formatting, API client and small UI utilities.
import { I18N, ERR_AR, ERR_AR_PATTERNS } from './i18n.js';

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- i18n ----------
export let lang = (() => { try { return localStorage.getItem('lang'); } catch (e) { return null; } })()
  || (navigator.language?.startsWith('en') ? 'en' : 'ar');
export const t = (k, p = {}) => (I18N[lang][k] ?? I18N.en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => p[n] ?? '');
let renderHandle = () => {};
export const setRender = fn => { renderHandle = fn; };
export const render = () => renderHandle();

export function setLang(l) {
  lang = l;
  try { localStorage.setItem('lang', l); }
  catch (e) { console.warn('Language preference not saved:', e.message); } // storage can be blocked (private mode); the page still works
  document.documentElement.lang = l; document.documentElement.dir = I18N[l].dir; render();
}
document.documentElement.lang = lang; document.documentElement.dir = I18N[lang].dir;
export const tErr = m => {
  if (lang !== 'ar') return m;
  if (ERR_AR[m]) return ERR_AR[m];
  for (const [re, fn] of ERR_AR_PATTERNS) { const x = m.match(re); if (x) return fn(x); }
  return m;
};
export const notifText = raw => {
  try {
    const { k, p } = JSON.parse(raw);
    return t(k, { ...p, comment: p.comment ? '— ' + p.comment : '', state: p.state ? t('state.' + p.state) : '' });
  } catch { return raw; }
};

export const badge = s => `<span class="badge ${s}">${t('st.' + s)}</span>`;
export const fmtSize = n => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB';
export const fmtDate = d => new Date(d.replace(' ', 'T') + 'Z').toLocaleString(lang === 'ar' ? 'ar' : undefined);
export const fmtDay = d => new Date(d + 'T00:00:00').toLocaleDateString(lang === 'ar' ? 'ar' : undefined);
export const dueBadge = r => r.overdue ? ` <span class="badge overdue">${t('overdue')}</span>` : '';
export const dueText = r => r.deadline ? `${fmtDay(r.deadline)}${dueBadge(r)}` : '<span class="mute">—</span>';

export const state = { user: null, tab: null, openId: null, openStageId: null, stageForm: null, thread: null, notifs: [], showNotifs: false };

export function toast(msg, err) {
  const el = $('#toast'); el.textContent = msg; el.className = 'show' + (err ? ' err' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.className = '', 3500);
}

export async function api(method, path, body) {
  const token = localStorage.getItem('token');
  const res = await fetch('/api' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path !== '/login') { localStorage.removeItem('token'); state.user = null; render(); throw new Error(tErr('Please log in')); }
  if (!res.ok) throw new Error(tErr(data.error || 'Request failed'));
  return data;
}
export const download = (id, name) => downloadPath(`/api/submissions/${id}/file`, name);
// POST/PUT with upload progress (XMLHttpRequest); resolves the parsed JSON, rejects with a translated message.
export const apiUpload = (method, path, body, onProgress = () => {}) => new Promise((resolve, reject) => {
  const x = new XMLHttpRequest(); x.open(method, '/api' + path);
  x.setRequestHeader('Content-Type', 'application/json');
  const token = localStorage.getItem('token'); if (token) x.setRequestHeader('Authorization', 'Bearer ' + token);
  x.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total * 100); };
  x.onerror = () => reject(new Error(tErr('Network error')));
  x.onload = () => {
    let data = {}; try { data = JSON.parse(x.responseText); } catch { /* empty body */ }
    if (x.status === 401) { localStorage.removeItem('token'); state.user = null; render(); return reject(new Error(tErr('Please log in'))); }
    x.status >= 200 && x.status < 300 ? resolve(data) : reject(new Error(tErr(data.error || 'Request failed')));
  };
  x.send(JSON.stringify(body));
});
export async function downloadPath(path, name) {
  const res = await fetch(path, { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
  if (!res.ok) return toast(tErr((await res.json()).error), true);
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
  a.click(); URL.revokeObjectURL(a.href);
}
export const readFile = f => new Promise((ok, no) => {
  const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1]); r.onerror = no; r.readAsDataURL(f);
});
export const act = (fn, okKey) => async (...a) => {
  try { const r = await fn(...a); if (okKey) toast(t(okKey)); return r; } catch (e) { toast(e.message, true); }
};
export const langBtn = () => `<button class="ghost langbtn" id="lang">${lang === 'ar' ? 'English' : 'العربية'}</button>`;
export const bindLang = () => { $('#lang').onclick = () => setLang(lang === 'ar' ? 'en' : 'ar'); };
export const roleLabel = r => t('role.' + r);
export const fmtDay2 = d => d ? fmtDay(d) : '—';
export const mb = n => n == null ? '' : n;
export const courseOpts = cs => cs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
