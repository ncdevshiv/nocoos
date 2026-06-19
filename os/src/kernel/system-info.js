import os from 'node:os';
import process from 'node:process';
import { config } from './config.js';

function formatUptime(seconds) {
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
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

export function snapshot() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const cpus = os.cpus() || [];
  const loadAvg = os.loadavg();
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
      load: loadAvg
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
