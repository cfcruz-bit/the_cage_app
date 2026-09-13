// Metro en monorepo: solo hay que decirle que el motor vive fuera de apps/mobile.
// Nada más: expo/metro-config ya sabe resolver workspaces, y tocar el resto de
// la resolución es justo lo que expo-doctor marca como peligroso.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// Vigila todo el monorepo, para que un cambio en packages/engine recargue la app.
config.watchFolders = [workspaceRoot];

// Busca dependencias primero en la app y luego en la raíz del workspace.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

module.exports = config;
