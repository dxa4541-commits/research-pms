// Settings: profile, language, password (uses the existing /me and /me/password endpoints).
import { $, esc, t, state, api, act, lang, setLang, roleLabel, toast, theme, setTheme } from '../core.js';
import { icon, avatar, pageHeader } from '../ui.js';

export async function renderSettings(view) {
  const u = state.user;
  const wf = u.role === 'supervisor' ? await api('GET', '/supervisor/settings') : null;
  view.innerHTML = `${pageHeader({ title: t('nav.settings'), sub: t('set.sub') })}
    <div class="grid g2" style="align-items:start">
      <div class="stack">
        <section class="card"><h3>${t('set.profile')}</h3><div class="row" style="gap:16px">${avatar(u.name, 'lg')}<div><b style="font-size:1.1rem">${esc(u.name)}</b><div class="mute">${roleLabel(u.role)}</div></div></div>
          <div class="divider"></div><dl style="margin:0;display:grid;grid-template-columns:auto 1fr;gap:8px 16px"><dt class="mute">${u.university_id ? t('uid') : t('email')}</dt><dd style="margin:0" dir="ltr">${esc(u.university_id ?? u.email)}</dd><dt class="mute">${t('role')}</dt><dd style="margin:0">${roleLabel(u.role)}</dd></dl></section>
        <section class="card"><h3>${t('language')}</h3><div class="chips" role="radiogroup" aria-label="${t('language')}"><button role="radio" aria-checked="${lang === 'ar'}" class="${lang === 'ar' ? 'on' : ''}" data-l="ar">العربية</button><button role="radio" aria-checked="${lang === 'en'}" class="${lang === 'en' ? 'on' : ''}" data-l="en">English</button></div></section>
        <section class="card"><h3>${t('th.title')}</h3><p class="small mute">${t('th.sub')}</p><div class="chips" role="radiogroup" aria-label="${t('th.title')}"><button role="radio" aria-checked="${theme === 'light'}" class="${theme === 'light' ? 'on' : ''}" data-th="light">${icon('sun')} ${t('th.lightN')}</button><button role="radio" aria-checked="${theme === 'dark'}" class="${theme === 'dark' ? 'on' : ''}" data-th="dark">${icon('moon')} ${t('th.darkN')}</button></div></section>
      </div>
      <div class="stack">${wf ? `<section class="card"><h3>${icon('layers')} ${t('ws.title')}</h3><p class="small mute">${t('ws.sub')}</p>
        <label class="inl"><input type="checkbox" id="wa" ${wf.auto_first_stage ? 'checked' : ''}> <b>${t('ws.auto')}</b></label><p class="hint">${t('ws.autoHint')}</p>
        <fieldset style="border:0;padding:0;margin:12px 0 0"><legend class="small"><b>${t('ws.policy')}</b></legend>
          ${['resubmit', 'stop', 'advance'].map(p => `<label class="inl" style="display:flex;margin-top:6px"><input type="radio" name="wp" value="${p}" ${wf.reject_policy === p ? 'checked' : ''}> ${t('ws.p.' + p)}</label>`).join('')}</fieldset>
        <p><button id="ws">${t('save')}</button></p></section>` : ''}
      <section class="card"><h3>${icon('key')} ${t('set.password')}</h3><p class="mute small">${t('set.pwNote')}</p>
        <form id="pf"><label for="c">${t('currentPw')}</label><input id="c" type="password" required dir="ltr" autocomplete="current-password">
        <label for="n1">${t('newPw')}</label><input id="n1" type="password" required minlength="6" dir="ltr" autocomplete="new-password">
        <label for="n2">${t('confirmPw')}</label><input id="n2" type="password" required minlength="6" dir="ltr" autocomplete="new-password"><p><button>${t('changePw')}</button></p></form></section></div>
    </div>`;
  $('#ws')?.addEventListener('click', act(async () => {
    await api('PUT', '/supervisor/settings', { autoFirstStage: $('#wa').checked, rejectPolicy: view.querySelector('[name=wp]:checked').value });
  }, 'ws.saved'));
  view.querySelectorAll('[data-l]').forEach(b => b.onclick = () => setLang(b.dataset.l));
  view.querySelectorAll('[data-th]').forEach(b => b.onclick = () => { state.shellKey = null; setTheme(b.dataset.th); });
  $('#pf').onsubmit = act(async e => {
    e.preventDefault();
    if ($('#n1').value !== $('#n2').value) throw new Error(t('pwMismatch'));
    await api('POST', '/me/password', { currentPassword: $('#c').value, newPassword: $('#n1').value });
    $('#pf').reset(); toast(t('pwChanged'));
  });
}
