import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import portFinder from '../os/src/kernel/port-finder.js';

test('port-finder: finds a free port', async () => {
  const port = await portFinder.findFreePort(30000, 30100);
  assert.ok(typeof port === 'number' && port > 0, 'returns a port number');
  assert.ok(port >= 30000 && port <= 30100, 'in expected range');
});

test('port-finder: skips occupied ports', async () => {
  // Occupy a port
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '0.0.0.0', r));
  const occupied = server.address().port;
  try {
    const port = await portFinder.findFreePort(occupied, occupied + 5);
    assert.notEqual(port, occupied, 'should not pick the occupied port');
    assert.ok(port > occupied);
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test('port-finder: isPortFree returns true for free port', async () => {
  const free = await portFinder.findFreePort(40000, 40100);
  const result = await portFinder.isPortFree(free);
  assert.equal(result, true);
});

test('port-finder: isPortFree returns false for occupied port', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '0.0.0.0', r));
  const occupied = server.address().port;
  try {
    const result = await portFinder.isPortFree(occupied);
    assert.equal(result, false);
  } finally {
    await new Promise((r) => server.close(r));
  }
});
