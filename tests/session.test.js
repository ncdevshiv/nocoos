import { test } from 'node:test';
import assert from 'node:assert/strict';
import sessionMgr from '../os/src/kernel/session.js';

test('session: default user exists', () => {
  const users = sessionMgr.listUsers();
  assert.ok(users.length >= 1);
  assert.ok(users.find((u) => u.username === 'user'));
});

test('session: valid login produces token', () => {
  const result = sessionMgr.login('user', 'nocoos');
  assert.equal(result.ok, true);
  assert.ok(result.token);
  assert.equal(result.user.username, 'user');
});

test('session: invalid login rejected', () => {
  const result = sessionMgr.login('user', 'wrong');
  assert.equal(result.ok, false);
  assert.equal(result.error, 'invalid_credentials');
});

test('session: token resolves correctly', () => {
  const r = sessionMgr.login('user', 'nocoos');
  const sess = sessionMgr.resolve(r.token);
  assert.ok(sess);
  assert.equal(sess.username, 'user');
});

test('session: invalid token rejected', () => {
  assert.equal(sessionMgr.resolve('not-a-real-token'), null);
});

test('session: logout invalidates token', () => {
  const r = sessionMgr.login('user', 'nocoos');
  assert.ok(sessionMgr.resolve(r.token));
  sessionMgr.logout(r.token);
  assert.equal(sessionMgr.resolve(r.token), null);
});
