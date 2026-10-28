import assert from 'node:assert/strict';
import { analyze } from '../src/analyze.js';
import { elf64, elf32, makeZip, axmlManifest, protoManifest } from './fixtures.mjs';

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
}

const group = (r, name) => r.groups.find((g) => g.name === name);

await test('APK: finds blockers, warnings, packaging issues and manifest', async () => {
  const apk = makeZip([
    { name: 'AndroidManifest.xml', data: axmlManifest({ pkg: 'com.example.app', minSdk: 21, targetSdk: 34, extractNativeLibs: false }) },
    { name: 'classes.dex', data: Buffer.from('dex\n035') },
    { name: 'lib/arm64-v8a/libflutter.so', data: elf64() },
    { name: 'lib/arm64-v8a/librive_text.so', data: elf64({ loads: [0x1000, 0x1000] }) },
    { name: 'lib/armeabi-v7a/librive_text.so', data: elf32({ loads: [0x1000] }) },
    { name: 'lib/x86_64/libdatastore_shared_counter.so', data: elf64({ machine: 62, relro: { vaddr: 0xc000, memsz: 0x1000 } }) },
    { name: 'lib/arm64-v8a/libmystery.so', data: elf64(), store: true, alignTo: 4096 + 1 },
    { name: 'lib/arm64-v8a/libsqlite3.so', data: elf64(), store: true, alignTo: 16384 },
  ]);
  const r = await analyze(new File([apk], 'app-release.apk'));

  assert.equal(r.kind, 'apk');
  assert.deepEqual(r.manifest, { packageName: 'com.example.app', minSdk: 21, targetSdk: 34, extractNativeLibs: false });
  assert.equal(r.targetApi.status, 'fail');
  assert.deepEqual(r.ecosystems, ['Flutter']);
  assert.equal(r.pageSize.status, 'fail');

  const rive = group(r, 'librive_text.so');
  assert.equal(rive.status, 'fail');
  assert.match(rive.known.source, /rive/);
  assert.equal(rive.items.find((i) => i.abi === 'armeabi-v7a').status, 'info');

  assert.equal(group(r, 'libmystery.so').status, 'fail');
  assert.match(group(r, 'libmystery.so').items[0].reason, /uncompressed/);
  assert.equal(group(r, 'libmystery.so').known, null);

  assert.equal(group(r, 'libdatastore_shared_counter.so').status, 'warn');
  assert.equal(group(r, 'libflutter.so').status, 'ok');
  assert.equal(group(r, 'libsqlite3.so').status, 'ok');
  assert.equal(r.groups[0].status, 'fail', 'failures sort first');
});

await test('AAB: reads protobuf manifest, passes when aligned', async () => {
  const aab = makeZip([
    { name: 'BundleConfig.pb', data: Buffer.alloc(0) },
    { name: 'base/manifest/AndroidManifest.xml', data: protoManifest({ pkg: 'com.example.aab', minSdk: 24, targetSdk: 36 }) },
    { name: 'base/lib/arm64-v8a/libflutter.so', data: elf64() },
    { name: 'base/lib/x86_64/libapp.so', data: elf64({ machine: 62 }) },
  ]);
  const r = await analyze(new File([aab], 'app-release.aab'));
  assert.equal(r.kind, 'aab');
  assert.equal(r.manifest.packageName, 'com.example.aab');
  assert.equal(r.manifest.minSdk, 24);
  assert.equal(r.manifest.targetSdk, 36);
  assert.equal(r.targetApi.status, 'ok');
  assert.equal(r.pageSize.status, 'ok');
});

await test('App with no native code is not affected', async () => {
  const apk = makeZip([
    { name: 'AndroidManifest.xml', data: axmlManifest({ pkg: 'com.example.plain', minSdk: 23, targetSdk: 36, extractNativeLibs: true }) },
    { name: 'classes.dex', data: Buffer.from('dex\n035') },
  ]);
  const r = await analyze(new File([apk], 'plain.apk'));
  assert.equal(r.pageSize.status, 'ok');
  assert.equal(r.pageSize.title, 'No native libraries');
  assert.equal(r.manifest.extractNativeLibs, true);
});

await test('Single .so file', async () => {
  const r = await analyze(new File([elf64({ loads: [0x1000] })], 'libfoo.so'));
  assert.equal(r.kind, 'so');
  assert.equal(r.pageSize.status, 'fail');
  assert.equal(r.targetApi.status, 'unknown');
});

await test('AAR with jni/ libraries', async () => {
  const aar = makeZip([
    { name: 'classes.jar', data: Buffer.alloc(10) },
    { name: 'jni/arm64-v8a/libtensorflowlite_jni.so', data: elf64({ loads: [0x1000] }) },
  ]);
  const r = await analyze(new File([aar], 'tflite.aar'));
  assert.equal(r.kind, 'aar');
  assert.equal(group(r, 'libtensorflowlite_jni.so').status, 'fail');
  assert.match(group(r, 'libtensorflowlite_jni.so').known.fix, /0\.12\.1/);
});

await test('Rejects files that are not packages', async () => {
  await assert.rejects(analyze(new File([Buffer.from('hello world')], 'notes.apk')), /not a ZIP/);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
