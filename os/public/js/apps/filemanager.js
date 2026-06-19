// File Manager app — browse, create, rename, delete, upload, download, open files.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';
import notify from '../core/notify.js';
import contextMenu from '../contextmenu.js';

const SIDEBAR_PLACES = [
  { label: 'Home', path: '/home/user', icon: 'home' },
  { label: 'Documents', path: '/home/user/Documents', icon: 'fileText' },
  { label: 'Projects', path: '/home/user/Projects', icon: 'code' },
  { label: 'Downloads', path: '/home/user/Downloads', icon: 'download' },
  { label: 'Apps', path: '/apps', icon: 'package' },
  { label: 'System', path: '/system', icon: 'cpu' },
  { label: 'Host', path: '/host', icon: 'globe' },
  { label: 'Tmp', path: '/tmp', icon: 'archive' }
];

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('folder', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

let cachedFS = null;
async function fetchDir(path) {
  return api.get('/api/fs/list', { query: { path } });
}

function extIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (!name.includes('.')) return 'file';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'].includes(ext)) return 'image';
  if (['js', 'mjs', 'ts', 'json', 'html', 'css', 'py', 'sh', 'rb', 'go', 'rs', 'c', 'cpp', 'h'].includes(ext)) return 'code';
  if (['md', 'txt', 'log', 'rtf'].includes(ext)) return 'fileText';
  if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archive';
  if (['mp3', 'wav', 'ogg', 'flac', 'm4a'].includes(ext)) return 'music';
  if (['mp4', 'mov', 'mkv', 'avi', 'webm'].includes(ext)) return 'play';
  return 'file';
}

