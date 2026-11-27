// Project poster: the team fills in its one-slide project page (built by the server from the course template),
// and the supervisor's posters folder lists every project of a course and downloads one slide or all of them.
import { $, esc, t, tErr, state, api, act, toast, render, fmtDate, readFile, downloadPath, getToken } from '../core.js';
import { icon, pageHeader, empty, progress, pill } from '../ui.js';

const FIELDS = ['name_ar', 'name_en', 'audience', 'description', 'colleges', 'url', 'desktop', 'mobile'];
const words = s => (s ?? '').trim().split(/\s+/).filter(Boolean).length;
const IMG = { desktop: { accept: '.png,.jpg,.jpeg', ratio: '16 / 10' }, mobile: { accept: '.png,.jpg,.jpeg', ratio: '9 / 19.5' } };
// Screenshots need the login token, so they are fetched and shown from a local copy.
async function blobUrl(path) {
  const res = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + getToken() } });
  return res.ok ? URL.createObjectURL(await res.blob()) : null;
}
const statusPill = s => s === 'complete' ? pill('approved', t('po.st.complete'), 'checkc') : s === 'partial' ? pill('warn', t('po.st.partial'), 'edit') : pill('neutral', t('po.st.empty'));
const slug = s => String(s).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'poster';

// ---------- Student ----------
export async function renderStudentPoster(view) {
  const mine = (await api('GET', '/research?limit=500')).filter(r => r.status !== 'rejected');
  if (!mine.length) { view.innerHTML = `${pageHeader({ title: t('po.title') })}<div class="card">${empty({ ic: 'grid', title: t('po.noResearch'), text: t('po.noResearchD') })}</div>`; return; }
  if (!mine.some(r => r.id === state.posterRid)) state.posterRid = mine[0].id;
  const d = await api('GET', `/research/${state.posterRid}/poster`), p = d.poster, ro = !d.can_edit;
  const files = {};                      // new screenshots picked in this form: { desktop: File, mobile: File } (null = remove)
  const done = FIELDS.length - d.missing.length;
  view.innerHTML = `${pageHeader({ title: t('po.title'), sub: t('po.sub'), actions: `${mine.length > 1 ? `<select id="pr" aria-label="${t('po.project')}">${mine.map(r => `<option value="${r.id}" ${r.id === d.research_id ? 'selected' : ''}>${esc(r.title)}</option>`).join('')}</select>` : ''}
      <button class="ghost" id="dl">${icon('download')} ${t('po.download')}</button>` })}
    ${ro ? `<div class="alert warn" style="margin-bottom:14px">${icon('lock')}<p>${esc(tErr(d.edit_problem))}</p></div>` : ''}
    <div class="grid g-main" style="align-items:start"><form id="pf" class="stack" novalidate>
      <section class="card"><h3>${icon('fileText')} ${t('po.sec.identity')}</h3>
        <div class="field-row"><div><label for="name_ar">${t('po.f.name_ar')}</label><input id="name_ar" dir="auto" maxlength="60" value="${esc(p.name_ar)}" placeholder="${esc(d.suggest.name_ar)}"></div>
          <div><label for="name_en">${t('po.f.name_en')}</label><input id="name_en" dir="ltr" maxlength="80" value="${esc(p.name_en)}" placeholder="Project Name"></div></div>
        <label for="audience">${t('po.f.audience')}</label><input id="audience" dir="auto" maxlength="40" value="${esc(p.audience)}" placeholder="${t('po.audiencePh')}">
        <p class="hint">${t('po.audienceHint')}</p></section>
      <section class="card"><h3>${icon('book')} ${t('po.f.description')}</h3>
        <textarea id="description" dir="auto" rows="7" maxlength="1200" placeholder="${t('po.descPh')}">${esc(p.description)}</textarea>
        <p class="hint" id="wc"></p>
        ${!p.description && d.suggest.description ? `<p><button type="button" class="ghost sm" id="useDesc">${icon('edit')} ${t('po.useDesc')}</button></p>` : ''}</section>
      <section class="card"><h3>${icon('flag')} ${t('po.f.colleges')}</h3><p class="hint" style="margin-top:0">${t('po.collegesHint')}</p>
        <div class="chips" id="cols" role="group" aria-label="${t('po.f.colleges')}">${d.colleges.map(k => `<button type="button" data-c="${k}" class="${p.colleges.includes(k) ? 'on' : ''}" aria-pressed="${p.colleges.includes(k)}">${p.colleges.includes(k) ? icon('check') : ''}${t('po.c.' + k)}</button>`).join('')}</div>
        <div id="otherBox" ${p.colleges.includes('other') ? '' : 'hidden'} style="margin-top:10px"><label for="other_college">${t('po.f.other')}</label><input id="other_college" dir="auto" maxlength="30" value="${esc(p.other_college)}"></div></section>
      <section class="card"><h3>${icon('globe')} ${t('po.f.url')}</h3>
        <input id="url" dir="ltr" maxlength="200" inputmode="url" value="${esc(p.url)}" placeholder="https://your-project.app"><p class="hint">${t('po.urlHint')}</p></section>
      <section class="card"><h3>${icon('eye')} ${t('po.sec.shots')}</h3><div class="field-row">
        ${['desktop', 'mobile'].map(k => `<div style="flex:${k === 'desktop' ? '2 1 260px' : '1 1 140px'}"><label for="f_${k}">${t('po.f.' + k)}</label>
          <div class="shot" data-shot="${k}" style="aspect-ratio:${IMG[k].ratio};max-height:${k === 'mobile' ? '300px' : 'none'};border:1px dashed var(--line-strong);border-radius:12px;display:grid;place-items:center;overflow:hidden;background:var(--surface-2);margin:6px 0">
            <span class="small mute">${t('po.noShot')}</span></div>
          ${ro ? '' : `<input type="file" id="f_${k}" accept="${IMG[k].accept}"><p class="hint">${t('po.hint.' + k)}</p>
          <button type="button" class="ghost sm" data-rm="${k}" ${p['has_' + k] ? '' : 'hidden'}>${icon('trash')} ${t('po.removeShot')}</button>`}</div>`).join('')}
      </div></section>
      ${ro ? '' : `<p><button id="save">${icon('check')} ${t('po.save')}</button></p>`}
    </form><div class="stack">
      <section class="card ${d.complete ? '' : 'accent'}"><div class="card-h"><h3>${t('po.status')}</h3>${statusPill(d.complete ? 'complete' : p.updated_at ? 'partial' : 'empty')}</div>
        ${progress(done / FIELDS.length * 100, { tone: d.complete ? 'ok' : '' })}<p class="small mute" style="margin:8px 0">${t('po.doneOf', { a: done, b: FIELDS.length })}</p>
        <ul class="checklist" style="list-style:none;padding:0;margin:0">${FIELDS.map(k => `<li class="small" style="display:flex;gap:8px;align-items:center;padding:3px 0">${d.missing.includes(k) ? `<span class="mute">${icon('clock')}</span>` : `<span style="color:var(--ok)">${icon('checkc')}</span>`}${t('po.f.' + k)}</li>`).join('')}</ul>
        ${p.updated_at ? `<p class="tiny mute" style="margin-top:10px">${t('po.updated')} ${fmtDate(p.updated_at)}</p>` : ''}
        <p class="hint">${d.complete ? t('po.inFolder') : t('po.notInFolder')}</p></section>
      <section class="card"><h3>${icon('users')} ${t('po.team')}</h3>${d.members.map(m => `<div class="member"><div class="t"><b>${esc(m.name)}</b><div class="tiny mute" dir="ltr" style="text-align:start">${esc(m.university_id ?? '—')}</div></div></div>`).join('')}
        <p class="hint">${t('po.teamHint')}</p>${d.members_cut ? `<p class="hint overdue">${t('po.teamCut', { n: d.members_cut })}</p>` : ''}</section>
    </div></div>`;

  // screenshots: current ones from the server, new ones previewed locally
  const show = (k, url) => { const box = view.querySelector(`[data-shot="${k}"]`); box.innerHTML = url ? `<img src="${url}" alt="${t('po.f.' + k)}" style="width:100%;height:100%;object-fit:cover;object-position:top">` : `<span class="small mute">${t('po.noShot')}</span>`; };
  for (const k of ['desktop', 'mobile']) if (p['has_' + k]) blobUrl(`/research/${d.research_id}/poster/image/${k}`).then(u => u && show(k, u));
  const wc = () => { const n = words($('#description').value); $('#wc').textContent = t('po.words', { n }); $('#wc').classList.toggle('overdue', n > 0 && (n < 60 || n > 110)); };
  wc(); $('#description').oninput = wc;
  $('#pr')?.addEventListener('change', e => { state.posterRid = Number(e.target.value); render(); });
  $('#dl').onclick = act(() => downloadPath(`/api/research/${d.research_id}/poster/pptx`, `${slug(p.name_ar || d.title)}.pptx`));
  if (ro) { view.querySelectorAll('#pf input, #pf textarea, #pf .chips button').forEach(el => { el.disabled = true; }); return; }
  $('#useDesc')?.addEventListener('click', () => { $('#description').value = d.suggest.description; wc(); $('#useDesc').remove(); });
  view.querySelectorAll('[data-c]').forEach(b => b.onclick = () => {
    const on = !b.classList.contains('on'); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    b.innerHTML = `${on ? icon('check') : ''}${t('po.c.' + b.dataset.c)}`;
    if (b.dataset.c === 'other') $('#otherBox').hidden = !on;
  });
  for (const k of ['desktop', 'mobile']) {
    $(`#f_${k}`).onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast(t('po.tooBig'), true); e.target.value = ''; return; }
      files[k] = f; show(k, URL.createObjectURL(f)); view.querySelector(`[data-rm="${k}"]`).hidden = false;
    };
  }
  view.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { files[b.dataset.rm] = null; $(`#f_${b.dataset.rm}`).value = ''; show(b.dataset.rm, null); b.hidden = true; });
  $('#pf').onsubmit = act(async e => {
    e.preventDefault();
    const body = Object.fromEntries(['name_ar', 'name_en', 'audience', 'description', 'url', 'other_college'].map(k => [k, $('#' + k).value.trim()]));
    body.colleges = [...view.querySelectorAll('[data-c].on')].map(b => b.dataset.c);
    for (const [k, f] of Object.entries(files)) body[k] = f ? { filename: f.name, data: await readFile(f) } : null;
    $('#save').disabled = true;
    try { const r = await api('PUT', `/research/${d.research_id}/poster`, body); toast(r.complete ? t('po.savedDone') : t('po.saved')); render(); }
    finally { if ($('#save')) $('#save').disabled = false; }
  });
}

