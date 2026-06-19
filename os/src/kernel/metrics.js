// Metrics registry: counters, gauges, histograms with Prometheus text-format output.
import os from 'node:os';
import process from 'node:process';
import { config } from './config.js';
import procMgr from './process-manager.js';
import termMgr from './terminal.js';
import logger from '../utils/logger.js';

const log = logger.make('metrics');

class Counter {
  constructor(name, help, labelNames = []) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.values = new Map();
  }
  inc(labelValues = {}, value = 1) {
    const key = this._labelKey(labelValues);
    this.values.set(key, { labels: this._labels(labelValues), value: (this.values.get(key)?.value || 0) + value });
  }
  get(labelValues = {}) {
    return this.values.get(this._labelKey(labelValues))?.value || 0;
  }
  _labelKey(labelValues) {
    return this.labelNames.map((n) => labelValues[n] || '').join('|');
  }
  _labels(labelValues) {
    const out = {};
    for (const n of this.labelNames) out[n] = labelValues[n] || '';
    return out;
  }
}

class Gauge {
  constructor(name, help, labelNames = [], collectFn = null) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.collectFn = collectFn;
    this.values = new Map();
  }
  set(labelValues = {}, value) {
    const key = this._labelKey(labelValues);
    this.values.set(key, { labels: this._labels(labelValues), value });
  }
  get(labelValues = {}) {
    return this.values.get(this._labelKey(labelValues))?.value;
  }
  collect() {
    if (this.collectFn) {
      try { this.collectFn(this); } catch (err) { log.warn('gauge collect failed', { name: this.name, err: err.message }); }
    }
    return Array.from(this.values.values());
  }
  _labelKey(labelValues) {
    return this.labelNames.map((n) => labelValues[n] || '').join('|');
  }
  _labels(labelValues) {
    const out = {};
    for (const n of this.labelNames) out[n] = labelValues[n] || '';
    return out;
  }
}

class Histogram {
  constructor(name, help, labelNames = [], buckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]) {
    this.name = name;
    this.help = help;
    this.labelNames = labelNames;
    this.buckets = buckets.slice().sort((a, b) => a - b);
    this.series = new Map();
  }
  observe(labelValues, value) {
    const key = this._labelKey(labelValues);
    let s = this.series.get(key);
    if (!s) {
      s = { labels: this._labels(labelValues), counts: new Array(this.buckets.length).fill(0), sum: 0, count: 0 };
      this.series.set(key, s);
    }
    for (let i = 0; i < this.buckets.length; i++) {
      if (value <= this.buckets[i]) s.counts[i]++;
    }
    s.sum += value;
    s.count++;
  }
  _labelKey(labelValues) {
    return this.labelNames.map((n) => labelValues[n] || '').join('|');
  }
  _labels(labelValues) {
    const out = {};
    for (const n of this.labelNames) out[n] = labelValues[n] || '';
    return out;
  }
}

class Registry {
  constructor() {
    this.metrics = new Map();
  }
  register(metric) {
    if (this.metrics.has(metric.name)) return this.metrics.get(metric.name);
    this.metrics.set(metric.name, metric);
    return metric;
  }
  counter(name, help, labelNames) {
    return this.register(new Counter(name, help, labelNames));
  }
  gauge(name, help, labelNames, collectFn) {
    return this.register(new Gauge(name, help, labelNames, collectFn));
  }
  histogram(name, help, labelNames, buckets) {
    return this.register(new Histogram(name, help, labelNames, buckets));
  }
  list() {
    return Array.from(this.metrics.values());
  }
  text() {
    const lines = [];
    for (const m of this.metrics.values()) {
      lines.push(`# HELP ${m.name} ${m.help}`);
      lines.push(`# TYPE ${m.name} ${m.constructor.name.toLowerCase()}`);
      if (m instanceof Counter) {
        for (const v of m.values.values()) {
          lines.push(this._formatLine(m.name, v.labels, String(v.value)));
        }
      } else if (m instanceof Gauge) {
        for (const v of m.collect()) {
          lines.push(this._formatLine(m.name, v.labels, String(v.value)));
        }
      } else if (m instanceof Histogram) {
        for (const [key, s] of m.series.entries()) {
          let cumulative = 0;
          for (let i = 0; i < m.buckets.length; i++) {
            cumulative = s.counts[i];
            const lbl = { ...s.labels, le: String(m.buckets[i]) };
            lines.push(this._formatLine(`${m.name}_bucket`, lbl, String(cumulative)));
          }
          lines.push(this._formatLine(`${m.name}_bucket`, { ...s.labels, le: '+Inf' }, String(s.count)));
          lines.push(this._formatLine(`${m.name}_sum`, s.labels, String(s.sum)));
          lines.push(this._formatLine(`${m.name}_count`, s.labels, String(s.count)));
        }
      }
    }
    return lines.join('\n') + '\n';
  }
  _formatLine(name, labels, value) {
    const labelStr = Object.entries(labels || {})
      .map(([k, v]) => `${k}="${this._escape(String(v))}"`)
      .join(',');
    return labelStr ? `${name}{${labelStr}} ${value}` : `${name} ${value}`;
  }
  _escape(s) {
    return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
  }
  snapshot() {
    const out = {};
    for (const m of this.metrics.values()) {
      if (m instanceof Counter) {
        out[m.name] = {};
        for (const v of m.values.values()) out[m.name][JSON.stringify(v.labels)] = v.value;
      } else if (m instanceof Gauge) {
        out[m.name] = {};
        for (const v of m.collect()) out[m.name][JSON.stringify(v.labels)] = v.value;
      } else if (m instanceof Histogram) {
        out[m.name] = {};
        for (const [key, s] of m.series.entries()) {
          out[m.name][key] = { buckets: Object.fromEntries(m.buckets.map((b, i) => [b, s.counts[i]])), sum: s.sum, count: s.count };
        }
      }
    }
    return out;
  }
}

