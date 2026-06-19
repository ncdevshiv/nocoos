// About app.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('info', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

export async function open() {
  const win = wm.create({
    appId: 'about',
    title: 'About NocoOS',
    icon: 'info',
    iconHtml: ICON_HTML,
    width: 560,
    height: 480,
    minWidth: 480,
    minHeight: 400,
    singleton: true
  });

  const root = document.createElement('div');
  root.className = 'app-about';

  let info = null;
  try { info = await api.get('/api/system/info'); } catch {}

  root.innerHTML = `
    <div class="about-logo">N</div>
    <h1 class="about-name">NocoOS</h1>
    <div class="about-version">v1.0.0 · Node.js ${escapeHtml(info?.node || '?')}</div>
    <p style="color:var(--muted);max-width:480px;margin:0.4rem 0 0;line-height:1.5">A complete Node.js desktop operating environment with virtual filesystem, window manager, terminal, and one-click package installer.</p>
    <div class="about-stats">
      <div class="about-stat"><div class="label">Host</div><div class="value">${escapeHtml(info?.hostname || '?')}</div></div>
      <div class="about-stat"><div class="label">Platform</div><div class="value">${escapeHtml(info?.platform || '?')} · ${escapeHtml(info?.arch || '?')}</div></div>
      <div class="about-stat"><div class="label">CPUs</div><div class="value">${info?.cpus.count || '?'}</div></div>
      <div class="about-stat"><div class="label">Memory</div><div class="value">${escapeHtml(info?.memory.totalText || '?')}</div></div>
      <div class="about-stat"><div class="label">Server uptime</div><div class="value">${escapeHtml(info?.process.uptime || '?')}</div></div>
      <div class="about-stat"><div class="label">Server PID</div><div class="value">${info?.process.pid || '?'}</div></div>
    </div>
    <div style="margin-top:1.5rem;display:flex;gap:0.5rem">
      <button class="btn-ghost" id="about-open-fm">Open Files</button>
      <button class="btn-ghost" id="about-open-term">Open Terminal</button>
    </div>
  `;

  win.setContent(root);

  root.querySelector('#about-open-fm').addEventListener('click', async () => {
    const fm = await import('./filemanager.js');
    fm.open();
  });
  root.querySelector('#about-open-term').addEventListener('click', async () => {
    const t = await import('./terminal.js');
    t.open();
  });

  return win;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { open };
