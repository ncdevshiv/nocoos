// Settings app — appearance, accounts, system info, package tools.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';
import notify from '../core/notify.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('settings', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: 'star' },
  { id: 'accounts', label: 'Accounts', icon: 'user' },
  { id: 'system', label: 'System', icon: 'cpu' },
  { id: 'tools', label: 'Package Tools', icon: 'package' },
  { id: 'about', label: 'About', icon: 'info' }
];

export async function open() {
  const win = wm.create({
    appId: 'settings',
    title: 'Settings',
    icon: 'settings',
    iconHtml: ICON_HTML,
    width: 760,
    height: 540,
    minWidth: 600,
    minHeight: 400,
    singleton: true
  });

  const root = document.createElement('div');
  root.className = 'app-settings';
  root.innerHTML = `
    <div class="settings-side" data-role="nav"></div>
    <div class="settings-main" data-role="main"></div>
  `;
  win.setContent(root);

  const navEl = root.querySelector('[data-role="nav"]');
  const mainEl = root.querySelector('[data-role="main"]');
  let active = 'appearance';

  function buildNav() {
    navEl.innerHTML = '';
    for (const s of SECTIONS) {
      const el = document.createElement('div');
      el.className = 'settings-nav-item' + (s.id === active ? ' active' : '');
      el.innerHTML = `${icons.get(s.icon, { size: 14 })}<span>${s.label}</span>`;
      el.addEventListener('click', () => { active = s.id; buildNav(); render(); });
      navEl.appendChild(el);
    }
  }

  async function render() {
    mainEl.innerHTML = '';
    if (active === 'appearance') return renderAppearance();
    if (active === 'accounts') return renderAccounts();
    if (active === 'system') return renderSystem();
    if (active === 'tools') return renderTools();
    if (active === 'about') return renderAbout();
  }

  let currentPrefs = null;

  async function renderAppearance() {
    mainEl.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await api.get('/api/settings');
      currentPrefs = r.prefs || {};
    } catch (err) {
      notify.error('Settings', `Could not load preferences: ${err.message}`);
      currentPrefs = { accent: '#7c5cff', accent2: '#22d3ee', wallpaper: 'aurora', animate: true, showIcons: true, confirmDelete: true };
    }
    mainEl.innerHTML = `
      <div class="settings-section">
        <h3>Theme</h3>
        <p>Customize the desktop colors. Changes save automatically.</p>
        <div class="settings-row"><div class="label">Accent</div><input class="input" type="color" value="${currentPrefs.accent}" data-key="accent"/></div>
        <div class="settings-row"><div class="label">Accent 2</div><input class="input" type="color" value="${currentPrefs.accent2}" data-key="accent2"/></div>
        <div class="settings-row"><div class="label">Wallpaper</div><select class="select" data-key="wallpaper">
          <option value="aurora">Aurora</option>
          <option value="midnight">Midnight</option>
          <option value="sunset">Sunset</option>
        </select></div>
      </div>
      <div class="settings-section">
        <h3>Behavior</h3>
        <div class="settings-row"><div class="label">Animate windows</div><div class="switch ${currentPrefs.animate ? 'on' : ''}" data-key="animate"></div></div>
        <div class="settings-row"><div class="label">Show desktop icons</div><div class="switch ${currentPrefs.showIcons ? 'on' : ''}" data-key="showIcons"></div></div>
        <div class="settings-row"><div class="label">Confirm on delete</div><div class="switch ${currentPrefs.confirmDelete ? 'on' : ''}" data-key="confirmDelete"></div></div>
      </div>
    `;
    const wallpaperEl = mainEl.querySelector('[data-key="wallpaper"]');
    if (wallpaperEl) wallpaperEl.value = currentPrefs.wallpaper;
    bindSwitches();
    bindInputs();
  }

  async function persist(key, value) {
    currentPrefs = { ...currentPrefs, [key]: value };
    try {
      await api.put('/api/settings', { [key]: value });
    } catch (err) {
      notify.error('Settings', `Failed to save ${key}: ${err.message}`);
    }
  }

  function renderAccounts() {
    const u = api.getUser ? api.getUser() : null;
    mainEl.innerHTML = `
      <div class="settings-section">
        <h3>Signed in as</h3>
        <p>${u ? escapeHtml(u.displayName) + ' (' + escapeHtml(u.username) + ')' : 'Unknown'}</p>
        <button class="btn-ghost" id="settings-signout">Sign out</button>
      </div>
      <div class="settings-section">
        <h3>Change password</h3>
        <p>You'll need to enter your current password to confirm.</p>
        <label>Current password</label><input class="input" type="password" id="settings-pw-old" autocomplete="current-password" />
        <label>New password</label><input class="input" type="password" id="settings-pw-new" autocomplete="new-password" />
        <button class="btn" id="settings-pw-save">Save password</button>
      </div>
    `;
    mainEl.querySelector('#settings-signout').addEventListener('click', () => {
      api.post('/api/auth/logout').finally(() => api.logout());
    });
    mainEl.querySelector('#settings-pw-save').addEventListener('click', async () => {
      const oldEl = mainEl.querySelector('#settings-pw-old');
      const newEl = mainEl.querySelector('#settings-pw-new');
      const currentPassword = oldEl.value;
      const newPassword = newEl.value;
      if (!currentPassword || !newPassword) {
        return notify.warn('Password', 'Both fields are required.');
      }
      if (newPassword.length < 4) {
        return notify.warn('Password', 'New password must be at least 4 characters.');
      }
      try {
        await api.post('/api/auth/password', { currentPassword, newPassword });
        oldEl.value = '';
        newEl.value = '';
        notify.success('Password', 'Password updated.');
      } catch (err) {
        notify.error('Password', err.message || 'Update failed.');
      }
    });
  }

  async function renderSystem() {
    mainEl.innerHTML = '<div class="spinner"></div> Loading system info…';
    try {
      const info = await api.get('/api/system/info');
      mainEl.innerHTML = `
        <div class="settings-section">
          <h3>Host</h3>
          <div class="settings-row"><div class="label">Hostname</div><div>${escapeHtml(info.hostname)}</div></div>
          <div class="settings-row"><div class="label">Platform</div><div>${escapeHtml(info.kernel)}</div></div>
          <div class="settings-row"><div class="label">Node.js</div><div>${escapeHtml(info.node)}</div></div>
          <div class="settings-row"><div class="label">CPUs</div><div>${info.cpus.count} × ${escapeHtml(info.cpus.model)} @ ${info.cpus.speed} MHz</div></div>
          <div class="settings-row"><div class="label">Memory</div><div>${info.memory.usedText} used / ${info.memory.totalText}</div></div>
          <div class="settings-row"><div class="label">Server uptime</div><div>${escapeHtml(info.process.uptime)}</div></div>
          <div class="settings-row"><div class="label">Process RSS</div><div>${escapeHtml(info.process.rss)}</div></div>
        </div>
      `;
    } catch (err) {
      mainEl.innerHTML = `<div class="muted">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  async function renderTools() {
    mainEl.innerHTML = '<div class="spinner"></div>';
    try {
      const r = await api.get('/api/system/tools');
      const tools = r.tools || {};
      let html = '<div class="settings-section"><h3>Detected package managers</h3>';
      for (const [name, path] of Object.entries(tools)) {
        html += `<div class="settings-row"><div class="label">${escapeHtml(name)}</div><div class="text-mono" style="font-size:0.8rem">${path ? escapeHtml(path) : '<span style="color:var(--danger)">not installed</span>'}</div></div>`;
      }
      html += '</div>';
      mainEl.innerHTML = html;
    } catch (err) {
      mainEl.innerHTML = `<div class="muted">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderAbout() {
    mainEl.innerHTML = `
      <div class="settings-section">
        <h3>NocoOS</h3>
        <p>A Node.js desktop environment that runs in your browser.</p>
        <div class="settings-row"><div class="label">Version</div><div>1.0.0</div></div>
        <div class="settings-row"><div class="label">License</div><div>MIT</div></div>
        <div class="settings-row"><div class="label">Stack</div><div>Node.js · Express · ws · xterm.js</div></div>
      </div>
    `;
  }

  function bindSwitches() {
    mainEl.querySelectorAll('.switch').forEach((sw) => {
      sw.addEventListener('click', async () => {
        sw.classList.toggle('on');
        const key = sw.dataset.key;
        const value = sw.classList.contains('on');
        await persist(key, value);
      });
    });
  }
  function bindInputs() {
    mainEl.querySelectorAll('input[type="color"]').forEach((inp) => {
      const applyLive = () => {
        const key = inp.dataset.key;
        document.documentElement.style.setProperty(key === 'accent' ? '--accent' : '--accent-2', inp.value);
      };
      inp.addEventListener('input', applyLive);
      inp.addEventListener('change', () => persist(inp.dataset.key, inp.value));
    });
    mainEl.querySelectorAll('select[data-key]').forEach((sel) => {
      sel.addEventListener('change', () => persist(sel.dataset.key, sel.value));
    });
  }

  buildNav();
  render();
  return win;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { open };