export async function open(opts = {}) {
  const startPath = opts.path || '/home/user';
  const win = wm.create({
    appId: 'filemanager',
    title: `Files — ${startPath}`,
    icon: 'folder',
    iconHtml: ICON_HTML,
    width: 880,
    height: 540,
    minWidth: 600,
    minHeight: 360,
    singleton: false
  });

  const root = document.createElement('div');
  root.className = 'app-fm';
  root.innerHTML = `
    <div class="fm-toolbar">
      <button class="icon-button" data-act="back" title="Back"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>
      <button class="icon-button" data-act="up" title="Up"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg></button>
      <button class="icon-button" data-act="refresh" title="Refresh"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/></svg></button>
      <input class="fm-path" data-role="path" />
      <button class="icon-button" data-act="view-grid" title="Grid"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg></button>
      <button class="icon-button" data-act="view-list" title="List"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg></button>
      <button class="icon-button" data-act="new-folder" title="New folder"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg></button>
      <button class="icon-button" data-act="upload" title="Upload"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg></button>
    </div>
    <div class="fm-sidebar">
      <div class="fm-sidebar-label">Places</div>
      <div data-role="places"></div>
    </div>
    <div class="fm-main" data-role="main"></div>
    <div class="fm-status">
      <span data-role="status">Ready</span>
      <span class="spacer"></span>
      <span data-role="count">0 items</span>
    </div>
  `;
  win.setContent(root);

  const pathInput = root.querySelector('[data-role="path"]');
  const main = root.querySelector('[data-role="main"]');
  const placesEl = root.querySelector('[data-role="places"]');
  const statusEl = root.querySelector('[data-role="status"]');
  const countEl = root.querySelector('[data-role="count"]');

  let currentPath = startPath;
  let history = [startPath];
  let historyIdx = 0;
  let view = 'grid';
  let selected = new Set();
  let entries = [];

  // Sidebar places
  for (const p of SIDEBAR_PLACES) {
    const el = document.createElement('div');
    el.className = 'fm-sidebar-item';
    el.innerHTML = `${icons.get(p.icon, { size: 16 })}<span>${p.label}</span>`;
    el.addEventListener('click', () => navigate(p.path));
    el.dataset.path = p.path;
    placesEl.appendChild(el);
  }

  async function navigate(path, { push = true } = {}) {
    if (!path) return;
    if (push) {
      history = history.slice(0, historyIdx + 1);
      history.push(path);
      historyIdx = history.length - 1;
    }
    currentPath = path;
    pathInput.value = path;
    win.setTitle(`Files — ${path}`);
    highlightSidebar();
    await load();
  }

  function highlightSidebar() {
    for (const el of placesEl.children) {
      el.classList.toggle('active', el.dataset.path === currentPath);
    }
  }

  async function load() {
    setStatus('Loading…');
    try {
      const r = await fetchDir(currentPath);
      entries = r.entries;
      render();
      setStatus(`Loaded ${entries.length} items`);
      countEl.textContent = `${entries.length} item${entries.length === 1 ? '' : 's'}`;
    } catch (err) {
      setStatus('Error: ' + err.message);
      main.innerHTML = `<div class="fm-empty">Failed to load: ${escapeHtml(err.message)}</div>`;
    }
  }

  function setStatus(s) { statusEl.textContent = s; }

  function render() {
    main.innerHTML = '';
    if (!entries.length) {
      main.innerHTML = '<div class="fm-empty">This folder is empty.</div>';
      return;
    }
    if (view === 'grid') {
      const grid = document.createElement('div');
      grid.className = 'fm-grid';
      for (const e of entries) grid.appendChild(gridItem(e));
      main.appendChild(grid);
    } else {
      const tbl = document.createElement('table');
      tbl.className = 'fm-list';
      tbl.innerHTML = `
        <thead><tr>
          <th>Name</th><th>Size</th><th>Modified</th><th>Type</th>
        </tr></thead>
        <tbody></tbody>`;
      const tb = tbl.querySelector('tbody');
      for (const e of entries) tb.appendChild(listItem(e));
      main.appendChild(tbl);
    }
  }

  function gridItem(e) {
    const el = document.createElement('div');
    el.className = 'fm-item';
    el.dataset.name = e.name;
    el.dataset.path = joinPath(currentPath, e.name);
    const ic = e.isDirectory ? 'folder' : extIcon(e.name);
    el.innerHTML = `
      <div class="fm-item-art">${icons.get(ic, { size: 36 })}</div>
      <div class="fm-item-name">${escapeHtml(e.name)}</div>
    `;
    bindItemEvents(el, e);
    return el;
  }

  function listItem(e) {
    const tr = document.createElement('tr');
    tr.dataset.name = e.name;
    tr.dataset.path = joinPath(currentPath, e.name);
    tr.innerHTML = `
      <td>${icons.get(e.isDirectory ? 'folder' : extIcon(e.name), { size: 14 })} <span style="margin-left:0.4rem">${escapeHtml(e.name)}</span></td>
      <td>${e.isDirectory ? '—' : formatSize(e.size)}</td>
      <td>${formatDate(e.mtime)}</td>
      <td>${e.isDirectory ? 'Folder' : (e.mime || 'File')}</td>
    `;
    bindItemEvents(tr, e);
    return tr;
  }

  function bindItemEvents(el, entry) {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      clearSelection();
      el.classList.add('selected');
      selected.add(entry);
    });
    el.addEventListener('dblclick', () => openEntry(entry));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      clearSelection();
      el.classList.add('selected');
      selected.add(entry);
      showItemContext(e.clientX, e.clientY, entry);
    });
  }

  function clearSelection() {
    for (const el of main.querySelectorAll('.selected')) el.classList.remove('selected');
    selected.clear();
  }

  async function openEntry(entry) {
    if (entry.isDirectory) {
      navigate(joinPath(currentPath, entry.name));
    } else {
      const fullPath = joinPath(currentPath, entry.name);
      const ext = (entry.name.split('.').pop() || '').toLowerCase();
      if (['md', 'txt', 'log', 'json', 'js', 'mjs', 'ts', 'html', 'css', 'py', 'sh', 'c', 'cpp', 'h', 'rb', 'go', 'rs', 'yml', 'yaml'].includes(ext)) {
        const { open } = await import('./editor.js');
        await open({ path: fullPath });
      } else {
        try {
          const url = `/api/fs/download?path=${encodeURIComponent(fullPath)}&token=${encodeURIComponent(sessionStorage.getItem('nocoos_token') || '')}`;
          const a = document.createElement('a');
          a.href = url;
          a.download = entry.name;
          document.body.appendChild(a);
          a.click();
          a.remove();
        } catch (err) {
          notify.error('Open failed', err.message);
        }
      }
    }
  }

  function showItemContext(x, y, entry) {
    const isDir = entry.isDirectory;
    contextMenu.show(x, y, [
      { label: isDir ? 'Open' : 'Open in editor', onClick: () => openEntry(entry) },
      { label: 'Rename', onClick: () => renameEntry(entry) },
      { label: 'Copy path', onClick: () => navigator.clipboard.writeText(joinPath(currentPath, entry.name)) },
      { separator: true },
      { label: 'Delete', danger: true, onClick: () => deleteEntry(entry) }
    ]);
  }

  async function renameEntry(entry) {
    const newName = prompt(`Rename "${entry.name}" to:`, entry.name);
    if (!newName || newName === entry.name) return;
    try {
      await api.post('/api/fs/rename', { from: joinPath(currentPath, entry.name), to: joinPath(currentPath, newName) });
      await load();
    } catch (err) { notify.error('Rename failed', err.message); }
  }

  async function deleteEntry(entry) {
    if (!confirm(`Delete ${entry.name}?`)) return;
    try {
      await api.post('/api/fs/delete', { path: joinPath(currentPath, entry.name), recursive: entry.isDirectory });
      await load();
    } catch (err) { notify.error('Delete failed', err.message); }
  }

  // Bind toolbar
  root.querySelector('[data-act="back"]').addEventListener('click', () => {
    if (historyIdx > 0) { historyIdx--; navigate(history[historyIdx], { push: false }); }
  });
  root.querySelector('[data-act="up"]').addEventListener('click', () => {
    const p = currentPath.split('/').filter(Boolean);
    if (p.length > 1) navigate('/' + p.slice(0, -1).join('/'));
  });
  root.querySelector('[data-act="refresh"]').addEventListener('click', load);
  root.querySelector('[data-act="view-grid"]').addEventListener('click', () => { view = 'grid'; render(); });
  root.querySelector('[data-act="view-list"]').addEventListener('click', () => { view = 'list'; render(); });
  root.querySelector('[data-act="new-folder"]').addEventListener('click', async () => {
    const name = prompt('New folder name:');
    if (!name) return;
    try {
      await api.post('/api/fs/mkdir', { path: joinPath(currentPath, name) });
      await load();
    } catch (err) { notify.error('Create folder failed', err.message); }
  });
  root.querySelector('[data-act="upload"]').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', async () => {
      for (const f of input.files) {
        try {
          await api.upload(`/api/fs/upload?path=${encodeURIComponent(joinPath(currentPath, f.name))}`, f);
        } catch (err) { notify.error('Upload failed', err.message); }
      }
      await load();
    });
    input.click();
  });

  pathInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); navigate(pathInput.value); }
  });
  main.addEventListener('click', () => clearSelection());
  main.addEventListener('contextmenu', (e) => {
    if (e.target.closest('.fm-item') || e.target.closest('tr')) return;
    e.preventDefault();
    contextMenu.show(e.clientX, e.clientY, [
      { label: 'Refresh', onClick: load },
      { label: 'New folder', onClick: async () => {
        const name = prompt('Folder name:');
        if (!name) return;
        try { await api.post('/api/fs/mkdir', { path: joinPath(currentPath, name) }); await load(); }
        catch (err) { notify.error('Create failed', err.message); }
      } }
    ]);
  });

  await navigate(startPath);
  return win;
}

function joinPath(base, name) {
  if (base.endsWith('/')) return base + name;
  return base + '/' + name;
}
function formatSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function formatDate(t) {
  if (!t) return '';
  const d = new Date(t);
  return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
function pad(n) { return String(n).padStart(2, '0'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { open };
