import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { config } from './src/kernel/config.js';
import vfs from './src/kernel/vfs.js';
import pkg from './src/kernel/package-manager.js';
import reg from './src/kernel/app-registry.js';
import * as metrics from './src/kernel/metrics.js';
import parser from './src/kernel/parser.js';
import lock from './src/kernel/lock.js';
import portFinder from './src/kernel/port-finder.js';
import registry from './src/kernel/registry.js';
import logger from './src/utils/logger.js';
import { createApiRouter } from './src/routes/api.js';
import { attachWebSocket } from './src/routes/ws.js';
import { attachHmr } from './src/routes/hmr.js';

const log = logger.make('server');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

vfs.boot();
reg.load();

async function main() {
  const tools = await pkg.detectTools();
  log.info('package managers detected', tools);

  // Resolve port: explicit NOCOOS_PORT > auto-scan starting from default > OS-assigned.
  let chosenPort = config.port;
  if (config.autoPort || chosenPort === 0) {
    const candidate = await portFinder.findFreePort(3000, 3099);
    if (candidate) {
      chosenPort = candidate;
      log.info('auto-allocated port', { port: chosenPort });
    } else {
      chosenPort = 0;
      log.warn('no free port in 3000-3099; using OS-assigned');
    }
  }

  // Acquire instance lock. Refuses to start if another NocoOS owns this data dir.
  let lockInfo;
  try {
    lockInfo = await lock.acquire({
      name: config.instanceName,
      pid: process.pid,
      port: chosenPort,
      dataDir: config.dataDir
    });
  } catch (err) {
    if (err.code === 'INSTANCE_RUNNING') {
      const e = err.existing || {};
      log.error('another NocoOS instance owns this data dir', {
        instance: e.name, pid: e.pid, port: e.port, dataDir: config.dataDir
      });
      process.stderr.write(`\nNocoOS: instance "${e.name}" already running (pid=${e.pid}, port=${e.port})\n` +
        `  data dir: ${config.dataDir}\n` +
        `  to run a second instance, use: NOCOOS_INSTANCE_NAME=foo node os/server.js\n` +
        `  to take over: delete the lock file or kill pid ${e.pid}\n\n`);
      process.exit(1);
    }
    throw err;
  }

  vfs.boot();
  reg.load();

  const app = express();
  app.disable('x-powered-by');

  // Security headers. Hand-rolled to avoid adding a dependency.
  // - X-Frame-Options: DENY           → prevent clickjacking
  // - X-Content-Type-Options: nosniff → prevent MIME sniffing
  // - Referrer-Policy: no-referrer    → don't leak page URLs to outbound requests
  // - Strict-Transport-Security       → force HTTPS when behind a TLS-terminating proxy
  // - Content-Security-Policy         → restrict resource origins. The frontend is
  //   fully self-hosted; 'unsafe-inline' for styles is needed because base.css
  //   and apps.css set theme variables dynamically; 'unsafe-inline' for scripts
  //   would be ideal but xterm.js + boot inline listeners require it. Tighten
  //   once Phase 3 introduces a build step with nonces.
  app.use((_req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (_req.secure || _req.headers['x-forwarded-proto'] === 'https') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Content-Security-Policy: fully self-hosted, no external origins allowed.
//   default-src 'self'             — only same-origin resources by default
//   script-src 'self' 'unsafe-inline' — inline scripts allowed for the boot
//     shim and HMR; tighten with nonces if a build step is added later
//   style-src 'self' 'unsafe-inline'  — inline styles for theme variables
//   img-src 'self' data: blob:      — base64 SVG icons + canvas thumbnails
//   font-src 'self' data:           — base64 icon fonts if any
//   connect-src 'self' ws: wss:    — same-origin + WebSocket for terminals
//   frame-ancestors 'none'          — block clickjacking
//   base-uri 'self'                 — block <base> hijacking
//   form-action 'self'              — only same-origin form submissions
//   object-src 'none'               — block <object>/<embed>/<applet>
//   frame-src 'none'                — block <iframe>
// If you need to load a CDN resource, vendor it locally under
// os/public/vendor/ and reference it via a relative path. Do NOT add
// https:// origins to this CSP — that violates the "local, isolated,
// portable" deployment requirement.
res.setHeader(
  'Content-Security-Policy',
  [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    "frame-src 'none'"
  ].join('; ')
    );
    next();
  });

  app.use((req, res, next) => {
    // express.json below consumes the request stream. Skip it for /api/client-errors
    // because that endpoint reads raw body itself (handles sendBeacon, text/plain, JSON).
    if (req.path === '/api/client-errors') return next();
    return express.json({ limit: '2mb' })(req, res, next);
  });
  app.use(metrics.middleware());

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - start;
      if (req.path.startsWith('/api') || res.statusCode >= 400) {
        log.debug('http', { m: req.method, p: req.path, s: res.statusCode, ms });
      }
    });
    next();
  });

  app.use('/api', createApiRouter());

  // Pre-serve JS syntax validation. Gated by NOCOOS_LINT=1 to avoid dev cost in prod.
  // Catches parse-time errors (e.g. "Unexpected token ')'") BEFORE the browser does.
  // Logs structured error + increments metric, then returns 500 with file:line:col info.
  const lintEnabled = process.env.NOCOOS_LINT === '1';
  if (lintEnabled) {
    // Sync cache + sync fallback parse. Spawning node --check via spawnSync
    // blocks the request thread for ~50ms but gives a definitive answer.
    // Acceptable in dev; production should keep NOCOOS_LINT=0.
    app.use((req, res, next) => {
      if (!req.path.endsWith('.js')) return next();
      const fullPath = path.join(config.publicDir, req.path.replace(/^\//, ''));
      if (!fullPath.startsWith(config.publicDir)) return next();
      let result;
      try { result = parser.validateFileSync(fullPath); }
      catch (err) { return next(); }
      if (result.ok) return next();
      metrics.recordSyntaxError(req.path);
      logger.make('lint').error('syntax error in JS', { file: req.path, line: result.error?.line, col: result.error?.column, message: result.error?.message });
      return res.status(500).type('application/json').send({
        error: 'syntax_error',
        file: req.path,
        line: result.error?.line || null,
        column: result.error?.column || null,
        message: result.error?.message || 'syntax error'
      });
    });
    logger.make('server').info('JS lint middleware enabled (NOCOOS_LINT=1) — sync parse');
  }

  // Prometheus metrics endpoint (no auth — meant for scraping)
  app.get('/metrics', (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.text());
  });

  app.get('/api/metrics/snapshot', (_req, res) => {
    res.json(metrics.snapshot());
  });

  app.use(express.static(config.publicDir, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  }));

  // Serve user-installed apps from the apps/* workspace at /js/<appId>/.
  // Apps live at <projectRoot>/apps/<appId>/<entry-path>. The manifest's
  // entry field is interpreted relative to the app directory.
  const userAppsRoot = path.resolve(config.root, '..', 'apps');
  app.use('/js', express.static(userAppsRoot, {
    index: false,
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    }
  }));

  app.get('/healthz', (_req, res) => res.json({ ok: true }));

  app.get('/', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'index.html'));
  });

  app.get('/login', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'login.html'));
  });

  app.get('/desktop', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'desktop.html'));
  });

  app.get('/boot', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'boot.html'));
  });

  app.get('/manager', (_req, res) => {
    res.sendFile(path.join(config.publicDir, 'manager.html'));
  });

  // Manager-only mode (NOCOOS_MANAGER=1): the dashboard at / is the manager
  // UI, and the local desktop/login routes are disabled so this instance
  // cannot be used as a regular session. Used by `nocoos --manager` to spin
  // up a dedicated supervisor instance that only exposes the cross-instance
  // registry + manager dashboard.
  if (process.env.NOCOOS_MANAGER === '1') {
    log.info('running in manager-only mode (local desktop/login/boot disabled)');
    app.get('/', (_req, res) => res.redirect('/manager'));
    app.get('/login', (_req, res) => res.status(404).send('Manager-only instance'));
    app.get('/desktop', (_req, res) => res.status(404).send('Manager-only instance'));
    app.get('/boot', (_req, res) => res.status(404).send('Manager-only instance'));
  }

  app.use((err, _req, res, _next) => {
    log.error('unhandled api error', { err: err.message, stack: err.stack });
    if (res.headersSent) return;
    res.status(err.statusCode || 500).json({ error: err.code || 'internal_error', message: err.message });
  });

  const server = http.createServer(app);
  attachWebSocket(server);
  const hmr = attachHmr(server);

  // Centralized cleanup. Idempotent — safe to call multiple times. Used by
  // exit, beforeExit, signal handlers, and the listen-failure path so the
  // lock + registry entry are always released, regardless of how the process
  // is shutting down.
  let cleanedUp = false;
  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    try { registry.remove(lockInfo.name); } catch {}
    try { lock.releaseSync(); } catch {}
  }

  // Register cleanup at module load, BEFORE listen(), so it runs even if
  // listen() fails (port conflict, lock conflict, package-manager failure).
  process.on('exit', cleanup);
  process.on('beforeExit', cleanup);

  server.listen(chosenPort, config.host, () => {
    log.info(`NocoOS listening on http://${config.host}:${chosenPort}`);
    log.info(`Instance: ${lockInfo.name} | dataDir: ${config.dataDir}`);
    log.info(`Default user: user / nocoos`);
    log.info(`Metrics: http://${config.host}:${chosenPort}/metrics`);
    log.info(`Logs format: ${process.env.NOCOOS_LOG_FORMAT || 'text'}`);
    if (process.env.NOCOOS_HMR === '1') {
      hmr.enable();
      log.info('HMR: enabled (frontend hot reload active)');
    }

    // Cross-instance registry: advertise this instance for the manager UI.
    const regEntry = {
      name: lockInfo.name,
      pid: process.pid,
      port: chosenPort,
      dataDir: config.dataDir,
      host: os.hostname(),
      version: '1.0.0',
      startedAt: lockInfo.startedAt
    };
    registry.upsert(regEntry);
    const hb = registry.startHeartbeat(regEntry, config.root, 5000);
    log.info('registered in cross-instance registry', { path: registry.paths.projectRoot });
    heartbeatHandle = hb;
  });

  // Register server.error handler so listen() failures still trigger cleanup.
  server.on('error', (err) => {
    log.error('server error', { err: err.message });
    cleanup();
    process.exit(1);
  });

  let heartbeatHandle = null;

  const shutdown = async (signal) => {
    log.info(`received ${signal}, shutting down`);
    hmr.disable();
    if (heartbeatHandle) registry.stopHeartbeat(heartbeatHandle);
    cleanup();
    // Force-close keepalive sockets so server.close() can complete.
    if (typeof server.closeIdleConnections === 'function') {
      try { server.closeIdleConnections(); } catch {}
    }
    server.close(() => {
      log.info('server closed cleanly');
      cleanup();
      process.exit(0);
    });
    // Hard timeout — kill the process even if connections hang.
    setTimeout(() => {
      log.warn('shutdown timeout, forcing exit');
      cleanup();
      process.exit(1);
    }, 3000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  log.error('failed to start', { err: err.message, stack: err.stack });
  process.exit(1);
});
