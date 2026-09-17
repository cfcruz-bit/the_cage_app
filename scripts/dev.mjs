/**
 * Levanta el entorno de desarrollo entero con un solo comando.
 *
 *     npm run dev
 *
 * Arranca la API y Metro a la vez y los deja atados: si cierras esto con
 * Ctrl+C, se cierran los dos. El motivo de que exista es que olvidarse de
 * levantar uvicorn produce un "sin conexión" en el móvil que parece un bug de
 * la app y no lo es.
 *
 * No usa `concurrently` ni ninguna dependencia: son cuarenta líneas de Node y
 * una dependencia menos que mantener al día con el SDK.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API_DIR = join(ROOT, 'services', 'api');
const MOBILE_DIR = join(ROOT, 'apps', 'mobile');
const IS_WINDOWS = process.platform === 'win32';

/** El uvicorn del entorno virtual, no el global. */
const UVICORN = IS_WINDOWS
  ? join(API_DIR, '.venv', 'Scripts', 'uvicorn.exe')
  : join(API_DIR, '.venv', 'bin', 'uvicorn');

if (!existsSync(UVICORN)) {
  console.error(
    `\nNo encuentro el entorno virtual de Python en:\n  ${UVICORN}\n\n` +
      'Créalo con:\n' +
      '  cd services/api\n' +
      (IS_WINDOWS
        ? '  py -m venv .venv\n  .venv\\Scripts\\activate\n'
        : '  python3 -m venv .venv\n  source .venv/bin/activate\n') +
      '  pip install -e ".[dev]"\n',
  );
  process.exit(1);
}

/** La IP de esta máquina en la red local. Solo para enseñarla. */
function lanAddress() {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) return address.address;
    }
  }
  return 'localhost';
}

const ip = lanAddress();

console.log('\n  THE CAGE · desarrollo');
console.log(`  API      http://${ip}:8000`);
console.log(`  Panel    http://${ip}:8000/admin`);
console.log(`  Docs     http://${ip}:8000/docs`);
console.log('\n  El móvil encuentra la API solo. No hay nada que configurar.');
console.log('  Ctrl+C cierra las dos cosas.\n');

const children = [];

function start(name, command, args, cwd, options = {}) {
  const child = spawn(command, args, {
    cwd,
    stdio: 'inherit',
    ...options,
  });

  child.on('exit', (code) => {
    // Si uno se cae, el otro no tiene sentido por su cuenta.
    if (!shuttingDown) {
      console.error(`\n[${name}] terminó con código ${code}. Cerrando el resto.`);
      shutdown();
    }
  });

  children.push(child);
  return child;
}

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    child.kill('SIGINT');
  }
  // Un margen para que cierren limpio antes de rendirse.
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start(
  'api',
  UVICORN,
  ['app.main:app', '--host', '0.0.0.0', '--port', '8000', '--reload'],
  API_DIR,
);

/**
 * Metro, arrancado sin pasar por el shell.
 *
 * Lo evidente sería `npx expo start`, pero en Windows `npx` es un `.cmd` y
 * Node solo ejecuta `.cmd` con `shell: true`, que desde Node 22 avisa de que
 * concatena los argumentos sin escaparlos (DEP0190). Aquí los argumentos son
 * constantes y no habría riesgo real, pero el aviso ensucia cada arranque y
 * la alternativa es mejor: se localiza el CLI de Expo dentro de node_modules y
 * se lanza con el mismo Node que corre este script. Sin shell, sin aviso, y
 * con la versión exacta que el proyecto tiene instalada.
 */
function startMetro() {
  const requireFromMobile = createRequire(join(MOBILE_DIR, 'package.json'));

  let cli;
  try {
    cli = requireFromMobile.resolve('@expo/cli/main.js');
  } catch {
    // Si Expo cambia la ruta de su CLI, se cae al camino de siempre en vez de
    // no arrancar. El aviso vuelve, pero el entorno funciona.
    console.warn('[dev] no encuentro el CLI de Expo; uso npx.');
    start('expo', 'npx', ['expo', 'start'], MOBILE_DIR, { shell: IS_WINDOWS });
    return;
  }

  start('expo', process.execPath, [cli, 'start'], MOBILE_DIR);
}

startMetro();
