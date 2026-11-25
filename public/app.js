// App shell: login screen, header, tabs and view routing.
import { $, esc, t, fmtDate, state, api, act, langBtn, bindLang, roleLabel, notifText, setRender } from './core.js';
import { renderResearchList, renderDetail, renderSubmit, renderStudents } from './views/research.js';
import { renderTeams, renderReports, renderUsers, renderCourses } from './views/admin.js';

// ---------- Layout ----------
const TABS = {
  student: ['myResearch', 'submit'], supervisor: ['research', 'students', 'teams'], admin: ['reports', 'users', 'courses'],
};
async function render() {
  const app = $('#app');
  if (!state.user && localStorage.getItem('token')) {
    try { state.user = await api('GET', '/me'); } catch { localStorage.removeItem('token'); }
  }
  if (!state.user) return renderLogin(app);
  const u = state.user, tabs = TABS[u.role];
  if (!tabs.includes(state.tab)) state.tab = tabs[0];
  try { state.notifs = await api('GET', '/notifications'); } catch { state.notifs = []; }
  const unread = state.notifs.filter(n => !n.is_read).length;
  app.innerHTML = `
    <header>
      <h1>${t('appName')}</h1>
      <span class="small mute">${esc(u.name)} · ${roleLabel(u.role)}</span>
      <button class="ghost bell" id="bell" aria-label="${t('notifications')}">🔔${unread ? `<b>${unread}</b>` : ''}</button>
      ${langBtn()}<button class="ghost" id="logout">${t('logout')}</button>
    </header>
    ${state.showNotifs ? `<div class="card notifs">${state.notifs.length ? state.notifs.map(n =>
      `<div class="${n.is_read ? '' : 'unread'}">${esc(notifText(n.message))}<div class="small mute" style="border:0;padding:0">${fmtDate(n.created_at)}</div></div>`).join('') : `<span class="mute">${t('noNotifs')}</span>`}</div>` : ''}
    <main><nav>${tabs.map(k => `<button class="${k === state.tab ? 'on' : ''}" data-tab="${k}">${t('tab.' + k)}</button>`).join('')}</nav><div id="view"></div></main>`;
  bindLang();
  $('#logout').onclick = act(async () => { await api('POST', '/logout'); localStorage.removeItem('token'); Object.assign(state, { user: null, tab: null, openId: null, notifs: [], showNotifs: false }); render(); });
  $('#bell').onclick = async () => {
    state.showNotifs = !state.showNotifs;
    if (!state.showNotifs && unread) await api('POST', '/notifications/read').catch(() => {});
    render();
  };
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; state.openId = null; render(); });
  const view = $('#view');
  const views = { myResearch: renderResearchList, research: renderResearchList, submit: renderSubmit, students: renderStudents,
    teams: renderTeams, reports: renderReports, users: renderUsers, courses: renderCourses };
  if (state.openId && ['myResearch', 'research'].includes(state.tab)) await renderDetail(view, state.openId);
  else await views[state.tab](view);
}

function renderLogin(app) {
  app.innerHTML = `<div class="card login"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${t('login')}</h2>${langBtn()}</div>
    <form id="f"><label for="e">${t('email')}</label><input id="e" type="email" required autocomplete="username" dir="ltr">
    <label for="p">${t('password')}</label><input id="p" type="password" required autocomplete="current-password" dir="ltr">
    <p><button type="submit" style="width:100%">${t('login')}</button></p></form>
    ${['localhost', '127.0.0.1'].includes(location.hostname) ? `<p class="small mute">${t('demo')}<br><span dir="ltr">admin@example.com / admin123<br>doctor@example.com / doctor123<br>student@example.com / student123</span></p>` : ''}</div>`;
  bindLang();
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const r = await api('POST', '/login', { email: $('#e').value, password: $('#p').value });
    localStorage.setItem('token', r.token); state.user = r.user; render();
  });
}

setRender(render);
render();
