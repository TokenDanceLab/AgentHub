const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);
const defaultResolveRequest = config.resolver.resolveRequest;

// Watch the workspace shared package for changes during development.
// pnpm symlinks node_modules/@agenthub/shared -> ../../shared, and Metro
// resolves subpath exports via shared/package.json exports map automatically.
config.watchFolders = [
  ...(config.watchFolders || []),
  path.resolve(__dirname, '..', 'shared'),
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@/')) {
    return context.resolveRequest(
      context,
      path.join(__dirname, 'src', moduleName.slice(2)),
      platform,
    );
  }

  if (defaultResolveRequest) {
    return defaultResolveRequest(context, moduleName, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
