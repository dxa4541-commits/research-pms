// Public screens: log in, student registration, forced first-login password change.
import { $, esc, t, state, api, act, lang, setLang, toast, render, roleLabel, theme, setTheme, setToken, clearToken } from '../core.js';
import { icon, avatar, enhanceForms } from '../ui.js';

const langBtn = () => `<button type="button" class="ghost sm" id="lang" aria-label="${t('language')}">${icon('globe')} ${lang === 'ar' ? 'English' : 'العربية'}</button>`;
const side = () => `<aside class="auth-side"><div class="row" style="gap:12px"><span class="sb-logo">${icon('cap')}</span><b style="font-size:1.1rem;color:var(--ink)">${t('brand')}</b></div>
  <div><h1>${t('auth.lead')}</h1><ul><li>${icon('layers')}<span>${t('auth.f1')}</span></li><li>${icon('users')}<span>${t('auth.f2')}</span></li><li>${icon('globe')}<span>${t('auth.f3')}</span></li></ul></div>
  <span class="small" style="opacity:.7">${t('auth.tag')}</span></aside>`;
const wrap = inner => `<div class="auth">${side()}<main class="auth-main"><div class="auth-card"><div class="auth-top"><button type="button" class="ghost sm" id="themeb" aria-label="${t(theme === 'dark' ? 'th.light' : 'th.dark')}">${icon(theme === 'dark' ? 'sun' : 'moon')}</button>${langBtn()}</div>${inner}</div></main></div>`;
const bindLang = () => { $('#lang').onclick = () => setLang(lang === 'ar' ? 'en' : 'ar'); $('#themeb').onclick = () => setTheme(theme === 'dark' ? 'light' : 'dark'); enhanceForms(document); };
// password field with a show/hide toggle (accessible)
const pwField = (id, label, auto) => `<label for="${id}">${label}</label><div class="search"><input id="${id}" type="password" required dir="ltr" autocomplete="${auto}" style="padding-inline-end:44px">
  <button type="button" class="icon" data-pw="${id}" aria-label="${t('auth.show')}" style="position:absolute;inset-inline-end:2px">${icon('eye')}</button></div>`;
const bindPw = () => document.querySelectorAll('[data-pw]').forEach(b => b.onclick = () => {
  const i = $('#' + b.dataset.pw), show = i.type === 'password'; i.type = show ? 'text' : 'password'; b.setAttribute('aria-label', t(show ? 'auth.hide' : 'auth.show'));
});

export function renderLogin(app) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  app.innerHTML = wrap(`<div class="card"><h2>${t('auth.welcome')}</h2><p class="mute">${t('auth.sub')}</p>
    <form id="f"><label for="e">${t('uidOrEmail')}</label><input id="e" type="text" required autocomplete="username" dir="ltr" autofocus>
    ${pwField('p', t('password'), 'current-password')}
    <p><button type="submit" class="block">${t('login')}</button></p></form>
    <div class="divider"></div><button type="button" class="ghost block" id="reg">${icon('cap')} ${t('registerLink')}</button></div>
    ${local ? `<div class="card flat" style="margin-top:12px"><p class="small mute" style="margin:0">${t('demo')}<br><span dir="ltr">admin@example.com / admin123<br>doctor@example.com / doctor123<br>20240001 / student123</span></p></div>` : ''}`);
  bindLang(); bindPw();
  $('#reg').onclick = () => { state.screen = 'register'; render(); };
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    const btn = e.submitter; if (btn) btn.disabled = true;
    try { const r = await api('POST', '/login', { email: $('#e').value, password: $('#p').value }); setToken(r.token); state.user = r.user; render(); }
    finally { if (btn) btn.disabled = false; }
  });
}

export function renderRegister(app) {
  app.innerHTML = wrap(`<div class="card"><h2>${t('registerTitle')}</h2><p class="mute">${t('registerHint')}</p>
    <form id="f"><label for="u">${t('uid')}</label><input id="u" required maxlength="30" dir="ltr" autocomplete="username">
    <label for="n">${t('fullName')} <span class="mute">${t('optional')}</span></label><input id="n" maxlength="100" autocomplete="name">
    <label for="m">${t('contactEmail')} <span class="mute">${t('optional')}</span></label><input id="m" type="email" dir="ltr" maxlength="200" autocomplete="email">
    <p><button type="submit" class="block">${t('sendRequest')}</button></p></form>
    <div id="done" hidden class="alert ok" role="status">${icon('checkc')}<p>${t('requestSent')}</p></div>
    <div class="divider"></div><button class="ghost block" id="back">${icon('arrow')} ${t('backToLogin')}</button></div>`);
  bindLang();
  $('#back').onclick = () => { state.screen = null; render(); };
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    await api('POST', '/register', { universityId: $('#u').value, name: $('#n').value || undefined, email: $('#m').value || undefined });
    $('#f').hidden = true; $('#done').hidden = false; toast(t('toast.registered'));
  });
}

export function renderForcedPassword(app, onDone) {
  const u = state.user;
  app.innerHTML = wrap(`<div class="card"><div class="row" style="margin-bottom:8px">${avatar(u.name, 'lg')}<div><b>${esc(u.name)}</b><div class="small mute">${roleLabel(u.role)}</div></div></div>
    <h2>${t('changePwTitle')}</h2><div class="alert warn" style="margin-bottom:8px">${icon('lock')}<p>${t('changePwHint')}</p></div>
    <form id="f">${pwField('c', t('currentPw'), 'current-password')}${pwField('p1', t('newPw'), 'new-password')}${pwField('p2', t('confirmPw'), 'new-password')}
    <p><button type="submit" class="block">${t('changePw')}</button></p></form>
    <button class="ghost block" id="logout">${icon('logout')} ${t('logout')}</button></div>`);
  bindLang(); bindPw();
  $('#logout').onclick = act(async () => { await api('POST', '/logout'); clearToken(); state.user = null; state.shellKey = null; render(); });
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) throw new Error(t('pwMismatch'));
    await api('POST', '/me/password', { currentPassword: $('#c').value, newPassword: $('#p1').value });
    state.user = { ...state.user, must_change_password: false }; toast(t('pwChanged')); onDone();
  });
}
