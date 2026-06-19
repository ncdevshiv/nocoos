// Code editor — multi-tab text editor with line numbers, save, and file tree.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';
import notify from '../core/notify.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('code', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

const LANG_BY_EXT = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript',
  ts: 'typescript', tsx: 'tsx', jsx: 'jsx',
  json: 'json', html: 'html', htm: 'html', xml: 'xml',
  css: 'css', scss: 'scss', less: 'less',
  md: 'markdown', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', cpp: 'cpp',
  h: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', sh: 'bash',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', sql: 'sql',
  vue: 'html', svelte: 'html'
};

function langOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return LANG_BY_EXT[ext] || 'plaintext';
}

function highlight(code, lang) {
  // Lightweight, regex-based highlighter. Output is HTML with span classes.
  // Not a full parser, but visually improves common languages.
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const patterns = [];

  if (lang === 'javascript' || lang === 'typescript' || lang === 'jsx' || lang === 'tsx') {
    patterns.push([/\/\/[^\n]*/g, 'comment']);
    patterns.push([/\/\*[\s\S]*?\*\//g, 'comment']);
    patterns.push([/`(?:\\.|[^`\\])*`/g, 'string']);
    patterns.push([/'(?:\\.|[^'\\])*'/g, 'string']);
    patterns.push([/"(?:\\.|[^"\\])*"/g, 'string']);
    patterns.push([/\b(const|let|var|function|return|if|else|for|while|switch|case|break|continue|class|new|this|super|extends|import|export|from|as|async|await|yield|try|catch|finally|throw|typeof|instanceof|in|of|null|undefined|true|false|do|default)\b/g, 'kw']);
    patterns.push([/\b\d+(\.\d+)?\b/g, 'num']);
  } else if (lang === 'json') {
    patterns.push([/"[^"]*"(?=\s*:)/g, 'key']);
    patterns.push([/"(?:\\.|[^"\\])*"/g, 'string']);
    patterns.push([/\b(true|false|null)\b/g, 'kw']);
    patterns.push([/-?\b\d+(\.\d+)?\b/g, 'num']);
  } else if (lang === 'html' || lang === 'xml') {
    patterns.push([/<!--[\s\S]*?-->/g, 'comment']);
    patterns.push([/<\/?[a-zA-Z][^>]*>/g, 'tag']);
    patterns.push([/"[^"]*"/g, 'string']);
    patterns.push([/'[^']*'/g, 'string']);
  } else if (lang === 'css' || lang === 'scss' || lang === 'less') {
    patterns.push([/\/\*[\s\S]*?\*\//g, 'comment']);
    patterns.push([/[.#][a-zA-Z_-][\w-]*/g, 'selector']);
    patterns.push([/--[a-zA-Z_-][\w-]*/g, 'var']);
    patterns.push([/\b[a-zA-Z-]+(?=\s*:)/g, 'prop']);
    patterns.push([/#[0-9a-fA-F]{3,8}\b/g, 'num']);
    patterns.push([/\b\d+(\.\d+)?(px|em|rem|%|s|ms|deg|fr)?\b/g, 'num']);
  } else if (lang === 'python') {
    patterns.push([/#.*/g, 'comment']);
    patterns.push([/'''[\s\S]*?'''/g, 'string']);
    patterns.push([/"""[\s\S]*?"""/g, 'string']);
    patterns.push([/'(?:\\.|[^'\\])*'/g, 'string']);
    patterns.push([/"(?:\\.|[^"\\])*"/g, 'string']);
    patterns.push([/\b(def|class|return|if|elif|else|for|while|import|from|as|try|except|finally|with|yield|async|await|pass|break|continue|in|is|not|and|or|None|True|False)\b/g, 'kw']);
    patterns.push([/\b\d+(\.\d+)?\b/g, 'num']);
  } else if (lang === 'bash' || lang === 'sh') {
    patterns.push([/#.*/g, 'comment']);
    patterns.push([/"(?:\\.|[^"\\])*"/g, 'string']);
    patterns.push([/'(?:\\.|[^'\\])*'/g, 'string']);
    patterns.push([/\$\{[^}]+\}/g, 'var']);
    patterns.push([/\$[a-zA-Z_][\w]*/g, 'var']);
    patterns.push([/\b(if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|export|local|echo|cd|ls|rm|cp|mv|export|source)\b/g, 'kw']);
  } else if (lang === 'markdown') {
    patterns.push([/^#{1,6}.*$/gm, 'kw']);
    patterns.push([/`[^`]+`/g, 'string']);
    patterns.push([/\*\*[^*]+\*\*/g, 'kw']);
  }

  let out = esc(code);
  for (const [re, cls] of patterns) {
    out = out.replace(re, (m) => `<span class="hl-${cls}">${m}</span>`);
  }
  return out + '\n';
}

function injectHlStyles() {
  if (document.getElementById('hl-styles')) return;
  const s = document.createElement('style');
  s.id = 'hl-styles';
  s.textContent = `
    .editor-host textarea { color: transparent; caret-color: var(--text); background: transparent; position: relative; z-index: 1; }
    .editor-host .editor-highlight { position: absolute; inset: 0; padding: 0.75rem 1rem 0.75rem calc(1rem + 48px); margin: 0; pointer-events: none; white-space: pre; overflow: auto; font-family: var(--font-mono); font-size: 0.9rem; line-height: 1.55; color: var(--text); z-index: 0; }
    .editor-host .editor-gutter { position: absolute; top: 0; left: 0; width: 48px; height: 100%; background: rgba(0,0,0,0.3); border-right: 1px solid var(--border); color: var(--muted); padding: 0.75rem 0.5rem 0.75rem 0; text-align: right; font-family: var(--font-mono); font-size: 0.85rem; line-height: 1.55; pointer-events: none; overflow: hidden; }
    .hl-kw { color: #c084fc; }
    .hl-string { color: #34d399; }
    .hl-comment { color: #64748b; font-style: italic; }
    .hl-num { color: #fbbf24; }
    .hl-tag { color: #22d3ee; }
    .hl-attr { color: #fbbf24; }
    .hl-key { color: #22d3ee; }
    .hl-selector { color: #fbbf24; }
    .hl-prop { color: #c084fc; }
    .hl-var { color: #f472b6; }
  `;
  document.head.appendChild(s);
}

export async function open(opts = {}) {
  injectHlStyles();

  const win = wm.create({
    appId: 'editor',
    title: opts.path ? `Editor — ${opts.path}` : 'Editor',
    icon: 'code',
    iconHtml: ICON_HTML,
    width: 920,
    height: 560,
    minWidth: 480,
    minHeight: 300
  });

  const root = document.createElement('div');
  root.className = 'app-editor';
  root.innerHTML = `
    <div class="editor-toolbar">
      <button class="icon-button" data-act="new" title="New file"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></button>
      <button class="icon-button" data-act="open" title="Open"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg></button>
      <button class="icon-button" data-act="save" title="Save (Ctrl+S)"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg></button>
      <div class="editor-tabs" data-role="tabs"></div>
      <select class="select" data-role="lang" style="width:auto;min-width:120px"></select>
    </div>
    <div class="editor-sidebar" data-role="sidebar">
      <div style="padding:0.4rem 0.5rem;color:var(--muted);font-size:0.75rem;text-transform:uppercase;letter-spacing:0.05em">Files</div>
      <ul class="editor-tree" data-role="tree"></ul>
    </div>
    <div class="editor-main" data-role="main"></div>
    <div class="editor-status">
      <span data-role="path">—</span>
      <span class="spacer"></span>
      <span data-role="lang">plain</span>
      <span data-role="ln">Ln 1, Col 1</span>
      <span data-role="size">0 chars</span>
    </div>
  `;
  win.setContent(root);

  const tabsEl = root.querySelector('[data-role="tabs"]');
  const mainEl = root.querySelector('[data-role="main"]');
  const treeEl = root.querySelector('[data-role="tree"]');
  const pathEl = root.querySelector('[data-role="path"]');
  const langEl = root.querySelector('[data-role="lang"]');
  const lnEl = root.querySelector('[data-role="ln"]');
  const sizeEl = root.querySelector('[data-role="size"]');
  const langSelect = root.querySelector('[data-role="lang"]');

  const LANGS = ['plaintext', 'javascript', 'typescript', 'json', 'html', 'css', 'markdown', 'python', 'bash', 'yaml', 'sql'];
  for (const l of LANGS) {
    const opt = document.createElement('option');
    opt.value = l;
    opt.textContent = l;
    langSelect.appendChild(opt);
  }
  langSelect.addEventListener('change', () => {
    const tab = tabs[currentTab];
    if (!tab) return;
    tab.lang = langSelect.value;
    refreshHighlight(tab);
  });

  const tabs = [];
  let currentTab = -1;

  function newTab(opts = {}) {
    const id = 't-' + (tabs.length + 1) + '-' + Date.now().toString(36);
    const tab = {
      id,
      path: opts.path || null,
      name: opts.name || (opts.path ? opts.path.split('/').pop() : 'Untitled'),
      content: opts.content || '',
      lang: opts.lang || (opts.path ? langOf(opts.path) : 'plaintext'),
      dirty: !!opts.dirty,
      host: null,
      ta: null,
      hl: null,
      gutter: null
    };
    tabs.push(tab);
    openTab(tabs.length - 1);
    refreshTabs();
    return tab;
  }

  function refreshTabs() {
    tabsEl.innerHTML = '';
    for (let i = 0; i < tabs.length; i++) {
      const t = tabs[i];
      const el = document.createElement('div');
      el.className = 'editor-tab' + (i === currentTab ? ' active' : '');
      el.dataset.tabId = t.id;
      el.innerHTML = `
        <span>${escapeHtml(t.name)}</span>
        ${t.dirty ? '<span class="dirty" title="Unsaved"></span>' : ''}
        <button class="tab-close" title="Close">×</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.tab-close')) return;
        openTab(i);
      });
      el.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(i);
      });
      tabsEl.appendChild(el);
    }
  }

  function openTab(i) {
    if (i < 0 || i >= tabs.length) return;
    currentTab = i;
    refreshTabs();
    for (let j = 0; j < tabs.length; j++) {
      const t = tabs[j];
      if (t.host) t.host.style.display = j === i ? 'block' : 'none';
      if (j === i) t.host && t.host.classList.add('active');
      else t.host && t.host.classList.remove('active');
    }
    const t = tabs[i];
    if (!t.host) buildHost(t);
    pathEl.textContent = t.path || '(unsaved)';
    langEl.textContent = t.lang;
    langSelect.value = t.lang;
    refreshHighlight(t);
    updateCursor();
    setTimeout(() => t.ta && t.ta.focus(), 0);
  }

  function buildHost(t) {
    const host = document.createElement('div');
    host.className = 'editor-host active';
    host.style.cssText = 'position:absolute;inset:0;';
    const gutter = document.createElement('div');
    gutter.className = 'editor-gutter';
    const hl = document.createElement('pre');
    hl.className = 'editor-highlight';
    const ta = document.createElement('textarea');
    ta.spellcheck = false;
    ta.wrap = 'off';
    host.appendChild(gutter);
    host.appendChild(hl);
    host.appendChild(ta);
    mainEl.appendChild(host);
    t.host = host;
    t.ta = ta;
    t.hl = hl;
    t.gutter = gutter;

    ta.value = t.content;
    ta.addEventListener('input', () => {
      t.content = ta.value;
      t.dirty = true;
      refreshTabs();
      refreshHighlight(t);
      updateCursor();
    });
    ta.addEventListener('scroll', () => {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    });
    ta.addEventListener('keyup', updateCursor);
    ta.addEventListener('click', updateCursor);
    ta.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); }
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = ta.selectionStart, end = ta.selectionEnd;
        ta.value = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
        ta.selectionStart = ta.selectionEnd = start + 2;
        t.content = ta.value;
        t.dirty = true;
        refreshTabs();
        refreshHighlight(t);
        updateCursor();
      }
    });
  }

  function refreshHighlight(t) {
    if (!t.hl) return;
    t.hl.innerHTML = highlight(t.content, t.lang);
    const lines = t.content.split('\n').length;
    let g = '';
    for (let i = 1; i <= Math.max(lines, 1); i++) g += i + '\n';
    t.gutter.textContent = g;
    sizeEl.textContent = `${t.content.length} chars · ${lines} lines`;
  }

  function updateCursor() {
    const t = tabs[currentTab];
    if (!t || !t.ta) return;
    const v = t.ta.value;
    const pos = t.ta.selectionStart;
    let line = 1, col = 1;
    for (let i = 0; i < pos; i++) { if (v[i] === '\n') { line++; col = 1; } else col++; }
    lnEl.textContent = `Ln ${line}, Col ${col}`;
  }

  async function closeTab(i) {
    const t = tabs[i];
    if (t.dirty && !confirm(`Discard changes to ${t.name}?`)) return;
    if (t.host) t.host.remove();
    tabs.splice(i, 1);
    if (currentTab >= tabs.length) currentTab = tabs.length - 1;
    if (currentTab < 0) {
      mainEl.innerHTML = '<div style="padding:2rem;color:var(--muted);text-align:center">No open files. Use “New” or “Open” to get started.</div>';
      pathEl.textContent = '—';
      langEl.textContent = '—';
      lnEl.textContent = 'Ln 1, Col 1';
      sizeEl.textContent = '0 chars';
    } else {
      openTab(currentTab);
    }
    refreshTabs();
  }

  async function save() {
    const t = tabs[currentTab];
    if (!t) return;
    if (!t.path) {
      const name = prompt('Save as path (under /home/user):', '/home/user/' + (t.name || 'untitled.txt'));
      if (!name) return;
      t.path = name.startsWith('/') ? name : ('/home/user/' + name);
      t.name = t.path.split('/').pop();
    }
    try {
      await api.put('/api/fs/write', { path: t.path, content: t.content });
      t.dirty = false;
      refreshTabs();
      notify.success('Saved', t.path);
    } catch (err) {
      notify.error('Save failed', err.message);
    }
  }

  async function openFile(path) {
    try {
      const r = await api.getRaw('/api/fs/read', { path, encoding: 'utf8' });
      const content = await r.text();
      newTab({ path, content, dirty: false, lang: langOf(path) });
    } catch (err) {
      notify.error('Open failed', err.message);
    }
  }

  async function loadTree(dirPath = '/home/user') {
    treeEl.innerHTML = '';
    try {
      const r = await api.get('/api/fs/list', { query: { path: dirPath } });
      for (const e of r.entries) treeEl.appendChild(treeItem(e, dirPath));
    } catch {}
  }

  function treeItem(entry, basePath) {
    const li = document.createElement('li');
    li.innerHTML = `${icons.get(entry.isDirectory ? 'folder' : 'fileText', { size: 14 })} ${escapeHtml(entry.name)}`;
    li.addEventListener('click', async () => {
      const full = joinPath(basePath, entry.name);
      if (entry.isDirectory) {
        if (li.classList.contains('folder') && li.querySelector('ul')) {
          const ul = li.querySelector('ul');
          ul.style.display = ul.style.display === 'none' ? '' : 'none';
        } else {
          try {
            const r = await api.get('/api/fs/list', { query: { path: full } });
            const ul = document.createElement('ul');
            for (const child of r.entries) ul.appendChild(treeItem(child, full));
            li.appendChild(ul);
          } catch (err) { notify.error('List failed', err.message); }
        }
      } else {
        openFile(full);
      }
    });
    return li;
  }

  function joinPath(base, name) { return base.endsWith('/') ? base + name : base + '/' + name; }

  root.querySelector('[data-act="new"]').addEventListener('click', () => newTab());
  root.querySelector('[data-act="open"]').addEventListener('click', async () => {
    const path = prompt('Open file path:');
    if (path) openFile(path);
  });
  root.querySelector('[data-act="save"]').addEventListener('click', save);

  loadTree();
  if (opts.path) await openFile(opts.path);
  else newTab();
  return win;
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

export default { open };
