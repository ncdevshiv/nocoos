import { spawn } from 'node:child_process';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import vfs from './vfs.js';
import procMgr from './process-manager.js';
import logger from '../utils/logger.js';

const log = logger.make('pty');

const COLS_DEFAULT = 100;
const ROWS_DEFAULT = 30;

function mapVfsPath(token) {
  if (!token) return null;
  try {
    const norm = vfs.normalize(token);
    const real = vfs.resolveReal(norm);
    return real;
  } catch {
    return null;
  }
}

class TerminalSession {
  constructor({ shell, cwd, env, cols, rows, id }) {
    this.id = id || randomUUID();
    this.shell = shell || config.hostInfo.shell;
    this.cwd = cwd || path.resolve(config.dataDir, 'home', 'user');
    this.cols = cols || COLS_DEFAULT;
    this.rows = rows || ROWS_DEFAULT;
    this.env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      FORCE_COLOR: '1',
      NOCOOS_TERM: '1',
      NOCOOS_TERM_ID: this.id,
      ...(env || {})
    };
    this.proc = null;
    this.alive = false;
    this.startedAt = Date.now();
    this.outputBuffer = [];
    this.listeners = new Set();
    this.exitListeners = new Set();
    // Input translation: buffer input until CR/LF, then rewrite VFS paths to real paths.
    this._inputBuffer = '';
  }

  _translateVfsPaths(input) {
    // Patterns that look like VFS paths inside a command line. We only translate
    // paths that are NOT inside double quotes that the shell would treat literally
    // when we are confident enough; for now we translate bare `/...` and `~/...`
    // outside quotes.
    const isWin = process.platform === 'win32';
    if (!isWin) return input;
    let out = '';
    let i = 0;
    while (i < input.length) {
      const ch = input[i];
      if (ch === '"') {
        // Skip quoted strings
        const end = input.indexOf('"', i + 1);
        if (end === -1) { out += input.slice(i); break; }
        out += input.slice(i, end + 1);
        i = end + 1;
      } else if (ch === '/' && (i === 0 || /[\s&|<>=;,()]/.test(input[i - 1]))) {
        // Look ahead for a VFS path
        let j = i;
        while (j < input.length && !/[\s"&|<>=;)]/.test(input[j])) j++;
        const token = input.slice(i, j);
        const mapped = mapVfsPath(token);
        if (mapped) {
          out += mapped;
          i = j;
        } else {
          out += ch;
          i++;
        }
      } else if (ch === '~' && (i === 0 || /[\s&|<>=;,()]/.test(input[i - 1])) && (input[i + 1] === '/' || i + 1 === input.length)) {
        let j = i + 1;
        if (input[j] === '/') {
          while (j < input.length && !/[\s"&|<>=;)]/.test(input[j])) j++;
        } else {
          j = i + 1;
        }
        const token = input.slice(i, j);
        const mapped = mapVfsPath(token.replace(/^~/, '/home/user'));
        if (mapped) {
          out += mapped;
          i = j;
        } else {
          out += ch;
          i++;
        }
      } else {
        out += ch;
        i++;
      }
    }
    return out;
  }

  _transformInput(input) {
    // Process the input line by line. Only rewrite lines that contain a VFS path
    // reference at a "path-looking" position; preserve everything else verbatim
    // (including ANSI sequences and interactive keystrokes).
    const lines = input.split('\r');
    const translated = lines.map((line, idx) => {
      // Only translate the final line in the chunk (the one before the final CRLF).
      // Other segments are likely cursor/edit control sequences.
      const isLast = idx === lines.length - 1;
      if (!isLast && lines.length > 1 && !line.includes('/')) return line;
      return this._translateVfsPaths(line);
    });
    return translated.join('\r');
  }

  start() {
    const isWin = process.platform === 'win32';
    const useShell = isWin ? false : true;
    let cmd, args;
    if (isWin) {
      cmd = this.shell;
      args = [];
    } else {
      cmd = this.shell;
      args = [];
    }
    log.info('starting terminal', { id: this.id, shell: this.shell, cwd: this.cwd });
    this.proc = spawn(cmd, args, {
      cwd: this.cwd,
      env: this.env,
      shell: useShell,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    this.alive = true;
    procMgr.register({
      id: `term-${this.id}`,
      kind: 'terminal',
      label: `Terminal ${this.id.slice(0, 6)}`,
      pid: this.proc.pid,
      cwd: this.cwd,
      command: this.shell,
      handle: this.proc
    });
    this.proc.stdout.on('data', (chunk) => this._emit('data', { stream: 'stdout', data: chunk.toString('utf8') }));
    this.proc.stderr.on('data', (chunk) => this._emit('data', { stream: 'stderr', data: chunk.toString('utf8') }));
    this.proc.on('exit', (code, signal) => {
      this.alive = false;
      const info = { code, signal };
      this._emit('exit', info);
      for (const cb of this.exitListeners) {
        try { cb(info); } catch {}
      }
    });
    this.proc.on('error', (err) => {
      const msg = `\r\n\x1b[31m[nocoos] failed to start shell: ${err.message}\x1b[0m\r\n`;
      this._emit('data', { stream: 'stderr', data: msg });
      this._emit('exit', { code: -1, signal: null, error: err.message });
      this.alive = false;
    });
    this._emit('data', { stream: 'stdout', data: this._banner() });
    return this;
  }

  _banner() {
    const cols = this.cols;
    const bar = '─'.repeat(Math.max(8, Math.min(cols - 2, 60)));
    return [
      `\x1b[36m┌${bar}┐\x1b[0m`,
      `\x1b[36m│\x1b[0m \x1b[1;36mNocoOS Terminal\x1b[0m \x1b[2m(${this.shell})\x1b[0m`,
      `\x1b[36m│\x1b[0m \x1b[2mcwd: ${this.cwd}\x1b[0m`,
      `\x1b[36m└${bar}┘\x1b[0m`,
      ''
    ].join('\r\n');
  }

  _emit(event, payload) {
    for (const cb of this.listeners) {
      try { cb({ event, ...payload }); } catch (err) { log.warn('listener error', { err: err.message }); }
    }
  }

  on(cb) {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onExit(cb) {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  write(data) {
    if (!this.alive || !this.proc) return false;
    let out = data;
    if (process.platform === 'win32' && data && data.includes('/')) {
      // Only translate segments containing a slash to avoid corrupting arrow keys etc.
      try { out = this._transformInput(data); } catch { out = data; }
    }
    try {
      this.proc.stdin.write(out);
      return true;
    } catch (err) {
      log.warn('write failed', { id: this.id, err: err.message });
      return false;
    }
  }

  resize(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    if (!this.alive || !this.proc) return false;
    if (typeof this.proc.kill === 'function' && process.platform !== 'win32') {
      try { this.proc.kill('SIGWINCH'); } catch {}
    }
    return true;
  }

  async kill(signal = 'SIGTERM') {
    if (!this.proc) return { ok: false };
    try {
      this.proc.kill(signal);
      setTimeout(() => {
        if (this.alive && this.proc) {
          try { this.proc.kill('SIGKILL'); } catch {}
        }
      }, 1500);
      return { ok: true };
    } catch (err) {
      log.warn('kill failed', { id: this.id, err: err.message });
      return { ok: false, error: err.message };
    }
  }
}

class TerminalManager {
  constructor() {
    this.sessions = new Map();
    this.max = config.maxTerminals;
  }

  setMax(n) {
    this.max = Math.max(1, Number(n) || this.max);
  }

  create(opts = {}) {
    if (this.sessions.size >= this.max) {
      throw new Error(`Maximum terminals (${this.max}) reached`);
    }
    const session = new TerminalSession(opts).start();
    session.onExit(() => {
      setTimeout(() => this.sessions.delete(session.id), 1000);
    });
    this.sessions.set(session.id, session);
    return session;
  }

  get(id) {
    return this.sessions.get(id) || null;
  }

  list() {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      shell: s.shell,
      cwd: s.cwd,
      cols: s.cols,
      rows: s.rows,
      alive: s.alive,
      startedAt: s.startedAt,
      pid: s.proc ? s.proc.pid : null
    }));
  }

  async killAll() {
    for (const s of this.sessions.values()) {
      await s.kill('SIGTERM');
    }
  }
}

const instance = new TerminalManager();
export default instance;
