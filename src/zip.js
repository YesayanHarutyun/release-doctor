// Minimal read-only ZIP reader that works on a Blob/File without loading it into memory.
// Supports stored + deflate entries and ZIP64 (large AABs).

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

async function view(blob, start, end) {
  return new DataView(await blob.slice(start, end).arrayBuffer());
}

export async function openZip(blob) {
  const size = blob.size;
  const tailLen = Math.min(size, 0xffff + 22 + 20);
  const tail = await view(blob, size - tailLen, size);

  let eocd = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This file is not a ZIP-based package (APK, AAB or AAR).');

  let count = tail.getUint16(eocd + 10, true);
  let cdSize = tail.getUint32(eocd + 12, true);
  let cdOffset = tail.getUint32(eocd + 16, true);

  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    const loc = eocd - 20;
    if (loc >= 0 && tail.getUint32(loc, true) === SIG_EOCD64_LOCATOR) {
      const z64Offset = Number(tail.getBigUint64(loc + 8, true));
      const z64 = await view(blob, z64Offset, z64Offset + 56);
      if (z64.getUint32(0, true) !== SIG_EOCD64) throw new Error('Corrupted ZIP64 directory.');
      count = Number(z64.getBigUint64(32, true));
      cdSize = Number(z64.getBigUint64(40, true));
      cdOffset = Number(z64.getBigUint64(48, true));
    }
  }

  const cd = await view(blob, cdOffset, cdOffset + cdSize);
  const decoder = new TextDecoder();
  const entries = [];
  let p = 0;
  for (let i = 0; i < count && p + 46 <= cd.byteLength; i++) {
    if (cd.getUint32(p, true) !== SIG_CENTRAL) break;
    const method = cd.getUint16(p + 10, true);
    let compSize = cd.getUint32(p + 20, true);
    let uncompSize = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    let localOffset = cd.getUint32(p + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen));

    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = cd.getUint16(e, true);
        const len = cd.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompSize === 0xffffffff) { uncompSize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(cd.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(cd.getBigUint64(q, true)); q += 8; }
        }
        e += 4 + len;
      }
    }

    entries.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { blob, entries };
}

// Absolute file offset where an entry's (possibly compressed) data starts.
export async function dataOffset(zip, entry) {
  const h = await view(zip.blob, entry.localOffset, entry.localOffset + 30);
  if (h.getUint32(0, true) !== SIG_LOCAL) throw new Error(`Bad local header for ${entry.name}`);
  return entry.localOffset + 30 + h.getUint16(26, true) + h.getUint16(28, true);
}

// Reads up to maxBytes of an entry's uncompressed content.
export async function readEntry(zip, entry, maxBytes = Infinity) {
  const start = await dataOffset(zip, entry);
  const want = Math.min(maxBytes, entry.uncompSize);
  const raw = zip.blob.slice(start, start + entry.compSize);

  if (entry.method === 0) return new Uint8Array(await raw.slice(0, want).arrayBuffer());
  if (entry.method !== 8) throw new Error(`Unsupported compression method ${entry.method} in ${entry.name}`);

  const reader = raw.stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const out = new Uint8Array(want);
  let n = 0;
  try {
    while (n < want) {
      const { done, value } = await reader.read();
      if (done) break;
      const take = Math.min(value.length, want - n);
      out.set(value.subarray(0, take), n);
      n += take;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return out.subarray(0, n);
}
