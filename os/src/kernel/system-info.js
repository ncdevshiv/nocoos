import os from 'node:os';
import process from 'node:process';
import { config } from './config.js';

function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 3600) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${d}d ${h}h ${m}m ${sec}s`;
}

function bytes(n) {
  if (n === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(n) / Math.log(k));
  return `${(n / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

// Cache the previous CPU tick sample so utilization can be computed as a
// delta between two snapshots. Windows doesn't expose loadavg() (it returns
// [0,0,0]) so we derive a percent-busy figure from the per-CPU tick counters.
let lastCpuSample = null;
let lastCpuSampleAt = 0;
function sampleCpuUtilization() {
  const cpus = os.cpus();
  if (!cpus || !cpus.length) return null;
  const now = Date.now();
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq;
  }
  if (lastCpuSample && now - lastCpuSampleAt > 0) {
    const idleDelta = idle - lastCpuSample.idle;
    const totalDelta = total - lastCpuSample.total;
    const util = totalDelta > 0 ? (1 - idleDelta / totalDelta) * 100 : 0;
    lastCpuSample = { idle, total };
    lastCpuSampleAt = now;
    return { percentBusy: Math.max(0, Math.min(100, util)), cores: cpus.length };
  }
  lastCpuSample = { idle, total };
  lastCpuSampleAt = now;
  return null; // first sample has no delta yet
}

export function snapshot() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus() || [];
  // os.loadavg() returns [0, 0, 0] on Windows. We surface it for POSIX systems
  // and provide a derived `utilization` (CPU% across all cores) for Windows.
  const isWin = process.platform === 'win32';
  const loadAvg = isWin ? null : os.loadavg();
  const utilization = sampleCpuUtilization();
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    release: os.release(),
    kernel: `${os.platform()} ${os.release()} ${os.arch()}`,
    node: process.version,
    nocoos: '1.0.0',
    cpus: {
      count: cpus.length,
      model: cpus[0] ? cpus[0].model : 'unknown',
      speed: cpus[0] ? cpus[0].speed : 0,
      load: loadAvg,                  // POSIX: [1m, 5m, 15m]; Windows: null
      utilization: utilization         // All platforms: { percentBusy, cores } or null on first call
    },
    memory: {
      total: totalMem,
      used: usedMem,
      free: freeMem,
      totalText: bytes(totalMem),
      usedText: bytes(usedMem),
      freeText: bytes(freeMem)
    },
    process: {
      pid: process.pid,
      ppid: process.ppid,
      uptime: formatUptime(process.uptime()),
      rss: bytes(process.memoryUsage().rss),
      heapUsed: bytes(process.memoryUsage().heapUsed),
      heapTotal: bytes(process.memoryUsage().heapTotal)
    },
    network: os.networkInterfaces(),
    env: {
      nodeEnv: process.env.NODE_ENV || 'development',
      shell: config.hostInfo.shell,
      homedir: os.homedir(),
      tmpdir: os.tmpdir(),
      username: os.userInfo().username
    },
    timestamp: Date.now()
  };
}

export default { snapshot };