// ---------- Supervisor / admin: the posters folder ----------
export async function renderPostersFolder(view) {
  const d = await api('GET', '/posters' + (state.posterCourse ? `?courseId=${state.posterCourse}` : ''));
  state.posterCourse = d.course_id;
  if (!d.course_id) { view.innerHTML = `${pageHeader({ title: t('po.folder') })}<div class="card">${empty({ ic: 'grid', title: t('po.noCourse') })}</div>`; return; }
  const count = s => d.items.filter(i => i.state === s).length, course = d.courses.find(c => c.id === d.course_id)?.name ?? '';
  const ok = count('complete'), started = ok + count('partial');
  view.innerHTML = `${pageHeader({ title: t('po.folder'), sub: t('po.folderSub'), actions: `${d.courses.length > 1 ? `<select id="pc" aria-label="${t('course')}">${d.courses.map(c => `<option value="${c.id}" ${c.id === d.course_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>` : ''}
      <button class="ghost" id="all" ${started ? '' : 'disabled'}>${icon('download')} ${t('po.dlAll')}</button>
      <button id="done" ${ok ? '' : 'disabled'}>${icon('download')} ${t('po.dlDone', { n: ok })}</button>` })}
    <div class="grid g3" style="margin-bottom:16px">${['complete', 'partial', 'empty'].map(s => `<div class="card"><div class="small mute">${t('po.st.' + s)}</div><div style="font-size:1.8rem;font-weight:700">${count(s)}</div></div>`).join('')}</div>
    <div class="card">${d.items.length ? `<div class="table-wrap"><table class="rt"><thead><tr><th>${t('po.project')}</th><th>${t('po.f.name_ar')}</th><th>${t('status')}</th><th>${t('po.missing')}</th><th>${t('po.updated')}</th><th><span class="sr-only">${t('actions')}</span></th></tr></thead><tbody>
      ${d.items.map(i => `<tr><td data-label="${t('po.project')}"><b>${esc(i.label)}</b><div class="tiny mute">${esc(i.title)}</div></td>
        <td data-label="${t('po.f.name_ar')}">${i.name_ar ? `${esc(i.name_ar)}${i.name_en ? `<div class="tiny mute" dir="ltr" style="text-align:start">${esc(i.name_en)}</div>` : ''}` : '<span class="mute">—</span>'}</td>
        <td data-label="${t('status')}">${statusPill(i.state)}</td>
        <td data-label="${t('po.missing')}" class="small">${i.state === 'complete' ? '<span class="mute">—</span>' : i.missing.map(k => t('po.f.' + k)).join('، ')}</td>
        <td data-label="${t('po.updated')}" class="small">${i.updated_at ? fmtDate(i.updated_at) : '—'}</td>
        <td><button class="ghost sm" data-dl="${i.research_id}" data-n="${esc(i.name_ar || i.title)}">${icon('download')} ${t('po.slide')}</button></td></tr>`).join('')}
      </tbody></table></div>` : empty({ ic: 'grid', title: t('po.noProjects') })}</div>`;
  $('#pc')?.addEventListener('change', e => { state.posterCourse = Number(e.target.value); render(); });
  $('#done').onclick = act(() => downloadPath(`/api/posters/pptx?courseId=${d.course_id}`, `${slug(t('po.fileName', { c: course }))}.pptx`));
  $('#all').onclick = act(() => downloadPath(`/api/posters/pptx?courseId=${d.course_id}&all=1`, `${slug(t('po.fileName', { c: course }))}.pptx`));
  view.querySelectorAll('[data-dl]').forEach(b => b.onclick = act(() => downloadPath(`/api/research/${b.dataset.dl}/poster/pptx`, `${slug(b.dataset.n)}.pptx`)));
}
