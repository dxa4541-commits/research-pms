// Settings: profile, language, password (uses the existing /me and /me/password endpoints).
import { $, esc, t, state, api, act, lang, setLang, roleLabel, toast } from '../core.js';
import { icon, avatar, pageHeader } from '../ui.js';

export async function renderSettings(view) {
  const u = state.user;
  view.innerHTML = `${pageHeader({ title: t('nav.settings'), sub: t('set.sub') })}
    <div class="grid g2" style="align-items:start">
      <div class="stack">
        <section class="card"><h3>${t('set.profile')}</h3><div class="row" style="gap:16px">${avatar(u.name, 'lg')}<div><b style="font-size:1.1rem">${esc(u.name)}</b><div class="mute">${roleLabel(u.role)}</div></div></div>
          <div class="divider"></div><dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 16px"><dt class="mute">${u.university_id ? t('uid') : t('email')}</dt><dd style="margin:0" dir="ltr">${esc(u.university_id ?? u.email)}</dd><dt class="mute">${t('role')}</dt><dd style="margin:0">${roleLabel(u.role)}</dd></dl></section>
        <section class="card"><h3>${t('language')}</h3><div class="chips" role="radiogroup" aria-label="${t('language')}"><button role="radio" aria-checked="${lang === 'ar'}" class="${lang === 'ar' ? 'on' : ''}" data-l="ar">العربية</button><button role="radio" aria-checked="${lang === 'en'}" class="${lang === 'en' ? 'on' : ''}" data-l="en">English</button></div></section>
      </div>
      <section class="card"><h3>${icon('key')} ${t('set.password')}</h3><p class="mute small">${t('set.pwNote')}</p>
        <form id="pf"><label for="c">${t('currentPw')}</label><input id="c" type="password" required dir="ltr" autocomplete="current-password">
        <label for="n1">${t('newPw')}</label><input id="n1" type="password" required minlength="6" dir="ltr" autocomplete="new-password">
        <label for="n2">${t('confirmPw')}</label><input id="n2" type="password" required minlength="6" dir="ltr" autocomplete="new-password"><p><button>${t('changePw')}</button></p></form></section>
    </div>`;
  view.querySelectorAll('[data-l]').forEach(b => b.onclick = () => setLang(b.dataset.l));
  $('#pf').onsubmit = act(async e => {
    e.preventDefault();
    if ($('#n1').value !== $('#n2').value) throw new Error(t('pwMismatch'));
    await api('POST', '/me/password', { currentPassword: $('#c').value, newPassword: $('#n1').value });
    $('#pf').reset(); toast(t('pwChanged'));
  });
}
