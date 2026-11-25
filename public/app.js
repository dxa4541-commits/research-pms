// App shell: login screen, header, tabs and view routing.
import { $, esc, t, fmtDate, state, api, act, langBtn, bindLang, roleLabel, notifText, setRender } from './core.js';
import { renderResearchList, renderDetail, renderSubmit, renderStudents } from './views/research.js';
import { renderTeams, renderReports, renderUsers, renderCourses, renderRegistrations, renderApprovedIds } from './views/admin.js';
import { renderDashboard, renderStages, renderSupervisorReports } from './views/supervisor.js';
import { renderMessages } from './views/messages.js';
import { renderRegister, renderForcedPassword } from './views/auth.js';
import { renderStudentDashboard, renderTeamPage } from './views/student.js';

// ---------- Layout ----------
const TABS = {
  student: ['studentDash', 'myTeam', 'myResearch', 'topic', 'messages'], supervisor: ['dashboard', 'research', 'stages', 'students', 'teams', 'messages', 'reports'], admin: ['reports', 'registrations', 'ids', 'users', 'courses'],
};
async function render() {
  const app = $('#app');
  if (!state.user && localStorage.getItem('token')) {
    try { state.user = await api('GET', '/me'); } catch { localStorage.removeItem('token'); }
  }
  if (!state.user) return state.screen === 'register' ? renderRegister(app) : renderLogin(app);
  if (state.user.must_change_password) return renderForcedPassword(app, render);
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
  $('#logout').onclick = act(async () => { await api('POST', '/logout'); localStorage.removeItem('token'); Object.assign(state, { user: null, screen: null, tab: null, openId: null, openStageId: null, stageForm: null, thread: null, expanded: null, notifs: [], showNotifs: false }); render(); });
  $('#bell').onclick = async () => {
    state.showNotifs = !state.showNotifs;
    if (!state.showNotifs && unread) await api('POST', '/notifications/read').catch(() => {});
    render();
  };
  document.querySelectorAll('nav button').forEach(b => b.onclick = () => { state.tab = b.dataset.tab; state.openId = null; state.openStageId = null; state.stageForm = null; render(); });
  const view = $('#view');
  const views = { myResearch: renderResearchList, research: renderResearchList, topic: renderSubmit, studentDash: renderStudentDashboard, myTeam: renderTeamPage,
    registrations: renderRegistrations, ids: renderApprovedIds, students: renderStudents,
    teams: renderTeams, reports: u.role === 'admin' ? renderReports : renderSupervisorReports, users: renderUsers, courses: renderCourses,
    dashboard: renderDashboard, stages: renderStages, messages: renderMessages };
  if (state.openId && ['myResearch', 'research'].includes(state.tab)) await renderDetail(view, state.openId);
  else await views[state.tab](view);
}

function renderLogin(app) {
  app.innerHTML = `<div class="card login"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${t('login')}</h2>${langBtn()}</div>
    <form id="f"><label for="e">${t('uidOrEmail')}</label><input id="e" type="text" required autocomplete="username" dir="ltr">
    <label for="p">${t('password')}</label><input id="p" type="password" required autocomplete="current-password" dir="ltr">
    <p><button type="submit" style="width:100%">${t('login')}</button></p></form>
    <p><button type="button" class="ghost" id="reg" style="width:100%">${t('registerLink')}</button></p>
    ${['localhost', '127.0.0.1'].includes(location.hostname) ? `<p class="small mute">${t('demo')}<br><span dir="ltr">admin@example.com / admin123<br>doctor@example.com / doctor123<br>20240001 / student123</span></p>` : ''}</div>`;
  bindLang();
  $('#reg').onclick = () => { state.screen = 'register'; render(); };
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const r = await api('POST', '/login', { email: $('#e').value, password: $('#p').value });
    localStorage.setItem('token', r.token); state.user = r.user; render();
  });
}

setRender(render);
render();
