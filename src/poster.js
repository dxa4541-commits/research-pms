// Project poster (one slide per project) built from the course template assets/project-poster-template.pptx.
// The template's shapes are found by name, filled with the data a team entered, and the slides of one or more
// projects are packed into a single .pptx. No PowerPoint library is needed: a slide is XML inside a ZIP.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { deflateSync, crc32 } from 'node:zlib';
import { readZip, writeZip } from './zip.js';
import { qrMatrix } from '../public/qr.js';

// Target colleges: key → the label (and shape name) on the template, in the template's order.
export const COLLEGES = {
  hadith: 'الحديث الشريف', quran: 'القرآن الكريم', sharia: 'الشريعة', law: 'الأنظمة', arabic: 'اللغة العربية',
  aqeedah: 'العقيدة والدعوة', engineering: 'الهندسة', computer: 'الحاسب الآلي', business: 'الأعمال', science: 'العلوم', other: 'أخرى',
};
export const MAX_MEMBERS = 6;

let TEMPLATE;
const template = () => TEMPLATE ??= readZip(readFileSync(fileURLToPath(new URL('../assets/project-poster-template.pptx', import.meta.url))));
const SLIDE = 'ppt/slides/slide2.xml';

// ---------- small XML helpers (the template is known, so targeted string edits are safe) ----------
const xmlText = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/\s+/g, ' ').trim()
  .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SHAPE = /<p:(sp|pic)>[\s\S]*?<\/p:\1>/g;