const registry = new Registry();

// Built-in metrics
const httpRequests = registry.counter('nocoos_http_requests_total', 'Total HTTP requests', ['method', 'route', 'status']);
const httpDuration = registry.histogram('nocoos_http_request_duration_seconds', 'HTTP request duration in seconds', ['method', 'route'], [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]);
const httpErrors = registry.counter('nocoos_http_errors_total', 'HTTP error responses (4xx/5xx)', ['method', 'route', 'status']);
const authLogins = registry.counter('nocoos_auth_logins_total', 'Successful authentication attempts', ['outcome']);
const wsConnections = registry.counter('nocoos_ws_connections_total', 'WebSocket connections opened', ['channel', 'result']);
const fsOps = registry.counter('nocoos_fs_operations_total', 'Virtual filesystem operations', ['op']);
const pkgJobs = registry.counter('nocoos_pkg_jobs_total', 'Package manager jobs completed', ['manager', 'status']);
const clientErrors = registry.counter('nocoos_client_errors_total', 'Client-side errors reported from the browser', ['kind', 'file']);
const syntaxErrors = registry.counter('nocoos_syntax_errors_total', 'Syntax errors detected by server-side parser', ['file']);

// Live-collected gauges
registry.gauge('nocoos_uptime_seconds', 'Server uptime in seconds', [], (g) => g.set({}, process.uptime()));
registry.gauge('nocoos_process_uptime_seconds', 'Process uptime in seconds', [], (g) => g.set({}, process.uptime()));
registry.gauge('nocoos_memory_rss_bytes', 'Node process RSS in bytes', [], (g) => g.set({}, process.memoryUsage().rss));
registry.gauge('nocoos_memory_heap_used_bytes', 'Node heap used in bytes', [], (g) => g.set({}, process.memoryUsage().heapUsed));
registry.gauge('nocoos_memory_heap_total_bytes', 'Node heap total in bytes', [], (g) => g.set({}, process.memoryUsage().heapTotal));
registry.gauge('nocoos_memory_external_bytes', 'Node external memory in bytes', [], (g) => g.set({}, process.memoryUsage().external));
registry.gauge('nocoos_host_memory_total_bytes', 'Host total memory in bytes', [], (g) => g.set({}, os.totalmem()));
registry.gauge('nocoos_host_memory_free_bytes', 'Host free memory in bytes', [], (g) => g.set({}, os.freemem()));
registry.gauge('nocoos_host_load_average', 'Host load average (1, 5, 15 min)', ['period'], (g) => {
  const [l1, l5, l15] = os.loadavg();
  g.set({ period: '1m' }, l1);
  g.set({ period: '5m' }, l5);
  g.set({ period: '15m' }, l15);
});
registry.gauge('nocoos_host_cpu_count', 'Host logical CPU count', [], (g) => g.set({}, os.cpus().length));
registry.gauge('nocoos_terminals_active', 'Currently alive terminal sessions', [], (g) => {
  let active = 0;
  for (const s of termMgr.sessions.values()) if (s.alive) active++;
  g.set({}, active);
});
registry.gauge('nocoos_terminals_total', 'Total terminal sessions (incl. exited)', [], (g) => g.set({}, termMgr.sessions.size));
registry.gauge('nocoos_processes_total', 'Tracked processes by kind', ['kind'], (g) => {
  const counts = { terminal: 0, package: 0, app: 0, other: 0 };
  for (const p of procMgr.processes.values()) {
    if (counts[p.kind] !== undefined) counts[p.kind]++;
    else counts.other++;
  }
  for (const [k, v] of Object.entries(counts)) g.set({ kind: k }, v);
});

export function middleware() {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const route = req.route?.path || req.baseUrl + (req.path || '') || req.path || 'unknown';
      const labels = {
        method: req.method,
        route: String(route).slice(0, 80),
        status: String(res.statusCode)
      };
      httpRequests.inc(labels, 1);
      if (res.statusCode >= 400) httpErrors.inc(labels, 1);
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      httpDuration.observe({ method: req.method, route: labels.route }, seconds);
    });
    next();
  };
}

export function recordAuth(outcome) {
  authLogins.inc({ outcome }, 1);
}

export function recordWs(channel, result) {
  wsConnections.inc({ channel, result }, 1);
}

export function recordFs(op) {
  fsOps.inc({ op }, 1);
}

export function recordPkg(manager, status) {
  pkgJobs.inc({ manager, status }, 1);
}

export function recordClientError(kind, file) {
  clientErrors.inc({ kind, file: String(file || 'unknown').slice(0, 80) }, 1);
}

export function recordSyntaxError(file) {
  syntaxErrors.inc({ file: String(file || 'unknown').slice(0, 80) }, 1);
}

export function snapshot() {
  return {
    timestamp: new Date().toISOString(),
    metrics: registry.snapshot(),
    process: {
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      nocoos: '1.0.0',
      uptime: process.uptime(),
      memory: process.memoryUsage()
    },
    host: {
      hostname: os.hostname(),
      cpus: os.cpus().length,
      model: os.cpus()[0]?.model || 'unknown',
      load: os.loadavg(),
      memory: { total: os.totalmem(), free: os.freemem() }
    }
  };
}

export function text() {
  return registry.text();
}

export default { middleware, recordAuth, recordWs, recordFs, recordPkg, snapshot, text };
