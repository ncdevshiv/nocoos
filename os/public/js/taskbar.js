// Taskbar: Start button, search, running apps, tray.
import wm from './wm.js';
import icons from './core/icons.js';
import api from './core/api.js';
import { openStartMenu, closeStartMenu } from './startmenu.js';

let taskbarEls = null;

export function init() {
  taskbarEls = {
    startBtn: document.getElementById('taskbar-start'),
    apps: document.getElementById('taskbar-apps'),
    clock: document.getElementById('tray-clock'),
    cpu: document.getElementById('tray-cpu'),
    showDesktop: document.getElementById('tray-show-desktop'),
    search: document.getElementById('taskbar-search')
  };

  taskbarEls.startBtn.addEventListener('click', () => openStartMenu());
  taskbarEls.showDesktop.addEventListener('click', () => {
    for (const w of wm.list()) {
      if (!w.minimized) {
        const win = wm.get(w.id);
        if (win) win.minimize();
      }
    }
  });

  taskbarEls.search.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const q = taskbarEls.search.value.trim();
      if (q) openLauncher(q);
      e.target.blur();
    }
  });

  wm.on('open', refresh);
  wm.on('close', refresh);
  wm.on('change', refresh);

  startClock();
  startSystemStats();
  refresh();
}

function refresh() {
  if (!taskbarEls) return;
  taskbarEls.apps.innerHTML = '';
  const wins = wm.list();
  const seenAppIds = new Set();
  for (const w of wins) {
    if (w.singleton && seenAppIds.has(w.appId)) continue;
    seenAppIds.add(w.appId);
    const btn = document.createElement('button');
    btn.className = 'taskbar-app';
    if (w.focused) btn.classList.add('active');
    btn.title = w.title;
    btn.innerHTML = `
      <span class="app-icon">${w.iconHtml || (w.icon ? icons.get(w.icon, { size: 14, stroke: 2.4 }) : icons.get('apps', { size: 14, stroke: 2.4 }))}</span>
      <span class="app-label">${escapeHtml(w.title)}</span>
    `;
    btn.addEventListener('click', () => {
      const win = wm.get(w.id);
      if (!win) return;
      if (w.focused && !w.minimized) {
        win.minimize();
      } else if (w.minimized) {
        win.restore();
      } else {
        win.focus();
      }
    });
    btn.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const win = wm.get(w.id);
      const items = [
        { label: win && !w.minimized ? 'Minimize' : 'Restore', onClick: () => win && (w.minimized ? win.restore() : win.minimize()) },
        { label: win && !w.maximized ? 'Maximize' : 'Unmaximize', onClick: () => win && win.toggleMaximize() },
        { separator: true },
        { label: 'Close', danger: true, onClick: () => win && win.close() }
      ];
      import('./contextmenu.js').then((m) => m.show(e.clientX, e.clientY, items));
    });
    taskbarEls.apps.appendChild(btn);
  }
}

function startClock() {
  const tick = () => {
    const d = new Date();
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    const time = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    taskbarEls.clock.innerHTML = `<div>${time}</div><div style="font-size:0.7rem;opacity:0.7">${day}</div>`;
  };
  tick();
  setInterval(tick, 1000);
}

let statsTimer = null;
function startSystemStats() {
  const tick = async () => {
    try {
      const data = await api.get('/api/system/info');
      const memPct = data.memory.total ? Math.round((data.memory.used / data.memory.total) * 100) : 0;
      taskbarEls.cpu.textContent = `${data.cpus.count} CPU · ${memPct}% MEM`;
    } catch {}
  };
  tick();
  statsTimer = setInterval(tick, 8000);
}

function pad(n) { return String(n).padStart(2, '0'); }
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

async function openLauncher(query) {
  const mod = await import('./apps/launcher.js');
  mod.open(query);
}

export default { init, refresh };
