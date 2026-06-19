import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../os/src/kernel/config.js';
import vfs from '../os/src/kernel/vfs.js';

const __filename = fileURLToPath(import.meta.url);

test('config: defaults are sane', () => {
  assert.ok(typeof config.port === 'number' && config.port > 0, 'port is positive number');
  assert.ok(typeof config.host === 'string', 'host is string');
  assert.ok(fs.existsSync(config.dataDir), 'dataDir exists');
  assert.ok(fs.existsSync(config.publicDir), 'publicDir exists');
});

test('vfs: boot creates home and apps dirs', () => {
  vfs.boot();
  assert.ok(fs.existsSync(path.join(config.dataDir, 'home', 'user')));
  assert.ok(fs.existsSync(path.join(config.dataDir, 'apps')));
  assert.ok(fs.existsSync(path.join(config.dataDir, 'tmp')));
});

test('vfs: write and read back', async () => {
  const path = '/tmp/test-' + Date.now() + '.txt';
  await vfs.writeFile(path, 'hello nocoos', { encoding: 'utf8' });
  const data = await vfs.readFile(path, { encoding: 'utf8' });
  assert.equal(data, 'hello nocoos');
  await vfs.remove(path);
});

test('vfs: list directory', async () => {
  const dir = '/tmp/test-dir-' + Date.now();
  await vfs.mkdir(dir);
  await vfs.writeFile(dir + '/a.txt', 'a');
  await vfs.writeFile(dir + '/b.txt', 'b');
  const entries = await vfs.listDir(dir);
  assert.equal(entries.length, 2);
  assert.ok(entries.find((e) => e.name === 'a.txt'));
  assert.ok(entries.find((e) => e.name === 'b.txt'));
  await vfs.remove(dir, { recursive: true });
});

test('vfs: rename file', async () => {
  const src = '/tmp/rename-src-' + Date.now() + '.txt';
  const dst = '/tmp/rename-dst-' + Date.now() + '.txt';
  await vfs.writeFile(src, 'data');
  await vfs.move(src, dst);
  assert.ok(await vfs.exists(dst));
  assert.ok(!(await vfs.exists(src)));
  await vfs.remove(dst);
});

test('vfs: normalize normalizes paths', () => {
  assert.equal(vfs.normalize('/a/b/../c'), '/a/c');
  assert.equal(vfs.normalize('/a//b'), '/a/b');
  assert.equal(vfs.normalize('a/b'), '/a/b');
});
