import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { config } from './config.js';
import procMgr from './process-manager.js';
import logger from '../utils/logger.js';

const log = logger.make('pkg');

const MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'];

function which(cmd) {
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const finder = isWin ? 'where' : 'which';
    // On Windows prefer the .cmd shim so spawn() can invoke it directly with shell:false.
    const candidates = isWin ? [`${cmd}.cmd`, `${cmd}.exe`, cmd] : [cmd];
    const tryNext = (i) => {
      if (i >= candidates.length) return resolve(null);
      const target = candidates[i];
      const p = spawn(finder, [target], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      let err = '';
      p.stdout.on('data', (d) => (out += d.toString()));
      p.stderr.on('data', (d) => (err += d.toString()));
      p.on('error', () => tryNext(i + 1));
      p.on('exit', (code) => {
        if (code === 0) {
          const first = out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
          // Skip results that are directories (e.g. "C:\Program Files\nodejs\npm")
          if (first) {
            try {
              const st = fs.statSync(first);
              if (st.isDirectory()) return tryNext(i + 1);
            } catch {
              // stat may fail on non-existent — but if 'where' returned it, it should exist
            }
            return resolve(first);
          }
        }
        tryNext(i + 1);
      });
    };
    tryNext(0);
  });
}

class PackageManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = new Map();
    this.tools = {};
  }

  async detectTools() {
    const found = {};
    for (const m of MANAGERS) {
      found[m] = await which(m);
    }
    this.tools = found;
    return found;
  }

  listTools() {
    return { ...this.tools };
  }

  async ensureAppsDir() {
    await fsp.mkdir(config.appsDir, { recursive: true });
  }

  async workspace(name) {
    const dir = path.join(config.appsDir, name);
    await fsp.mkdir(dir, { recursive: true });
    return dir;
  }

  isJobRunning(id) {
    const job = this.jobs.get(id);
    return job && job.status === 'running';
  }

  listJobs() {
    return Array.from(this.jobs.values()).map((j) => ({
      id: j.id,
      manager: j.manager,
      args: j.args,
      cwd: j.cwd,
      status: j.status,
      startedAt: j.startedAt,
      endedAt: j.endedAt,
      exitCode: j.exitCode
    }));
  }

  createJob({ manager, args, cwd }) {
    if (!MANAGERS.includes(manager)) throw new Error(`Unsupported manager: ${manager}`);
    if (!this.tools[manager]) throw new Error(`Manager not installed on host: ${manager}`);
    const id = randomUUID();
    const job = {
      id,
      manager,
      args,
      cwd,
      status: 'running',
      startedAt: Date.now(),
      endedAt: null,
      exitCode: null,
      proc: null,
      output: ''
    };
    this.jobs.set(id, job);
    return job;
  }

  runJob(job, { onData, onExit }) {
    return new Promise((resolve) => {
      let bin = this.tools[job.manager];
      if (!bin) {
        if (onData) onData({ stream: 'stderr', text: `\n[error] manager not installed: ${job.manager}\n` });
        job.status = 'failed';
        job.exitCode = -1;
        job.endedAt = Date.now();
        if (onExit) onExit({ code: -1, signal: null });
        return resolve({ id: job.id, status: 'failed', exitCode: -1 });
      }
      const isWin = process.platform === 'win32';
      // On Windows, .cmd/.bat shims must run under cmd.exe (shell:true).
      // To avoid path-with-space parsing issues, we invoke by command name,
      // letting cmd.exe resolve it through PATH.
      const useShell = isWin;
      const spawnBin = isWin ? job.manager : bin;
      const child = spawn(spawnBin, job.args, {
        cwd: job.cwd,
        env: { ...process.env, NO_INTERACTIVE: '1', CI: '1', NPM_CONFIG_FUND: 'false', NPM_CONFIG_AUDIT: 'false', NONINTERACTIVE: '1' },
        shell: useShell,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe']
      });
      job.proc = child;
      procMgr.register({
        kind: 'package',
        label: `${job.manager} ${job.args.join(' ')}`.trim(),
        pid: child.pid,
        cwd: job.cwd,
        command: `${job.manager} ${job.args.join(' ')}`,
        handle: child
      });
      const handleChunk = (stream) => (chunk) => {
        const text = chunk.toString();
        job.output += text;
        if (job.output.length > 1024 * 1024) job.output = job.output.slice(-512 * 1024);
        if (onData) onData({ stream, text });
      };
      child.stdout.on('data', handleChunk('stdout'));
      child.stderr.on('data', handleChunk('stderr'));
      child.on('error', (err) => {
        job.status = 'error';
        job.error = err.message;
        if (onData) onData({ stream: 'stderr', text: `\n[error] ${err.message}\n` });
      });
      child.on('exit', (code, signal) => {
        job.status = code === 0 ? 'success' : 'failed';
        job.exitCode = code;
        job.endedAt = Date.now();
        if (onExit) onExit({ code, signal });
        resolve({ id: job.id, status: job.status, exitCode: code });
      });
    });
  }

  cancelJob(id) {
    const job = this.jobs.get(id);
    if (!job || !job.proc) return false;
    try {
      job.proc.kill('SIGTERM');
      job.status = 'cancelled';
      return true;
    } catch (err) {
      log.warn('cancel failed', { id, err: err.message });
      return false;
    }
  }

  async install({ manager = 'npm', packages, cwd, save = true }) {
    await this.ensureAppsDir();
    if (!packages || !packages.length) throw new Error('packages required');
    const targetDir = cwd || (await this.workspace('workspace'));
    await fsp.mkdir(targetDir, { recursive: true });
    if (!fs.existsSync(path.join(targetDir, 'package.json'))) {
      const pkg = { name: path.basename(targetDir), version: '0.1.0', private: true };
      await fsp.writeFile(path.join(targetDir, 'package.json'), JSON.stringify(pkg, null, 2));
    }
    const args = ['install', ...packages];
    if (manager === 'npm' && !save) args.push('--no-save');
    if (manager === 'pnpm' && !save) args.push('--no-save');
    const job = this.createJob({ manager, args, cwd: targetDir });
    return { job, dir: targetDir };
  }

  async uninstall({ manager = 'npm', packages, cwd, save = true }) {
    if (!packages || !packages.length) throw new Error('packages required');
    const targetDir = cwd || (await this.workspace('workspace'));
    if (!fs.existsSync(path.join(targetDir, 'package.json'))) {
      throw new Error('No package.json in workspace — nothing to uninstall');
    }
    // npm/pnpm/yarn all accept `uninstall <pkg>`; bun uses `remove`.
    let args;
    if (manager === 'bun') args = ['remove', ...packages];
    else args = ['uninstall', ...packages];
    if ((manager === 'npm' || manager === 'pnpm') && !save) args.push('--no-save');
    const job = this.createJob({ manager, args, cwd: targetDir });
    return { job, dir: targetDir };
  }

  async runScript({ manager = 'npm', cwd, script, args = [] }) {
    const mgrArgs = manager === 'npm' ? ['run', script, ...args] : ['run', script, ...args];
    const job = this.createJob({ manager, args: mgrArgs, cwd });
    return job;
  }
}

const instance = new PackageManager();
export default instance;
