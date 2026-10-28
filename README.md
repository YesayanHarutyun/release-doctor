# Release Doctor

**Find out exactly why Google Play is blocking your Android update, and how to fix it.**

Drop an `.aab`, `.apk`, `.aar` or `.so` file into the page. Release Doctor checks the two rules that block most updates today:

- **16 KB page size:** every 64-bit native library must be 16 KB-aligned.
- **Target API level:** new apps and updates must target API 36.

For each failing library it tells you **which plugin or SDK ships it**, the version that fixes it, and the command to run.

**Your app never leaves your computer.** The file is read with browser APIs only; nothing is uploaded. You can verify that in the source: the only network requests are for the site's own files.

## What it checks
| Check | Details |
|---|---|
| ELF LOAD alignment | Every `PT_LOAD` segment of each `.so` must be aligned to ≥ 16 KB. Only `arm64-v8a` and `x86_64` are gating; 32-bit ABIs are reported but not required. |
| APK packaging | Uncompressed (`extractNativeLibs=false`) libraries must start at a 16 KB-aligned offset inside the APK. |
| RELRO end | Warns when the `PT_GNU_RELRO` segment ends off a 16 KB boundary (known issue in AndroidX DataStore 1.2.0). |
| Target API | Reads `targetSdkVersion` from the binary manifest (APK) or the protobuf manifest (AAB). |
| Library → source | Maps known libraries (Flutter engine, rive, ML Kit, CameraX, DataStore, TensorFlow Lite, FFmpegKit, SQLite, React Native, Unity…) to the package that ships them and the fixed version. |

## Run locally
```bash
node serve.mjs               # http://localhost:5173
node test/run.mjs            # tests
node scripts/make-sample.mjs # regenerate the example APK
```
No dependencies and no build step: the site is plain HTML, CSS and ES modules.

## Contributing a library
Saw a failing library that Release Doctor doesn't recognise? Open an issue with the `.so` file name, the package that ships it, and the version that fixed it (with a link to a changelog or issue). Entries live in [`src/libdb.js`](src/libdb.js), and every entry is sourced.

---
Release Doctor is an independent tool and is not affiliated with or endorsed by Google. Google Play and Android are trademarks of Google LLC. Results are a best-effort check; Play Console is the final authority.
