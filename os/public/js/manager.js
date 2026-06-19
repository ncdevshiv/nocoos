// Manager UI: lists running instances, lets you stop them, copy launch commands.
import api from './core/api.js';
import icons from './core/icons.js';
import notify from './core/notify.js';

const listEl = document.getElementById('instance-list');
const badgeEl = document.getElementById('count-badge');
const subtitleEl = document.getElementById('manager-subtitle');
const refreshBtn = document.getElementById('btn-refresh');
const copyCmdBtn = document.getElementById('btn-copy-cmd');
const launchNameInput = document.getElementById('launch-name');
const launchPortInput = document.getElementById('launch-port');
const launchCmdEl = document.getElementById('launch-cmd');

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function updateLaunchCmd() {
  const name = launchNameInput.value.trim() || 'myapp';
  const port = launchPortInput.value.trim();
  let cmd = `node bin/nocoos.js --name ${name}`;
  if (port) cmd += ` --port ${port}`;
  launchCmdEl.textContent = cmd;
}

async function loadInstances() {
  try {
    const resp = await fetch('/api/instances');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    renderList(data.instances || []);
  } catch (err) {
    subtitleEl.textContent = 'Failed to load instances: ' + err.message;
  }
}

function renderList(instances) {
  badgeEl.textContent = instances.length;
  subtitleEl.textContent = instances.length
    ? `${instances.filter((i) => i.status === 'running').length} running, ${instances.filter((i) => i.status !== 'running').length} other`
    : 'No instances registered';
  if (!instances.length) {
    listEl.innerHTML = `<div class="manager-empty">No instances yet. Start one with <code>node bin/nocoos.js</code>.</div>`;
    return;
  }
  listEl.innerHTML = '';
  for (const inst of instances) {
    const card = document.createElement('div');
    card.className = 'instance-card';
    const age = inst.ageMs ? formatAge(inst.ageMs) : '?';
    card.innerHTML = `
      <div class="instance-status ${escapeHtml(inst.status)}"></div>
      <div class="instance-info">
        <div class="instance-name">
          ${escapeHtml(inst.name)}
          <span class="badge">${escapeHtml(inst.status)}</span>
        </div>
        <div class="instance-meta">
          port ${inst.port} · pid ${inst.pid} · ${escapeHtml(inst.host || '?')} · heartbeat ${age}
        </div>
      </div>
      <div class="instance-actions">
        <button class="btn-ghost" data-act="open" title="Open in new tab">
          ${icons.get('external', { size: 14 })}
        </button>
        <button class="btn-ghost" data-act="copy" title="Copy URL">
          ${icons.get('copy', { size: 14 })}
        </button>
        <button class="btn-danger" data-act="stop" title="Stop instance">
          ${icons.get('power', { size: 14 })}
          Stop
        </button>
      </div>
    `;
    card.querySelector('[data-act="open"]').addEventListener('click', () => {
      window.open(`http://${location.hostname}:${inst.port}`, '_blank');
    });
    card.querySelector('[data-act="copy"]').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(`http://localhost:${inst.port}`);
        notify.success('Copied', `URL for ${inst.name}`);
      } catch {}
    });
    card.querySelector('[data-act="stop"]').addEventListener('click', async () => {
      if (!confirm(`Stop instance "${inst.name}" (pid ${inst.pid})?`)) return;
      try {
        const r = await fetch(`/api/instances/${encodeURIComponent(inst.name)}/stop`, { method: 'POST' });
        const data = await r.json();
        if (data.ok) {
          notify.info('Stopping', `Sent SIGTERM to ${inst.name}`);
          setTimeout(loadInstances, 1000);
        } else {
          notify.error('Stop failed', data.message || 'unknown error');
        }
      } catch (err) {
        notify.error('Stop failed', err.message);
      }
    });
    listEl.appendChild(card);
  }
}

function formatAge(ms) {
  if (ms < 1000) return 'just now';
  if (ms < 60 * 1000) return Math.round(ms / 1000) + 's ago';
  if (ms < 3600 * 1000) return Math.round(ms / 60000) + 'm ago';
  return Math.round(ms / 3600000) + 'h ago';
}

refreshBtn.addEventListener('click', loadInstances);
launchNameInput.addEventListener('input', updateLaunchCmd);
launchPortInput.addEventListener('input', updateLaunchCmd);
copyCmdBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(launchCmdEl.textContent);
    notify.success('Copied', launchCmdEl.textContent);
  } catch {
    notify.error('Copy failed', 'clipboard unavailable');
  }
});

updateLaunchCmd();
loadInstances();
setInterval(loadInstances, 4000);
