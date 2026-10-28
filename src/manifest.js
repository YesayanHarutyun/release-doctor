// Reads package name, minSdk, targetSdk and extractNativeLibs from a compiled AndroidManifest.xml.
// APKs store it as binary XML (AXML); AABs store it as an aapt2 protobuf XmlNode.

const RES_XML = 0x0003;
const RES_STRING_POOL = 0x0001;
const RES_XML_RESOURCE_MAP = 0x0180;
const RES_XML_START_ELEMENT = 0x0102;

const ATTR_IDS = {
  minSdkVersion: 0x0101020c,
  targetSdkVersion: 0x01010270,
  extractNativeLibs: 0x010104ea,
};

function emptyResult() {
  return { packageName: null, minSdk: null, targetSdk: null, extractNativeLibs: null };
}

function apply(out, element, attrName, resId, strVal, intVal, boolVal) {
  const is = (key) => attrName === key || resId === ATTR_IDS[key];
  if (element === 'manifest' && attrName === 'package') out.packageName = strVal;
  if (element === 'uses-sdk') {
    if (is('minSdkVersion')) out.minSdk = intVal ?? strVal;
    if (is('targetSdkVersion')) out.targetSdk = intVal ?? strVal;
  }
  if (element === 'application' && is('extractNativeLibs')) out.extractNativeLibs = boolVal ?? strVal === 'true';
}

export function parseManifest(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x03 && bytes[1] === 0x00) return parseBinaryXml(bytes);
  if (bytes.length >= 2 && bytes[0] === 0x0a) return parseProtoXml(bytes);
  return null;
}

// ---------- Binary XML (APK) ----------

function readStringPool(dv, p) {
  const headerSize = dv.getUint16(p + 2, true);
  const count = dv.getUint32(p + 8, true);
  const flags = dv.getUint32(p + 16, true);
  const stringsStart = dv.getUint32(p + 20, true);
  const utf8 = (flags & 0x100) !== 0;
  const dec8 = new TextDecoder('utf-8');
  const dec16 = new TextDecoder('utf-16le');
  const strings = new Array(count);
  for (let i = 0; i < count; i++) {
    let s = p + stringsStart + dv.getUint32(p + headerSize + i * 4, true);
    if (utf8) {
      s += dv.getUint8(s) & 0x80 ? 2 : 1;
      let len = dv.getUint8(s);
      if (len & 0x80) { len = ((len & 0x7f) << 8) | dv.getUint8(s + 1); s += 2; } else { s += 1; }
      strings[i] = dec8.decode(new Uint8Array(dv.buffer, dv.byteOffset + s, len));
    } else {
      let len = dv.getUint16(s, true);
      if (len & 0x8000) { len = ((len & 0x7fff) << 16) | dv.getUint16(s + 2, true); s += 4; } else { s += 2; }
      strings[i] = dec16.decode(new Uint8Array(dv.buffer, dv.byteOffset + s, len * 2));
    }
  }
  return strings;
}

function parseBinaryXml(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint16(0, true) !== RES_XML) return null;
  const out = emptyResult();
  let strings = [];
  const resMap = [];
  let p = dv.getUint16(2, true);

  while (p + 8 <= bytes.length) {
    const type = dv.getUint16(p, true);
    const headerSize = dv.getUint16(p + 2, true);
    const size = dv.getUint32(p + 4, true);
    if (size < 8 || p + size > bytes.length) break;

    if (type === RES_STRING_POOL) {
      strings = readStringPool(dv, p);
    } else if (type === RES_XML_RESOURCE_MAP) {
      for (let i = p + headerSize; i < p + size; i += 4) resMap.push(dv.getUint32(i, true));
    } else if (type === RES_XML_START_ELEMENT) {
      const ext = p + headerSize;
      const element = strings[dv.getUint32(ext + 4, true)];
      const attrStart = dv.getUint16(ext + 8, true);
      const attrSize = dv.getUint16(ext + 10, true);
      const attrCount = dv.getUint16(ext + 12, true);
      for (let i = 0; i < attrCount; i++) {
        const a = ext + attrStart + i * attrSize;
        const nameIdx = dv.getUint32(a + 4, true);
        const rawIdx = dv.getUint32(a + 8, true);
        const dataType = dv.getUint8(a + 15);
        const data = dv.getUint32(a + 16, true);
        const strVal = rawIdx !== 0xffffffff ? strings[rawIdx] : null;
        const isInt = dataType >= 0x10 && dataType <= 0x1f;
        const intVal = isInt ? data : strVal && /^\d+$/.test(strVal) ? Number(strVal) : null;
        const boolVal = dataType === 0x12 ? data !== 0 : null;
        apply(out, element, strings[nameIdx], resMap[nameIdx], strVal, intVal, boolVal);
      }
    }
    p += size;
  }
  return out;
}

