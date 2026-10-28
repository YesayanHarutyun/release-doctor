// Known native libraries: which plugin/SDK ships them and what fixes 16 KB alignment.
// confidence: 'confirmed' = official changelog/docs; 'reported' = multiple developer reports; 'likely' = single/indirect source.
// Keep every entry sourced. Add new libraries as they show up in real reports.

export const LIBS = [
  {
    match: /^libflutter\.so$/,
    source: 'Flutter engine',
    ecosystem: 'Flutter',
    fix: 'Upgrade Flutter to the latest stable release and rebuild. Community guides treat 3.32.8+ as the safe baseline; the engine itself is rarely the culprit on recent versions.',
    commands: ['flutter upgrade', 'flutter clean', 'flutter build appbundle --release'],
    confidence: 'reported',
    links: [{ label: 'Fix guide (Flutter / MAUI)', url: 'https://startdebugging.net/2026/08/fix-google-play-rejects-flutter-or-maui-app-for-16-kb-page-size/' }],
  },
  {
    match: /^libapp\.so$/,
    source: 'Your compiled Dart code (Flutter AOT snapshot)',
    ecosystem: 'Flutter',
    fix: 'Built by the Flutter toolchain. Upgrading Flutter and rebuilding produces an aligned libapp.so.',
    commands: ['flutter upgrade', 'flutter build appbundle --release'],
    confidence: 'reported',
    links: [],
  },
  {
    match: /^librive_text\.so$/,
    source: 'rive (Flutter package) — via rive_common',
    ecosystem: 'Flutter',
    fix: 'rive 0.13.x ships 4 KB-aligned native libraries. Move to the 0.14.x runtime (a major release with a migration guide), or as a stop-gap build rive_common with NDK r28 (ndkVersion "28.2.13676358").',
    commands: ['flutter pub upgrade --major-versions rive'],
    confidence: 'reported',
    links: [
      { label: 'rive-flutter issue #527', url: 'https://github.com/rive-app/rive-flutter/issues/527' },
      { label: 'Rive 0.14.0 stable announcement', url: 'https://community.rive.app/c/announcements/flutter-runtime-0-14-0-is-now-stable' },
    ],
  },
  {
    match: /^libbarhopper_v3\.so$/,
    source: 'Google ML Kit barcode scanning (used by mobile_scanner, google_mlkit_barcode_scanning and many QR plugins)',
    ecosystem: 'Android SDK',
    fix: 'Upgrade com.google.mlkit:barcode-scanning to 17.3.0 or newer — or a plugin version that bundles it — and use AGP 8.5.1+. A few projects still saw failures on 17.3.0 with older build tools.',
    commands: ['flutter pub upgrade mobile_scanner'],
    confidence: 'reported',
    links: [
      { label: 'googlesamples/mlkit #976', url: 'https://github.com/googlesamples/mlkit/issues/976' },
      { label: 'Example fix PR (CameraX 1.4.2 + ML Kit 17.3.0)', url: 'https://github.com/tranvuongquocdat/SideScreen/pull/93' },
    ],
  },
  {
    match: /^libimage_processing_util_jni\.so$/,
    source: 'AndroidX CameraX (used by the camera plugin, mobile_scanner and others)',
    ecosystem: 'Android SDK',
    fix: 'CameraX 1.2.x/1.3.x are 4 KB-aligned. Upgrade androidx.camera:* to 1.4.0 or newer (1.4.2 is widely used), or a plugin version that depends on it.',
    commands: ['flutter pub upgrade camera mobile_scanner'],
    confidence: 'reported',
    links: [{ label: 'Example fix PR (CameraX 1.3.4 → 1.4.2)', url: 'https://github.com/blackmouthriver/DocuSmart/pull/146' }],
  },
  {
    match: /^libsurface_util_jni\.so$/,
    source: 'AndroidX CameraX (camera-core)',
    ecosystem: 'Android SDK',
    fix: 'Upgrade androidx.camera:* to 1.4.0 or newer, as for libimage_processing_util_jni.so.',
    commands: [],
    confidence: 'likely',
    links: [],
  },
  {
    match: /^libdatastore_shared_counter\.so$/,
    source: 'AndroidX DataStore (pulled in by shared_preferences_android 2.4.x and others)',
    ecosystem: 'Android SDK',
    fix: 'DataStore 1.2.0 has a RELRO segment that ends off a 16 KB boundary. Upgrade androidx.datastore to 1.2.1 or newer (or a shared_preferences version that depends on it).',
    commands: ['flutter pub upgrade shared_preferences'],
    confidence: 'reported',
    links: [
      { label: 'flutter/flutter #182744', url: 'https://github.com/flutter/flutter/issues/182744' },
      { label: 'flutter/flutter #182898', url: 'https://github.com/flutter/flutter/issues/182898' },
    ],
  },
  {
    match: /^libtensorflowlite(_gpu)?_jni\.so$/,
    source: 'TensorFlow Lite / LiteRT (tflite_flutter and others)',
    ecosystem: 'Android SDK',
    fix: 'tflite_flutter: upgrade to 0.12.1 or newer (moves to LiteRT 1.4.0). 0.12.0 claimed support but was not compatible.',
    commands: ['flutter pub upgrade tflite_flutter'],
    confidence: 'reported',
    links: [{ label: 'tflite_flutter changelog', url: 'https://pub.dev/packages/tflite_flutter/changelog' }],
  },
  {
    match: /^lib(ffmpegkit|ffmpegkit_abidetect|avcodec|avdevice|avfilter|avformat|avutil|swresample|swscale)\.so$/,
    source: 'FFmpeg — usually ffmpeg_kit_flutter (retired; ships 4 KB-aligned binaries)',
    ecosystem: 'Flutter',
    fix: 'The original FFmpegKit is retired. Switch to a maintained fork that ships 16 KB-aligned binaries — check its maintenance status and licence before adopting it.',
    commands: [],
    confidence: 'reported',
    links: [{ label: 'ffmpeg_kit_16kb on pub.dev', url: 'https://pub.dev/documentation/ffmpeg_kit_16kb/latest/' }],
  },
  {
    match: /^libsqlite3\.so$/,
    source: 'SQLite — in Flutter usually sqlite3_flutter_libs (drift, sqflite_common_ffi, Amplify)',
    ecosystem: 'Flutter',
    fix: 'sqlite3_flutter_libs added 16 KB support in 0.5.25. The package is now end-of-life, so plan a move to sqlite3 3.x, which no longer needs it.',
    commands: ['flutter pub upgrade sqlite3_flutter_libs'],
    confidence: 'confirmed',
    links: [{ label: 'sqlite3_flutter_libs changelog', url: 'https://pub.dev/packages/sqlite3_flutter_libs/changelog' }],
  },
  {
    match: /^lib(hermes|hermestooling|jsi|jsc|reactnativejni|fbjni|react_nativemodule_core|turbomodulejsijni|jscexecutor|folly_runtime|glog|yoga|reactnative)\.so$/,
    source: 'React Native',
    ecosystem: 'React Native',
    fix: 'Upgrade React Native to 0.77 or newer (0.81+ recommended), use AGP 8.5.1+ and NDK r28+, then check each third-party native module.',
    commands: [],
    confidence: 'confirmed',
    links: [{ label: 'React Native 0.77 release notes', url: 'https://reactnative.dev/blog/2025/01/21/version-0.77' }],
  },
  {
    match: /^lib(unity|il2cpp|main|burst_generated)\.so$/,
    source: 'Unity engine',
    ecosystem: 'Unity',
    fix: 'Upgrade Unity to 2022.3.56f1+, 2021.3.48f1+ (extended LTS) or 6000.0.38f1+, then rebuild. Outdated Unity plugins can still fail — Play Console → App bundle explorer → Memory page size names them.',
    commands: [],
    confidence: 'confirmed',
    links: [{ label: 'Unity announcement', url: 'https://discussions.unity.com/t/android-unity-engine-support-for-16-kb-memory-page-sizes-android-15/1589588' }],
  },
  {
    match: /^libc\+\+_shared\.so$/,
    source: 'C++ runtime from the NDK, bundled by one of your native dependencies',
    ecosystem: 'Android SDK',
    fix: 'Whichever library bundles it must be rebuilt with NDK r28+ (or r27 with 16 KB linker flags). Upgrade the native dependencies that ship it; for your own C/C++ code set ndkVersion to r28+.',
    commands: [],
    confidence: 'reported',
    links: [],
  },
];

export const ECOSYSTEM_MARKERS = [
  { match: /^libflutter\.so$/, ecosystem: 'Flutter' },
  { match: /^lib(reactnativejni|hermes|reactnative)\.so$/, ecosystem: 'React Native' },
  { match: /^lib(unity|il2cpp)\.so$/, ecosystem: 'Unity' },
  { match: /^libmonosgen-2\.0\.so$/, ecosystem: '.NET for Android / MAUI' },
];

export function identify(libName) {
  return LIBS.find((l) => l.match.test(libName)) ?? null;
}

export const UNKNOWN_FIX = {
  source: 'Unknown — not in our database yet',
  fix: 'Find which dependency ships it: after a release build, search your project\'s build/ folder and ~/.gradle/caches for this file name — the folder or AAR name tells you the library. Upgrade it to a release built with NDK r28+. Play Console → App bundle explorer → Memory page size also lists the offending libraries.',
  commands: [],
  confidence: null,
  links: [{ label: 'Android: Support 16 KB page sizes', url: 'https://developer.android.com/guide/practices/page-sizes' }],
};
