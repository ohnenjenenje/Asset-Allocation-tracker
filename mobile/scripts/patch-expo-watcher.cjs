// Termux/proot-friendly patch: the host kernel caps inotify watches (~8k), while
// React Native's node_modules tree has ~9k dirs, so Metro's fallback watcher crashes
// with ENOSPC. This patch turns watcher errors into debug logs instead of fatal errors.
// The dev server still bundles correctly — fast-refresh may not notice every file change,
// restart `expo start` if needed.
const fs = require('fs');
const path = require('path');

const file = path.join(
  __dirname,
  '../node_modules/@expo/metro-file-map/build/watchers/FallbackWatcher.js'
);
if (!fs.existsSync(file)) {
  console.log('[patch-expo-watcher] watcher file not found, skipping');
  process.exit(0);
}
let src = fs.readFileSync(file, 'utf8');
let patched = false;

for (const oldSnippet of [
  'catch (error) {\n            // Directory can vanish before watch; filterDir must not throw.\n            this.#checkedEmitError(error);\n            return false;\n        }',
]) {
  const nw = oldSnippet.replace(
    'this.#checkedEmitError(error);',
    'console.debug?console.debug("[watcher] skipped after inotify limit:", error.code):0;'
  );
  if (src.includes(oldSnippet)) { src = src.replace(oldSnippet, nw); patched = true; }
}

// Also silence errors reported through watcher.on("error", ...)
const oldErr = "watcher.on('error', (error) => {\n            // Node emits no `close` after `error`.\n            if (this.#watched[dir] === watcher) {\n                delete this.#watched[dir];\n            }\n            watcher.close();\n            this.#checkedEmitError(error);\n        });";
const newErr = "watcher.on('error', (error) => {\n            if (this.#watched[dir] === watcher) {\n                delete this.#watched[dir];\n            }\n            watcher.close();\n            console.debug('[watcher] dropped watch after inotify limit:', error.code);\n        });";
if (src.includes(oldErr)) { src = src.replace(oldErr, newErr); patched = true; }

if (patched) {
  fs.writeFileSync(file, src);
  console.log('[patch-expo-watcher] FallbackWatcher patched');
} else {
  console.log('[patch-expo-watcher] already patched or source changed — no-op');
}
