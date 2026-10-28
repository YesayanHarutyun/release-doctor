// Generates samples/example-flutter-app.apk: a small synthetic Flutter APK with typical 16 KB problems,
// used by the "See an example report" button.
import { mkdir, writeFile } from 'node:fs/promises';
import { elf64, elf32, makeZip, axmlManifest } from '../test/fixtures.mjs';

const small = { padTo: 2048 };
const apk = makeZip([
  { name: 'AndroidManifest.xml', data: axmlManifest({ pkg: 'com.example.shop', minSdk: 23, targetSdk: 35, extractNativeLibs: false }) },
  { name: 'classes.dex', data: Buffer.from('dex\n035\0') },
  { name: 'lib/arm64-v8a/libflutter.so', data: elf64(small) },
  { name: 'lib/arm64-v8a/libapp.so', data: elf64(small) },
  { name: 'lib/arm64-v8a/librive_text.so', data: elf64({ ...small, loads: [0x1000, 0x1000] }) },
  { name: 'lib/arm64-v8a/libbarhopper_v3.so', data: elf64({ ...small, loads: [0x1000, 0x1000] }) },
  { name: 'lib/arm64-v8a/libdatastore_shared_counter.so', data: elf64({ ...small, relro: { vaddr: 0xc000, memsz: 0x1000 } }) },
  { name: 'lib/arm64-v8a/libsqlite3.so', data: elf64(small) },
  { name: 'lib/armeabi-v7a/libflutter.so', data: elf32({ loads: [0x1000] }) },
  { name: 'lib/armeabi-v7a/librive_text.so', data: elf32({ loads: [0x1000] }) },
  { name: 'lib/x86_64/libflutter.so', data: elf64({ ...small, machine: 62 }) },
  { name: 'lib/x86_64/librive_text.so', data: elf64({ ...small, machine: 62, loads: [0x1000, 0x1000] }) },
]);

await mkdir(new URL('../samples/', import.meta.url), { recursive: true });
await writeFile(new URL('../samples/example-flutter-app.apk', import.meta.url), apk);
console.log(`samples/example-flutter-app.apk (${apk.length} bytes)`);
