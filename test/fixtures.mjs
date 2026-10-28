// Builders for synthetic ELF libraries, APK/AAB zips and compiled manifests used by the tests.
import zlib from 'node:zlib';

export function elf64({ machine = 183, loads = [0x4000, 0x4000], relro = null, padTo = 40000 } = {}) {
  const phnum = loads.length + (relro ? 1 : 0);
  const buf = Buffer.alloc(Math.max(64 + phnum * 56, padTo));
  buf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1], 0);
  buf.writeUInt16LE(3, 16);
  buf.writeUInt16LE(machine, 18);
  buf.writeUInt32LE(1, 20);
  buf.writeBigUInt64LE(64n, 32);
  buf.writeUInt16LE(64, 52);
  buf.writeUInt16LE(56, 54);
  buf.writeUInt16LE(phnum, 56);
  let p = 64;
  loads.forEach((align, i) => {
    buf.writeUInt32LE(1, p);
    buf.writeBigUInt64LE(BigInt(i * 0x10000), p + 16);
    buf.writeBigUInt64LE(0x1000n, p + 40);
    buf.writeBigUInt64LE(BigInt(align), p + 48);
    p += 56;
  });
  if (relro) {
    buf.writeUInt32LE(0x6474e552, p);
    buf.writeBigUInt64LE(BigInt(relro.vaddr), p + 16);
    buf.writeBigUInt64LE(BigInt(relro.memsz), p + 40);
    buf.writeBigUInt64LE(1n, p + 48);
  }
  // Pseudo-random filler so deflate produces several output chunks.
  for (let i = 64 + phnum * 56 + 64, x = 7; i < buf.length; i++) { x = (x * 1103515245 + 12345) >>> 0; buf[i] = x >>> 24; }
  return buf;
}

export function elf32({ machine = 40, loads = [0x1000] } = {}) {
  const buf = Buffer.alloc(52 + loads.length * 32 + 64);
  buf.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0);
  buf.writeUInt16LE(3, 16);
  buf.writeUInt16LE(machine, 18);
  buf.writeUInt32LE(1, 20);
  buf.writeUInt32LE(52, 28);
  buf.writeUInt16LE(52, 40);
  buf.writeUInt16LE(32, 42);
  buf.writeUInt16LE(loads.length, 44);
  loads.forEach((align, i) => {
    const p = 52 + i * 32;
    buf.writeUInt32LE(1, p);
    buf.writeUInt32LE(i * 0x10000, p + 8);
    buf.writeUInt32LE(0x1000, p + 20);
    buf.writeUInt32LE(align, p + 28);
  });
  return buf;
}

// files: [{ name, data, store?, alignTo? }]
export function makeZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name);
    const body = f.store ? f.data : zlib.deflateRawSync(f.data);
    const method = f.store ? 0 : 8;
    let extraLen = 0;
    if (f.store && f.alignTo) extraLen = (f.alignTo - ((offset + 30 + name.length) % f.alignTo)) % f.alignTo;
    const extra = Buffer.alloc(extraLen);
    const crc = zlib.crc32(f.data);

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26);
    lh.writeUInt16LE(extraLen, 28);
    locals.push(lh, name, extra, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);

    offset += 30 + name.length + extraLen + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

