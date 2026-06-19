import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

async function startServer(port, env = {}) {
  // Unique instance per test so parallel test files don't fight over the same data dir lock.
  const instance = 'test-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
  const proc = spawn(process.execPath, ['os/server.js'], {
    cwd: ROOT,
    env: { ...process.env, NOCOOS_PORT: String(port), NOCOOS_LOG_LEVEL: 'error', NOCOOS_INSTANCE_NAME: instance, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/api/health`);
      if (r.ok) return proc;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  proc.kill('SIGKILL');
  throw new Error('server did not start');
}

async function stopServer(proc) {
  if (!proc) return;
  if (proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  await Promise.race([
    new Promise((r) => proc.once('exit', r)),
    new Promise((r) => setTimeout(() => {
      try { proc.kill('SIGKILL'); } catch {}
      r();
    }, 2000))
  ]);
}

test('client-errors: endpoint accepts JSON and returns 204', async () => {
  const port = 31500 + Math.floor(Math.random() * 100);
  const proc = await startServer(port);
  try {
    const resp = await fetch(`http://localhost:${port}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'syntax',
        message: 'Test syntax error',
        file: '/js/apps/test.js',
        line: 42,
        col: 8,
        stack: 'SyntaxError: Unexpected token\n  at /js/apps/test.js:42:8'
      })
    });
    assert.equal(resp.status, 204);
  } finally {
    await stopServer(proc);
  }
});

test('client-errors: endpoint accepts text/plain sendBeacon body', async () => {
  const port = 31500 + Math.floor(Math.random() * 100);
  const proc = await startServer(port);
  try {
    const resp = await fetch(`http://localhost:${port}/api/client-errors`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'kind=runtime&message=plain-text-error'
    });
    assert.equal(resp.status, 204);
  } finally {
    await stopServer(proc);
  }
});

test('client-errors: increments metric counter', async () => {
  const port = 31500 + Math.floor(Math.random() * 100);
  const proc = await startServer(port);
  try {
    for (let i = 0; i < 3; i++) {
      await fetch(`http://localhost:${port}/api/client-errors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'runtime', message: `error ${i}`, file: '/js/test.js' })
      });
    }
    const resp = await fetch(`http://localhost:${port}/metrics`);
    const text = await resp.text();
    assert.ok(text.includes('nocoos_client_errors_total'), 'has client errors counter');
  } finally {
    await stopServer(proc);
  }
});
