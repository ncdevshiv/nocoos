import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import lock from '../os/src/kernel/lock.js';

const tmpRoot = path.join(os.tmpdir(), 'nocoos-lock-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

test('lock: acquire writes lock file with metadata', async () => {
  const dir = path.join(tmpRoot, 'a');
  await fsp.mkdir(dir, { recursive: true });
  const payload = await lock.acquire({ name: 'a', pid: process.pid, port: 3000, dataDir: dir });
  assert.equal(payload.name, 'a');
  assert.equal(payload.port, 3000);
  assert.ok(payload.startedAt);
  const raw = await fsp.readFile(path.join(dir, '.lock'), 'utf8');
  const parsed = JSON.parse(raw);
  assert.equal(parsed.pid, process.pid);
  assert.equal(parsed.name, 'a');
});

test('lock: second acquire on same dir by alive pid refuses', async () => {
  const dir = path.join(tmpRoot, 'b');
  await fsp.mkdir(dir, { recursive: true });
  // Spawn a real alive process so we can verify the conflict detection.
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    await lock.acquire({ name: 'b', pid: child.pid, port: 3000, dataDir: dir });
    await assert.rejects(
      () => lock.acquire({ name: 'b2', pid: process.pid, port: 3001, dataDir: dir }),
      (err) => err.code === 'INSTANCE_RUNNING'
    );
  } finally {
    try { child.kill('SIGKILL'); } catch {}
  }
});

test('lock: stale lock (dead pid) is removed and replaced', async () => {
  const dir = path.join(tmpRoot, 'c');
  await fsp.mkdir(dir, { recursive: true });
  // Use a very high PID that almost certainly doesn't exist
  await lock.acquire({ name: 'c', pid: 99999999, port: 3000, dataDir: dir });
  const newLock = await lock.acquire({ name: 'c', pid: process.pid, port: 3001, dataDir: dir });
  assert.equal(newLock.pid, process.pid);
  assert.equal(newLock.port, 3001);
});

test('lock: force flag bypasses alive-pid check', async () => {
  const dir = path.join(tmpRoot, 'g');
  await fsp.mkdir(dir, { recursive: true });
  const { spawn } = await import('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    await lock.acquire({ name: 'g', pid: child.pid, port: 3000, dataDir: dir });
    const newLock = await lock.acquire({ name: 'g2', pid: process.pid, port: 3001, dataDir: dir, force: true });
    assert.equal(newLock.pid, process.pid);
  } finally {
    try { child.kill('SIGKILL'); } catch {}
  }
});

test('lock: release removes lock file', async () => {
  const dir = path.join(tmpRoot, 'd');
  await fsp.mkdir(dir, { recursive: true });
  await lock.acquire({ name: 'd', pid: process.pid, port: 3000, dataDir: dir });
  assert.ok(fs.existsSync(path.join(dir, '.lock')));
  await lock.release(dir);
  assert.ok(!fs.existsSync(path.join(dir, '.lock')));
});

test('lock: releaseSync removes lock file', async () => {
  const dir = path.join(tmpRoot, 'e');
  await fsp.mkdir(dir, { recursive: true });
  await lock.acquire({ name: 'e', pid: process.pid, port: 3000, dataDir: dir });
  assert.ok(lock.releaseSync(dir));
  assert.ok(!fs.existsSync(path.join(dir, '.lock')));
});

test('lock: readLock returns null when no lock exists', async () => {
  const dir = path.join(tmpRoot, 'f');
  await fsp.mkdir(dir, { recursive: true });
  const result = await lock.readLock(dir);
  assert.equal(result, null);
});

test('lock: isAlive detects current process', () => {
  assert.equal(lock.isAlive(process.pid), true);
  assert.equal(lock.isAlive(99999999), false);
});

test('lock: cleanup tmp after tests', async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});
