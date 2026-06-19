// End-to-end runtime test for NocoOS.
// Boots the server in a child process, exercises every API endpoint and
// WebSocket channel, then exits. Designed to fail loud and print a clear
// summary so we can see exactly what works and what doesn't.

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { WebSocket } from 'ws';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

const PORT = 33999;
const DATA_DIR = path.join(ROOT, 'os', 'data-test-e2e');
const SERVER_PATH = path.join(ROOT, 'os', 'server.js');

const results = [];
let server = null;
let token = null;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

async function api(method, path, body, useAuth = false) {
  const headers = { 'Content-Type': 'application/json' };
  if (useAuth && token) headers.Authorization = `Bearer ${token}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`http://localhost:${PORT}${path}`, opts);
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, body: json, headers: res.headers };
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {}
    await wait(100);
  }
  throw new Error('server did not start');
}

async function bootServer() {
  console.log('\n=== Booting server ===');
  // Clean data dir for fresh state
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  server = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      NOCOOS_PORT: String(PORT),
      NOCOOS_INSTANCE_NAME: 'e2e',
      NOCOOS_LOG_LEVEL: 'warn'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[srv-err] ${d}`));
  await waitForServer();
  console.log('  server up');
}

async function killServer() {
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await new Promise((r) => { server.once('exit', r); setTimeout(r, 2000); });
  }
}

async function section(name, fn) {
  console.log(`\n=== ${name} ===`);
  await fn();
}

async function main() {
  await bootServer();

  // 1. Health
  await section('Health & metrics', async () => {
    const r = await api('GET', '/api/health');
    check('GET /api/health', r.status === 200 && r.body?.ok === true);
    const m = await api('GET', '/api/metrics/snapshot');
    check('GET /api/metrics/snapshot', m.status === 200 && typeof m.body === 'object');
  });

  // 2. Auth — login
  await section('Auth: login, me, logout', async () => {
    const bad = await api('POST', '/api/auth/login', { username: 'user', password: 'wrong' });
    check('POST /api/auth/login (bad pw) → 401', bad.status === 401);

    const ok = await api('POST', '/api/auth/login', { username: 'user', password: 'nocoos' });
    check('POST /api/auth/login (good) → 200', ok.status === 200 && typeof ok.body?.token === 'string');
    token = ok.body?.token;
    check('token is HMAC-signed (contains dot)', token?.includes('.'));

    const me = await api('GET', '/api/auth/me', null, true);
    check('GET /api/auth/me → 200 with isAdmin', me.status === 200 && me.body?.user?.isAdmin === true);

    const meNoAuth = await api('GET', '/api/auth/me');
    check('GET /api/auth/me (no auth) → 401', meNoAuth.status === 401);

    const logout = await api('POST', '/api/auth/logout', {}, true);
    check('POST /api/auth/logout → 200', logout.status === 200);

    // Re-login since logout invalidated the token
    const re = await api('POST', '/api/auth/login', { username: 'user', password: 'nocoos' });
    token = re.body?.token;
  });

  // 3. Auth — password change
  await section('Auth: password change', async () => {
    const r = await api('POST', '/api/auth/password', {
      currentPassword: 'nocoos',
      newPassword: 'newpass123'
    }, true);
    check('POST /api/auth/password (valid) → 200', r.status === 200);

    // Old password should now fail
    const oldFail = await api('POST', '/api/auth/login', { username: 'user', password: 'nocoos' });
    check('old password rejected after change', oldFail.status === 401);

    // New password should work
    const newOk = await api('POST', '/api/auth/login', { username: 'user', password: 'newpass123' });
    check('new password accepted', newOk.status === 200 && typeof newOk.body?.token === 'string');
    token = newOk.body?.token;

    // Restore default password for subsequent tests
    await api('POST', '/api/auth/password', {
      currentPassword: 'newpass123',
      newPassword: 'nocoos'
    }, true);
    const restored = await api('POST', '/api/auth/login', { username: 'user', password: 'nocoos' });
    token = restored.body?.token;
  });

  // 4. Auth — unlock (lock screen)
  await section('Auth: unlock', async () => {
    const r = await api('POST', '/api/auth/unlock', { password: 'nocoos' }, true);
    check('POST /api/auth/unlock (correct) → 200', r.status === 200);
    const bad = await api('POST', '/api/auth/unlock', { password: 'wrong' }, true);
    check('POST /api/auth/unlock (wrong) → 401', bad.status === 401);
  });

  // 5. Settings persistence
  await section('Settings: GET, PUT, persist', async () => {
    const get = await api('GET', '/api/settings', null, true);
    check('GET /api/settings → 200 with defaults', get.status === 200 && get.body?.prefs?.accent);

    const put = await api('PUT', '/api/settings', { accent: '#ff0000', animate: false }, true);
    check('PUT /api/settings → 200 with updated', put.status === 200 && put.body?.prefs?.accent === '#ff0000');

    const get2 = await api('GET', '/api/settings', null, true);
    check('GET /api/settings (after PUT) → persists', get2.body?.prefs?.accent === '#ff0000');
  });

  // 6. System info (Windows loadavg should be null, CPU util should be present)
  await section('System info', async () => {
    const r = await api('GET', '/api/system/info', null, true);
    check('GET /api/system/info → 200', r.status === 200);
    const cpus = r.body?.cpus;
    check('cpus.utilization field present', cpus?.utilization !== undefined || cpus?.utilization === null);
    if (process.platform === 'win32') {
      check('Windows: load is null', cpus?.load === null);
    } else {
      check('POSIX: load is array of 3', Array.isArray(cpus?.load) && cpus.load.length === 3);
    }
  });

  // 7. VFS — list, write, read, mkdir, delete
  await section('VFS operations', async () => {
    const list = await api('GET', '/api/fs/list?path=/home/user', null, true);
    check('GET /api/fs/list → 200', list.status === 200);

    const write = await api('PUT', '/api/fs/write', {
      path: '/home/user/test-e2e.txt',
      content: 'hello from e2e'
    }, true);
    check('PUT /api/fs/write → 200', write.status === 200);

    // /fs/read returns raw text, not JSON
    const readRes = await fetch(`http://localhost:${PORT}/api/fs/read?path=/home/user/test-e2e.txt`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const readText = await readRes.text();
    check('GET /api/fs/read → returns content', readRes.status === 200 && readText === 'hello from e2e');

    const mkdir = await api('POST', '/api/fs/mkdir', { path: '/tmp/e2e-dir' }, true);
    check('POST /api/fs/mkdir → 200', mkdir.status === 200);

    const rm = await api('POST', '/api/fs/delete', { path: '/home/user/test-e2e.txt' }, true);
    check('POST /api/fs/delete → 200', rm.status === 200);
  });

  // 8. VFS ACL — /host RO default
  await section('VFS ACL (Phase 2.5)', async () => {
    const writeHost = await api('PUT', '/api/fs/write', {
      path: '/host/test-e2e.txt',
      content: 'should fail'
    }, true);
    check('write to /host rejected (default RO) → 403', writeHost.status === 403);

    const readHost = await api('GET', '/api/fs/list?path=/host', null, true);
    check('read /host allowed → 200', readHost.status === 200);
  });

  // 9. Apps registry
  await section('Apps registry', async () => {
    const r = await api('GET', '/api/registry/apps', null, true);
    check('GET /api/registry/apps → 200', r.status === 200 && Array.isArray(r.body?.apps));
    const ids = (r.body?.apps || []).map((a) => a.id);
    check('builtin apps all present', ['terminal', 'filemanager', 'editor', 'installer', 'settings', 'monitor', 'browser', 'about'].every((id) => ids.includes(id)));
    // monitor/browser should now be pinned (Phase 4.4 fix)
    const monitor = (r.body?.apps || []).find((a) => a.id === 'monitor');
    check('monitor is pinned', monitor?.pinned === true);
    const browser = (r.body?.apps || []).find((a) => a.id === 'browser');
    check('browser is pinned', browser?.pinned === true);
    // User app from apps/hello
    check('user app "hello" loaded', ids.includes('hello'));
  });

  // 10. Manager-only mode routes
  await section('Manager-only mode', async () => {
    const r = await api('GET', '/manager');
    check('GET /manager → 200 (HTML)', r.status === 200);
  });

  // 11. /api/instances auth (Phase 1.5)
  await section('Cross-instance registry auth', async () => {
    const noAuth = await api('GET', '/api/instances');
    check('GET /api/instances (no auth) → 401', noAuth.status === 401);
    const withAuth = await api('GET', '/api/instances', null, true);
    check('GET /api/instances (auth) → 200', withAuth.status === 200);
  });

  async function waitForWsMessage(ws, predicate, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { ws.removeListener('message', onMsg); resolve(null); }, timeoutMs);
    function onMsg(raw) {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (predicate(m)) {
        clearTimeout(timer);
        ws.removeListener('message', onMsg);
        resolve(m);
      }
    }
    ws.on('message', onMsg);
  });
}

