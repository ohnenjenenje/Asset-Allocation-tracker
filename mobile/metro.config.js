const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');
const path = require('path');

const config = getDefaultConfig(__dirname);

// Termux/proot kernel caps inotify watches (~8k); node_modules has ~9k dirs.
// Exclude heavy subtrees we never import so the file watcher stays under the limit.
const NO_WATCH = [
  /node_modules\/firebase\/compat\/.*/,
  /node_modules\/@firebase\/.*\/dist\/esm5\/.*\.map$/,
];

config.resolver = config.resolver || {};
config.resolver.blockList = NO_WATCH;

module.exports = withNativeWind(config, { input: './global.css' });
