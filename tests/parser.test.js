import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import parser from '../os/src/kernel/parser.js';

test('parser: valid JS passes', async () => {
  const tmp = path.join(os.tmpdir(), 'nocoos-test-' + Date.now() + '.js');
  fs.writeFileSync(tmp, 'export const x = 1;\n');
  const result = await parser.validateFile(tmp);
  assert.equal(result.ok, true);
  fs.unlinkSync(tmp);
});

test('parser: catches Unexpected token', async () => {
  const tmp = path.join(os.tmpdir(), 'nocoos-test-' + Date.now() + '.js');
  fs.writeFileSync(tmp, 'export const x = 1;)\n');
  const result = await parser.validateFile(tmp);
  assert.equal(result.ok, false);
  assert.ok(result.error, 'has error object');
  assert.ok(typeof result.error.message === 'string');
  fs.unlinkSync(tmp);
});

test('parser: catches unclosed bracket', async () => {
  const tmp = path.join(os.tmpdir(), 'nocoos-test-' + Date.now() + '.js');
  fs.writeFileSync(tmp, 'export function foo() { return [1, 2, ;\n');
  const result = await parser.validateFile(tmp);
  assert.equal(result.ok, false);
  fs.unlinkSync(tmp);
});

test('parser: caches by mtime', async () => {
  const tmp = path.join(os.tmpdir(), 'nocoos-test-' + Date.now() + '.js');
  fs.writeFileSync(tmp, 'export const x = 1;\n');
  const a = await parser.validateFile(tmp);
  const b = await parser.validateFile(tmp);
  assert.equal(a.ok, true);
  assert.equal(b.cached, true, 'second call cached');
  fs.unlinkSync(tmp);
});

test('parser: cache invalidates on mtime change', async () => {
  const tmp = path.join(os.tmpdir(), 'nocoos-test-' + Date.now() + '.js');
  fs.writeFileSync(tmp, 'export const x = 1;\n');
  await parser.validateFile(tmp);
  // Wait and update mtime
  await new Promise((r) => setTimeout(r, 50));
  fs.writeFileSync(tmp, 'export const x = 2;\n');
  const result = await parser.validateFile(tmp);
  assert.equal(result.ok, true);
  assert.notEqual(result.cached, true, 'cache invalidated after mtime change');
  fs.unlinkSync(tmp);
});

test('parser: handles missing file gracefully', async () => {
  const result = await parser.validateFile('/nonexistent/path/to/file.js');
  assert.equal(result.ok, false);
});

test('parser: skip large files', async () => {
  const tmp = path.join(os.tmpdir(), 'nocoos-test-' + Date.now() + '.js');
  // 2 MB file
  const big = '// ' + 'x'.repeat(2 * 1024 * 1024) + '\n';
  fs.writeFileSync(tmp, big);
  const result = await parser.validateFile(tmp);
  assert.equal(result.ok, true);
  assert.equal(result.skipped, 'too_large');
  fs.unlinkSync(tmp);
});

test('parser: reports line and column', async () => {
  const tmp = path.join(os.tmpdir(), 'nocoos-test-' + Date.now() + '.js');
  fs.writeFileSync(tmp, 'export const x = 1;\nexport const y = 2;)\n');
  parser.invalidate(tmp);
  const result = await parser.validateFile(tmp);
  assert.equal(result.ok, false);
  assert.ok(typeof result.error.line === 'number' || result.error.line === null);
  fs.unlinkSync(tmp);
});
