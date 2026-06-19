// Run dialog / launcher.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';
import { launch as launchApp } from '../startmenu.js';

let cachedApps = null;
async function getApps() {
  if (cachedApps) return cachedApps;
  try {
    const r = await api.get('/api/registry/apps');
    cachedApps = r.apps;
  } catch { cachedApps = []; }
  return cachedApps;
}

export async function open(initialQuery = '') {
  const win = wm.create({
    appId: 'launcher',
    title: 'Run',
    icon: 'search',
    width: 560,
    height: 420,
    minWidth: 420,
    minHeight: 300,
    singleton: false
  });

  const root = document.createElement('div');
  root.className = 'app-launcher';
  root.innerHTML = `
    <input class="launcher-input" placeholder="Type app name, file path, or shell command…" value="${escapeAttr(initialQuery)}" />
    <div class="launcher-suggestions" data-role="suggestions"></div>
  `;
  win.setContent(root);

  const input = root.querySelector('.launcher-input');
  const suggEl = root.querySelector('[data-role="suggestions"]');
  let activeIdx = 0;
  let items = [];

  async function refresh() {
    const q = input.value.trim();
    items = [];
    if (!q) {
      const apps = await getApps();
      items.push({ kind: 'header', label: 'Apps' });
      for (const a of apps) items.push({ kind: 'app', app: a });
      items.push({ kind: 'header', label: 'Common commands' });
      items.push({ kind: 'shell', label: 'ls -la', sub: 'List current directory' });
      items.push({ kind: 'shell', label: 'pwd', sub: 'Print working directory' });
      items.push({ kind: 'shell', label: 'node --version', sub: 'Show Node.js version' });
    } else {
      const apps = await getApps();
      const matched = apps.filter((a) => a.name.toLowerCase().includes(q.toLowerCase()) || a.id.toLowerCase().includes(q.toLowerCase()));
      for (const a of matched) items.push({ kind: 'app', app: a });
      if (q.startsWith('/') || q.startsWith('~') || q.includes('.')) {
        items.push({ kind: 'file', path: q.startsWith('~') ? q.replace('~', '/home/user') : q });
      }
      if (matched.length === 0 && !items.some((i) => i.kind === 'file')) {
        items.push({ kind: 'shell', label: q, sub: 'Run in new terminal' });
      }
    }
    render();
  }

  function render() {
    suggEl.innerHTML = '';
    activeIdx = 0;
    let firstActionable = -1;
    items.forEach((it, i) => {
      if (it.kind === 'header') {
        const h = document.createElement('div');
        h.className = 'start-menu-section-title';
        h.style.padding = '0.4rem 0.6rem';
        h.textContent = it.label;
        suggEl.appendChild(h);
        return;
      }
      const el = document.createElement('div');
      el.className = 'launcher-suggestion';
      el.dataset.idx = i;
      let icon = 'apps';
      let title = '';
      let sub = '';
      if (it.kind === 'app') { icon = it.app.icon || 'apps'; title = it.app.name; sub = it.app.description || it.app.id; }
      else if (it.kind === 'file') { icon = 'file'; title = 'Open ' + it.path; sub = 'Open file in editor'; }
      else if (it.kind === 'shell') { icon = 'terminal'; title = it.label; sub = it.sub || 'Run in terminal'; }
      el.innerHTML = `
        <div class="suggestion-icon">${icons.get(icon, { size: 14, stroke: 2.2 })}</div>
        <div class="meta"><div class="title">${escapeHtml(title)}</div><div class="sub">${escapeHtml(sub)}</div></div>
      `;
      if (firstActionable === -1) firstActionable = i;
      el.addEventListener('click', () => execute(i));
      suggEl.appendChild(el);
    });
    if (firstActionable >= 0) highlight(firstActionable);
  }

  function highlight(i) {
    for (const el of suggEl.children) el.classList.remove('active');
    activeIdx = i;
    const el = suggEl.querySelector(`[data-idx="${i}"]`);
    if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest' }); }
  }

  async function execute(i) {
    const it = items[i];
    if (!it) return;
    win.close();
    if (it.kind === 'app') {
      await launchApp(it.app.id);
    } else if (it.kind === 'file') {
      const editor = await import('./editor.js');
      await editor.open({ path: it.path });
    } else if (it.kind === 'shell') {
      const term = await import('./terminal.js');
      const termWin = await term.open();
      setTimeout(async () => {
        try {
          await fetch('/api/terminals/' + termWin.id.replace('w-', '') + '/exec').catch(() => {});
        } catch {}
      }, 200);
      const inputEl = termWin.el?.querySelector?.('textarea.xterm-helper-textarea');
      inputEl?.focus();
    }
  }

  input.addEventListener('input', refresh);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const next = findNextActionable(activeIdx, 1);
      if (next !== -1) highlight(next);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const next = findNextActionable(activeIdx, -1);
      if (next !== -1) highlight(next);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      execute(activeIdx);
    } else if (e.key === 'Escape') {
      win.close();
    }
  });

  function findNextActionable(from, dir) {
    let i = from + dir;
    while (i >= 0 && i < items.length) {
      if (items[i].kind !== 'header') return i;
      i += dir;
    }
    return -1;
  }

  setTimeout(() => { input.focus(); input.select(); }, 50);
  await refresh();
  return win;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function escapeAttr(s) { return escapeHtml(s); }

export default { open };
