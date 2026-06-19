// Desktop root: wallpaper, desktop icons, context menu, window container glue.
import api from './core/api.js';
import wm from './wm.js';
import icons from './core/icons.js';
import notify from './core/notify.js';
import contextMenu from './contextmenu.js';
import { launch as launchApp } from './startmenu.js';
import * as taskbar from './taskbar.js';

const TASKBAR_HEIGHT = 52;

let iconsEl = null;
let selectionRect = null;
let selectionStart = null;
let selectedIcons = new Set();

const DESKTOP_PINNED = [
  { id: 'terminal', x: 0, y: 0 },
  { id: 'filemanager', x: 0, y: 1 },
  { id: 'editor', x: 0, y: 2 },
  { id: 'installer', x: 0, y: 3 },
  { id: 'monitor', x: 0, y: 4 },
  { id: 'browser', x: 0, y: 5 },
  { id: 'settings', x: 0, y: 6 },
  { id: 'about', x: 0, y: 7 }
];

export async function init() {
  iconsEl = document.getElementById('desktop-icons');
  selectionRect = document.getElementById('selection-rect');

  await applyPrefs();
  await renderDesktopIcons();
  bindWallpaperContext();
  bindSelection();

  taskbar.init();

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Escape') {
      // close focused window
      const f = wm.focused();
      if (f) f.close();
    }
  });
}

// Apply persisted user preferences to the DOM. Called once at boot.
// Theme variables drive CSS; wallpaper is applied as a data attribute so
// the stylesheet can swap background gradients.
async function applyPrefs() {
  let prefs = null;
  try {
    const r = await api.get('/api/settings');
    prefs = r.prefs;
  } catch {
    // Defaults baked into the stylesheet will be used if settings can't load.
    return;
  }
  const root = document.documentElement;
  if (prefs.accent) root.style.setProperty('--accent', prefs.accent);
  if (prefs.accent2) root.style.setProperty('--accent-2', prefs.accent2);
  if (prefs.wallpaper) document.body.dataset.wallpaper = prefs.wallpaper;
}

let cachedApps = null;
async function getApps() {
  if (cachedApps) return cachedApps;
  try {
    const r = await api.get('/api/registry/apps');
    cachedApps = r.apps;
    return cachedApps;
  } catch { return []; }
}

async function renderDesktopIcons() {
  const apps = await getApps();
  iconsEl.innerHTML = '';
  for (const conf of DESKTOP_PINNED) {
    const app = apps.find((a) => a.id === conf.id);
    if (!app) continue;
    const el = document.createElement('div');
    el.className = 'desktop-icon';
    el.dataset.appId = app.id;
    el.style.gridRow = (conf.y + 1);
    el.style.gridColumn = (conf.x + 1);
    el.innerHTML = `
      <div class="icon-art">${icons.get(app.icon || 'apps', { size: 26, stroke: 2.2 })}</div>
      <div class="icon-label">${escapeHtml(app.name)}</div>
    `;
    el.addEventListener('click', (e) => {
      clearSelection();
      el.classList.add('selected');
      selectedIcons.add(el);
      e.stopPropagation();
    });
    el.addEventListener('dblclick', () => launchApp(app.id));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextMenu.show(e.clientX, e.clientY, [
        { label: 'Open', onClick: () => launchApp(app.id) },
        { separator: true },
        { label: 'Properties', onClick: () => notify.info(app.name, app.description || '') }
      ]);
    });
    iconsEl.appendChild(el);
  }
}

function bindWallpaperContext() {
  const wallpaper = document.getElementById('desktop-wallpaper');
  wallpaper.addEventListener('click', () => clearSelection());
  wallpaper.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    contextMenu.show(e.clientX, e.clientY, [
      { label: 'Open Terminal', onClick: () => launchApp('terminal') },
      { label: 'Open Files', onClick: () => launchApp('filemanager') },
      { separator: true },
      { label: 'Refresh', onClick: async () => { cachedApps = null; await renderDesktopIcons(); } }
    ]);
  });
}

function bindSelection() {
  const wallpaper = document.getElementById('desktop-wallpaper');
  wallpaper.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target !== wallpaper && !e.target.classList.contains('desktop-icons') && !e.target.classList.contains('desktop-wallpaper')) return;
    clearSelection();
    selectionStart = { x: e.clientX, y: e.clientY };
    selectionRect.hidden = false;
    selectionRect.style.left = e.clientX + 'px';
    selectionRect.style.top = e.clientY + 'px';
    selectionRect.style.width = '0px';
    selectionRect.style.height = '0px';
  });
  window.addEventListener('mousemove', (e) => {
    if (!selectionStart) return;
    const x = Math.min(selectionStart.x, e.clientX);
    const y = Math.min(selectionStart.y, e.clientY);
    const w = Math.abs(e.clientX - selectionStart.x);
    const h = Math.abs(e.clientY - selectionStart.y);
    selectionRect.style.left = x + 'px';
    selectionRect.style.top = y + 'px';
    selectionRect.style.width = w + 'px';
    selectionRect.style.height = h + 'px';
  });
  window.addEventListener('mouseup', () => {
    if (!selectionStart) return;
    const rect = selectionRect.getBoundingClientRect();
    if (rect.width > 4 && rect.height > 4) {
      const icons = iconsEl.querySelectorAll('.desktop-icon');
      for (const ic of icons) {
        const ir = ic.getBoundingClientRect();
        if (ir.left >= rect.left && ir.right <= rect.right && ir.top >= rect.top && ir.bottom <= rect.bottom) {
          ic.classList.add('selected');
          selectedIcons.add(ic);
        }
      }
    }
    selectionRect.hidden = true;
    selectionStart = null;
  });
}

function clearSelection() {
  for (const el of selectedIcons) el.classList.remove('selected');
  selectedIcons.clear();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { init };
