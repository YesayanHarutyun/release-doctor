import { openZip, readEntry, dataOffset } from './zip.js';
import { parseElf, formatAlign, PAGE_16K } from './elf.js';
import { parseManifest } from './manifest.js';
import { identify, ECOSYSTEM_MARKERS } from './libdb.js';
import { CONFIG } from './config.js';

// Google Play's 16 KB rule applies to 64-bit ABIs only.
const GATING_ABIS = new Set(['arm64-v8a', 'x86_64']);
const LIB_PATH = /(?:^|\/)(?:lib|jni)\/([^/]+)\/([^/]+\.so)$/;
const SEVERITY = { fail: 4, warn: 3, unknown: 2, info: 1, ok: 0 };
const ABI_BY_MACHINE = { arm64: 'arm64-v8a', x86_64: 'x86_64', arm: 'armeabi-v7a', x86: 'x86' };

function detectKind(fileName, entries) {
  const names = entries.map((e) => e.name);
  const has = (n) => names.includes(n);
  if (has('BundleConfig.pb') || has('base/manifest/AndroidManifest.xml')) return 'aab';
  if (has('AndroidManifest.xml') && names.some((n) => /^classes\d*\.dex$/.test(n))) return 'apk';
  if (fileName.endsWith('.aar') || has('classes.jar')) return 'aar';
  if (names.some((n) => n.endsWith('.apk'))) return 'apk-set';
  return 'zip';
}

async function readElf(zip, entry) {
  let elf = parseElf(await readEntry(zip, entry, 16384));
  if (!elf.ok && elf.needBytes && elf.needBytes <= 1 << 20) {
    elf = parseElf(await readEntry(zip, entry, elf.needBytes));
  }
  return elf;
}

function judge(lib) {
  const { elf, gating, zipAligned } = lib;
  if (!elf.ok) return ['unknown', elf.error || 'Could not read the library headers'];
  if (!elf.loadAligned16k) {
    return gating
      ? ['fail', `LOAD segments aligned to ${formatAlign(elf.minLoadAlign)}; Google Play needs 16 KB`]
      : ['info', '32-bit ABI: not covered by Google Play\'s 16 KB rule'];
  }
  if (zipAligned === false) {
    return [gating ? 'fail' : 'info', 'Stored uncompressed but not 16 KB-aligned inside the APK; rebuild with AGP 8.5.1+ (or zipalign -P 16)'];
  }
  if (!elf.relroAligned16k) {
    return [gating ? 'warn' : 'info', 'RELRO segment ends off a 16 KB boundary; may trigger Android 16 compatibility warnings'];
  }
  return ['ok', '16 KB aligned'];
}

function makeLib(base, elf, zipAligned) {
  const lib = { ...base, gating: GATING_ABIS.has(base.abi), elf, zipAligned };
  [lib.status, lib.reason] = judge(lib);
  return lib;
}

function groupByName(libs) {
  const groups = new Map();
  for (const lib of libs) {
    if (!groups.has(lib.name)) groups.set(lib.name, { name: lib.name, known: identify(lib.name), items: [], status: 'ok' });
    const g = groups.get(lib.name);
    g.items.push(lib);
    if (SEVERITY[lib.status] > SEVERITY[g.status]) g.status = lib.status;
  }
  return [...groups.values()].sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || a.name.localeCompare(b.name));
}

