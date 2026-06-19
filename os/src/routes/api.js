import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { config } from '../kernel/config.js';
import vfs from '../kernel/vfs.js';
import pkg from '../kernel/package-manager.js';
import sessionMgr from '../kernel/session.js';
import sysInfo from '../kernel/system-info.js';
import procMgr from '../kernel/process-manager.js';
import logger from '../utils/logger.js';
import termMgr from '../kernel/terminal.js';
import reg from '../kernel/app-registry.js';
import * as metrics from '../kernel/metrics.js';
import parser from '../kernel/parser.js';
import registry from '../kernel/registry.js';

const log = logger.make('api');

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requireAuth(req, res, next) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.token || '');
  const sess = sessionMgr.resolve(token);
  if (!sess) return res.status(401).json({ error: 'unauthorized' });
  req.session = sess;
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session?.isAdmin) return res.status(403).json({ error: 'forbidden' });
  next();
}

// Hand-rolled login rate limiter. Tracks failed attempts per (IP, username)
// pair in an in-memory Map with automatic expiry. Avoids adding a dependency
// for one endpoint. Default: 10 failures per 60s window per (IP, username).
const LOGIN_LIMIT_MAX = 10;
const LOGIN_LIMIT_WINDOW_MS = 60_000;
const loginAttempts = new Map(); // key -> { count, resetAt }
function loginRateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const username = String((req.body && req.body.username) || '').toLowerCase();
  const key = `${ip}::${username}`;
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (entry && entry.resetAt > now && entry.count >= LOGIN_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'rate_limited', retryAfter });
  }
  if (!entry || entry.resetAt <= now) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_LIMIT_WINDOW_MS });
  }
  req._loginKey = key;
  next();
}
function recordLoginFailure(key) {
  const entry = loginAttempts.get(key);
  if (entry) entry.count += 1;
}
function recordLoginSuccess(key) {
  loginAttempts.delete(key);
}
// Periodic cleanup of stale entries so the Map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (v.resetAt <= now) loginAttempts.delete(k);
  }
}, LOGIN_LIMIT_WINDOW_MS).unref();

