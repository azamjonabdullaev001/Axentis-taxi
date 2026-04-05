const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedDir = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Allow Metro to resolve modules from the shared/ folder outside the project
config.watchFolders = [sharedDir];

// Redirect native-only packages to web stubs when bundling for web
const webStubs = {
  'react-native-maps': path.resolve(projectRoot, 'stubs/react-native-maps.js'),
};

// Capture Expo's resolver BEFORE overwriting it so we can chain properly
const expoResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && webStubs[moduleName]) {
    return { type: 'sourceFile', filePath: webStubs[moduleName] };
  }
  if (expoResolveRequest) {
    return expoResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
