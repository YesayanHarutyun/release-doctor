import { analyze } from './analyze.js';
import { formatAlign } from './elf.js';
import { UNKNOWN_FIX } from './libdb.js';
import { CONFIG } from './config.js';

const STATUS_LABEL = { fail: 'Blocked', warn: 'Warning', ok: 'OK', info: 'Not required', unknown: 'Unknown' };
const KIND_LABEL = { apk: 'APK', aab: 'App bundle (AAB)', aar: 'Android library (AAR)', so: 'Native library', 'apk-set': 'Split APK set', zip: 'ZIP archive' };

function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const badge = (status) => h('span', { class: `badge b-${status}` }, STATUS_LABEL[status]);

function formatSize(bytes) {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function codeBlock(lines) {
  const text = lines.join('\n');
  const btn = h('button', { class: 'btn copy', type: 'button' }, 'Copy');
  btn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch {
      btn.textContent = 'Select & copy';
    }
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  });
  return h('div', { class: 'code' }, h('pre', {}, h('code', {}, text)), btn);
}

function verdictCard(label, verdict) {
  return h('div', { class: `card verdict s-${verdict.status}` },
    h('p', { class: 'verdict-label' }, label),
    h('h3', {}, verdict.title),
    h('p', {}, verdict.detail));
}

function metaRow(report) {
  const m = report.manifest ?? {};
  const item = (k, v) => (v === null || v === undefined || v === '' ? null : h('span', {}, `${k}: `, h('b', {}, String(v))));
  return h('div', { class: 'meta' },
    item('Type', KIND_LABEL[report.kind] ?? report.kind),
    item('Size', formatSize(report.fileSize)),
    item('Package', m.packageName),
    item('minSdk', m.minSdk),
    item('targetSdk', m.targetSdk),
    item('Built with', report.ecosystems.join(', ')),
    item('Native libraries', new Set(report.libs.map((l) => l.name)).size));
}

function targetApiFix(report) {
  const flutter = report.ecosystems.includes('Flutter');
  const req = CONFIG.requiredTargetApi;
  return h('div', { class: 'card fix' },
    h('div', { class: 'fix-head' }, h('h4', {}, `targetSdk ${report.manifest.targetSdk} → ${req}`), badge('fail')),
    h('p', { class: 'fix-source' }, 'Your app module\'s Gradle configuration'),
    h('p', { class: 'fix-text' }, `Raise compileSdk and targetSdk to ${req} and upgrade the Android Gradle Plugin to a version that supports API ${req}. Then test the Android 16 behavior changes:`),
    h('ul', {},
      h('li', {}, 'Edge-to-edge display can no longer be switched off; check that content isn\'t hidden behind system bars.'),
      h('li', {}, 'Predictive back gestures are on by default; custom back handling may need updating.'),
      h('li', {}, 'On large screens, orientation and resizability restrictions are ignored; check tablet and foldable layouts.')),
    codeBlock(flutter
      ? ['// android/app/build.gradle(.kts)', 'android {', `    compileSdk = ${req}`, '    defaultConfig {', `        targetSdk = ${req}`, '    }', '}']
      : ['android {', `    compileSdk = ${req}`, '    defaultConfig {', `        targetSdk = ${req}`, '    }', '}']));
}

function libraryFix(group) {
  const info = group.known ?? UNKNOWN_FIX;
  const abis = group.items.filter((i) => i.status === group.status).map((i) => i.abi);
  const reasons = [...new Set(group.items.filter((i) => i.status === group.status).map((i) => i.reason))];
  return h('div', { class: 'card fix' },
    h('div', { class: 'fix-head' },
      h('h4', {}, group.name),
      badge(group.status),
      h('span', { class: 'fix-abis' }, abis.join(' · '))),
    h('p', { class: 'fix-source' }, 'Shipped by: ', h('b', {}, info.source)),
    h('p', { class: 'fix-text' }, reasons.join('. ') + '.'),
    h('p', { class: 'fix-text' }, h('b', {}, 'Fix: '), info.fix),
    info.commands?.length ? codeBlock(info.commands) : null,
    info.links?.length ? h('div', { class: 'links' }, info.links.map((l) => h('a', { href: l.url, target: '_blank', rel: 'noopener' }, l.label))) : null,
    info.confidence && info.confidence !== 'confirmed'
      ? h('p', { class: 'confidence' }, info.confidence === 'reported'
        ? 'Based on multiple developer reports. Re-scan your build after upgrading to confirm.'
        : 'Based on limited reports. Re-scan your build after upgrading to confirm.')
      : null);
}

