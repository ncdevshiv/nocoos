// Per-instance lock file. Prevents two NocoOSes from sharing the same data dir.
//
// Lock file location: <dataDir>/.lock (lives next to the data it protects).
// Lock file content: JSON { name, pid, port, startedAt, version }.
//
// On boot:
//   - If lock exists and the recorded PID is alive: refuse to start.
//   - If lock exists and the recorded PID is dead: remove stale lock, acquire new.
//   - If no lock: acquire new.
//
// On graceful shutdown: remove lock (best-effort; crash leaves a stale lock that
// next boot will detect via PID liveness).
import fs from 'node:fs';
import path from 'node:path';
import fsp from 'node:fs/promises';
import os from 'node:os';
import { config } from './config.js';
import logger from '../utils/logger.js';

const log = logger.make('lock');

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if (err.code === 'ESRCH') return false;  // no such process
    if (err.code === 'EPERM') return true;   // process exists but we lack permission
    return false;
  }
}

export function lockPath(dataDir = config.dataDir) {
  return path.join(dataDir, '.lock');
}

export async function readLock(dataDir = config.dataDir) {
  try {
    const raw = await fsp.readFile(lockPath(dataDir), 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return null;
  }
}

export function readLockSync(dataDir = config.dataDir) {
  try {
    const raw = fs.readFileSync(lockPath(dataDir), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function acquire({ name, pid, port, dataDir = config.dataDir, force = false } = {}) {
  await fsp.mkdir(dataDir, { recursive: true });
  const lockFile = lockPath(dataDir);
  const existing = await readLock(dataDir);
  if (existing && !force) {
    const alive = isPidAlive(existing.pid);
    if (alive && existing.pid !== pid) {
      const err = new Error(`instance "${existing.name}" already running (pid=${existing.pid}, port=${existing.port})`);
      err.code = 'INSTANCE_RUNNING';
      err.existing = existing;
      throw err;
    }
    if (!alive) {
      log.warn('removing stale lock', { oldPid: existing.pid, currentPid: pid });
      try { await fsp.unlink(lockFile); } catch {}
    }
  }
  const payload = {
    name,
    pid,
    port,
    startedAt: new Date().toISOString(),
    host: os.hostname(),
    version: '1.0.0'
  };
  // Atomic write: write to tmp then rename
  const tmp = lockFile + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(payload, null, 2));
  await fsp.rename(tmp, lockFile);
  log.info('lock acquired', { name, pid, port, dataDir });
  return payload;
}

export async function release(dataDir = config.dataDir) {
  try {
    await fsp.unlink(lockPath(dataDir));
    log.info('lock released', { dataDir });
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    log.warn('lock release failed', { err: err.message });
    return false;
  }
}

// Sync variants for shutdown handlers (no async allowed in SIGTERM).
export function releaseSync(dataDir = config.dataDir) {
  try { fs.unlinkSync(lockPath(dataDir)); return true; }
  catch { return false; }
}

export function isAlive(pid) { return isPidAlive(pid); }

export default { acquire, release, releaseSync, readLock, readLockSync, lockPath, isAlive };
