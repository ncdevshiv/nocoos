// JS syntax validator. Wraps `node --check` as a subprocess so we don't need a
// parser dependency (acorn/babel) but still validate ESM files correctly.
//
// Results are cached by (path, mtimeMs) so unchanged files are instant.
// The cache is also driven by the HMR file watcher so edits invalidate.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import logger from '../utils/logger.js';

const log = logger.make('parser');

const cache = new Map(); // path -> { mtimeMs, ok, error? }
const inFlight = new Map(); // path -> Promise
const MAX_CACHE = 500;

function cacheGet(filePath, mtimeMs) {
  const entry = cache.get(filePath);
  if (entry && entry.mtimeMs === mtimeMs) return entry;
  return null;
}

function peekCache(filePath) {
  // Sync cache lookup. Returns the cached entry regardless of mtime (caller decides).
  return cache.get(filePath) || null;
}

function cacheSet(filePath, mtimeMs, value) {
  if (cache.size > MAX_CACHE) {
    // Drop oldest entries
    const drop = Math.floor(MAX_CACHE * 0.2);
    let i = 0;
    for (const k of cache.keys()) {
      if (i++ >= drop) break;
      cache.delete(k);
    }
  }
  cache.set(filePath, { mtimeMs, ...value });
}

function parseStderrSync(stderr, filePath) {
  if (!stderr) return null;
  const lines = stderr.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  for (const line of lines) {
    let m = line.match(/^(.+?):(\d+)(?::(\d+))?\s*[-–]\s*(.+)$/);
    if (m) {
      const path = m[1] === '[stdin]' ? (filePath || '<stdin>') : m[1];
      return {
        path,
        line: Number.parseInt(m[2], 10) || null,
        column: m[3] ? Number.parseInt(m[3], 10) : null,
        message: m[4] || line,
        raw: stderr
      };
    }
  }
  const head = lines[0] || '';
  const m2 = head.match(/^(?:\[stdin\]|(.+?))(?::(\d+))?(?::(\d+))?$/);
  if (m2) {
    const errLine = lines.find((l) => /^(SyntaxError|TypeError|ReferenceError|Error)/i.test(l));
    return {
      path: m2[1] || filePath || '<stdin>',
      line: m2[2] ? Number.parseInt(m2[2], 10) : null,
      column: m2[3] ? Number.parseInt(m2[3], 10) : null,
      message: errLine || head,
      raw: stderr
    };
  }
  return { path: filePath || '<stdin>', line: null, column: null, message: lines[0] || stderr, raw: stderr };
}

function validateFileSync(filePath) {
  let stat;
  try { stat = fs.statSync(filePath); } catch { return { ok: false, error: { message: 'file not found', raw: 'ENOENT' } }; }
  if (!stat.isFile()) return { ok: true };
  if (stat.size > 1024 * 1024) return { ok: true, skipped: 'too_large' };

  const cached = cacheGet(filePath, stat.mtimeMs);
  if (cached) return cached.ok ? { ok: true, cached: true } : { ok: false, error: cached.error, cached: true };

  // ESM detection: scan the entire file for top-level import/export statements.
  // Earlier versions only scanned the first 256 bytes, which misclassified files
  // whose header comment pushed the first `import` past that window as CommonJS.
  // Results are cached by mtime so the full-file scan only runs on edit.
  const isModule = filePath.endsWith('.mjs') || (filePath.endsWith('.js') && /^\s*(?:import|export)\s/m.test(fs.readFileSync(filePath, 'utf8')));
  const child = spawnSync(process.execPath, ['--check', isModule ? '--input-type=module' : '--input-type=commonjs'], {
    input: fs.readFileSync(filePath),
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: 5000
  });
  const stderr = child.stderr ? child.stderr.toString() : '';
  if (child.status === 0) {
    cacheSet(filePath, stat.mtimeMs, { ok: true });
    return { ok: true };
  }
  const err = parseStderrSync(stderr, filePath) || { message: `exit ${child.status}`, raw: stderr };
  cacheSet(filePath, stat.mtimeMs, { ok: false, error: err });
  return { ok: false, error: err };
}

async function validateFile(filePath) {
  let stat;
  try { stat = await fsp.stat(filePath); } catch { return { ok: false, error: { message: 'file not found', raw: 'ENOENT' } }; }
  if (!stat.isFile()) return { ok: true };
  if (stat.size > 1024 * 1024) return { ok: true, skipped: 'too_large' };

  const cached = cacheGet(filePath, stat.mtimeMs);
  if (cached) return cached.ok ? { ok: true, cached: true } : { ok: false, error: cached.error, cached: true };

  const inflight = inFlight.get(filePath);
  if (inflight) return inflight;

  const promise = new Promise((resolve) => {
    // ESM detection: scan the entire file (see comment on validateFileSync above).
    const isModule = filePath.endsWith('.mjs') || filePath.endsWith('.js') && /^\s*(?:import|export)\s/m.test(fs.readFileSync(filePath, 'utf8'));
    const child = spawn(process.execPath, ['--check', isModule ? '--input-type=module' : '--input-type=commonjs'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    const stream = fs.createReadStream(filePath);
    stream.on('error', (err) => {
      log.warn('parse read failed', { filePath, err: err.message });
      resolve({ ok: false, error: { message: err.message, raw: err.message } });
    });
    stream.pipe(child.stdin);
    child.on('error', (err) => {
      log.warn('parse spawn failed', { filePath, err: err.message });
      resolve({ ok: false, error: { message: err.message, raw: err.message } });
    });
    child.on('exit', (code) => {
      inFlight.delete(filePath);
      if (code === 0) {
        cacheSet(filePath, stat.mtimeMs, { ok: true });
        resolve({ ok: true });
      } else {
        const err = parseStderrSync(stderr, filePath) || { message: `exit ${code}`, raw: stderr };
        cacheSet(filePath, stat.mtimeMs, { ok: false, error: err });
        resolve({ ok: false, error: err });
      }
    });
  });
  inFlight.set(filePath, promise);
  return promise;
}

function invalidate(filePath) {
  cache.delete(filePath);
}

function clear() {
  cache.clear();
}

function stats() {
  return { cached: cache.size, inflight: inFlight.size };
}

export default { validateFile, validateFileSync, invalidate, clear, stats, peekCache };
