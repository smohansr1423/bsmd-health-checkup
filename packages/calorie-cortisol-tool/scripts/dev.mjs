#!/usr/bin/env node
/**
 * One-command local dev runner for the Calorie & Cortisol Tool.
 *
 * Boots the whole backend + demo UI with in-memory adapters (NO external
 * databases/queues required):
 *
 *   gateway         :8080   (Node)   real buildGateway pipeline + reverse proxy
 *   user-profile    :8081   (Go)     in-memory stores
 *   cortisol-data   :8082   (Node)   in-memory / pure functions
 *   notification    :8083   (Node)   in-memory Fake* transports
 *   food-vision     :8084   (Python) FastAPI + in-memory routers
 *   nutrition-lookup:8085   (Python) FastAPI + in-memory backends
 *   insights-ml     :8086   (Python) FastAPI + in-memory
 *   pwa demo        :5173   (Vite)   proxies /api → gateway
 *
 * Uses ONLY locally installed toolchains. Configurable via env:
 *   GO_BIN       path to the (portable) go binary
 *   PYTHON_BIN   python interpreter to run uvicorn with (default: ./.venv)
 *   USE_POETRY=1 run the Python services via `poetry run uvicorn` instead
 *
 * Streams labelled, colourised output and shuts every child down cleanly on
 * Ctrl+C.
 */

import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { existsSync } from 'node:fs';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// --- configuration (env-overridable, Windows-friendly defaults) ------------
const GO_BIN =
  process.env.GO_BIN ||
  'C:\\Users\\P2775899\\AppData\\Local\\goportable\\go\\bin\\go.exe';

const VENV_PY = join(
  ROOT,
  '.venv',
  process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python',
);
const PYTHON_BIN =
  process.env.PYTHON_BIN || (existsSync(VENV_PY) ? VENV_PY : 'python');
const USE_POETRY = process.env.USE_POETRY === '1';

const SHARED_PYTHON = join(ROOT, 'shared', 'python');

// --- ANSI colours for labelled output --------------------------------------
const COLOURS = [36, 32, 33, 35, 34, 92, 93, 95];
const children = [];
let shuttingDown = false;

function label(name, colour) {
  return `\x1b[${colour}m[${name}]\x1b[0m`;
}

function pipe(name, colour, stream) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buf += chunk;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      process.stdout.write(`${label(name, colour)} ${line}\n`);
    }
  });
  stream.on('end', () => {
    if (buf.trim()) process.stdout.write(`${label(name, colour)} ${buf}\n`);
  });
}

/**
 * Spawn a labelled long-running child.
 * @param {string} name       label
 * @param {string} command    executable
 * @param {string[]} args      arguments
 * @param {object} opts        { cwd, env, port }
 */
function launch(name, command, args, opts = {}) {
  const colour = COLOURS[children.length % COLOURS.length];
  const env = { ...process.env, ...(opts.env || {}) };
  if (opts.port) env.PORT = String(opts.port);

  process.stdout.write(
    `${label(name, colour)} starting: ${command} ${args.join(' ')}\n`,
  );

  const child = spawn(command, args, {
    cwd: opts.cwd || ROOT,
    env,
    shell: false,
    windowsHide: true,
  });

  pipe(name, colour, child.stdout);
  pipe(name, colour, child.stderr);

  child.on('exit', (code, signal) => {
    if (!shuttingDown) {
      process.stdout.write(
        `${label(name, colour)} exited (code=${code}, signal=${signal})\n`,
      );
    }
  });
  child.on('error', (err) => {
    process.stdout.write(`${label(name, colour)} spawn error: ${err.message}\n`);
  });

  children.push({ name, child });
  return child;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  process.stdout.write('\n\x1b[1mShutting down all services...\x1b[0m\n');
  for (const { child } of children) {
    try {
      child.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  // Give children a moment, then force-exit.
  setTimeout(() => process.exit(0), 1500);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- helpers ----------------------------------------------------------------
function runToCompletion(name, command, args, opts = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const colour = 90;
    process.stdout.write(
      `${label(name, colour)} ${command} ${args.join(' ')}\n`,
    );
    const child = spawn(command, args, {
      cwd: opts.cwd || ROOT,
      env: { ...process.env, ...(opts.env || {}) },
      shell: false,
      windowsHide: true,
      stdio: 'inherit',
    });
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : rejectPromise(new Error(`${name} exited ${code}`)),
    );
    child.on('error', rejectPromise);
  });
}

function pythonService(name, dir, port) {
  const cwd = join(ROOT, 'services', dir);
  const env = { PYTHONPATH: `${SHARED_PYTHON}` };
  if (USE_POETRY) {
    return launch(
      name,
      'poetry',
      ['run', 'uvicorn', 'app.main:app', '--port', String(port), '--host', '0.0.0.0'],
      { cwd, env, port },
    );
  }
  return launch(
    name,
    PYTHON_BIN,
    ['-m', 'uvicorn', 'app.main:app', '--port', String(port), '--host', '0.0.0.0'],
    { cwd, env, port },
  );
}

// --- main -------------------------------------------------------------------
async function main() {
  // 1. Build the TypeScript packages once (shared, gateway, node services, pwa
  //    lib) so `node dist/server.js` has fresh output.
  const tscBin = require.resolve('typescript/bin/tsc');
  try {
    await runToCompletion('build', process.execPath, [tscBin, '--build'], {
      cwd: ROOT,
    });
  } catch (err) {
    process.stdout.write(
      `\x1b[31mTypeScript build failed: ${err.message}. Aborting.\x1b[0m\n`,
    );
    process.exit(1);
  }

  // 2. Go user-profile (portable go, in-memory stores).
  launch('user-profile', GO_BIN, ['run', '.'], {
    cwd: join(ROOT, 'services', 'user-profile'),
    port: 8081,
  });

  // 3. Node services (compiled dist).
  launch('cortisol-data', process.execPath, ['dist/server.js'], {
    cwd: join(ROOT, 'services', 'cortisol-data'),
    port: 8082,
  });
  launch('notification', process.execPath, ['dist/server.js'], {
    cwd: join(ROOT, 'services', 'notification'),
    port: 8083,
  });

  // 4. Python FastAPI services (uvicorn).
  pythonService('food-vision', 'food-vision', 8084);
  pythonService('nutrition-lookup', 'nutrition-lookup', 8085);
  pythonService('insights-ml', 'insights-ml', 8086);

  // 5. Gateway (compiled dist) — reverse-proxies to the above.
  launch('gateway', process.execPath, ['dist/server.js'], {
    cwd: join(ROOT, 'gateway'),
    port: 8080,
  });

  // 6. PWA demo (Vite dev server, proxies /api → gateway).
  const viteBin = require.resolve('vite/bin/vite.js');
  launch('pwa', process.execPath, [viteBin], {
    cwd: join(ROOT, 'clients', 'pwa'),
    port: 5173,
  });

  process.stdout.write(
    '\n\x1b[1mAll services launching. Open the demo at http://localhost:5173\x1b[0m\n' +
      'Press Ctrl+C to stop everything.\n\n',
  );
}

main().catch((err) => {
  process.stdout.write(`\x1b[31mdev runner error: ${err.message}\x1b[0m\n`);
  shutdown();
});
