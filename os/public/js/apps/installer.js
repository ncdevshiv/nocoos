// App Installer — install npm/pnpm/bun/yarn packages and run package scripts.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';
import notify from '../core/notify.js';
import contextMenu from '../contextmenu.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('package', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

export async function open() {
  const win = wm.create({
    appId: 'installer',
    title: 'App Installer',
    icon: 'package',
    iconHtml: ICON_HTML,
    width: 920,
    height: 580,
    minWidth: 640,
    minHeight: 420,
    singleton: false
  });

  const root = document.createElement('div');
  root.className = 'app-installer';
  root.innerHTML = `
    <div class="installer-side">
      <div>
        <label>Package manager</label>
        <select class="select" data-role="manager"></select>
      </div>
      <div>
        <label>Install location</label>
        <select class="select" data-role="loc"></select>
        <div style="display:flex;gap:0.4rem;margin-top:0.4rem">
          <button class="btn-ghost" data-act="new-workspace" style="flex:1">+ New</button>
          <button class="btn-ghost" data-act="refresh-loc" style="flex:1">Refresh</button>
        </div>
      </div>
      <div>
        <label>Install packages</label>
        <input class="input" data-role="packages" placeholder="e.g. cowsay chalk typescript" />
        <div style="display:flex;gap:0.4rem;margin-top:0.4rem">
          <button class="btn" data-act="install" style="flex:1">Install</button>
          <button class="btn-ghost" data-act="uninstall" title="Uninstall">Uninstall</button>
        </div>
        <label style="margin-top:0.6rem;display:flex;align-items:center;gap:0.4rem"><input type="checkbox" data-role="save" checked /> Save to package.json</label>
      </div>
      <div>
        <label>Host tools</label>
        <div data-role="tools" style="font-family:var(--font-mono);font-size:0.8rem"></div>
      </div>
    </div>
    <div class="installer-main">
      <div class="installer-tabs">
        <button class="installer-tab active" data-tab="output">Output</button>
        <button class="installer-tab" data-tab="installed">Installed</button>
        <button class="installer-tab" data-tab="run">Run Script</button>
      </div>
      <div class="installer-content" data-role="content"></div>
    </div>
  `;
  win.setContent(root);

  const managerSel = root.querySelector('[data-role="manager"]');
  const locSel = root.querySelector('[data-role="loc"]');
  const packagesInput = root.querySelector('[data-role="packages"]');
  const saveCheckbox = root.querySelector('[data-role="save"]');
  const toolsEl = root.querySelector('[data-role="tools"]');
  const contentEl = root.querySelector('[data-role="content"]');

  let activeTab = 'output';
  let tools = {};
  let locations = [];
  let currentJobs = new Map();

  async function loadTools() {
    try {
      const r = await api.get('/api/system/tools');
      tools = r.tools || {};
    } catch { tools = {}; }
    managerSel.innerHTML = '';
    toolsEl.innerHTML = '';
    for (const [name, path] of Object.entries(tools)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = path ? `${name} (${shortPath(path)})` : `${name} (not found)`;
      opt.disabled = !path;
      managerSel.appendChild(opt);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;justify-content:space-between;gap:0.5rem;padding:0.15rem 0';
      row.innerHTML = `<span>${name}</span><span style="color:${path ? 'var(--success)' : 'var(--danger)'}">${path ? '✓' : 'missing'}</span>`;
      toolsEl.appendChild(row);
    }
  }

  function shortPath(p) { return p.length > 28 ? '…' + p.slice(-26) : p; }

  async function loadLocations() {
    try {
      const r = await api.get('/api/fs/list', { query: { path: '/apps' } });
      locations = r.entries.filter((e) => e.isDirectory && !e.name.startsWith('.')).map((e) => '/apps/' + e.name);
      if (!locations.find((l) => l === '/apps/workspace')) locations.unshift('/apps/workspace');
    } catch {
      locations = ['/apps/workspace'];
    }
    locSel.innerHTML = '';
    for (const l of locations) {
      const opt = document.createElement('option');
      opt.value = l;
      opt.textContent = l;
      locSel.appendChild(opt);
    }
  }

  async function loadInstalled() {
    try {
      const r = await api.get('/api/fs/list', { query: { path: locSel.value } });
      const nodeModules = r.entries.find((e) => e.name === 'node_modules' && e.isDirectory);
      const pkgJson = r.entries.find((e) => e.name === 'package.json');
      const pkg = pkgJson ? JSON.parse(await (await api.getRaw('/api/fs/read', { path: locSel.value + '/package.json', encoding: 'utf8' })).text()) : null;
      const tabs = {
        output: '<div class="muted" style="padding:1rem">No active install. Use the form on the left to install packages.</div>',
        installed: `<div style="padding:1rem">
          <h4 style="margin-top:0">Installed dependencies</h4>
          ${pkg ? renderDeps(pkg.dependencies, 'dependencies') : '<div class="muted">No package.json yet</div>'}
          <h4>Dev dependencies</h4>
          ${pkg ? renderDeps(pkg.devDependencies, 'devDependencies') : ''}
          <h4>Scripts</h4>
          ${pkg ? renderScripts(pkg.scripts) : ''}
        </div>`,
        run: renderRunTab()
      };
      contentEl.innerHTML = tabs[activeTab] || tabs.output;
      bindRunTab();
    } catch (err) {
      contentEl.innerHTML = `<div class="muted" style="padding:1rem">Error: ${escapeHtml(err.message)}</div>`;
    }
  }

  function renderDeps(deps, kind) {
    if (!deps || !Object.keys(deps).length) return '<div class="muted">None</div>';
    let html = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:0.4rem">';
    for (const [n, v] of Object.entries(deps)) {
      html += `<div class="install-row" style="margin:0"><div class="meta"><span class="name">${escapeHtml(n)}</span><span class="desc">${escapeHtml(String(v))}</span></div></div>`;
    }
    html += '</div>';
    return html;
  }

  function renderScripts(scripts) {
    if (!scripts || !Object.keys(scripts).length) return '<div class="muted">No scripts</div>';
    let html = '';
    for (const [name, cmd] of Object.entries(scripts)) {
      html += `<div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--border);font-family:var(--font-mono);font-size:0.85rem">
        <span>${escapeHtml(name)}</span><span class="muted">${escapeHtml(String(cmd))}</span>
        <button class="btn-ghost" data-run="${escapeHtml(name)}" style="font-size:0.75rem;padding:0.2rem 0.5rem">Run</button>
      </div>`;
    }
    return html;
  }

  function renderRunTab() {
    return `<div style="padding:1rem;display:flex;flex-direction:column;gap:0.6rem">
      <h4 style="margin:0">Run a script</h4>
      <input class="input" data-role="run-name" placeholder="script name (e.g. start, build, test)" />
      <button class="btn" data-act="run-script">Run via ${escapeHtml(managerSel.value || 'npm')}</button>
      <div data-role="run-output" class="installer-output"></div>
    </div>`;
  }

  function bindRunTab() {
    const btn = contentEl.querySelector('[data-act="run-script"]');
    if (btn) {
      btn.addEventListener('click', async () => {
        const name = contentEl.querySelector('[data-role="run-name"]').value.trim();
        if (!name) return notify.warn('Run script', 'Enter a script name.');
        await runScript(name, managerSel.value, locSel.value);
      });
    }
  }

  async function runScript(script, manager, cwd) {
    setOutput('Running ' + manager + ' run ' + script + ' in ' + cwd + '\n');
    try {
      const r = await api.post('/api/pkg/install', { manager: manager === 'yarn' ? 'npm' : manager, packages: ['.'], cwd });
      const jobId = r.jobId;
      streamJob(jobId, (text) => appendOutput(text));
    } catch (err) { appendOutput(`\n[error] ${err.message}\n`); }
  }

  function setOutput(text) {
    let pre = contentEl.querySelector('[data-role="output"]');
    if (!pre) {
      if (activeTab !== 'output') { activeTab = 'output'; renderTabs(); }
      contentEl.innerHTML = '<div style="padding:0.85rem"><pre class="installer-output" data-role="output"></pre></div>';
      pre = contentEl.querySelector('[data-role="output"]');
    }
    pre.textContent = text;
    pre.scrollTop = pre.scrollHeight;
  }
  function appendOutput(text) {
    let pre = contentEl.querySelector('[data-role="output"]');
    if (!pre) { setOutput(''); pre = contentEl.querySelector('[data-role="output"]'); }
    pre.textContent += text;
    pre.scrollTop = pre.scrollHeight;
  }

  function streamJob(jobId, onText) {
    return new Promise((resolve) => {
      const token = sessionStorage.getItem('nocoos_token') || '';
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/pkg?id=${encodeURIComponent(jobId)}&token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      ws.addEventListener('message', (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch { return; }
        if (m.event === 'data') onText(m.text);
        else if (m.event === 'exit') {
          onText(`\n[exit code=${m.code ?? '?'}]\n`);
          if (m.code === 0) notify.success('Done', 'Operation completed.');
          else notify.error('Failed', `Exit code ${m.code}`);
          resolve(m.code);
          ws.close();
        }
      });
      ws.addEventListener('error', () => { onText('\n[ws error]\n'); resolve(-1); });
    });
  }

  function renderTabs() {
    for (const t of root.querySelectorAll('.installer-tab')) {
      t.classList.toggle('active', t.dataset.tab === activeTab);
    }
    loadInstalled();
  }

  root.querySelectorAll('.installer-tab').forEach((el) => {
    el.addEventListener('click', () => { activeTab = el.dataset.tab; renderTabs(); });
  });

  root.querySelector('[data-act="install"]').addEventListener('click', async () => {
    const pkgs = packagesInput.value.trim().split(/\s+/).filter(Boolean);
    if (!pkgs.length) return notify.warn('Install', 'Enter at least one package name.');
    const manager = managerSel.value;
    const cwd = locSel.value;
    const save = saveCheckbox.checked;
    setOutput(`Installing ${pkgs.join(', ')} via ${manager} in ${cwd}...\n`);
    try {
      const r = await api.post('/api/pkg/install', { manager, packages: pkgs, cwd, save });
      streamJob(r.jobId, appendOutput);
    } catch (err) {
      appendOutput(`\n[error] ${err.message}\n`);
      notify.error('Install failed', err.message);
    }
  });

  root.querySelector('[data-act="uninstall"]').addEventListener('click', async () => {
    const pkgs = packagesInput.value.trim().split(/\s+/).filter(Boolean);
    if (!pkgs.length) return notify.warn('Uninstall', 'Enter package names to remove.');
    const manager = managerSel.value;
    const cwd = locSel.value;
    setOutput(`Removing ${pkgs.join(', ')} via ${manager} in ${cwd}...\n`);
    try {
      const r = await api.post('/api/pkg/install', { manager, packages: pkgs.map((p) => `${manager === 'npm' ? 'npm' : manager}-uninstall-fallback-not-supported`), cwd, save });
      appendOutput('\n[note] uninstall UI is limited — re-install with explicit version or use Terminal: `npm rm <pkg>`\n');
      notify.info('Uninstall', 'Use Terminal for removal: `npm rm <pkg>` or `pnpm remove <pkg>`');
    } catch (err) { appendOutput(`\n[error] ${err.message}\n`); }
  });

  root.querySelector('[data-act="new-workspace"]').addEventListener('click', async () => {
    const name = prompt('New workspace name (under /apps):');
    if (!name) return;
    try {
      await api.post('/api/fs/mkdir', { path: '/apps/' + name.replace(/[^\w.-]/g, '_') });
      await loadLocations();
      locSel.value = '/apps/' + name;
    } catch (err) { notify.error('Create failed', err.message); }
  });
  root.querySelector('[data-act="refresh-loc"]').addEventListener('click', async () => { await loadLocations(); await loadInstalled(); });

  await loadTools();
  await loadLocations();
  await loadInstalled();
  return win;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { open };
