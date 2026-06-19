import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

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

test('lint: middleware returns 500 with error info for broken JS', async () => {
  const port = 31600 + Math.floor(Math.random() * 100);
  const proc = await startServer(port, { NOCOOS_LINT: '1' });
  const target = path.resolve('os/public/js/_lint_test_broken.js');
  fs.writeFileSync(target, 'export const x = 1;)\n');
  try {
    const ok = await fetch(`http://localhost:${port}/js/apps/terminal.js`);
    assert.equal(ok.status, 200, 'valid JS still served');

    const resp = await fetch(`http://localhost:${port}/js/_lint_test_broken.js`);
    assert.equal(resp.status, 500, 'broken JS returns 500');
    const body = await resp.json();
    assert.equal(body.error, 'syntax_error');
    assert.ok(body.file.includes('_lint_test_broken.js'), 'file in body');
    assert.ok(body.message, 'has message');
  } finally {
    try { fs.unlinkSync(target); } catch {}
    await stopServer(proc);
  }
});

test('lint: middleware off by default', async () => {
  const port = 31700 + Math.floor(Math.random() * 100);
  const proc = await startServer(port, {});
  const target = path.resolve('os/public/js/_lint_test_off.js');
  fs.writeFileSync(target, 'export const x = 1;)\n');
  try {
    const resp = await fetch(`http://localhost:${port}/js/_lint_test_off.js`);
    assert.equal(resp.status, 200, 'broken JS served when lint off');
  } finally {
    try { fs.unlinkSync(target); } catch {}
    await stopServer(proc);
  }
});
