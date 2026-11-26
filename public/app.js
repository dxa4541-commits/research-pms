// App shell: auth screens, sidebar, top bar, role-based routing.
import { $, esc, t, fmtDate, state, api, act, setRender, notifText, lang, setLang, roleLabel, theme, setTheme, getToken, clearToken, adoptSession } from './core.js';
import { icon, avatar, bindDropdowns, closeDropdowns, loading, errorBox, setCrumbs, enhanceTables, enhanceForms, closeViewer } from './ui.js';
import { renderLogin, renderRegister, renderForcedPassword } from './views/auth.js';
import { renderResearchList, renderDetail, renderSubmit, renderStudents } from './views/research.js';
import { renderTeams, renderReports, renderUsers, renderCourses, renderRegistrations, renderApprovedIds, renderAdminDashboard } from './views/admin.js';
import { renderDashboard, renderStages, renderSupervisorReports, renderReviewQueue, renderSupervisorGrades, renderProposals } from './views/supervisor.js';
import { renderPresentations, renderStudentPresentation } from './views/presentations.js';
import { renderStudentDashboard, renderTeamPage, renderTasks, renderStudentStages, renderStudentGrades } from './views/student.js';
import { renderMessages } from './views/messages.js';
import { renderNotifications, notifMeta } from './views/notifications.js';
import { renderSettings } from './views/settings.js';
import { openShare } from './views/share.js';

// ---------- Navigation per role, grouped in sections: [section, [[key, icon, label], ...]] ----------
const SECTIONS = {
  student: [['overview', [['studentDash', 'dash', 'dashboard'], ['tasks', 'tasks', 'tasks']]], ['research', [['myResearch', 'book', 'myResearch'], ['stagesS', 'layers', 'stages'], ['presentS', 'calendar', 'presentation'], ['grades', 'award', 'grades']]],
    ['collab', [['myTeam', 'users', 'team'], ['messages', 'message', 'messages']]], ['account', [['notifications', 'bell', 'notifications'], ['settings', 'settings', 'settings']]]],
  supervisor: [['overview', [['dashboard', 'dash', 'dashboard']]], ['research', [['proposals', 'fileText', 'proposals'], ['research', 'book', 'research'], ['stages', 'layers', 'stages'], ['review', 'inbox', 'review'], ['presentations', 'calendar', 'presentations'], ['grades', 'award', 'grades']]],
    ['people', [['students', 'user', 'students'], ['teams', 'users', 'teams'], ['messages', 'message', 'messages']]], ['insights', [['reports', 'chart', 'reports']]], ['account', [['notifications', 'bell', 'notifications'], ['settings', 'settings', 'settings']]]],
  admin: [['overview', [['adminDash', 'dash', 'dashboard']]], ['admission', [['registrations', 'userCheck', 'registrations'], ['ids', 'idcard', 'ids']]],
    ['management', [['users', 'users', 'users'], ['courses', 'book', 'courses'], ['research', 'fileText', 'research']]], ['insights', [['reports', 'chart', 'reports']]], ['account', [['notifications', 'bell', 'notifications'], ['settings', 'settings', 'settings']]]],
};
const NAV = Object.fromEntries(Object.entries(SECTIONS).map(([r, secs]) => [r, secs.flatMap(x => x[1])]));
const HIDDEN = { student: ['topic'], supervisor: [], admin: [] }; // routes reachable by buttons but not in the sidebar
const lsGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage blocked: preference only */ } };
state.collapsed = lsGet('sbCollapsed') === '1';
const views = {
  myResearch: renderResearchList, research: renderResearchList, topic: renderSubmit, students: renderStudents, teams: renderTeams, reports: v => state.user.role === 'admin' ? renderReports(v) : renderSupervisorReports(v),
  studentDash: renderStudentDashboard, myTeam: renderTeamPage, tasks: renderTasks, stagesS: renderStudentStages, grades: v => state.user.role === 'student' ? renderStudentGrades(v) : renderSupervisorGrades(v),
  dashboard: renderDashboard, proposals: renderProposals, presentations: renderPresentations, presentS: renderStudentPresentation, stages: renderStages, review: renderReviewQueue, messages: renderMessages, notifications: renderNotifications, settings: renderSettings,
  adminDash: renderAdminDashboard, registrations: renderRegistrations, ids: renderApprovedIds, users: renderUsers, courses: renderCourses,
};
let seq = 0;

