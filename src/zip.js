// Minimal ZIP reader / writer (enough for .pptx packages): stored + deflated entries, no zip64, no encryption.
// Uses only node:zlib so the app needs no extra dependency.
import { inflateRawSync, deflateRawSync, crc32 } from 'node:zlib';

// Reads every entry through the central directory. Returns Map(name → Buffer).
export function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a ZIP file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt ZIP central directory');
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42), name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + size);
    if (!name.endsWith('/')) out.set(name, method === 0 ? Buffer.from(raw) : method === 8 ? inflateRawSync(raw) : (() => { throw new Error(`ZIP method ${method} not supported`); })());
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

// entries: iterable of [name, Buffer|string]. Already-compressed media (png/jpeg) are stored, everything else deflated.
export function writeZip(entries) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, value] of entries) {
    const data = Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
    const store = /\.(png|jpe?g|gif)$/i.test(name);
    const body = store ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8'), crc = crc32(data) >>> 0, method = store ? 0 : 8;
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(method, 8);
    head.writeUInt32LE(0x00210000, 10); // fixed DOS date/time (1980-01-01): the output is deterministic
    head.writeUInt32LE(crc, 14); head.writeUInt32LE(body.length, 18); head.writeUInt32LE(data.length, 22); head.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(0x00210000, 12); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28); dir.writeUInt32LE(offset, 42);
    locals.push(head, nameBuf, body); central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
