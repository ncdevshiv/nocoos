// Cross-instance registry. Lives at <root>/.nocoos-registry.json (project-local).
// Each running instance writes its entry with a heartbeat timestamp.
// Manager mode reads this file to discover instances.
//
// Heartbeat model: each instance refreshes its entry every N seconds. Manager
// considers an instance "stale" if lastSeen is older than STALE_THRESHOLD.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { config } from './config.js';
import logger from '../utils/logger.js';

const log = logger.make('registry');

// Cross-instance registry lives at the PROJECT root (one level above os/), not the OS root.
// config.root is the OS package root (os/). Project root = config.root's parent.
const PROJECT_ROOT = path.resolve(config.root, '..');

const STALE_THRESHOLD_MS = 30 * 1000;

export function registryPath(root = PROJECT_ROOT) {
  return path.join(root, '.nocoos-registry.json');
}

export function load(root = PROJECT_ROOT) {
  try {
    const raw = fs.readFileSync(registryPath(root), 'utf8');
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.instances)) return { instances: [] };
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return { instances: [] };
    log.warn('failed to load registry', { err: err.message });
    return { instances: [] };
  }
}

export function save(data, root = PROJECT_ROOT) {
  const p = registryPath(root);
  const tmp = p + '.tmp';
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, p);
}

export function upsert(entry, root = PROJECT_ROOT) {
  const data = load(root);
  const idx = data.instances.findIndex((i) => i.name === entry.name);
  const lastSeen = entry.lastSeen || new Date().toISOString();
  if (idx >= 0) data.instances[idx] = { ...data.instances[idx], ...entry, lastSeen };
  else data.instances.push({ ...entry, lastSeen });
  save(data, root);
  return data;
}

export function remove(name, root = PROJECT_ROOT) {
  const data = load(root);
  data.instances = data.instances.filter((i) => i.name !== name);
  save(data, root);
  return data;
}

export function pruneStale(root = PROJECT_ROOT) {
  const data = load(root);
  const cutoff = Date.now() - STALE_THRESHOLD_MS;
  data.instances = data.instances.filter((i) => {
    const seen = i.lastSeen ? Date.parse(i.lastSeen) : 0;
    return seen > cutoff;
  });
  save(data, root);
  return data;
}

export function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; }
  catch (err) {
    if (err.code === 'ESRCH') return false;
    if (err.code === 'EPERM') return true;
    return false;
  }
}

export function listWithStatus(root = PROJECT_ROOT) {
  const data = pruneStale(root);
  return data.instances.map((i) => {
    const seen = i.lastSeen ? Date.parse(i.lastSeen) : 0;
    const ageMs = Date.now() - seen;
    const alive = isPidAlive(i.pid);
    return { ...i, ageMs, alive, status: alive ? 'running' : 'stale' };
  });
}

export function startHeartbeat(entry, root = PROJECT_ROOT, intervalMs = 5000) {
  const handle = setInterval(() => {
    try { upsert(entry, root); } catch (err) { log.warn('heartbeat failed', { err: err.message }); }
  }, intervalMs);
  if (handle.unref) handle.unref();
  return handle;
}

export function stopHeartbeat(handle) {
  if (handle) clearInterval(handle);
}

export const thresholds = { staleMs: STALE_THRESHOLD_MS };
export const paths = { projectRoot: PROJECT_ROOT };

export default {
  path: registryPath, load, save, upsert, remove, pruneStale, listWithStatus,
  isPidAlive, startHeartbeat, stopHeartbeat, thresholds, paths
};