function shellHtml(u) {
  return `<a class="sr-only skip" href="#view">${t('skip')}</a>
  <div class="app ${state.collapsed ? 'collapsed' : ''}" id="shell">
    <aside class="sidebar" id="sb" aria-label="${t('appName')}">
      <div class="sb-brand"><span class="sb-logo">${icon('cap')}</span><div class="t"><b>${t('brand')}</b><span class="sb-role">${t('ws.' + u.role)}</span></div></div>
      <nav class="sb-nav" id="nav">${SECTIONS[u.role].map(([sec, list]) => `<div class="sb-sec" role="presentation">${t('sec.' + sec)}</div>${list.map(([k, ic, lbl]) => `<button data-tab="${k}" data-tip="${t('nav.' + lbl)}"><span aria-hidden="true">${icon(ic)}</span><span class="sb-label">${t('nav.' + lbl)}</span><span class="sb-badge" data-nb="${k}" hidden></span></button>`).join('')}`).join('')}</nav>
      <div class="sb-foot"><button id="collapse" class="sb-collapse" data-tip="${t('collapse')}" aria-label="${t('collapse')}">${icon('left')}<span class="sb-label">${t('collapse')}</span></button></div>
    </aside>
    <div class="overlay" id="ov"></div>
    <div class="main-col">
      <header class="topbar">
        <button class="icon menu-btn" id="menu" aria-label="${t('openMenu')}">${icon('menu')}</button>
        <nav class="crumbs" id="crumbs" aria-label="breadcrumb"></nav>
        ${u.role !== 'admin' ? `<form class="search top-search" id="gs" role="search">${icon('search')}<input id="gq" type="search" placeholder="${t('searchPh')}" aria-label="${t('searchPh')}"><kbd aria-hidden="true">/</kbd></form>` : ''}
        <div class="top-actions">
          ${u.role !== 'student' ? `<button class="icon" id="share" data-tip="${t('sh.title')}" aria-label="${t('sh.title')}">${icon('grid')}</button>` : ''}
          <button class="icon" id="theme" data-tip="${t(theme === 'dark' ? 'th.light' : 'th.dark')}" aria-label="${t(theme === 'dark' ? 'th.light' : 'th.dark')}">${icon(theme === 'dark' ? 'sun' : 'moon')}</button>
          <button class="icon" id="lang" data-tip="${t('language')}" aria-label="${t('language')}">${icon('globe')}<span class="lang-label small">${lang === 'ar' ? 'EN' : 'ع'}</span></button>
          <div class="dd"><button class="icon bell" data-dd="nmenu" id="bell" data-tip="${t('nav.notifications')}" aria-label="${t('nav.notifications')}">${icon('bell')}<span class="dot" id="bdot" hidden></span></button>
            <div class="dd-menu wide" id="nmenu" hidden></div></div>
          <div class="dd"><button class="user-btn" data-dd="umenu" id="ubtn" aria-label="${t('profile')}">${avatar(u.name)}<span class="who"><b>${esc(u.name)}</b><span>${roleLabel(u.role)}</span></span>${icon('down')}</button>
            <div class="dd-menu" id="umenu" hidden><div class="dd-head"><b>${esc(u.name)}</b><div class="small mute" dir="ltr">${esc(u.university_id ?? u.email ?? '')}</div></div>
              <button data-tab="settings">${icon('settings')} ${t('nav.settings')}</button><button id="logout">${icon('logout')} ${t('logout')}</button></div></div>
        </div>
      </header>
      <main class="content" id="view" tabindex="-1"></main>
    </div>
  </div>`;
}

