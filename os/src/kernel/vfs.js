import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from './config.js';
import logger from '../utils/logger.js';

const log = logger.make('vfs');

const ROOTS = [
  { virtual: '/', real: config.dataDir, kind: 'data' },
  { virtual: '/host', real: path.resolve(config.root, '..'), kind: 'host' }
];

const SYSTEM_PATHS = new Set(['/system', '/system/apps', '/system/users', '/system/sessions']);

function findRoot(virtualPath) {
  if (virtualPath === '/' || virtualPath === '') return ROOTS[0];
  for (const r of ROOTS) {
    if (virtualPath === r.virtual) return r;
    if (r.virtual !== '/' && virtualPath.startsWith(r.virtual + '/')) return r;
  }
  return ROOTS[0];
}

function resolveReal(virtualPath) {
  const root = findRoot(virtualPath);
  const rel = virtualPath === root.virtual ? '/' : virtualPath.slice(root.virtual.length);
  const real = path.normalize(path.join(root.real, rel));
  const realNorm = path.resolve(real);
  const rootReal = path.resolve(root.real);
  if (!realNorm.startsWith(rootReal) && root.kind === 'host') {
    const hostRoot = path.resolve(ROOTS[1].real);
    if (!realNorm.startsWith(hostRoot)) {
      throw new Error('Path escapes host root');
    }
  }
  if (root.kind === 'data' && !realNorm.startsWith(rootReal)) {
    throw new Error('Path escapes data root');
  }
  return realNorm;
}

function toVirtual(realPath) {
  const realNorm = path.resolve(realPath);
  for (const r of ROOTS) {
    const rootReal = path.resolve(r.real);
    if (realNorm === rootReal) return r.virtual === '/' ? '/' : r.virtual;
    if (realNorm.startsWith(rootReal + path.sep)) {
      const rel = realNorm.slice(rootReal.length).split(path.sep).join('/');
      return (r.virtual === '/' ? '' : r.virtual) + rel;
    }
  }
  return realNorm;
}

function normalize(p) {
  if (!p) p = '/';
  if (!p.startsWith('/')) p = '/' + p;
  const parts = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return '/' + parts.join('/');
}

function mime(name) {
  const ext = path.extname(name).toLowerCase().slice(1);
  const map = {
    txt: 'text/plain', md: 'text/markdown', html: 'text/html', htm: 'text/html',
    css: 'text/css', js: 'application/javascript', mjs: 'application/javascript',
    json: 'application/json', svg: 'image/svg+xml', png: 'image/png',
    jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
    ico: 'image/x-icon', pdf: 'application/pdf', zip: 'application/zip',
    tar: 'application/x-tar', gz: 'application/gzip', sh: 'text/x-shellscript',
    py: 'text/x-python', ts: 'application/typescript'
  };
  return map[ext] || 'application/octet-stream';
}

async function ensureDir(realPath) {
  await fsp.mkdir(realPath, { recursive: true });
}

async function statInfo(realPath, name) {
  const st = await fsp.stat(realPath);
  return {
    name,
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    size: st.size,
    mtime: st.mtimeMs,
    ctime: st.ctimeMs,
    mode: st.mode,
    mime: st.isFile() ? mime(name) : null
  };
}

async function listDir(virtualPath) {
  const real = resolveReal(normalize(virtualPath));
  await ensureDir(real);
  const entries = await fsp.readdir(real, { withFileTypes: true });
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.well-known') continue;
    try {
      const st = await fsp.stat(path.join(real, e.name));
      out.push({
        name: e.name,
        isDirectory: e.isDirectory(),
        isFile: e.isFile(),
        size: st.size,
        mtime: st.mtimeMs,
        ctime: st.ctimeMs,
        mime: e.isFile() ? mime(e.name) : null
      });
    } catch (err) {
      log.warn('stat failed', { entry: e.name, err: err.message });
    }
  }
  out.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  return out;
}

async function stat(virtualPath) {
  const real = resolveReal(normalize(virtualPath));
  const st = await fsp.stat(real);
  return {
    isDirectory: st.isDirectory(),
    isFile: st.isFile(),
    size: st.size,
    mtime: st.mtimeMs,
    ctime: st.ctimeMs,
    mode: st.mode
  };
}

async function readFile(virtualPath, { encoding = null, start, end } = {}) {
  const real = resolveReal(normalize(virtualPath));
  if (start !== undefined || end !== undefined) {
    const fh = await fsp.open(real, 'r');
    try {
      const length = (end !== undefined ? end + 1 : undefined) - (start || 0);
      const buf = Buffer.alloc(length);
      await fh.read(buf, 0, length, start || 0);
      return encoding ? buf.toString(encoding) : buf;
    } finally {
      await fh.close();
    }
  }
  return fsp.readFile(real, encoding ? { encoding } : undefined);
}