export function createApiRouter() {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({ ok: true, ts: Date.now(), uptime: process.uptime() });
  });

  // Client-side error reporting. Browser sends errors via sendBeacon/fetch.
  // Body may be JSON, text, or sendBeacon blob. We read raw and parse ourselves
  // because the global express.json middleware would have already consumed the stream.
  const rawBodyMiddleware = (req, _res, next) => {
    if (req.method !== 'POST') return next();
    if (req.rawBody !== undefined) return next();
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      req.rawBody = Buffer.concat(chunks).toString('utf8');
      next();
    });
    req.on('error', next);
  };
  router.post('/client-errors', rawBodyMiddleware, asyncHandler(async (req, res) => {
    let payload = null;
    const raw = req.rawBody || '';
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = { message: raw.slice(0, 500), raw: true }; }
    }
    if (!payload || typeof payload !== 'object') payload = { message: String(raw).slice(0, 500) };
    const kind = String(payload.kind || 'runtime').slice(0, 32);
    const message = String(payload.message || '').slice(0, 1000);
    const file = payload.file ? String(payload.file).slice(0, 256) : null;
    const line = Number.isFinite(payload.line) ? payload.line : null;
    const col = Number.isFinite(payload.col) ? payload.col : null;
    const stack = payload.stack ? String(payload.stack).slice(0, 4000) : null;
    const url = payload.url ? String(payload.url).slice(0, 256) : null;
    const userAgent = payload.userAgent ? String(payload.userAgent).slice(0, 256) : (req.headers['user-agent'] || '').slice(0, 256);

    metrics.recordClientError(kind, file || 'unknown');
    logger.make('client').error('client error', {
      kind, message, file, line, col, url, userAgent,
      stack: stack ? stack.split('\n').slice(0, 8).join('\n') : null
    });
    res.status(204).end();
  }));

  router.get('/health/lint', (_req, res) => {
    res.json({ enabled: process.env.NOCOOS_LINT === '1', parser: parser.stats() });
  });

  router.post('/auth/login', express.json(), loginRateLimit, asyncHandler(async (req, res) => {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: 'missing_credentials' });
    const result = sessionMgr.login(username, password);
    if (!result.ok) {
      metrics.recordAuth('failure');
      recordLoginFailure(req._loginKey);
      return res.status(401).json({ error: result.error });
    }
    metrics.recordAuth('success');
    recordLoginSuccess(req._loginKey);
    res.json({ token: result.token, user: result.user });
  }));

  router.post('/auth/logout', requireAuth, asyncHandler(async (req, res) => {
    const token = req.headers.authorization.slice(7);
    sessionMgr.logout(token);
    res.json({ ok: true });
  }));

  router.get('/auth/me', requireAuth, (req, res) => {
    res.json({ user: { username: req.session.username, displayName: req.session.displayName, isAdmin: req.session.isAdmin } });
  });

  router.get('/system/info', requireAuth, (_req, res) => {
    res.json(sysInfo.snapshot());
  });

  router.get('/system/procs', requireAuth, (_req, res) => {
    res.json({ procs: procMgr.list(), stats: procMgr.stats() });
  });

  router.post('/system/procs/:id/kill', requireAuth, requireAdmin, express.json(), asyncHandler(async (req, res) => {
    const result = await procMgr.kill(req.params.id, { signal: req.body?.signal || 'SIGTERM', force: !!req.body?.force });
    res.json(result);
  }));

  router.get('/system/tools', requireAuth, asyncHandler(async (_req, res) => {
    res.json({ tools: pkg.listTools() });
  }));

  router.get('/apps', requireAuth, (_req, res) => {
    res.json({ apps: pkg.listJobs() });
  });

  router.get('/fs/list', requireAuth, asyncHandler(async (req, res) => {
    const p = req.query.path || '/home/user';
    const entries = await vfs.listDir(p);
    res.json({ path: vfs.normalize(p), entries });
  }));

  router.get('/fs/stat', requireAuth, asyncHandler(async (req, res) => {
    const p = req.query.path;
    if (!p) return res.status(400).json({ error: 'path_required' });
    const info = await vfs.stat(p);
    res.json({ path: vfs.normalize(p), ...info });
  }));

  router.get('/fs/read', requireAuth, asyncHandler(async (req, res) => {
    const p = req.query.path;
    if (!p) return res.status(400).json({ error: 'path_required' });
    const enc = req.query.encoding || 'utf8';
    const norm = vfs.normalize(p);
    const info = await vfs.stat(norm);
    if (info.isDirectory) return res.status(400).json({ error: 'is_directory' });
    const data = await vfs.readFile(norm, { encoding: enc === 'binary' ? null : enc });
    if (req.query.download === '1') {
      const name = path.basename(norm);
      res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
      res.setHeader('Content-Type', vfs.mime(name));
      return res.send(data);
    }
    if (typeof data === 'string') {
      res.setHeader('Content-Type', vfs.mime(path.basename(norm)));
      return res.send(data);
    }
    res.setHeader('Content-Type', vfs.mime(path.basename(norm)));
    res.send(data);
  }));

  router.put('/fs/write', requireAuth, express.json({ limit: '20mb' }), asyncHandler(async (req, res) => {
    const { path: p, content, encoding = 'utf8' } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path_required' });
    const result = await vfs.writeFile(p, content ?? '', { encoding });
    res.json(result);
  }));

  // Maximum upload size in bytes (default 100 MB). The Content-Length header is
  // checked up-front for fail-fast behavior; the streaming counter below is a
  // defense-in-depth check for clients that omit or lie about Content-Length.
  const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

  router.post('/fs/upload', requireAuth, asyncHandler(async (req, res) => {
    const p = req.query.path;
    if (!p) return res.status(400).json({ error: 'path_required' });

    // Fail fast on advertised size to avoid even starting the stream write.
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES) {
      return res.status(413).json({ error: 'too_large', maxBytes: MAX_UPLOAD_BYTES });
    }

    const norm = vfs.normalize(p);
    await fsp.mkdir(vfs.resolveReal(path.dirname(norm)), { recursive: true });
    const dest = fsp.createWriteStream(vfs.resolveReal(norm));

    // Defense-in-depth: count bytes through a Transform and abort if the
    // client lies about Content-Length or sends chunked-encoded data.
    let bytes = 0;
    let aborted = false;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        bytes += chunk.length;
        if (bytes > MAX_UPLOAD_BYTES) {
          aborted = true;
          dest.destroy();
          return cb(new Error('too_large'));
        }
        cb(null, chunk);
      }
    });

    try {
      await pipeline(req, counter, dest);
      res.json({ ok: true, size: (await vfs.stat(norm)).size });
    } catch (err) {
      // Clean up the partial file when the limit is exceeded.
      try { await fsp.unlink(vfs.resolveReal(norm)); } catch {}
      if (aborted || err.message === 'too_large') {
        return res.status(413).json({ error: 'too_large', maxBytes: MAX_UPLOAD_BYTES });
      }
      throw err;
    }
  }));

  router.post('/fs/mkdir', requireAuth, express.json(), asyncHandler(async (req, res) => {
    const { path: p } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path_required' });
    await vfs.mkdir(p);
    res.json({ ok: true });
  }));

  router.post('/fs/rename', requireAuth, requireAdmin, express.json(), asyncHandler(async (req, res) => {
    const { from, to } = req.body || {};
    if (!from || !to) return res.status(400).json({ error: 'from_and_to_required' });
    await vfs.move(from, to);
    res.json({ ok: true });
  }));

  router.post('/fs/delete', requireAuth, requireAdmin, express.json(), asyncHandler(async (req, res) => {
    const { path: p, recursive } = req.body || {};
    if (!p) return res.status(400).json({ error: 'path_required' });
    const result = await vfs.remove(p, { recursive: !!recursive });
    res.json(result);
  }));

  router.get('/fs/download', requireAuth, asyncHandler(async (req, res) => {
    const p = req.query.path;
    if (!p) return res.status(400).json({ error: 'path_required' });
    const norm = vfs.normalize(p);
    const info = await vfs.stat(norm);
    if (info.isDirectory) return res.status(400).json({ error: 'is_directory' });
    const real = vfs.resolveReal(norm);
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(norm)}"`);
    res.setHeader('Content-Type', vfs.mime(path.basename(norm)));
    res.setHeader('Content-Length', info.size);
    await pipeline(fsp.createReadStream(real), res);
  }));

  router.post('/pkg/install', requireAuth, requireAdmin, express.json(), asyncHandler(async (req, res) => {
    const { manager = 'npm', packages, cwd, save = true } = req.body || {};
    if (!Array.isArray(packages) || packages.length === 0) {
      return res.status(400).json({ error: 'packages_required' });
    }
    const { job, dir } = await pkg.install({ manager, packages, cwd, save });
    res.json({ jobId: job.id, dir });
  }));

  router.get('/pkg/jobs', requireAuth, (_req, res) => {
    res.json({ jobs: pkg.listJobs() });
  });

  router.post('/pkg/jobs/:id/cancel', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
    const ok = pkg.cancelJob(req.params.id);
    res.json({ ok });
  }));

  router.get('/terminals', requireAuth, (_req, res) => {
    res.json({ terminals: termMgr.list() });
  });

  router.post('/terminals', requireAuth, express.json(), asyncHandler(async (req, res) => {
    const { cwd, shell, cols, rows, env } = req.body || {};
    const session = termMgr.create({ cwd, shell, cols, rows, env });
    res.json({ id: session.id, shell: session.shell, cwd: session.cwd });
  }));

  router.delete('/terminals/:id', requireAuth, asyncHandler(async (req, res) => {
    const t = termMgr.get(req.params.id);
    if (!t) return res.status(404).json({ error: 'not_found' });
    await t.kill('SIGTERM');
    res.json({ ok: true });
  }));

  router.get('/registry/apps', requireAuth, (_req, res) => {
    res.json({ apps: reg.list(), byCategory: reg.byCategory(), pinned: reg.pinnedList().map((a) => a.id) });
  });

  // Cross-instance registry endpoints — manager UI uses these.
  // These were previously unauthenticated, allowing anyone reaching the HTTP
  // port to enumerate every NocoOS instance on the host and SIGTERM them.
  // Now require auth for read and admin for the destructive stop action.
  router.get('/instances', requireAuth, (_req, res) => {
    res.json({ instances: registry.listWithStatus() });
  });

  router.get('/instances/:name', requireAuth, (req, res) => {
    const list = registry.listWithStatus();
    const inst = list.find((i) => i.name === req.params.name);
    if (!inst) return res.status(404).json({ error: 'not_found' });
    res.json(inst);
  });

  router.post('/instances/:name/stop', requireAuth, requireAdmin, (req, res) => {
    const list = registry.listWithStatus();
    const inst = list.find((i) => i.name === req.params.name);
    if (!inst) return res.status(404).json({ error: 'not_found' });
    try {
      process.kill(inst.pid, 'SIGTERM');
      res.json({ ok: true, pid: inst.pid });
    } catch (err) {
      res.status(500).json({ error: 'kill_failed', message: err.message });
    }
  });

  // Translate VFS mount-ACL errors (and any *_mount_not_* pattern) into 403.
  // Other errors fall through to the default express error handler.
  // NOTE: This handler must be registered after all routes so it can catch
  // next(err) calls from async handlers.
  router.use((err, _req, res, _next) => {
    const msg = err && err.message;
    if (typeof msg === 'string' && /(_mount_not_readable|_mount_not_writable|_mount_not_executable|host_)/.test(msg)) {
      return res.status(403).json({ error: msg });
    }
    return res.status(500).json({ error: 'internal', message: msg });
  });

  return router;
}
