import { test } from 'node:test';
import assert from 'node:assert/strict';
import metrics from '../os/src/kernel/metrics.js';

test('metrics: counters increment and serialize', () => {
  metrics.recordAuth('success');
  metrics.recordAuth('success');
  metrics.recordAuth('failure');
  const snap = metrics.snapshot();
  assert.ok(snap.metrics.nocoos_auth_logins_total, 'auth counter present');
  const total = Object.values(snap.metrics.nocoos_auth_logins_total).reduce((a, b) => a + b, 0);
  assert.ok(total >= 3, 'at least 3 auth events recorded');
});

test('metrics: fs ops counter', () => {
  metrics.recordFs('write');
  metrics.recordFs('read');
  metrics.recordFs('read');
  const snap = metrics.snapshot();
  const fsTotal = Object.values(snap.metrics.nocoos_fs_operations_total).reduce((a, b) => a + b, 0);
  assert.ok(fsTotal >= 3, 'fs ops recorded');
});

test('metrics: pkg jobs counter', () => {
  metrics.recordPkg('npm', 'success');
  metrics.recordPkg('npm', 'failed');
  metrics.recordPkg('pnpm', 'success');
  const snap = metrics.snapshot();
  const all = Object.entries(snap.metrics.nocoos_pkg_jobs_total).reduce((sum, [k, v]) => sum + (typeof v === 'number' ? v : 0), 0);
  assert.ok(all >= 3, 'pkg jobs recorded');
});

test('metrics: text format produces Prometheus output', () => {
  const text = metrics.text();
  assert.ok(text.includes('# HELP nocoos_uptime_seconds'), 'has uptime help');
  assert.ok(text.includes('# TYPE nocoos_uptime_seconds'), 'has uptime type');
  assert.ok(text.includes('nocoos_uptime_seconds'), 'has uptime gauge line');
  assert.ok(text.includes('nocoos_memory_rss_bytes'), 'has rss gauge');
  assert.ok(text.includes('nocoos_http_requests_total'), 'has http counter');
  assert.ok(text.includes('# TYPE nocoos_http_request_duration_seconds histogram'), 'has http histogram');
});

test('metrics: snapshot contains process and host info', () => {
  const snap = metrics.snapshot();
  assert.ok(snap.process.pid > 0, 'pid set');
  assert.ok(snap.process.node, 'node version set');
  assert.ok(snap.host.hostname, 'hostname set');
  assert.ok(snap.host.cpus >= 1, 'cpu count set');
  assert.ok(snap.timestamp, 'timestamp set');
});

test('metrics: ws connections counter exists', () => {
  metrics.recordWs('terminal', 'success');
  const snap = metrics.snapshot();
  assert.ok(snap.metrics.nocoos_ws_connections_total, 'ws counter present');
});