function ctaCards() {
  const cards = [];
  if (CONFIG.fixServiceUrl) {
    cards.push(h('div', { class: 'card cta-main' },
      h('h3', {}, 'Rather not spend your weekend on Gradle?'),
      h('p', {}, 'Get it fixed for you: plugin upgrades, target API 36 and 16 KB alignment, with a signed build ready to upload. Fixed price.'),
      h('a', { class: 'btn btn-primary', href: CONFIG.fixServiceUrl, target: '_blank', rel: 'noopener' }, 'Get it fixed')));
  }
  if (CONFIG.discordUrl) {
    cards.push(h('div', { class: 'card' },
      h('h3', {}, 'Stuck on a library?'),
      h('p', {}, 'Ask in the Discord. Other developers have probably hit the same one.'),
      h('a', { class: 'btn', href: CONFIG.discordUrl, target: '_blank', rel: 'noopener' }, 'Join the Discord')));
  }
  if (CONFIG.alertsUrl) {
    cards.push(h('div', { class: 'card' },
      h('h3', {}, 'Don\'t get caught by the next deadline'),
      h('p', {}, 'Google raises the target API every year (API 37 is expected in August 2027). Get one email before it bites.'),
      h('a', { class: 'btn', href: CONFIG.alertsUrl, target: '_blank', rel: 'noopener' }, 'Get deadline alerts')));
  }
  return cards.length ? h('div', { class: 'cta' }, cards) : null;
}

function libTable(report) {
  if (!report.libs.length) return null;
  const rows = [...report.libs]
    .sort((a, b) => a.name.localeCompare(b.name) || a.abi.localeCompare(b.abi))
    .map((l) => h('tr', {},
      h('td', { class: 'mono' }, l.name),
      h('td', {}, l.abi),
      h('td', {}, l.elf.ok ? formatAlign(l.elf.minLoadAlign) : '—'),
      h('td', {}, l.zipAligned === null ? (l.compressed ? 'compressed' : '—') : l.zipAligned ? 'uncompressed, aligned' : 'uncompressed, NOT aligned'),
      h('td', {}, badge(l.status))));
  return h('details', { class: 'all-libs' },
    h('summary', {}, `All native libraries (${report.libs.length} files)`),
    h('div', { class: 'table-wrap' },
      h('table', {},
        h('thead', {}, h('tr', {}, ['Library', 'ABI', 'LOAD alignment', 'Packaging', 'Status'].map((t) => h('th', {}, t)))),
        h('tbody', {}, rows))));
}

function renderReport(report) {
  const fixes = [];
  if (report.targetApi.status === 'fail') fixes.push(targetApiFix(report));
  for (const g of report.groups) {
    if (g.status === 'fail' || g.status === 'warn' || g.status === 'unknown') fixes.push(libraryFix(g));
  }

  return [
    h('div', { class: 'results-head' },
      h('h2', {}, report.fileName),
      h('button', { class: 'btn', type: 'button', onclick: () => fileInput.click() }, 'Scan another file')),
    report.notes.map((n) => h('div', { class: 'notice' }, n)),
    h('div', { class: 'verdicts' },
      verdictCard('16 KB page size', report.pageSize),
      verdictCard('Target API level', report.targetApi)),
    metaRow(report),
    fixes.length
      ? [h('h3', { class: 'section-title' }, `What to fix (${fixes.length})`), h('div', { class: 'fixes' }, fixes)]
      : h('div', { class: 'card' }, h('h3', { style: 'margin:0 0 6px' }, 'Nothing to fix'), h('p', { style: 'margin:0;color:var(--muted)' }, 'This build passes both checks. If Play Console still complains, make sure you uploaded this exact build.')),
    ctaCards(),
    libTable(report),
  ];
}

const results = document.getElementById('results');
const drop = document.getElementById('drop');
const fileInput = document.getElementById('file');

async function handleFile(file) {
  if (!file) return;
  results.hidden = false;
  results.replaceChildren(h('div', { class: 'loading' }, h('span', { class: 'spinner' }), `Reading ${file.name}…`));
  drop.classList.add('is-busy');
  try {
    const report = await analyze(file);
    results.replaceChildren(...renderReport(report).flat().filter(Boolean));
  } catch (e) {
    console.error(e);
    results.replaceChildren(h('div', { class: 'error' },
      h('b', {}, 'Could not read this file. '),
      e.message || String(e),
      h('p', { style: 'margin:8px 0 0' }, 'Release Doctor reads .aab, .apk, .aar and .so files.')));
  } finally {
    drop.classList.remove('is-busy');
    fileInput.value = '';
    results.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

fileInput.addEventListener('change', () => handleFile(fileInput.files[0]));

document.getElementById('sample').addEventListener('click', async () => {
  const res = await fetch('samples/example-flutter-app.apk');
  handleFile(new File([await res.blob()], 'example-flutter-app.apk'));
});

for (const target of [drop, document.body]) {
  target.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-over');
  });
  target.addEventListener('dragleave', (e) => {
    if (e.target === drop || !drop.contains(e.relatedTarget)) drop.classList.remove('is-over');
  });
  target.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-over');
    handleFile(e.dataTransfer.files[0]);
  });
}
