import { test } from 'node:test';
import assert from 'node:assert/strict';
import reg from '../os/src/kernel/app-registry.js';
import procMgr from '../os/src/kernel/process-manager.js';

test('app-registry: loads builtins', () => {
  reg.load();
  const apps = reg.list();
  assert.ok(apps.length >= 8, 'at least 8 apps registered');
  const ids = apps.map((a) => a.id);
  for (const required of ['terminal', 'filemanager', 'editor', 'installer', 'settings', 'monitor', 'browser', 'about']) {
    assert.ok(ids.includes(required), `builtin app "${required}" must be present`);
  }
});

test('app-registry: pinned list is non-empty', () => {
  const pinned = reg.pinnedList();
  assert.ok(pinned.length > 0);
});

test('app-registry: pin/unpin works', () => {
  const ok = reg.pin('monitor');
  assert.equal(ok, true);
  assert.ok(reg.pinned.has('monitor'));
  reg.unpin('monitor');
  assert.ok(!reg.pinned.has('monitor'));
});

test('process-manager: stats work', () => {
  const stats = procMgr.stats();
  assert.equal(typeof stats.total, 'number');
  assert.equal(typeof stats.running, 'number');
});