function pageSizeVerdict(report) {
  const failing = report.groups.filter((g) => g.status === 'fail');
  if (!report.libs.length) {
    return { status: 'ok', title: 'No native libraries', detail: 'The 16 KB rule only affects apps that ship native (.so) code. Nothing to fix here.' };
  }
  if (failing.length) {
    const n = failing.length;
    return { status: 'fail', title: `Blocked: ${n} ${n === 1 ? 'library is' : 'libraries are'} not 16 KB-aligned`, detail: 'Google Play rejects updates whose 64-bit native libraries are not 16 KB-aligned.' };
  }
  if (!report.libs.some((l) => l.gating)) {
    return { status: 'warn', title: 'No 64-bit libraries found', detail: 'Google Play requires 64-bit (arm64-v8a) native code. Check that your build includes it.' };
  }
  if (report.groups.some((g) => g.status === 'warn' || g.status === 'unknown')) {
    return { status: 'warn', title: 'Passes, with warnings', detail: 'All 64-bit LOAD segments are 16 KB-aligned, but some libraries need a closer look.' };
  }
  return { status: 'ok', title: 'All 64-bit native libraries are 16 KB-aligned', detail: 'This build meets Google Play\'s 16 KB page-size requirement.' };
}

function targetApiVerdict(report) {
  const t = report.manifest?.targetSdk;
  const req = CONFIG.requiredTargetApi;
  if (report.kind === 'aar' || report.kind === 'so') {
    return { status: 'unknown', title: 'Target API: not applicable', detail: 'Libraries don\'t declare a target API; check the app that uses them.' };
  }
  if (t === null || t === undefined) {
    return { status: 'unknown', title: 'Target API not found', detail: 'Could not read targetSdkVersion from the manifest.' };
  }
  if (typeof t !== 'number') {
    return { status: 'warn', title: `Target API: ${t}`, detail: 'This looks like a preview codename; Google Play does not accept preview targets.' };
  }
  if (t >= req) {
    return { status: 'ok', title: `Targets API ${t}`, detail: `Meets Google Play's current requirement (API ${req}).` };
  }
  return { status: 'fail', title: `Targets API ${t}; Google Play requires ${req}`, detail: `New apps and app updates must target API ${req}. Updates to this build will be rejected.` };
}

export async function analyze(file) {
  const report = { fileName: file.name, fileSize: file.size, kind: null, manifest: null, libs: [], notes: [] };
  const lower = file.name.toLowerCase();

  if (lower.endsWith('.so')) {
    report.kind = 'so';
    const elf = parseElf(new Uint8Array(await file.slice(0, 1 << 20).arrayBuffer()));
    const abi = ABI_BY_MACHINE[elf.machine] ?? 'arm64-v8a';
    report.libs.push(makeLib({ path: file.name, abi, name: file.name }, elf, null));
  } else {
    const zip = await openZip(file);
    report.kind = detectKind(lower, zip.entries);
    if (report.kind === 'apk-set') {
      report.notes.push('This looks like a split-APK set (.apks / .xapk / .apkm). Upload the base APK inside it, or your .aab.');
    }

    const manifestPath = report.kind === 'aab' ? 'base/manifest/AndroidManifest.xml' : 'AndroidManifest.xml';
    const manifestEntry = zip.entries.find((e) => e.name === manifestPath);
    if (manifestEntry) {
      try {
        report.manifest = parseManifest(await readEntry(zip, manifestEntry, 8 << 20));
      } catch (e) {
        report.notes.push(`Could not read AndroidManifest.xml: ${e.message}`);
      }
    }

    for (const entry of zip.entries) {
      const m = LIB_PATH.exec(entry.name);
      if (!m) continue;
      let elf;
      try {
        elf = await readElf(zip, entry);
      } catch (e) {
        elf = { ok: false, error: e.message };
      }
      const zipAligned = report.kind === 'apk' && entry.method === 0 ? (await dataOffset(zip, entry)) % PAGE_16K === 0 : null;
      report.libs.push(makeLib({ path: entry.name, abi: m[1], name: m[2], compressed: entry.method !== 0 }, elf, zipAligned));
    }
  }

  const names = report.libs.map((l) => l.name);
  report.ecosystems = [...new Set(ECOSYSTEM_MARKERS.filter((mk) => names.some((n) => mk.match.test(n))).map((mk) => mk.ecosystem))];
  report.groups = groupByName(report.libs);
  report.pageSize = pageSizeVerdict(report);
  report.targetApi = targetApiVerdict(report);
  return report;
}
