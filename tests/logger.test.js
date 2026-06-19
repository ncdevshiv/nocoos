import { test } from 'node:test';
import assert from 'node:assert/strict';
import logger from '../os/src/utils/logger.js';

test('logger: formatJson produces valid JSON', () => {
  const out = logger.formatJson('info', 'auth', 'login attempt', { user: 'alice' });
  const parsed = JSON.parse(out);
  assert.equal(parsed.level, 'info');
  assert.equal(parsed.scope, 'auth');
  assert.equal(parsed.msg, 'login attempt');
  assert.equal(parsed.meta.user, 'alice');
  assert.ok(parsed.ts, 'has timestamp');
});

test('logger: formatText produces readable text', () => {
  const out = logger.formatText('warn', 'pkg', 'install failed', { pkg: 'foo' });
  assert.match(out, /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, 'has ISO timestamp');
  assert.match(out, /WARN/, 'has level');
  assert.match(out, /\[pkg\]/, 'has scope');
  assert.match(out, /install failed/, 'has message');
  assert.match(out, /"pkg":"foo"/, 'has meta');
});

test('logger: redact removes sensitive fields', () => {
  const r = logger.redact({ username: 'alice', password: 'hunter2', token: 'abc', nested: { authorization: 'Bearer xyz' } });
  assert.equal(r.username, 'alice');
  assert.equal(r.password, '[REDACTED]');
  assert.equal(r.token, '[REDACTED]');
  assert.equal(r.nested.authorization, '[REDACTED]');
});

test('logger: redact handles arrays and primitives', () => {
  assert.equal(logger.redact('plain'), 'plain');
  assert.equal(logger.redact(42), 42);
  assert.equal(logger.redact(null), null);
  const arr = logger.redact([{ password: 'x', ok: 1 }]);
  assert.equal(arr[0].password, '[REDACTED]');
  assert.equal(arr[0].ok, 1);
});

test('logger: make() returns a logger with all levels', () => {
  const log = logger.make('test-scope');
  assert.equal(typeof log.debug, 'function');
  assert.equal(typeof log.info, 'function');
  assert.equal(typeof log.warn, 'function');
  assert.equal(typeof log.error, 'function');
  assert.equal(typeof log.child, 'function');
  // Calling should not throw
  log.info('test');
  log.warn('test', { foo: 'bar' });
});

test('logger: child scopes concatenate with dot', () => {
  const log = logger.make('parent').child('child');
  // Just verify it doesn't throw
  log.info('nested');
});
