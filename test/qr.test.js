// QR generator used by "Share the site": structure checks (decoding was verified against an independent reader).
import assert from 'node:assert/strict';
const { qrMatrix, qrSvg } = await import('../public/qr.js');
let n = 0; const ok = name => console.log(`ok ${++n} - ${name}`);
const m = qrMatrix('https://research-pms-dxa.onrender.com');
assert.equal(m.length, 29); assert.ok(m.every(r => r.length === 29)); ok('37-byte address → version 3 (29×29)');
const finder = (cx, cy) => { for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const d = Math.max(Math.abs(dx), Math.abs(dy)); assert.equal(m[cy + dy][cx + dx], d !== 2, `finder at ${cx},${cy}`); } };
finder(3, 3); finder(25, 3); finder(3, 25); ok('three finder patterns');
for (let i = 8; i < 21; i++) { assert.equal(m[6][i], i % 2 === 0); assert.equal(m[i][6], i % 2 === 0); } ok('timing patterns');
assert.equal(m[21][8], true); ok('dark module');
assert.deepEqual(qrMatrix('https://research-pms-dxa.onrender.com'), m); ok('deterministic');
assert.equal(qrMatrix('a').length, 21); assert.equal(qrMatrix('z'.repeat(213)).length, 57); ok('versions 1 to 10');
assert.throws(() => qrMatrix('z'.repeat(214))); ok('too long text refused');
const svg = qrSvg('https://x.y', { label: 'a "b"' });
assert.ok(svg.startsWith('<svg') && svg.includes('viewBox="0 0 29 29"') && svg.includes('aria-label="a &quot;b&quot;"')); ok('SVG with quiet zone and escaped label');
console.log(`\nAll ${n} QR checks passed`);
