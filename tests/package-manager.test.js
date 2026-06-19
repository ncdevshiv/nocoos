import { test } from 'node:test';
import assert from 'node:assert/strict';
import pkg from '../os/src/kernel/package-manager.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

test('package-manager: detects installed tools', async () => {
  const tools = await pkg.detectTools();
  assert.ok(tools.npm, 'npm should be available in this environment');
});

test('package-manager: workspace exists', async () => {
  const dir = await pkg.workspace('test-' + Date.now());
  assert.ok(fs.existsSync(dir));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('package-manager: rejects unsupported manager', () => {
  assert.throws(() => pkg.createJob({ manager: 'fake', args: ['x'], cwd: process.cwd() }));
});

test('package-manager: cancel returns false on missing job', () => {
  assert.equal(pkg.cancelJob('non-existent-id'), false);
});
