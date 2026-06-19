import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import logger from '../utils/logger.js';

const log = logger.make('apps');

const BUILTIN = [
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Run shell commands and scripts in a real PTY terminal.',
    icon: 'terminal',
    category: 'system',
    builtin: true,
    pinned: true,
    entry: '/js/apps/terminal.js',
    singleton: false
  },
  {
    id: 'filemanager',
    name: 'Files',
    description: 'Browse, open and edit files in your virtual filesystem.',
    icon: 'folder',
    category: 'system',
    builtin: true,
    pinned: true,
    entry: '/js/apps/filemanager.js',
    singleton: false
  },
  {
    id: 'editor',
    name: 'Code Editor',
    description: 'Edit code with multi-language tokenizer-based syntax highlighting (JS/TS/JSON/HTML/CSS/Python/Bash/Go/Rust/Java/SQL/YAML) and multi-file tabs.',
    icon: 'code',
    category: 'development',
    builtin: true,
    pinned: true,
    entry: '/js/apps/editor.js',
    singleton: false
  },
  {
    id: 'installer',
    name: 'App Installer',
    description: 'Install Node packages via npm, pnpm, yarn or bun and launch them.',
    icon: 'package',
    category: 'development',
    builtin: true,
    pinned: true,
    entry: '/js/apps/installer.js',
    singleton: false
  },
  {
    id: 'settings',
    name: 'Settings',
    description: 'Configure NocoOS appearance, accounts and behavior.',
    icon: 'settings',
    category: 'system',
    builtin: true,
    pinned: true,
    entry: '/js/apps/settings.js',
    singleton: true
  },
  {
    id: 'monitor',
    name: 'System Monitor',
    description: 'Inspect running processes, memory and CPU usage.',
    icon: 'activity',
    category: 'system',
    builtin: true,
    pinned: false,
    entry: '/js/apps/monitor.js',
    singleton: false
  },
  {
    id: 'browser',
    name: 'Browser',
    description: 'Open remote URLs in an in-OS browser.',
    icon: 'globe',
    category: 'internet',
    builtin: true,
    pinned: false,
    entry: '/js/apps/browser.js',
    singleton: false
  },
  {
    id: 'about',
    name: 'About NocoOS',
    description: 'Information about this operating environment.',
    icon: 'info',
    category: 'system',
    builtin: true,
    pinned: true,
    entry: '/js/apps/about.js',
    singleton: true
  }
];

class AppRegistry {
  constructor() {
    this.apps = new Map();
    this.pinned = new Set();
  }

  load() {
    for (const a of BUILTIN) {
      this.apps.set(a.id, { ...a });
      if (a.pinned) this.pinned.add(a.id);
    }
    this._loadUser();
  }

  _loadUser() {
    const dir = config.appsDir;
    if (!fs.existsSync(dir)) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (e.name.startsWith('.')) continue;
      const manifestPath = path.join(dir, e.name, 'nocoos.json');
      if (!fs.existsSync(manifestPath)) continue;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!manifest.id) manifest.id = e.name;
        if (!manifest.name) manifest.name = manifest.id;
        manifest.userInstalled = true;
        manifest.builtin = false;
        this.apps.set(manifest.id, manifest);
        if (manifest.pinned) this.pinned.add(manifest.id);
      } catch (err) {
        log.warn('invalid manifest', { dir: e.name, err: err.message });
      }
    }
  }

  list() {
    return Array.from(this.apps.values());
  }

  byCategory() {
    const out = {};
    for (const a of this.apps.values()) {
      const c = a.category || 'other';
      if (!out[c]) out[c] = [];
      out[c].push(a);
    }
    for (const c of Object.keys(out)) {
      out[c].sort((a, b) => a.name.localeCompare(b.name));
    }
    return out;
  }

  get(id) {
    return this.apps.get(id) || null;
  }

  pin(id) {
    if (!this.apps.has(id)) return false;
    this.pinned.add(id);
    return true;
  }

  unpin(id) {
    this.pinned.delete(id);
    return true;
  }

  pinnedList() {
    return Array.from(this.pinned).map((id) => this.apps.get(id)).filter(Boolean);
  }

  registerUserApp(manifest) {
    if (!manifest.id) throw new Error('manifest.id required');
    if (!manifest.entry) throw new Error('manifest.entry required');
    this.apps.set(manifest.id, { ...manifest, userInstalled: true, builtin: false });
    if (manifest.pinned) this.pinned.add(manifest.id);
    return this.apps.get(manifest.id);
  }

  unregister(id) {
    const a = this.apps.get(id);
    if (!a) return false;
    if (a.builtin) throw new Error('cannot unregister builtin app');
    this.apps.delete(id);
    this.pinned.delete(id);
    return true;
  }
}

const instance = new AppRegistry();
export default instance;
