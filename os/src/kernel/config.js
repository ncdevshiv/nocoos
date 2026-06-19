import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
// __filename = <project>/os/src/kernel/config.js. The "OS root" is the parent of src/ (i.e. os/).
// Project root is one level above; computed in registry.js for cross-instance state.
const ROOT = path.resolve(path.dirname(__filename), '..', '..');

function loadDotEnv() {
  const envPath = path.join(ROOT, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

function int(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

function str(name, fallback) {
  const v = process.env[name];
  return v === undefined || v === '' ? fallback : v;
}

export const config = {
  root: ROOT,
  port: int('NOCOOS_PORT', 3000),
  host: str('NOCOOS_HOST', '0.0.0.0'),
  env: str('NOCOOS_ENV', 'development'),
  sessionSecret: str('NOCOOS_SESSION_SECRET', 'nocoos-dev-secret-change-me'),
  maxTerminals: int('NOCOOS_MAX_TERMINALS', 8),
  // Instance name → determines data dir and lock file. Default 'default' → os/data/.
  // Set NOCOOS_INSTANCE_NAME to run a second isolated OS in the same project.
  instanceName: str('NOCOOS_INSTANCE_NAME', 'default').replace(/[^\w.-]/g, '_').slice(0, 64),
  // Auto-port: if NOCOOS_PORT is 0 or NOCOOS_AUTO_PORT=1, scan for a free port.
  autoPort: str('NOCOOS_AUTO_PORT', '') === '1',
  // Per-instance data dir override.
  dataDirOverride: str('NOCOOS_DATA_DIR', ''),
  // Derived: dataDir defaults to os/data-<name>/ (or os/data/ for 'default')
  get dataDir() {
    if (this.dataDirOverride) return path.resolve(this.dataDirOverride);
    if (this.instanceName === 'default') return path.join(ROOT, 'data');
    return path.join(ROOT, 'data-' + this.instanceName);
  },
  get appsDir() {
    return str('NOCOOS_APPS_DIR', '') || path.join(this.dataDir, 'apps');
  },
  publicDir: path.join(ROOT, 'public'),
  hostInfo: {
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    hostname: os.hostname(),
    release: os.release(),
    nodeVersion: process.version,
    shell: process.env.SHELL || (os.platform() === 'win32' ? (process.env.COMSPEC || 'cmd.exe') : '/bin/sh'),
    homedir: os.homedir(),
    username: os.userInfo().username
  }
};

// Ensure instance-specific data dir exists.
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'home', 'user'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'system'), { recursive: true });
fs.mkdirSync(config.appsDir, { recursive: true });

export default config;
