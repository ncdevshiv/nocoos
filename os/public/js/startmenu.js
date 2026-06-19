// Start menu with search and app listing.
import icons from './core/icons.js';
import api from './core/api.js';
import wm from './wm.js';
import notify from './core/notify.js';
import { logout } from './core/api.js';

let menuEl = null;
let searchEl = null;
let bodyEl = null;
let isOpen = false;

export function init() {
  menuEl = document.getElementById('start-menu');
  searchEl = document.getElementById('start-search');
  bodyEl = document.getElementById('start-body');

  searchEl.addEventListener('input', () => render(searchEl.value));
  searchEl.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeStartMenu();
    if (e.key === 'Enter') {
      const first = bodyEl.querySelector('[data-action="launch"]');
      if (first) first.click();
    }
  });

  document.getElementById('start-action-logout').addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch {}
    logout();
  });
  document.getElementById('start-action-lock').addEventListener('click', () => {
    closeStartMenu();
    showLockScreen();
  });
  document.getElementById('start-action-restart').addEventListener('click', async () => {
    closeStartMenu();
    if (!confirm('Restart the NocoOS server?\n\nAll sessions on this instance will be disconnected briefly.')) return;
    try {
      await api.post('/api/system/restart');
      notify.info('Restarting', 'The server is restarting. Reloading in 3s…');
      setTimeout(() => location.reload(), 3000);
    } catch (err) {
      notify.error('Restart failed', err.message || 'Could not restart the server.');
    }
  });

  document.addEventListener('click', (e) => {
    if (!isOpen) return;
    if (menuEl.contains(e.target)) return;
    if (e.target.closest('#taskbar-start')) return;
    closeStartMenu();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) closeStartMenu();
  });

  render('');
}

export async function openStartMenu() {
  if (!menuEl) init();
  menuEl.hidden = false;
  isOpen = true;
  document.getElementById('taskbar-start').classList.add('active');
  searchEl.value = '';
  render('');
  setTimeout(() => searchEl.focus(), 50);
}

export function closeStartMenu() {
  if (!menuEl) return;
  menuEl.hidden = true;
  isOpen = false;
  document.getElementById('taskbar-start').classList.remove('active');
}

let cachedApps = null;
async function getApps() {
  if (cachedApps) return cachedApps;
  try {
    const r = await api.get('/api/registry/apps');
    cachedApps = r.apps;
    return cachedApps;
  } catch (err) {
    console.error('failed to load apps', err);
    return [];
  }
}

async function render(query) {
  if (!bodyEl) return;
  bodyEl.innerHTML = '';
  const apps = await getApps();
  const pinned = apps.filter((a) => a.pinned);
  const all = apps;

  const q = (query || '').toLowerCase().trim();
  const filterFn = (a) => !q || a.name.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
  const filteredPinned = pinned.filter(filterFn);
  const filteredAll = all.filter(filterFn);

  if (filteredPinned.length) {
    bodyEl.appendChild(sectionTitle('Pinned'));
    bodyEl.appendChild(tileGrid(filteredPinned));
  }
  if (filteredAll.length) {
    bodyEl.appendChild(sectionTitle('All apps'));
    bodyEl.appendChild(tileGrid(filteredAll));
  }
  if (!filteredPinned.length && !filteredAll.length) {
    const empty = document.createElement('div');
    empty.style.padding = '1.5rem';
    empty.style.color = 'var(--muted)';
    empty.style.textAlign = 'center';
    empty.textContent = `No matches for "${query}"`;
    bodyEl.appendChild(empty);
  }
}

function sectionTitle(text) {
  const h = document.createElement('div');
  h.className = 'start-menu-section-title';
  h.textContent = text;
  return h;
}

function tileGrid(apps) {
  const grid = document.createElement('div');
  grid.className = 'start-menu-grid';
  for (const a of apps) grid.appendChild(tile(a));
  return grid;
}

function tile(app) {
  const t = document.createElement('button');
  t.className = 'start-menu-tile';
  t.dataset.action = 'launch';
  t.dataset.appId = app.id;
  t.title = app.description || app.name;
  t.innerHTML = `
    <div class="tile-icon">${icons.get(app.icon || 'apps', { size: 22, stroke: 2 })}</div>
    <div class="tile-name">${escapeHtml(app.name)}</div>
  `;
  t.addEventListener('click', async () => {
    closeStartMenu();
    await launchApp(app.id);
  });
  return t;
}

async function launchApp(appId) {
  const app = (await getApps()).find((a) => a.id === appId);
  if (!app) return;
  try {
    const mod = await import(`./apps/${app.id}.js`);
    if (typeof mod.open === 'function') {
      mod.open();
    } else if (typeof mod.launch === 'function') {
      mod.launch();
    } else {
      notify.error('App error', `App "${appId}" has no open() function.`);
    }
  } catch (err) {
    notify.error('Failed to open', err.message);
  }
}

export async function launch(appId) { return launchApp(appId); }

// Lock screen: client-side overlay that hides the desktop. The session token
// remains valid on the server; the user re-authenticates with their password
// via POST /api/auth/unlock to dismiss the overlay. Server-side, no session
// rotation occurs (so an attacker with a stolen token still needs the password).
let lockOverlayEl = null;
function ensureLockOverlay() {
  if (lockOverlayEl) return lockOverlayEl;
  const overlay = document.createElement('div');
  overlay.id = 'lock-overlay';
  overlay.className = 'lock-overlay';
  overlay.innerHTML = `
    <div class="lock-card">
      <div class="lock-title">Locked</div>
      <div class="lock-sub" id="lock-user">Enter your password to continue.</div>
      <form id="lock-form">
        <input class="input" type="password" id="lock-password" autocomplete="current-password" autofocus />
        <button class="btn" type="submit">Unlock</button>
      </form>
      <div class="lock-error" id="lock-error"></div>
      <button class="btn-ghost" id="lock-signout">Sign out instead</button>
    </div>
  `;
  document.body.appendChild(overlay);
  lockOverlayEl = overlay;
  return overlay;
}

export function showLockScreen() {
  const overlay = ensureLockOverlay();
  overlay.classList.add('visible');
  const errEl = overlay.querySelector('#lock-error');
  errEl.textContent = '';
  const pwEl = overlay.querySelector('#lock-password');
  pwEl.value = '';
  const user = api.getUser ? api.getUser() : null;
  if (user) overlay.querySelector('#lock-user').textContent = `Signed in as ${user.displayName || user.username}. Enter your password to continue.`;
  setTimeout(() => pwEl.focus(), 50);

  const form = overlay.querySelector('#lock-form');
  const onSubmit = async (e) => {
    e.preventDefault();
    const password = pwEl.value;
    if (!password) { errEl.textContent = 'Password is required.'; return; }
    try {
      await api.post('/api/auth/unlock', { password });
      overlay.classList.remove('visible');
      pwEl.value = '';
      errEl.textContent = '';
    } catch (err) {
      errEl.textContent = err.message || 'Incorrect password.';
      pwEl.select();
    }
  };
  form.addEventListener('submit', onSubmit, { once: false });
  overlay.querySelector('#lock-signout').addEventListener('click', async () => {
    try { await api.post('/api/auth/logout'); } catch {}
    logout();
  }, { once: false });
}

export function hideLockScreen() {
  if (lockOverlayEl) lockOverlayEl.classList.remove('visible');
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { openStartMenu, closeStartMenu, init, launch };
