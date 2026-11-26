// "Share the site": a QR code of the site address to show in a lecture (full screen), download or copy.
import { t, esc, toast } from '../core.js';
import { icon, modal } from '../ui.js';
import { qrSvg } from '../qr.js';

export function openShare() {
  const url = location.origin, svg = qrSvg(url, { label: t('sh.qrLabel') });
  const m = modal({ title: t('sh.title'), ic: 'grid', body: `<p class="small mute">${t('sh.sub')}</p>
    <div class="share-qr">${svg}</div><p class="share-url" dir="ltr">${esc(url.replace(/^https?:\/\//, ''))}</p>`,
    actions: `<button class="ghost" data-x>${t('close')}</button><button class="ghost" data-copy>${icon('paperclip')} ${t('sh.copy')}</button>
      <button class="ghost" data-dl>${icon('download')} ${t('sh.download')}</button><button data-full>${icon('eye')} ${t('sh.full')}</button>` });
  const q = s => m.el.querySelector(s);
  q('[data-x]').onclick = m.close;
  q('[data-copy]').onclick = async () => {
    try { await navigator.clipboard.writeText(url); toast(t('sh.copied')); }
    catch { toast(url); }                                       // clipboard blocked: show the address instead
  };
  q('[data-dl]').onclick = () => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })), download: 'research-pms-qr.svg' });
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  q('[data-full]').onclick = () => {                            // presentation mode for the projector
    m.close();
    const o = document.createElement('div');
    o.className = 'share-full'; o.tabIndex = 0; o.setAttribute('role', 'dialog'); o.setAttribute('aria-label', t('sh.title'));
    o.innerHTML = `<h2>${t('sh.scan')}</h2><div class="share-qr big">${svg}</div><p class="share-url" dir="ltr">${esc(url.replace(/^https?:\/\//, ''))}</p><p class="small mute">${t('sh.exit')}</p>`;
    const close = () => o.remove();
    o.onclick = close; o.onkeydown = e => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
    document.body.appendChild(o); o.focus();
  };
}
