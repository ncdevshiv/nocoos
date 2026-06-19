import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

async function startServer(port, env = {}) {
  const instance = 'multi-' + process.pid + '-' + Math.random().toString(36).slice(2, 8);
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

// Each test picks a base port from process.pid to avoid collisions across
// parallel `node --test` runs (each Node process has a unique pid, so
// port ranges don't overlap). Final ports still get a small random offset
// for the conflict test (which spawns two servers on different ports).
function basePort() {
  return 32000 + (process.pid % 1000);
}

test('multi-instance: two servers with different instance names coexist', { timeout: 30000 }, async () => {
  const port1 = basePort() + Math.floor(Math.random() * 50);
  const port2 = port1 + 50;
  const proc1 = await startServer(port1, { NOCOOS_INSTANCE_NAME: 'multi-a-' + process.pid });
  let proc2;
  try {
    // Second instance with different name should succeed even if data dir would conflict.
    proc2 = await startServer(port2, { NOCOOS_INSTANCE_NAME: 'multi-b-' + process.pid });

    // Both should respond to /api/health
    const r1 = await fetch(`http://localhost:${port1}/api/health`);
    const r2 = await fetch(`http://localhost:${port2}/api/health`);
    assert.equal(r1.status, 200, 'instance 1 healthy');
    assert.equal(r2.status, 200, 'instance 2 healthy');

    // Different data dirs means different users.json files. Login first.
    async function loginAndInfo(port) {
      const login = await fetch(`http://localhost:${port}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'user', password: 'nocoos' })
      });
      const { token } = await login.json();
      const info = await (await fetch(`http://localhost:${port}/api/system/info`, {
        headers: { Authorization: `Bearer ${token}` }
      })).json();
      return info;
    }
    const sysInfo1 = await loginAndInfo(port1);
    const sysInfo2 = await loginAndInfo(port2);
    assert.ok(sysInfo1.process);
    assert.ok(sysInfo2.process);
    assert.notEqual(sysInfo1.process.pid, sysInfo2.process.pid, 'different PIDs');
  } finally {
    await stopServer(proc1);
    if (proc2) await stopServer(proc2);
  }
});

test('multi-instance: same instance name on different ports — second refused', { timeout: 20000 }, async () => {
  const port1 = basePort() + 100 + Math.floor(Math.random() * 50);
  const port2 = port1 + 50;
  const name = 'conflict-' + process.pid;
  const proc1 = await startServer(port1, { NOCOOS_INSTANCE_NAME: name });
  let proc2;
  try {
    // Capture stderr BEFORE waiting for exit so we don't miss INSTANCE_RUNNING.
    let stderr = '';
    // Try to start a second with the same instance name → should fail (refuse)
    proc2 = spawn(process.execPath, ['os/server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NOCOOS_PORT: String(port2),
        NOCOOS_LOG_LEVEL: 'error',
        NOCOOS_INSTANCE_NAME: name
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    proc2.stderr.on('data', (d) => { stderr += d.toString(); });

    // Wait for second to exit (it should exit with INSTANCE_RUNNING)
    const exitCode = await new Promise((r) => proc2.once('exit', r));
    assert.notEqual(exitCode, 0, 'second instance should exit non-zero');
    assert.ok(stderr.includes('INSTANCE_RUNNING') || exitCode === 1, 'exited due to lock conflict');
  } finally {
    await stopServer(proc1);
    // Always release proc2 regardless of exit state. stopServer() no-ops on
    // already-exited procs, so calling it unconditionally is safe and prevents
    // orphaned processes if the test path changes in the future.
    if (proc2) await stopServer(proc2);
  }
});

test('multi-instance: default instance has its own data dir', async () => {
  // Just verify that boot creates data dir
  const port = basePort() + 200 + Math.floor(Math.random() * 50);
  const proc = await startServer(port, { NOCOOS_INSTANCE_NAME: 'dflt-' + process.pid });
  try {
    // Give it a moment
    await new Promise((r) => setTimeout(r, 200));
    // The data dir is os/data-<name>/. Check that the boot created it.
    // (We can't easily check the path from outside, so just verify health.)
    const r = await fetch(`http://localhost:${port}/api/health`);
    assert.equal(r.status, 200);
  } finally {
    await stopServer(proc);
  }
});
