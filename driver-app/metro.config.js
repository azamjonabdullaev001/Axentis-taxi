const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const sharedDir = path.resolve(projectRoot, '../shared');

const config = getDefaultConfig(projectRoot);

// Allow Metro to resolve modules from the shared/ folder outside the project
config.watchFolders = [sharedDir];

module.exports = config;