// ---------- Protobuf XML (AAB) ----------

function varint(b, p) {
  let x = 0;
  let mul = 1;
  let byte;
  do {
    byte = b[p++];
    x += (byte & 0x7f) * mul;
    mul *= 128;
  } while (byte & 0x80);
  return [x, p];
}

function readFields(b, start, end) {
  const out = [];
  let p = start;
  while (p < end) {
    let key;
    [key, p] = varint(b, p);
    const field = Math.floor(key / 8);
    const wt = key & 7;
    if (wt === 0) { let v; [v, p] = varint(b, p); out.push({ field, wt, v }); }
    else if (wt === 2) { let len; [len, p] = varint(b, p); out.push({ field, wt, start: p, end: p + len }); p += len; }
    else if (wt === 1) { out.push({ field, wt, start: p, end: p + 8 }); p += 8; }
    else if (wt === 5) { out.push({ field, wt, start: p, end: p + 4 }); p += 4; }
    else throw new Error(`Unsupported protobuf wire type ${wt}`);
  }
  return out;
}

function parseProtoXml(b) {
  const out = emptyResult();
  const dec = new TextDecoder();
  const str = (f) => dec.decode(b.subarray(f.start, f.end));

  // Item.prim (7) -> Primitive.int_decimal (6) / int_hex (7) / boolean (8)
  function primitive(item) {
    for (const f of readFields(b, item.start, item.end)) {
      if (f.field !== 7 || f.wt !== 2) continue;
      for (const pf of readFields(b, f.start, f.end)) {
        if ((pf.field === 6 || pf.field === 7) && pf.wt === 0) return { int: pf.v };
        if (pf.field === 8 && pf.wt === 0) return { bool: pf.v !== 0 };
      }
    }
    return {};
  }

  function element(start, end) {
    let name = null;
    const attrs = [];
    const children = [];
    for (const f of readFields(b, start, end)) {
      if (f.field === 3 && f.wt === 2) name = str(f);
      else if (f.field === 4 && f.wt === 2) attrs.push(f);
      else if (f.field === 5 && f.wt === 2) children.push(f);
    }
    for (const a of attrs) {
      let attrName = null;
      let strVal = null;
      let resId = null;
      let prim = {};
      for (const f of readFields(b, a.start, a.end)) {
        if (f.field === 2 && f.wt === 2) attrName = str(f);
        else if (f.field === 3 && f.wt === 2) strVal = str(f);
        else if (f.field === 5 && f.wt === 0) resId = f.v;
        else if (f.field === 6 && f.wt === 2) prim = primitive(f);
      }
      const intVal = prim.int ?? (strVal && /^\d+$/.test(strVal) ? Number(strVal) : null);
      apply(out, name, attrName, resId, strVal, intVal, prim.bool ?? null);
    }
    for (const child of children) {
      for (const f of readFields(b, child.start, child.end)) {
        if (f.field === 1 && f.wt === 2) element(f.start, f.end);
      }
    }
  }

  for (const f of readFields(b, 0, b.length)) {
    if (f.field === 1 && f.wt === 2) element(f.start, f.end);
  }
  return out;
}
