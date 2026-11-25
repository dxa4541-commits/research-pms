// Public registration screen and the forced first-login password change.
import { $, esc, t, state, api, act, langBtn, bindLang, toast, render } from '../core.js';

export function renderRegister(app) {
  app.innerHTML = `<div class="card login"><div class="row" style="justify-content:space-between"><h2 style="margin:0">${t('registerTitle')}</h2>${langBtn()}</div>
    <p class="small mute">${t('registerHint')}</p>
    <form id="f"><label for="u">${t('uid')}</label><input id="u" required maxlength="30" dir="ltr" autocomplete="username">
    <label for="n">${t('fullName')} <span class="mute">${t('optional')}</span></label><input id="n" maxlength="100">
    <label for="m">${t('contactEmail')} <span class="mute">${t('optional')}</span></label><input id="m" type="email" dir="ltr" maxlength="200">
    <p><button type="submit" style="width:100%">${t('sendRequest')}</button></p></form>
    <div id="done" hidden class="note">${t('requestSent')}</div>
    <p><button class="ghost" id="back" style="width:100%">${t('backToLogin')}</button></p></div>`;
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
  app.innerHTML = `<header><h1>${t('appName')}</h1><span class="small mute">${esc(u.name)}</span>${langBtn()}<button class="ghost" id="logout">${t('logout')}</button></header>
    <main><div class="card login" style="margin-top:6vh"><h2>${t('changePwTitle')}</h2><p class="small mute">${t('changePwHint')}</p>
    <form id="f"><label for="c">${t('currentPw')}</label><input id="c" type="password" required dir="ltr" autocomplete="current-password">
    <label for="p1">${t('newPw')}</label><input id="p1" type="password" required minlength="6" dir="ltr" autocomplete="new-password">
    <label for="p2">${t('confirmPw')}</label><input id="p2" type="password" required minlength="6" dir="ltr" autocomplete="new-password">
    <p><button type="submit" style="width:100%">${t('changePw')}</button></p></form></div></main>`;
  bindLang();
  $('#logout').onclick = act(async () => { await api('POST', '/logout'); localStorage.removeItem('token'); state.user = null; render(); });
  $('#f').onsubmit = act(async e => {
    e.preventDefault();
    if ($('#p1').value !== $('#p2').value) throw new Error(t('pwMismatch'));
    await api('POST', '/me/password', { currentPassword: $('#c').value, newPassword: $('#p1').value });
    state.user = { ...state.user, must_change_password: false }; toast(t('pwChanged')); onDone();
  });
}