async function writeFile(virtualPath, data, { encoding = 'utf8' } = {}) {
  const real = resolveReal(normalize(virtualPath));
  await fsp.mkdir(path.dirname(real), { recursive: true });
  if (typeof data === 'string' || Buffer.isBuffer(data)) {
    await fsp.writeFile(real, data, encoding ? { encoding } : undefined);
  } else {
    await fsp.writeFile(real, data);
  }
  return { ok: true, size: (await fsp.stat(real)).size };
}

async function appendFile(virtualPath, data, { encoding = 'utf8' } = {}) {
  const real = resolveReal(normalize(virtualPath));
  await fsp.mkdir(path.dirname(real), { recursive: true });
  await fsp.appendFile(real, data, encoding ? { encoding } : undefined);
  return { ok: true };
}

async function remove(virtualPath, { recursive = false } = {}) {
  const real = resolveReal(normalize(virtualPath));
  const st = await fsp.stat(real).catch(() => null);
  if (!st) return { ok: true, existed: false };
  if (st.isDirectory()) {
    if (!recursive) {
      const entries = await fsp.readdir(real);
      if (entries.length) throw new Error('Directory not empty');
      await fsp.rmdir(real);
    } else {
      await fsp.rm(real, { recursive: true, force: true });
    }
  } else {
    await fsp.unlink(real);
  }
  return { ok: true, existed: true };
}

async function mkdir(virtualPath, { recursive = true } = {}) {
  const real = resolveReal(normalize(virtualPath));
  await fsp.mkdir(real, { recursive });
  return { ok: true };
}

async function move(src, dst) {
  const s = resolveReal(normalize(src));
  const d = resolveReal(normalize(dst));
  await fsp.mkdir(path.dirname(d), { recursive: true });
  await fsp.rename(s, d);
  return { ok: true };
}

async function copy(src, dst) {
  const s = resolveReal(normalize(src));
  const d = resolveReal(normalize(dst));
  const st = await fsp.stat(s);
  await fsp.mkdir(path.dirname(d), { recursive: true });
  if (st.isDirectory()) {
    await fsp.cp(s, d, { recursive: true });
  } else {
    await fsp.copyFile(s, d);
  }
  return { ok: true };
}

async function exists(virtualPath) {
  try {
    await fsp.stat(resolveReal(normalize(virtualPath)));
    return true;
  } catch {
    return false;
  }
}

function watch(virtualPath, onChange) {
  const real = resolveReal(normalize(virtualPath));
  try {
    const watcher = fs.watch(real, { recursive: true }, (event, filename) => {
      onChange({ event, filename: filename ? filename.toString() : null });
    });
    return () => watcher.close();
  } catch (err) {
    log.warn('watch failed', { virtualPath, err: err.message });
    return () => {};
  }
}

function boot() {
  fs.mkdirSync(path.join(config.dataDir, 'home', 'user', 'Documents'), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'home', 'user', 'Projects'), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'home', 'user', 'Downloads'), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'apps'), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'system'), { recursive: true });
  fs.mkdirSync(path.join(config.dataDir, 'tmp'), { recursive: true });
  const welcome = path.join(config.dataDir, 'home', 'user', 'README.md');
  if (!fs.existsSync(welcome)) {
    fs.writeFileSync(welcome, `# Welcome to NocoOS

This is your personal space inside NocoOS.

- **Terminal**: open it from the taskbar to run any shell command.
- **File Manager**: browse your files at /home/user.
- **App Installer**: install npm/pnpm/bun packages and launch them from the desktop.
- **Host filesystem**: the host machine is mounted read-write at /host.

## Quick commands
\`\`\`
ls /home/user
cd /apps
pnpm add <package>
\`\`\`
`, 'utf8');
  }
  const sysInfo = path.join(config.dataDir, 'system', 'info.json');
  if (!fs.existsSync(sysInfo)) {
    fs.writeFileSync(sysInfo, JSON.stringify({
      installed: {},
      pinned: ['terminal', 'filemanager', 'editor', 'installer', 'settings', 'about']
    }, null, 2));
  }
}

export default {
  boot,
  normalize,
  resolveReal,
  toVirtual,
  listDir,
  stat,
  readFile,
  writeFile,
  appendFile,
  remove,
  mkdir,
  move,
  copy,
  exists,
  watch,
  mime
};
