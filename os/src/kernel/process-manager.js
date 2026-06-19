import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import logger from '../utils/logger.js';

const log = logger.make('proc');

class ProcessManager extends EventEmitter {
  constructor() {
    super();
    this.processes = new Map();
  }

  register(meta) {
    const id = meta.id || randomUUID();
    const proc = {
      id,
      kind: meta.kind || 'app',
      label: meta.label || id.slice(0, 8),
      pid: meta.pid ?? null,
      startedAt: Date.now(),
      parent: meta.parent || null,
      cwd: meta.cwd || null,
      command: meta.command || null,
      status: meta.status || 'running',
      handle: meta.handle || null,
      meta: meta.meta || {},
      onExit: meta.onExit || null
    };
    this.processes.set(id, proc);
    if (proc.handle && typeof proc.handle.on === 'function') {
      proc.handle.on('exit', (code, signal) => this._finish(id, { code, signal }));
    }
    this.emit('spawn', proc);
    log.info('process registered', { id, kind: proc.kind, label: proc.label });
    return proc;
  }

  list() {
    return Array.from(this.processes.values()).map((p) => ({
      id: p.id,
      kind: p.kind,
      label: p.label,
      pid: p.pid,
      startedAt: p.startedAt,
      parent: p.parent,
      cwd: p.cwd,
      command: p.command,
      status: p.status,
      runtimeMs: Date.now() - p.startedAt,
      meta: p.meta
    }));
  }

  get(id) {
    return this.processes.get(id) || null;
  }

  async kill(id, { signal = 'SIGTERM', force = false } = {}) {
    const proc = this.processes.get(id);
    if (!proc) return { ok: false, error: 'not_found' };
    if (proc.status !== 'running') return { ok: true, alreadyExited: true };
    if (proc.handle && typeof proc.handle.kill === 'function') {
      try {
        proc.handle.kill(signal);
      } catch (err) {
        log.warn('kill failed', { id, err: err.message });
      }
    }
    if (force) {
      setTimeout(() => {
        const cur = this.processes.get(id);
        if (cur && cur.status === 'running' && cur.handle && typeof cur.handle.kill === 'function') {
          try { cur.handle.kill('SIGKILL'); } catch {}
        }
      }, 1500);
    }
    return { ok: true };
  }

  _finish(id, info) {
    const proc = this.processes.get(id);
    if (!proc) return;
    proc.status = info && (info.signal ? 'signaled' : 'exited');
    proc.exitCode = info ? info.code : null;
    proc.exitSignal = info ? info.signal : null;
    proc.endedAt = Date.now();
    this.emit('exit', proc);
    if (proc.onExit) {
      try { proc.onExit(proc); } catch (err) { log.warn('onExit failed', { err: err.message }); }
    }
    setTimeout(() => {
      if (this.processes.get(id) === proc) this.processes.delete(id);
    }, 5000);
  }

  stats() {
    const procs = Array.from(this.processes.values());
    const byKind = {};
    for (const p of procs) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
    return {
      total: procs.length,
      byKind,
      running: procs.filter((p) => p.status === 'running').length
    };
  }
}

const instance = new ProcessManager();
export default instance;
