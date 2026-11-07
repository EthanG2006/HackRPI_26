#!/usr/bin/env node
// One launcher for Windows, macOS and Linux.
//   npm run setup     install web deps + Python venv
//   npm run dev       Vite dev server (hot reload) + API with --reload
//   npm run demo      production build (rebuilt only if sources changed) + API, opens the browser
//   npm run pipeline  rebuild data/processed and web/public/data from the raw sources
// Flags: --no-open (don't open a browser), --no-api (frontend only)
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(root, 'web');
const mode = process.argv[2] ?? 'dev';
const flags = new Set(process.argv.slice(3));
const isWin = process.platform === 'win32';
const URL = 'http://localhost:5173';
const venvPython = join(root, '.venv', isWin ? 'Scripts/python.exe' : 'bin/python');

const children = [];

function runSync(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell: isWin, ...opts });
  return r.status === 0;
}

function start(name, cmd, args, opts = {}) {
  const p = spawn(cmd, args, { cwd: root, shell: isWin, stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  const out = (stream) => (buf) =>
    stream.write(
      buf
        .toString()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((l) => `[${name}] ${l}\n`)
        .join(''),
    );
  p.stdout.on('data', out(process.stdout));
  p.stderr.on('data', out(process.stderr));
  p.on('exit', (code) => console.log(`[${name}] exited (${code})${name === 'api' ? ' — the frontend keeps working on cached data' : ''}`));
  children.push(p);
  return p;
}

function stopAll() {
  for (const p of children) {
    if (p.exitCode !== null) continue;
    if (isWin) spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
    else p.kill('SIGTERM');
  }
}
process.on('SIGINT', () => (stopAll(), process.exit(0)));
process.on('SIGTERM', () => (stopAll(), process.exit(0)));

function systemPython() {
  const candidates = isWin ? [['py', ['-3.12']], ['py', ['-3.11']], ['python', []]] : [['python3.12', []], ['python3', []]];
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '--version'], { shell: isWin, encoding: 'utf8' });
    if (r.status === 0 && /Python 3\.(1[1-3])/.test(r.stdout + r.stderr)) return [cmd, pre];
  }
  return null;
}

function setup({ full }) {
  if (!existsSync(join(web, 'node_modules'))) {
    console.log('[setup] installing web dependencies…');
    runSync('npm', ['install', '--prefix', 'web', '--no-audit', '--no-fund']);
  }
  if (!existsSync(venvPython)) {
    const py = systemPython();
    if (!py) {
      console.warn('[setup] Python 3.11–3.13 not found. The app runs without the API (cached data, scripted copilot).');
      return;
    }
    console.log('[setup] creating .venv…');
    runSync(py[0], [...py[1], '-m', 'venv', '.venv']);
  }
  const req = full ? 'pipeline/requirements.txt' : 'server/requirements.txt';
  const probe = full ? 'import lightgbm, shap, geopandas' : 'import fastapi, uvicorn, numpy, scipy';
  if (spawnSync(venvPython, ['-c', probe]).status !== 0) {
    console.log(`[setup] installing Python packages (${req})…`);
    runSync(venvPython, ['-m', 'pip', 'install', '-q', '-r', req]);
  }
}

function newestMtime(dir) {
  let newest = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return newest;
}

function buildIfStale() {
  const index = join(web, 'dist', 'index.html');
  const srcTime = Math.max(newestMtime(join(web, 'src')), newestMtime(join(web, 'public')), statSync(join(web, 'index.html')).mtimeMs);
  if (existsSync(index) && statSync(index).mtimeMs > srcTime) return console.log('[demo] build is up to date');
  console.log('[demo] building the frontend…');
  if (!runSync('npm', ['--prefix', 'web', 'run', 'build'])) {
    console.error('[demo] build failed');
    process.exit(1);
  }
}

function startApi(reload) {
  if (flags.has('--no-api')) return;
  if (!existsSync(venvPython)) return console.warn('[api] no .venv — run `npm run setup`. Continuing with the frontend only.');
  start('api', venvPython, ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', '8000', ...(reload ? ['--reload', '--reload-dir', 'server'] : [])]);
}

function openBrowser() {
  if (flags.has('--no-open')) return;
  const [cmd, args] = isWin ? ['cmd', ['/c', 'start', '""', URL]] : process.platform === 'darwin' ? ['open', [URL]] : ['xdg-open', [URL]];
  setTimeout(() => spawn(cmd, args, { stdio: 'ignore', detached: true, shell: false }).unref(), 2500);
}

switch (mode) {
  case 'setup':
    setup({ full: true });
    break;
  case 'dev':
    setup({ full: false });
    startApi(true);
    start('web', 'npm', ['--prefix', 'web', 'run', 'dev']);
    openBrowser();
    break;
  case 'demo':
    setup({ full: false });
    buildIfStale();
    startApi(false);
    start('web', 'npm', ['--prefix', 'web', 'run', 'preview']);
    console.log(`\n  Rx Radar → ${URL}\n  Presenter keys: 1–8 beats · → next · R reset · Ctrl+K palette · N notes\n`);
    openBrowser();
    break;
  case 'pipeline':
    setup({ full: true });
    process.exit(runSync(venvPython, ['-m', 'pipeline.run_all']) ? 0 : 1);
  default:
    console.error(`unknown mode "${mode}" (use setup | dev | demo | pipeline)`);
    process.exit(1);
}