function bindShell(u) {
  const shell = $('#shell');
  bindDropdowns(document);
  document.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => go(b.dataset.tab));
  $('#collapse').onclick = () => { state.collapsed = !state.collapsed; lsSet('sbCollapsed', state.collapsed ? '1' : '0'); shell.classList.toggle('collapsed', state.collapsed); };
  $('#menu').onclick = () => shell.classList.add('drawer');
  $('#ov').onclick = () => shell.classList.remove('drawer');
  $('#lang').onclick = () => setLang(lang === 'ar' ? 'en' : 'ar');
  $('#share')?.addEventListener('click', openShare);
  $('#theme').onclick = () => { state.shellKey = null; setTheme(theme === 'dark' ? 'light' : 'dark'); };
  $('#logout').onclick = act(async () => {
    await api('POST', '/logout'); clearToken();
    Object.assign(state, { user: null, screen: null, tab: null, openId: null, openStageId: null, stageForm: null, thread: null, expanded: null, notifs: [], shellKey: null, researchTab: null }); render();
  });
  if (!window.__slash) { window.__slash = true; document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && $('#gq')) { e.preventDefault(); $('#gq').focus(); } }); }
  if ($('#gs')) $('#gs').onsubmit = e => { e.preventDefault(); state.q = $('#gq').value.trim(); go(u.role === 'student' ? 'myResearch' : 'research'); };
}

function go(tab) {
  state.tab = tab; state.openId = null; state.openStageId = null; state.stageForm = null; state.researchTab = null;
  $('#shell')?.classList.remove('drawer'); closeDropdowns(); render();
}