// Binary XML manifest (APK). Attribute names for min/targetSdk are blank so lookup must use the resource map.
export function axmlManifest({ pkg, minSdk, targetSdk, extractNativeLibs }) {
  const strings = ['', '', 'extractNativeLibs', 'package', 'manifest', 'uses-sdk', 'application', pkg];
  const S = Object.fromEntries(strings.map((s, i) => [s || `blank${i}`, i]));
  const resMap = [0x0101020c, 0x01010270, 0x010104ea];

  const strData = Buffer.concat(strings.map((s) => {
    const b = Buffer.alloc(2 + s.length * 2 + 2);
    b.writeUInt16LE(s.length, 0);
    b.write(s, 2, 'utf16le');
    return b;
  }));
  const padded = Buffer.concat([strData, Buffer.alloc((4 - (strData.length % 4)) % 4)]);
  const offsets = Buffer.alloc(strings.length * 4);
  let o = 0;
  strings.forEach((s, i) => { offsets.writeUInt32LE(o, i * 4); o += 2 + s.length * 2 + 2; });
  const spHeader = Buffer.alloc(28);
  spHeader.writeUInt16LE(0x0001, 0);
  spHeader.writeUInt16LE(28, 2);
  spHeader.writeUInt32LE(28 + offsets.length + padded.length, 4);
  spHeader.writeUInt32LE(strings.length, 8);
  spHeader.writeUInt32LE(28 + offsets.length, 20);
  const stringPool = Buffer.concat([spHeader, offsets, padded]);

  const rm = Buffer.alloc(8 + resMap.length * 4);
  rm.writeUInt16LE(0x0180, 0);
  rm.writeUInt16LE(8, 2);
  rm.writeUInt32LE(rm.length, 4);
  resMap.forEach((id, i) => rm.writeUInt32LE(id, 8 + i * 4));

  const element = (nameIdx, attrs) => {
    const b = Buffer.alloc(16 + 20 + attrs.length * 20);
    b.writeUInt16LE(0x0102, 0);
    b.writeUInt16LE(16, 2);
    b.writeUInt32LE(b.length, 4);
    b.writeUInt32LE(0xffffffff, 12);
    b.writeUInt32LE(0xffffffff, 16);
    b.writeUInt32LE(nameIdx, 20);
    b.writeUInt16LE(20, 24);
    b.writeUInt16LE(20, 26);
    b.writeUInt16LE(attrs.length, 28);
    attrs.forEach((a, i) => {
      const p = 36 + i * 20;
      b.writeUInt32LE(0xffffffff, p);
      b.writeUInt32LE(a.name, p + 4);
      b.writeUInt32LE(a.raw ?? 0xffffffff, p + 8);
      b.writeUInt16LE(8, p + 12);
      b.writeUInt8(a.type, p + 15);
      b.writeUInt32LE(a.data, p + 16);
    });
    return b;
  };

  const body = Buffer.concat([
    stringPool,
    rm,
    element(S.manifest, [{ name: S.package, raw: S[pkg], type: 0x03, data: S[pkg] }]),
    element(S['uses-sdk'], [
      { name: 0, type: 0x10, data: minSdk },
      { name: 1, type: 0x10, data: targetSdk },
    ]),
    element(S.application, [{ name: S.extractNativeLibs, type: 0x12, data: extractNativeLibs ? 0xffffffff : 0 }]),
  ]);
  const header = Buffer.alloc(8);
  header.writeUInt16LE(0x0003, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(8 + body.length, 4);
  return Buffer.concat([header, body]);
}

// aapt2 protobuf manifest (AAB).
export function protoManifest({ pkg, minSdk, targetSdk }) {
  const vint = (n) => { const out = []; while (n > 127) { out.push((n % 128) | 0x80); n = Math.floor(n / 128); } out.push(n); return Buffer.from(out); };
  const bytesField = (num, buf) => Buffer.concat([vint(num * 8 + 2), vint(buf.length), buf]);
  const strField = (num, s) => bytesField(num, Buffer.from(s));
  const intField = (num, n) => Buffer.concat([vint(num * 8), vint(n)]);
  const intAttr = (name, resId, value) => bytesField(4, Buffer.concat([
    strField(1, 'http://schemas.android.com/apk/res/android'),
    strField(2, name),
    strField(3, String(value)),
    intField(5, resId),
    bytesField(6, bytesField(7, intField(6, value))),
  ]));
  const usesSdk = bytesField(1, Buffer.concat([
    strField(3, 'uses-sdk'),
    intAttr('minSdkVersion', 0x0101020c, minSdk),
    intAttr('targetSdkVersion', 0x01010270, targetSdk),
  ]));
  const manifest = Buffer.concat([
    strField(3, 'manifest'),
    bytesField(4, Buffer.concat([strField(2, 'package'), strField(3, pkg)])),
    bytesField(5, usesSdk),
  ]);
  return bytesField(1, manifest);
}
