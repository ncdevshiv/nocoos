// System Monitor — CPU, memory, processes, server stats.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('activity', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

export async function open() {
  const win = wm.create({
    appId: 'monitor',
    title: 'System Monitor',
    icon: 'activity',
    iconHtml: ICON_HTML,
    width: 780,
    height: 520,
    minWidth: 600,
    minHeight: 360,
    singleton: false
  });

  const root = document.createElement('div');
  root.className = 'app-monitor';
  root.innerHTML = `
    <div class="monitor-grid" data-role="cards"></div>
    <h3 style="margin:1rem 0 0.4rem;font-size:0.95rem">Processes</h3>
    <table class="monitor-table">
      <thead><tr>
        <th>ID</th><th>Kind</th><th>Label</th><th>PID</th><th>Status</th><th>Runtime</th><th>Command</th><th></th>
      </tr></thead>
      <tbody data-role="rows"></tbody>
    </table>
  `;
  win.setContent(root);

  const cardsEl = root.querySelector('[data-role="cards"]');
  const rowsEl = root.querySelector('[data-role="rows"]');

  let info = null;
  let procs = [];

  async function refresh() {
    try {
      const [infoResp, procsResp] = await Promise.all([
        api.get('/api/system/info'),
        api.get('/api/system/procs')
      ]);
      info = infoResp;
      procs = procsResp.procs;
      renderCards();
      renderRows();
    } catch {}
  }

  function renderCards() {
    const memPct = info.memory.total ? Math.round((info.memory.used / info.memory.total) * 100) : 0;
    cardsEl.innerHTML = `
      <div class="monitor-card">
        <h4>CPU</h4>
        <div class="monitor-value">${info.cpus.count}</div>
        <div class="muted text-sm">${escapeHtml(info.cpus.model)} @ ${info.cpus.speed} MHz</div>
        <div class="muted text-sm" style="margin-top:0.3rem">Load: ${info.cpus.load.map((n) => n.toFixed(2)).join(' / ')}</div>
      </div>
      <div class="monitor-card">
        <h4>Memory</h4>
        <div class="monitor-value">${memPct}%</div>
        <div class="muted text-sm">${info.memory.usedText} used of ${info.memory.totalText}</div>
        <div class="monitor-bar"><div style="width:${memPct}%"></div></div>
      </div>
      <div class="monitor-card">
        <h4>Server</h4>
        <div class="monitor-value text-sm" style="font-family:var(--font-mono)">${escapeHtml(info.node)}</div>
        <div class="muted text-sm">uptime: ${escapeHtml(info.process.uptime)}</div>
        <div class="muted text-sm">pid: ${info.process.pid}</div>
      </div>
      <div class="monitor-card">
        <h4>Heap</h4>
        <div class="monitor-value text-sm" style="font-family:var(--font-mono)">${escapeHtml(info.process.heapUsed)}</div>
        <div class="muted text-sm">of ${escapeHtml(info.process.heapTotal)}</div>
      </div>
    `;
  }

  function renderRows() {
    rowsEl.innerHTML = '';
    if (!procs.length) {
      rowsEl.innerHTML = '<tr><td colspan="8" class="muted" style="padding:0.85rem">No running processes.</td></tr>';
      return;
    }
    for (const p of procs) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(p.id.slice(0, 8))}</td>
        <td><span class="badge">${escapeHtml(p.kind)}</span></td>
        <td>${escapeHtml(p.label)}</td>
        <td>${p.pid ?? '-'}</td>
        <td>${escapeHtml(p.status)}</td>
        <td>${formatRuntime(p.runtimeMs)}</td>
        <td class="muted text-mono" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.command || '')}</td>
        <td><button class="btn-ghost" data-kill="${p.id}" style="padding:0.2rem 0.5rem;font-size:0.75rem">Kill</button></td>
      `;
      rowsEl.appendChild(tr);
    }
    rowsEl.querySelectorAll('[data-kill]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.kill;
        try {
          await api.post(`/api/system/procs/${id}/kill`, { signal: 'SIGTERM' });
          setTimeout(refresh, 500);
        } catch {}
      });
    });
  }

  function formatRuntime(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
    return Math.floor(s / 3600) + 'h ' + Math.floor((s % 3600) / 60) + 'm';
  }

  await refresh();
  const t = setInterval(refresh, 4000);
  win.on('close', () => clearInterval(t));
  return win;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { open };
