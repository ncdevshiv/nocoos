// HMR (hot module reload) channel for the frontend.
// Watches the public/ directory and broadcasts a "reload" event over WebSocket
// when files change. The frontend listens and does a soft reload (window.location.reload()).
//
// Enable with NOCOOS_HMR=1. Disabled by default for production safety.
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { config } from '../kernel/config.js';
import parser from '../kernel/parser.js';
import metrics from '../kernel/metrics.js';
import logger from '../utils/logger.js';

const log = logger.make('hmr');

export function attachHmr(server) {
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set();
  let watcher = null;
  let debounceTimer = null;
  let pendingEvents = [];

  function safeSend(ws, payload) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(payload)); } catch (err) { log.warn('hmr send failed', { err: err.message }); }
  }

  function broadcast(payload) {
    for (const ws of clients) safeSend(ws, payload);
  }

  function flushEvents() {
    if (!pendingEvents.length) return;
    const events = pendingEvents.slice();
    pendingEvents = [];
    log.info('hmr reload', { count: events.length, files: events.map((e) => e.path).slice(0, 5) });
    broadcast({ type: 'reload', reason: 'change', events, ts: Date.now() });
  }

  function scheduleReload(ev) {
    pendingEvents.push(ev);
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const events = pendingEvents.slice();
      pendingEvents = [];

      // Parse every changed .js file before broadcasting. If any has a syntax error,
      // broadcast a syntax-error event instead of reload — the page would just break again.
      const validEvents = [];
      const syntaxErrors = [];
      for (const e of events) {
        if (!e.path.endsWith('.js')) { validEvents.push(e); continue; }
        const fullPath = path.join(config.publicDir, e.path.replace(/^\//, ''));
        if (!fullPath.startsWith(config.publicDir)) { validEvents.push(e); continue; }
        if (!fs.existsSync(fullPath)) { validEvents.push(e); continue; }
        try {
          const result = await parser.validateFile(fullPath);
          if (result.ok) {
            validEvents.push(e);
          } else {
            syntaxErrors.push({ ...e, error: result.error });
            metrics.recordSyntaxError(e.path);
          }
        } catch (err) {
          validEvents.push(e);
        }
      }

      if (syntaxErrors.length) {
        log.warn('hmr syntax errors — reload suppressed', { count: syntaxErrors.length });
        broadcast({
          type: 'syntax-error',
          ts: Date.now(),
          errors: syntaxErrors.map((e) => ({
            path: e.path,
            line: e.error?.line || null,
            column: e.error?.column || null,
            message: e.error?.message || 'syntax error'
          }))
        });
      }
      if (validEvents.length) {
        log.info('hmr reload', { count: validEvents.length, files: validEvents.map((e) => e.path).slice(0, 5) });
        broadcast({ type: 'reload', reason: 'change', events: validEvents, ts: Date.now() });
      }
    }, 150);
  }

  function startWatcher() {
    if (watcher) return;
    if (!fs.existsSync(config.publicDir)) {
      log.warn('public dir missing, HMR disabled', { dir: config.publicDir });
      return;
    }
    try {
      watcher = fs.watch(config.publicDir, { recursive: true }, (event, filename) => {
        if (!filename) return;
        const rel = filename.toString();
        if (rel.includes('node_modules')) return;
        if (rel.startsWith('.') && rel !== '.well-known') return;
        scheduleReload({ event, path: '/' + rel.split(path.sep).join('/') });
      });
      watcher.on('error', (err) => log.warn('watcher error', { err: err.message }));
      log.info('file watcher started', { dir: config.publicDir });
    } catch (err) {
      log.warn('failed to start watcher', { err: err.message });
    }
  }

  function stopWatcher() {
    if (watcher) {
      try { watcher.close(); } catch {}
      watcher = null;
    }
  }

  function handleUpgrade(req, socket, head) {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname !== '/ws/hmr') {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        clients.add(ws);
        log.debug('hmr client connected', { total: clients.size });
        safeSend(ws, { type: 'hello', enabled: true, ts: Date.now() });
        ws.on('close', () => {
          clients.delete(ws);
          log.debug('hmr client disconnected', { total: clients.size });
        });
        ws.on('error', () => {});
      });
    } catch (err) {
      log.warn('hmr upgrade failed', { err: err.message });
      try { socket.destroy(); } catch {}
    }
  }

  let enabled = false;

  return {
    enable() {
      if (enabled) return;
      enabled = true;
      startWatcher();
      server.on('upgrade', handleUpgrade);
    },
    disable() {
      if (!enabled) return;
      enabled = false;
      stopWatcher();
      server.off('upgrade', handleUpgrade);
      for (const ws of clients) {
        try { ws.close(); } catch {}
      }
      clients.clear();
    },
    isEnabled() { return enabled; },
    clients: () => clients.size
  };
}

export default attachHmr;