// 12. WebSocket: /ws/shell — admin only, sandboxed
  await section('WebSocket: /ws/shell (admin, sandboxed)', async () => {
    const ws = new WebSocket(`ws://localhost:${PORT}/ws/shell?token=${encodeURIComponent(token)}`);
    const opened = await new Promise((resolve) => {
      ws.once('open', () => resolve(true));
      ws.once('error', () => resolve(false));
      setTimeout(() => resolve(false), 3000);
    });
    check('WS /ws/shell open as admin', opened);
    if (opened) {
      // Drain the initial hello message so it doesn't match our predicate.
      await waitForWsMessage(ws, (m) => m.event === 'hello', 1000);

      // Send a benign eval
      ws.send(JSON.stringify({ type: 'eval', code: '1 + 2' }));
      const result = await waitForWsMessage(ws, (m) => m.event === 'result', 3000);
      check('WS /ws/shell eval returns 3', result?.value === '3');

      // Send an attempt to access require — should be undefined in sandbox
      ws.send(JSON.stringify({ type: 'eval', code: 'typeof require' }));
      const sandboxResult = await waitForWsMessage(ws, (m) => m.event === 'result', 3000);
      check('sandboxed eval cannot access require', sandboxResult?.value === 'undefined');

      // Send an attempt to access process — should be undefined
      ws.send(JSON.stringify({ type: 'eval', code: 'typeof process' }));
      const procResult = await waitForWsMessage(ws, (m) => m.event === 'result', 3000);
      check('sandboxed eval cannot access process', procResult?.value === 'undefined');

      // Send a Math call to verify the sandbox allows safe builtins
      ws.send(JSON.stringify({ type: 'eval', code: 'Math.sqrt(16)' }));
      const mathResult = await waitForWsMessage(ws, (m) => m.event === 'result', 3000);
      check('sandboxed eval allows Math', mathResult?.value === '4');

      ws.close();
    }
  });

  // 13. WebSocket: /ws/terminal — create, write, list, kill
  await section('WebSocket: /ws/terminal', async () => {
    const create = await api('POST', '/api/terminals', {}, true);
    check('POST /api/terminals → 200', create.status === 200 && typeof create.body?.id === 'string');
    const termId = create.body?.id;

    if (termId) {
      const ws = new WebSocket(`ws://localhost:${PORT}/ws/terminal?id=${encodeURIComponent(termId)}&token=${encodeURIComponent(token)}`);
      const opened = await new Promise((resolve) => {
        ws.once('open', () => resolve(true));
        ws.once('error', () => resolve(false));
        setTimeout(() => resolve(false), 3000);
      });
      check('WS /ws/terminal open', opened);
      if (opened) {
        ws.send(JSON.stringify({ type: 'input', data: 'echo e2e-ok\n' }));
        await wait(800);
        const list = await api('GET', '/api/terminals', null, true);
        const term = (list.body?.terminals || []).find((t) => t.id === termId);
        check('terminal appears in list', !!term);
      }
      ws.close();

      const del = await api('DELETE', `/api/terminals/${termId}`, null, true);
      check('DELETE /api/terminals/:id → 200', del.status === 200);
    }
  });

  // 14. Client errors endpoint (no auth needed)
  await section('Client errors endpoint', async () => {
    const r = await fetch(`http://localhost:${PORT}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'test', message: 'e2e test error', file: 'test.js' })
    });
    check('POST /api/client-errors → 204', r.status === 204);
  });

  // 15. Frontend pages (HTML)
  await section('Frontend pages', async () => {
    const pages = ['/', '/login', '/boot', '/desktop', '/manager'];
    for (const p of pages) {
      const r = await fetch(`http://localhost:${PORT}${p}`);
      check(`GET ${p} → 200 (HTML)`, r.status === 200 && (await r.text()).includes('<!DOCTYPE') || (await r.text()).includes('<html'));
    }
  });

  // 16. Static assets for user apps
  await section('User app static serving', async () => {
    const r = await fetch(`http://localhost:${PORT}/js/hello/index.js`);
    check('GET /js/hello/index.js → 200', r.status === 200);
    const text = await r.text();
    check('hello/index.js contains open()', text.includes('export async function open'));
  });

  // 17. /api/health/lint (parser)
  await section('Lint parser', async () => {
    const r = await api('GET', '/api/health/lint');
    check('GET /api/health/lint → 200', r.status === 200);
    check('parser stats present', typeof r.body?.parser === 'object');
  });

  // 18. Package manager (skip actual install — slow)
  await section('Package manager endpoints (no actual install)', async () => {
    const tools = await api('GET', '/api/system/tools', null, true);
    check('GET /api/system/tools → 200', tools.status === 200 && typeof tools.body?.tools === 'object');
    const jobs = await api('GET', '/api/pkg/jobs', null, true);
    check('GET /api/pkg/jobs → 200', jobs.status === 200 && Array.isArray(jobs.body?.jobs));
  });

  // 19. /api/system/procs/:id/kill — needs admin (we have admin)
  await section('Process management', async () => {
    const procs = await api('GET', '/api/system/procs', null, true);
    check('GET /api/system/procs → 200', procs.status === 200 && Array.isArray(procs.body?.procs));
    // Don't actually kill any process — just verify the route exists and 404s for missing ids
    const kill404 = await api('POST', '/api/system/procs/nonexistent-id-12345/kill', { signal: 'SIGTERM' }, true);
    check('POST /api/system/procs/:id/kill (missing) → 404', kill404.status === 404);
  });

  await killServer();

  // Summary
  console.log('\n=== Summary ===');
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;
  console.log(`  ${passed} passed, ${failed} failed (of ${results.length} checks)`);
  if (failed > 0) {
    console.log('\n  Failures:');
    for (const r of results.filter((r) => !r.ok)) {
      console.log(`    - ${r.name}${r.detail ? ': ' + r.detail : ''}`);
    }
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('E2E test crashed:', err);
  killServer().then(() => process.exit(1));
});