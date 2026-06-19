import { test } from 'node:test';
import assert from 'node:assert/strict';
import termMgr from '../os/src/kernel/terminal.js';

function clearSessions() {
  for (const s of Array.from(termMgr.sessions.values())) {
    try { s.proc && s.proc.kill('SIGKILL'); } catch {}
    termMgr.sessions.delete(s.id);
  }
}

test('terminal: creates a session and lists it', async () => {
  clearSessions();
  const s = termMgr.create({ cols: 80, rows: 24 });
  assert.ok(s.id, 'session id');
  assert.ok(s.proc, 'process spawned');
  const list = termMgr.list();
  assert.ok(list.find((t) => t.id === s.id), 'session in list');
  clearSessions();
});

test('terminal: rejects beyond max', () => {
  clearSessions();
  termMgr.setMax(1);
  const a = termMgr.create({});
  assert.throws(() => termMgr.create({}), /Maximum terminals/);
  clearSessions();
  termMgr.setMax(8);
});

test('terminal: write forwards to stdin', async () => {
  clearSessions();
  const s = termMgr.create({ cols: 80, rows: 24 });
  await new Promise((r) => setTimeout(r, 250));
  const ok = s.write('echo hello\n');
  assert.equal(typeof ok, 'boolean');
  clearSessions();
});