const nameOf = s => s.match(/<p:cNvPr id="\d+" name="([^"]*)"/)?.[1];
function editShape(xml, name, fn) {
  let found = false;
  const out = xml.replace(SHAPE, s => { if (nameOf(s) !== name) return s; found = true; return fn(s); });
  if (!found) throw new Error(`Poster template has no shape named "${name}"`);
  return out;
}
const getShape = (xml, name) => xml.match(SHAPE).find(s => nameOf(s) === name) ?? (() => { throw new Error(`Poster template has no shape named "${name}"`); })();
const setText = (s, text, sz) => {
  s = s.replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${xmlText(text)}</a:t>`);
  return sz ? s.replace(/ sz="\d+"/g, ` sz="${Math.round(sz)}"`) : s;
};
const xfrm = s => { const m = s.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>\s*<a:ext cx="(\d+)" cy="(\d+)"\/>/); return { x: +m[1], y: +m[2], cx: +m[3], cy: +m[4] }; };
const move = (s, { x, y, cx, cy }) => s.replace(/<a:off x="-?\d+" y="-?\d+"\/>(\s*)<a:ext cx="\d+" cy="\d+"\/>/, `<a:off x="${Math.round(x)}" y="${Math.round(y)}"/>$1<a:ext cx="${Math.round(cx)}" cy="${Math.round(cy)}"/>`);
const withId = (s, id, name) => s.replace(/<p:cNvPr id="\d+" name="[^"]*"/, `<p:cNvPr id="${id}" name="${xmlText(name)}"`);
// Font size that keeps `text` on one line of `width` EMU (≈ average glyph width 0.55 em), between min and the template size.
const fit = (text, width, sz, min, em = 0.55) => Math.max(min, Math.min(sz, Math.floor((width / 127) / (Math.max(1, [...text].length) * em))));
const pic = ({ id, name, descr, rid, box, crop = null, geom = '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>' }) =>
  `<p:pic><p:nvPicPr><p:cNvPr id="${id}" name="${xmlText(name)}" descr="${xmlText(descr)}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>`
  + `<p:blipFill><a:blip r:embed="${rid}"/>${crop ? `<a:srcRect l="${crop.l}" t="${crop.t}" r="${crop.r}" b="${crop.b}"/>` : ''}<a:stretch><a:fillRect/></a:stretch></p:blipFill>`
  + `<p:spPr><a:xfrm><a:off x="${box.x}" y="${box.y}"/><a:ext cx="${box.cx}" cy="${box.cy}"/></a:xfrm>${geom}</p:spPr></p:pic>`;

// ---------- images ----------
export function imageSize(buf) {
  if (buf.subarray(0, 8).equals(Buffer.from('89504E470D0A1A0A', 'hex'))) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let p = 2; p + 9 < buf.length;) {
      if (buf[p] !== 0xff) { p++; continue; }
      const m = buf[p + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { p += 2; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
      p += 2 + buf.readUInt16BE(p + 2);
    }
  }
  return null;
}
// Crop (in 1/1000 %) so the picture covers the box; screenshots keep their top edge (the page header).
function coverCrop(size, box) {
  if (!size?.w || !size?.h) return null;
  const img = size.w / size.h, frame = box.cx / box.cy;
  if (Math.abs(img - frame) < 0.01) return null;
  if (img > frame) { const side = Math.round((1 - frame / img) / 2 * 100000); return { l: side, r: side, t: 0, b: 0 }; }
  return { l: 0, r: 0, t: 0, b: Math.round((1 - img / frame) * 100000) };
}
// PNG of a QR code (RGB, 2-module quiet zone).
export function qrPng(text, { scale = 10, dark = [0x12, 0x34, 0x3a] } = {}) {
  const m = qrMatrix(text), q = 2, n = (m.length + q * 2) * scale;
  const raw = Buffer.alloc((n * 3 + 1) * n, 0xff);
  for (let y = 0; y < n; y++) {
    raw[y * (n * 3 + 1)] = 0;
    const my = Math.floor(y / scale) - q;
    for (let x = 0; x < n; x++) {
      const mx = Math.floor(x / scale) - q;
      if (my >= 0 && mx >= 0 && my < m.length && mx < m.length && m[my][mx]) raw.set(dark, y * (n * 3 + 1) + 1 + x * 3);
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'latin1'), data]), crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(n, 0); ihdr.writeUInt32BE(n, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from('89504E470D0A1A0A', 'hex'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---------- one slide ----------
// p: { name_ar, name_en, audience, description, colleges: [key], other_college, url, members: [{ name, university_id }],
//      desktop: { buf, ext } | null, mobile: { buf, ext } | null }
// Returns the slide XML, its relationships and the media files it needs (paths under ppt/media/).
function buildSlide(p, i) {
  let xml = template().get(SLIDE).toString('utf8');
  const media = [], rels = [
    ['rId2', 'image', '../media/image-2-2.png'],                     // the "selected" check mark
    ['rId3', 'slideLayout', '../slideLayouts/slideLayout2.xml'],
  ];
  let nextId = 100;

  // helper shapes parked to the right of the slide (instructions for filling the template by hand)
  for (const n of ['خلفية كلية مختارة', 'علامة كلية مختارة', 'كلية مختارة', 'Text 57']) xml = editShape(xml, n, () => '');

  const audience = p.audience || 'الفئة المستهدفة';
  xml = editShape(xml, 'المستهدفون', s => setText(s, audience, fit(audience, 1463040, 1680, 1000, 0.5)));
  const ar = p.name_ar || 'اسم المشروع', en = p.name_en || 'Project Name';
  xml = editShape(xml, 'اسم المشروع', s => setText(s, ar, fit(ar, 5212080, 6000, 2400, 0.48)));
  xml = editShape(xml, 'Project Name', s => setText(s, en, fit(en, 5212080, 1920, 1100, 0.5)));
  const desc = p.description || 'وصف المشروع';
  const chars = [...desc].length;
  xml = editShape(xml, 'وصف المشروع', s => setText(s, desc, chars > 900 ? Math.max(820, 1020 * Math.sqrt(900 / chars)) : null));

  // team: the template has two columns (label, name, university ID) split by a line in the background picture, so
  // members go two per row, right to left; 3–6 members use 2–3 rows without the small "student name" labels
  const proto = { label: getShape(xml, 'Text 44'), name: getShape(xml, 'اسم الطالب 1'), uid: getShape(xml, 'الرقم الجامعي 1') };
  for (const n of ['Text 44', 'اسم الطالب 1', 'الرقم الجامعي 1', 'Text 47', 'اسم الطالب 2', 'الرقم الجامعي 2']) xml = editShape(xml, n, () => '');
  const members = (p.members?.length ? p.members : [{ name: 'اسم الطالب', university_id: '4520XXXXX' }]).slice(0, MAX_MEMBERS);
  const rows = Math.ceil(members.length / 2);
  const cols = [[2743200, 1943100], [525780, 1828800]];                              // [x, width] of the template's two columns
  const L = rows === 1 ? null : rows === 2 ? { top: 3611880, pitch: 384048, name: 1040, uid: 860, nameH: 190500, uidH: 140208 }
    : { top: 3584448, pitch: 265176, name: 900, uid: 760, nameH: 150876, uidH: 117348 };
  const team = members.map((m, k) => {
    const [x, w] = cols[k % 2], parts = [];
    if (!L) {
      parts.push(move(withId(proto.label, nextId++, `Text ${k}`), { x, y: 3718560, cx: w, cy: 137160 }));
      parts.push(move(setText(withId(proto.name, nextId++, `اسم الطالب ${k + 1}`), m.name, fit(m.name, w, 1140, 760)), { x, y: 3855720, cx: w, cy: 198120 }));
      parts.push(move(setText(withId(proto.uid, nextId++, `الرقم الجامعي ${k + 1}`), m.university_id || '—'), { x, y: 4046220, cx: w, cy: 152400 }));
    } else {
      const y = L.top + Math.floor(k / 2) * L.pitch;
      parts.push(move(setText(withId(proto.name, nextId++, `اسم الطالب ${k + 1}`), m.name, fit(m.name, w, L.name, 700)), { x, y, cx: w, cy: L.nameH }));
      parts.push(move(setText(withId(proto.uid, nextId++, `الرقم الجامعي ${k + 1}`), m.university_id || '—', L.uid), { x, y: y + L.nameH, cx: w, cy: L.uidH }));
    }
    return parts.join('');
  }).join('');
  xml = xml.replace('</p:spTree>', `${team}</p:spTree>`);

  // target colleges: selected ones get the dark fill, white text and the check mark instead of the empty circle
  for (const key of new Set(p.colleges ?? [])) {
    const label = COLLEGES[key]; if (!label) continue;
    xml = editShape(xml, `خلفية ${label}`, s => s.replace(/<a:solidFill>[\s\S]*?<\/a:ln>/, '<a:solidFill><a:srgbClr val="0B4F5C"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="0B4F5C"/></a:solidFill><a:prstDash val="solid"/></a:ln>'));
    xml = editShape(xml, `دائرة ${label}`, s => { const b = xfrm(s); return pic({ id: nextId++, name: `علامة ${label}`, descr: 'محددة', rid: 'rId2', box: { x: b.x - 15240, y: b.y - 15240, cx: 137160, cy: 137160 } }); });
    xml = editShape(xml, label, s => {
      s = s.replace(/<a:srgbClr val="12343A"\/>/g, '<a:srgbClr val="FFFFFF"/>');
      return key === 'other' && p.other_college ? setText(s, p.other_college, fit(p.other_college, 784860, 840, 600, 0.5)) : s;
    });
  }

  // project link + QR code (the template's sample QR stays until a link is given)
  if (p.url) {
    const shown = p.url.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    xml = editShape(xml, 'رابط المشروع', s => setText(s, shown, fit(shown, 1676400, 750, 560, 0.55)));
    media.push([`ppt/media/poster${i}-qr.png`, qrPng(p.url)]);
    rels.push(['rId1', 'image', `../media/poster${i}-qr.png`]);
  } else rels.push(['rId1', 'image', '../media/image-2-1.png']);

  // screenshots replace the placeholder rectangles, cropped to fill them
  for (const [shape, key, rid, descr] of [['لقطة سطح المكتب', 'desktop', 'rId5', 'لقطة شاشة سطح المكتب للمشروع'], ['لقطة الجوال', 'mobile', 'rId6', 'لقطة شاشة الجوال للمشروع']]) {
    const img = p[key]; if (!img) continue;
    const ext = img.ext === 'png' ? 'png' : 'jpeg', file = `poster${i}-${key}.${ext}`;
    media.push([`ppt/media/${file}`, img.buf]);
    rels.push([rid, 'image', `../media/${file}`]);
    xml = editShape(xml, shape, s => {
      const box = xfrm(s), geom = s.match(/<a:prstGeom[\s\S]*?<\/a:prstGeom>/)?.[0];
      return pic({ id: nextId++, name: shape, descr, rid, box, crop: coverCrop(imageSize(img.buf), box), geom });
    });
  }
  return { xml, rels, media };
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const CT = 'application/vnd.openxmlformats-officedocument.presentationml.';
const relsXml = list => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${REL}${type}" Target="${target}"/>`).join('')}</Relationships>`;

// One .pptx holding a slide per poster (in the given order).
export function buildDeck(posters, { title = 'ملصقات المشاريع' } = {}) {
  if (!posters.length) throw new Error('No posters to build');
  const tpl = template(), files = new Map();
  for (const [name, buf] of tpl) if (!/^ppt\/(slides|notesSlides)\//.test(name)) files.set(name, buf);
  const slides = posters.map((p, k) => buildSlide(p, k + 1));
  slides.forEach((s, k) => {
    files.set(`ppt/slides/slide${k + 1}.xml`, Buffer.from(s.xml, 'utf8'));
    files.set(`ppt/slides/_rels/slide${k + 1}.xml.rels`, Buffer.from(relsXml(s.rels), 'utf8'));
    for (const [name, buf] of s.media) files.set(name, buf);
  });
  // presentation: the slide list and its relationships
  let pres = tpl.get('ppt/presentation.xml').toString('utf8');
  pres = pres.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, `<p:sldIdLst>${slides.map((_, k) => `<p:sldId id="${256 + k}" r:id="rIdS${k + 1}"/>`).join('')}</p:sldIdLst>`);
  files.set('ppt/presentation.xml', Buffer.from(pres, 'utf8'));
  const presRels = [...tpl.get('ppt/_rels/presentation.xml.rels').toString('utf8').matchAll(/<Relationship Id="([^"]+)" Type="[^"]*\/([^"/]+)" Target="([^"]+)"\/>/g)]
    .filter(m => m[2] !== 'slide').map(m => [m[1], m[2], m[3]]);
  files.set('ppt/_rels/presentation.xml.rels', Buffer.from(relsXml([...presRels, ...slides.map((_, k) => [`rIdS${k + 1}`, 'slide', `slides/slide${k + 1}.xml`])]), 'utf8'));
  let types = tpl.get('[Content_Types].xml').toString('utf8').replace(/<Override PartName="\/ppt\/(slides|notesSlides)\/[^"]+" ContentType="[^"]+"\/>/g, '');
  types = types.replace('</Types>', `${slides.map((_, k) => `<Override PartName="/ppt/slides/slide${k + 1}.xml" ContentType="${CT}slide+xml"/>`).join('')}</Types>`);
  files.set('[Content_Types].xml', Buffer.from(types, 'utf8'));
  files.set('docProps/app.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Microsoft Office PowerPoint</Application><PresentationFormat>On-screen Show (16:9)</PresentationFormat><Slides>${slides.length}</Slides><Notes>0</Notes><AppVersion>16.0000</AppVersion></Properties>`, 'utf8'));
  const now = new Date().toISOString().slice(0, 19) + 'Z';
  files.set('docProps/core.xml', Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlText(title)}</dc:title><dc:creator>Research PMS</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>`, 'utf8'));
  // template media no part refers to any more (the sample QR once a link is given, the check mark with no college) go
  const used = new Set();
  for (const [name, buf] of files) if (name.endsWith('.rels')) for (const m of buf.toString('utf8').matchAll(/Target="\.\.\/media\/([^"]+)"/g)) used.add(`ppt/media/${m[1]}`);
  for (const name of [...files.keys()]) if (name.startsWith('ppt/media/') && !used.has(name)) files.delete(name);
  // [Content_Types].xml first, as Office writes it
  const order = ['[Content_Types].xml', ...[...files.keys()].filter(n => n !== '[Content_Types].xml')];
  return writeZip(order.map(n => [n, files.get(n)]));
}