function updateChrome(u) {
  const unread = state.notifs.filter(n => !n.is_read).length;
  document.querySelectorAll('#nav [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === state.tab));
  document.querySelectorAll('#nav [aria-current]').forEach(b => b.removeAttribute('aria-current'));
  $(`#nav [data-tab="${state.tab}"]`)?.setAttribute('aria-current', 'page');
  const nb = k => $(`[data-nb="${k}"]`);
  const setBadge = (k, n) => { const el = nb(k); if (el) { el.hidden = !n; el.textContent = n > 99 ? '99+' : n; } };
  setBadge('notifications', unread); if (u.role === 'supervisor') { setBadge('review', state.pendingReviews ?? 0); setBadge('proposals', state.pendingProposals ?? 0); } if (u.role === 'admin') setBadge('registrations', state.pendingRegs ?? 0);
  $('#bdot').hidden = !unread; $('#bdot').textContent = unread > 9 ? '9+' : unread;
  const menu = $('#nmenu');
  menu.innerHTML = `<div class="dd-head row"><b class="grow">${t('nav.notifications')}</b><button class="link" id="nall">${t('viewAll')}</button></div>
    ${state.notifs.length ? state.notifs.slice(0, 7).map(n => { const m = notifMeta(n); return `<div class="n-item ${n.is_read ? '' : 'unread'}"><span class="todo" style="padding:0;border:0"><span class="ic ${m.tone}">${icon(m.icon)}</span></span><div><p>${esc(notifText(n.message))}</p><span class="tiny mute">${fmtDate(n.created_at)}</span></div></div>`; }).join('') : `<p class="mute small" style="padding:12px">${t('noNotifs')}</p>`}`;
  $('#nall').onclick = () => go('notifications');
  $('#bell').addEventListener('dd-open', async () => { if (unread) { await api('POST', '/notifications/read').catch(() => {}); state.notifs.forEach(n => { n.is_read = 1; }); $('#bdot').hidden = true; document.querySelectorAll('[data-nb="notifications"]').forEach(e => { e.hidden = true; }); } });
}

async function render() {
  const mine = ++seq, app = $('#app');
  const sigNow = `${state.tab}|${state.openId}|${state.openStageId}|${state.researchTab}`;
  if (state.viewerSig && state.viewerSig !== sigNow) closeViewer();
  state.viewerSig = sigNow;
  if (!state.user) await adoptSession();
  if (!state.user && getToken()) {
    try { state.user = await api('GET', '/me'); } catch { clearToken(); }
  }
  if (mine !== seq) return;
  if (!state.user) { state.shellKey = null; return state.screen === 'register' ? renderRegister(app) : renderLogin(app); }
  if (state.user.must_change_password) { state.shellKey = null; return renderForcedPassword(app, render); }
  const u = state.user;
  const allowed = [...NAV[u.role].map(x => x[0]), ...HIDDEN[u.role]];
  if (!allowed.includes(state.tab)) state.tab = NAV[u.role][0][0];
  const extra = [api('GET', '/notifications').catch(() => [])];
  if (u.role === 'supervisor') extra.push(api('GET', '/stages').then(s => s.reduce((a, x) => a + x.counts.pending_review, 0)).catch(() => 0));
  if (u.role === 'admin') extra.push(api('GET', '/registrations?status=pending').then(r => r.length).catch(() => 0));
  if (u.role === 'supervisor') extra.push(api('GET', '/research?status=pending&limit=500').then(l => l.length).catch(() => 0));
  const [notifs, badge, ideas] = await Promise.all(extra);
  state.pendingProposals = ideas ?? 0;
  if (mine !== seq) return;
  state.notifs = notifs; state.pendingReviews = u.role === 'supervisor' ? badge : 0; state.pendingRegs = u.role === 'admin' ? badge : 0;
  const key = `${u.id}|${lang}|${theme}`;
  if (state.shellKey !== key || !$('#view')) { app.innerHTML = shellHtml(u); state.shellKey = key; bindShell(u); }
  updateChrome(u);
  setCrumbs([{ label: t('nav.' + (NAV[u.role].find(x => x[0] === state.tab)?.[2] ?? 'dashboard')) }]);
  const view = $('#view'), sig = `${state.tab}|${state.openId}|${state.openStageId}|${state.stageForm?.id}|${state.researchTab}|${state.thread}`;
  const sameScreen = state.lastSig === sig, y = window.scrollY;
  if (!sameScreen || !view.firstChild) view.innerHTML = loading();
  // The new screen is built in a hidden container placed first in the document (so `$()` finds its elements),
  // and swapped in only when it is ready and still current: no flicker, no stale overwrite.
  const box = document.createElement('div'); box.className = 'screen'; box.hidden = true; view.prepend(box);
  try {
    await ((state.openId && ['myResearch', 'research'].includes(state.tab)) ? renderDetail(box, state.openId) : views[state.tab](box));
    if (mine !== seq) { box.remove(); return; }
    [...view.children].forEach(c => { if (c !== box) c.remove(); });
    box.hidden = false;
  } catch (e) {
    box.remove();
    if (mine !== seq) return;
    view.innerHTML = errorBox(e.message);
    view.querySelector('[data-retry]')?.addEventListener('click', render);
  }
  enhanceTables(view); enhanceForms(view);
  // keep the heading outline valid (no skipped levels) without changing the visual style of the cards
  let prev = 0;
  view.querySelectorAll('h1,h2,h3,h4').forEach(h => { const L = +h.tagName[1]; if (h.closest('[hidden]')) { if (L > 2) { h.setAttribute('role', 'heading'); h.setAttribute('aria-level', '2'); } return; } const lvl = Math.min(L, prev + 1); prev = lvl; if (lvl !== L) { h.setAttribute('role', 'heading'); h.setAttribute('aria-level', String(lvl)); } });
  state.lastSig = sig;
  if (sameScreen) window.scrollTo(0, y); else { window.scrollTo(0, 0); view.focus({ preventScroll: true }); }
}

setRender(render);
render();

// Live updates: every 20 s (while the tab is visible) look for new notifications. A new one is shown as a toast and
// the current screen is refreshed in place, unless the user is in the middle of typing or choosing files.
let lastNotif = null;
const busy = () => {
  const v = $('#view'); if (!v) return true;
  if (v.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return true;
  if (document.querySelector('.modal-back, [data-dd][aria-expanded="true"]')) return true;
  if (v.querySelector('[data-flist] .dz-file, .dz-sel .dz-file')) return true;
  return [...v.querySelectorAll('textarea, input:not([type]), input[type=text], input[type=number]')].some(i => i.value && i.value !== i.defaultValue);
};
setInterval(async () => {
  if (!state.user || state.user.must_change_password || document.hidden) return;
  const list = await api('GET', '/notifications').catch(() => null);
  if (!list) return;
  const top = list[0]?.id ?? 0;
  if (lastNotif === null || top <= lastNotif) { lastNotif = Math.max(lastNotif ?? 0, top); return; }
  lastNotif = top;
  toast(notifText(list[0].message));
  if (!busy()) render(); else { state.notifs = list; }
}, 20000);
