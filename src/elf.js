// Reads just enough of an ELF shared library to check 16 KB page-size compatibility.

export const PAGE_16K = 16384;

const PT_LOAD = 1;
const PT_GNU_RELRO = 0x6474e552;

const MACHINES = { 3: 'x86', 40: 'arm', 62: 'x86_64', 183: 'arm64' };

export function parseElf(bytes) {
  if (bytes.length < 52 || bytes[0] !== 0x7f || bytes[1] !== 0x45 || bytes[2] !== 0x4c || bytes[3] !== 0x46) {
    return { ok: false, error: 'Not an ELF library' };
  }
  const is64 = bytes[4] === 2;
  const le = bytes[5] === 1;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, le);
  const u32 = (o) => dv.getUint32(o, le);
  const u64 = (o) => Number(dv.getBigUint64(o, le));

  if (bytes.length < (is64 ? 64 : 52)) return { ok: false, needBytes: is64 ? 64 : 52 };

  const machine = MACHINES[u16(18)] ?? `machine ${u16(18)}`;
  const phoff = is64 ? u64(32) : u32(28);
  const phentsize = is64 ? u16(54) : u16(42);
  const phnum = is64 ? u16(56) : u16(44);
  const need = phoff + phentsize * phnum;
  if (need > bytes.length) return { ok: false, needBytes: need };

  const segments = [];
  for (let i = 0; i < phnum; i++) {
    const b = phoff + i * phentsize;
    const type = u32(b);
    const seg = is64
      ? { type, vaddr: u64(b + 16), memsz: u64(b + 40), align: u64(b + 48) }
      : { type, vaddr: u32(b + 8), memsz: u32(b + 20), align: u32(b + 28) };
    segments.push(seg);
  }

  const loads = segments.filter((s) => s.type === PT_LOAD);
  const minLoadAlign = loads.length ? Math.min(...loads.map((s) => s.align)) : null;
  const relro = segments.find((s) => s.type === PT_GNU_RELRO);
  const relroEnd = relro ? relro.vaddr + relro.memsz : null;

  return {
    ok: true,
    is64,
    machine,
    loadCount: loads.length,
    minLoadAlign,
    loadAligned16k: minLoadAlign !== null && minLoadAlign >= PAGE_16K,
    relroEnd,
    relroAligned16k: relroEnd === null || relroEnd % PAGE_16K === 0,
  };
}

export function formatAlign(align) {
  if (align === null || align === undefined) return '—';
  const log = Math.log2(align);
  return Number.isInteger(log) ? `${align >= 1024 ? align / 1024 + ' KB' : align + ' B'} (2^${log})` : `${align} B`;
}
