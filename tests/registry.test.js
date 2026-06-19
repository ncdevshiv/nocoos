import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import registry from '../os/src/kernel/registry.js';

const tmpRoot = path.join(os.tmpdir(), 'nocoos-reg-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8));

test('registry: load returns empty when no file', () => {
  const r = registry.load(tmpRoot);
  assert.deepEqual(r.instances, []);
});

test('registry: upsert adds entry', () => {
  registry.upsert({ name: 'a', pid: 99991, port: 3000, dataDir: '/tmp/a' }, tmpRoot);
  const r = registry.load(tmpRoot);
  assert.equal(r.instances.length, 1);
  assert.equal(r.instances[0].name, 'a');
  assert.equal(r.instances[0].port, 3000);
  assert.ok(r.instances[0].lastSeen);
});

test('registry: upsert updates existing entry', () => {
  registry.upsert({ name: 'a', pid: 99991, port: 3000, dataDir: '/tmp/a' }, tmpRoot);
  registry.upsert({ name: 'a', pid: 99991, port: 3001, dataDir: '/tmp/a' }, tmpRoot);
  const r = registry.load(tmpRoot);
  assert.equal(r.instances.length, 1);
  assert.equal(r.instances[0].port, 3001);
});

test('registry: remove deletes entry', () => {
  registry.upsert({ name: 'b', pid: 99992, port: 3000, dataDir: '/tmp/b' }, tmpRoot);
  registry.remove('b', tmpRoot);
  const r = registry.load(tmpRoot);
  assert.equal(r.instances.find((i) => i.name === 'b'), undefined);
});

test('registry: pruneStale removes stale entries', () => {
  // Clean slate for this test
  registry.remove('s', tmpRoot);
  registry.remove('f', tmpRoot);
  registry.remove('live', tmpRoot);
  registry.remove('a', tmpRoot);
  registry.upsert({ name: 's', pid: 99993, port: 3000, dataDir: '/tmp/s', lastSeen: new Date(Date.now() - 60000).toISOString() }, tmpRoot);
  registry.upsert({ name: 'f', pid: 99994, port: 3001, dataDir: '/tmp/f', lastSeen: new Date().toISOString() }, tmpRoot);
  const before = registry.load(tmpRoot);
  assert.equal(before.instances.length, 2, 'both entries before prune');
  const r = registry.pruneStale(tmpRoot);
  assert.equal(r.instances.length, 1, 'stale entry pruned, fresh kept');
  assert.equal(r.instances[0].name, 'f');
});

test('registry: listWithStatus marks alive pid correctly', async () => {
  // Use a real alive child for the alive check
  const child = spawn(process.execPath, ['-e', 'setInterval(()=>{}, 60000)'], { stdio: 'ignore' });
  try {
    registry.upsert({ name: 'live', pid: child.pid, port: 3000, dataDir: '/tmp/live' }, tmpRoot);
    const list = registry.listWithStatus(tmpRoot);
    const live = list.find((i) => i.name === 'live');
    assert.ok(live);
    assert.equal(live.alive, true);
    assert.equal(live.status, 'running');
  } finally {
    try { child.kill('SIGKILL'); } catch {}
  }
});

test('registry: isAlive works', () => {
  assert.equal(registry.isPidAlive(process.pid), true);
  assert.equal(registry.isPidAlive(99999999), false);
});

test('registry: cleanup', async () => {
  try { await fsp.unlink(path.join(tmpRoot, '.nocoos-registry.json')); } catch {}
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});
