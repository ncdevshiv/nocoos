import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import WS from 'ws';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const WebSocket = WS.WebSocket || WS;

async function startServer(port, env = {}) {
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
  proc.kill('SIGTERM');
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

test('hmr: syntax-error event sent when file becomes invalid', { timeout: 15000 }, async () => {
  const port = 31800 + Math.floor(Math.random() * 100);
  const proc = await startServer(port, { NOCOOS_HMR: '1' });
  const target = path.resolve('os/public/js/_hmr_test_broken.js');
  try {
    const sock = new WebSocket(`ws://localhost:${port}/ws/hmr`);
    const events = [];
    let resolveDone;
    const done = new Promise((r) => { resolveDone = r; });

    sock.on('message', (data) => {
      const m = JSON.parse(data.toString());
      events.push(m);
      if (m.type === 'syntax-error') {
        resolveDone(m);
      }
    });
    sock.on('error', () => resolveDone(null));

    await new Promise((resolve, reject) => {
      sock.on('open', resolve);
      sock.on('error', reject);
    });

    // Wait for hello
    await new Promise((r) => setTimeout(r, 200));

    // Write a broken file — should trigger parse + syntax-error event
    fs.writeFileSync(target, 'export const x = 1;)\n');

    const result = await Promise.race([
      done,
      new Promise((r) => setTimeout(() => r('timeout'), 5000))
    ]);

    sock.close();

    assert.notEqual(result, 'timeout', 'received event within 5s');
    assert.notEqual(result, null, 'no connection error');
    assert.equal(result.type, 'syntax-error');
    assert.ok(Array.isArray(result.errors));
    assert.ok(result.errors.length >= 1);
    assert.ok(result.errors[0].path.includes('_hmr_test_broken.js'));
    assert.ok(result.errors[0].message);
  } finally {
    try { fs.unlinkSync(target); } catch {}
    await stopServer(proc);
  }
});
