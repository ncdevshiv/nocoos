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
  plaintext: 'plaintext', txt: 'plaintext',
  vue: 'html', svelte: 'html'
};

function langOf(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  return LANG_BY_EXT[ext] || 'plaintext';
}

// Tokenizer-based highlighter. Walks the input once, emitting tagged spans.
// Replaces the earlier regex chain with a single-pass tokenizer that
// properly distinguishes strings/comments/keywords. Supports more languages
// than the regex approach and is robust to nested structures.
function escHtml(s) { return s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

// Keyword sets per language. Order doesn't matter; longest-match wins via
// word boundaries in the tokenizer.
const KEYWORDS = {
  javascript: ['const','let','var','function','return','if','else','for','while','switch','case','break','continue','class','new','this','super','extends','import','export','from','as','async','await','yield','try','catch','finally','throw','typeof','instanceof','in','of','null','undefined','true','false','do','default','void','delete','static','get','set'],
  typescript: ['const','let','var','function','return','if','else','for','while','switch','case','break','continue','class','new','this','super','extends','import','export','from','as','async','await','yield','try','catch','finally','throw','typeof','instanceof','in','of','null','undefined','true','false','do','default','void','delete','static','get','set','interface','type','enum','public','private','protected','readonly','implements','namespace','declare','abstract','keyof'],
  python: ['def','class','return','if','elif','else','for','while','import','from','as','try','except','finally','with','yield','async','await','pass','break','continue','in','is','not','and','or','None','True','False','lambda','global','nonlocal','raise','assert'],
  bash: ['if','then','else','elif','fi','for','while','do','done','case','esac','in','function','return','export','local','echo','cd','ls','rm','cp','mv','source','set','unset','readonly','declare','select','until','time'],
  go: ['func','var','const','package','import','return','if','else','for','while','switch','case','break','continue','default','type','struct','interface','map','chan','go','defer','select','fallthrough','range','nil','true','false'],
  rust: ['fn','let','mut','const','static','pub','use','mod','crate','self','super','return','if','else','for','while','loop','match','break','continue','in','as','where','impl','trait','struct','enum','true','false','None','Some','Ok','Err','async','await','move','ref','dyn','unsafe','extern','type'],
  java: ['public','private','protected','static','final','abstract','class','interface','extends','implements','new','this','super','return','if','else','for','while','do','switch','case','break','continue','default','try','catch','finally','throw','throws','void','null','true','false','package','import','enum'],
  sql: ['SELECT','FROM','WHERE','JOIN','LEFT','RIGHT','INNER','OUTER','FULL','ON','AS','AND','OR','NOT','NULL','IS','IN','BETWEEN','LIKE','GROUP','BY','ORDER','HAVING','LIMIT','OFFSET','INSERT','INTO','VALUES','UPDATE','SET','DELETE','CREATE','TABLE','INDEX','DROP','ALTER','ADD','COLUMN','PRIMARY','KEY','FOREIGN','REFERENCES','UNION','ALL','DISTINCT','CASE','WHEN','THEN','ELSE','END'],
  yaml: ['true','false','null','yes','no','on','off']
};

// Identifier pattern (letter or underscore, then word chars).
const IDENT = /[A-Za-z_$][\w$]*/;

// Per-language comment and string configurations.
const LANGS = {
  javascript: { line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'], keywords: 'javascript' },
  typescript: { line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'], keywords: 'typescript' },
  jsx:        { line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'], keywords: 'javascript', html: true },
  tsx:        { line: '//', block: ['/*', '*/'], strings: ['"', "'", '`'], keywords: 'typescript', html: true },
  json:       { strings: ['"'], keywords: 'json' },
  html:       { block: ['<!--', '-->'], strings: ['"', "'"], keywords: null, html: true },
  xml:        { block: ['<!--', '-->'], strings: ['"', "'"], keywords: null, html: true },
  css:        { block: ['/*', '*/'], strings: ['"', "'"], keywords: null },
  scss:       { line: '//', block: ['/*', '*/'], strings: ['"', "'"], keywords: null },
  less:       { line: '//', block: ['/*', '*/'], strings: ['"', "'"], keywords: null },
  python:     { line: '#', block: null, strings: ['"', "'"], keywords: 'python', triple: ['"""', "'''"] },
  bash:       { line: '#', block: null, strings: ['"', "'"], keywords: 'bash' },
  markdown:   { block: null, strings: null, keywords: null, markdown: true },
  yaml:       { line: '#', block: null, strings: ['"', "'"], keywords: 'yaml' },
  sql:        { line: '--', block: ['/*', '*/'], strings: ['"', "'"], keywords: 'sql' },
  go:         { line: '//', block: ['/*', '*/'], strings: ['`', '"'], keywords: 'go', rawStrings: true },
  rust:       { line: '//', block: ['/*', '*/'], strings: ['"'], keywords: 'rust', rawStrings: true },
  java:       { line: '//', block: ['/*', '*/'], strings: ['"', "'"], keywords: 'java' }
};

// Build a Set for fast keyword lookup.
const kwSets = {};
for (const [lang, words] of Object.entries(KEYWORDS)) {
  kwSets[lang] = new Set(words);
}
kwSets.json = new Set(['true', 'false', 'null']);

function highlight(code, lang) {
  const conf = LANGS[lang] || {};
  const kwSet = conf.keywords ? kwSets[conf.keywords] : null;
  const lines = code.split('\n');
  const out = [];

  for (let li = 0; li < lines.length; li++) {
    out.push(highlightLine(lines[li], conf, kwSet, lang));
  }
  return out.join('\n') + '\n';
}

function highlightLine(line, conf, kwSet, lang) {
  // Tokenizer that walks the line character by character. Each token is
  // either a string, comment, number, identifier, or plain text.
  let i = 0;
  const len = line.length;
  let buf = '';
  let result = '';

  function flush() {
    if (!buf) return;
    result += escHtml(buf);
    buf = '';
  }

  while (i < len) {
    const rest = line.slice(i);

    // Line comment
    if (conf.line && rest.startsWith(conf.line)) {
      flush();
      result += `<span class="hl-comment">${escHtml(rest)}</span>`;
      i = len;
      break;
    }

    // Block comment start (only on the line where it begins)
    if (conf.block && rest.startsWith(conf.block[0])) {
      flush();
      const end = line.indexOf(conf.block[1], i + conf.block[0].length);
      if (end !== -1) {
        result += `<span class="hl-comment">${escHtml(line.slice(i, end + conf.block[1].length))}</span>`;
        i = end + conf.block[1].length;
      } else {
        result += `<span class="hl-comment">${escHtml(rest)}</span>`;
        i = len;
      }
      continue;
    }

    // Triple-quoted string (Python)
    if (conf.triple) {
      let matched = false;
      for (const q of conf.triple) {
        if (rest.startsWith(q)) {
          flush();
          const end = line.indexOf(q, i + q.length);
          if (end !== -1) {
            result += `<span class="hl-string">${escHtml(line.slice(i, end + q.length))}</span>`;
            i = end + q.length;
          } else {
            result += `<span class="hl-string">${escHtml(rest)}</span>`;
            i = len;
          }
          matched = true;
          break;
        }
      }
      if (matched) continue;
    }

    // Strings
    if (conf.strings) {
      let matchedStr = false;
      for (const q of conf.strings) {
        if (rest.startsWith(q)) {
          flush();
          // Walk to closing quote, respecting escapes (and raw strings for Go/Rust).
          let j = i + q.length;
          while (j < len) {
            if (conf.rawStrings && q === '`') {
              // raw string: no escapes, ends at matching backtick
              if (line[j] === '`') { j++; break; }
              j++;
            } else {
              if (line[j] === '\\' && j + 1 < len) { j += 2; continue; }
              if (line[j] === q) { j++; break; }
              j++;
            }
          }
          result += `<span class="hl-string">${escHtml(line.slice(i, j))}</span>`;
          i = j;
          matchedStr = true;
          break;
        }
      }
      if (matchedStr) continue;
    }

    // Numbers
    const numMatch = rest.match(/^(?:0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+|\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)/);
    if (numMatch && /[\d.]/.test(line[i])) {
      // Avoid matching a dot that's part of an identifier or method call.
      const prev = i > 0 ? line[i - 1] : '';
      if (i === 0 || !/[A-Za-z_$]/.test(prev)) {
        flush();
        result += `<span class="hl-num">${escHtml(numMatch[0])}</span>`;
        i += numMatch[0].length;
        continue;
      }
    }

    // Identifiers / keywords
    const idMatch = rest.match(IDENT);
    if (idMatch && idMatch.index === 0) {
      const word = idMatch[0];
      // JSON keys (followed by colon, optionally with whitespace)
      if (lang === 'json' && /^\s*:/.test(line.slice(i + word.length))) {
        flush();
        result += `<span class="hl-key">${escHtml(word)}</span>`;
        i += word.length;
        continue;
      }
      if (kwSet && kwSet.has(word)) {
        flush();
        result += `<span class="hl-kw">${escHtml(word)}</span>`;
        i += word.length;
        continue;
      }
    }

    // HTML mode: tag delimiters
    if (conf.html) {
      if (rest.startsWith('</') || rest.startsWith('<')) {
        // Don't tokenize < or <= operators in script blocks; only inside
        // tag positions. Heuristic: highlight if next char is letter or /.
        const next = line[i + 1];
        if (next === '/' || /[A-Za-z!]/.test(next)) {
          flush();
          const close = line.indexOf('>', i);
          if (close !== -1) {
            const tagBody = line.slice(i, close + 1);
            // Inside-tag attributes
            const tagInner = tagBody.replace(/^<\/?/, '').replace(/\/?>$/, '');
            const tagName = tagInner.match(/^[A-Za-z][\w-]*/);
            let html = '<span class="hl-tag">&lt;';
            if (line[i + 1] === '/') html += '/';
            let cursor = i + (line[i + 1] === '/' ? 2 : 1);
            if (tagName) {
              html += `<span class="hl-tag-name">${escHtml(tagName[0])}</span>`;
              cursor += tagName[0].length;
            }
            while (cursor < close) {
              const attrMatch = line.slice(cursor, close).match(/^\s+([A-Za-z_:][\w:.-]*)(=)?/);
              if (attrMatch) {
                html += ' ';
                html += `<span class="hl-attr">${escHtml(attrMatch[1])}</span>`;
                cursor += attrMatch[0].length - (attrMatch[2] ? 1 : 0);
                if (attrMatch[2]) {
                  html += '=';
                  const v = line.slice(cursor, close);
                  const vm = v.match(/^("[^"]*"|'[^']*'|[^\s>]+)/);
                  if (vm) {
                    html += `<span class="hl-string">${escHtml(vm[0])}</span>`;
                    cursor += vm[0].length;
                  }
                }
              } else {
                html += escHtml(line[cursor]);
                cursor++;
              }
            }
            html += '&gt;</span>';
            result += html;
            i = close + 1;
            continue;
          }
        }
      }
    }

    // Markdown headings at line start
    if (conf.markdown && i === 0) {
      const h = rest.match(/^(#{1,6})\s/);
      if (h) {
        flush();
        result += `<span class="hl-kw">${escHtml(rest)}</span>`;
        i = len;
        break;
      }
    }

    buf += line[i];
    i++;
  }
  flush();
  return result;
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
    .hl-tag-name { color: #c084fc; font-weight: 600; }
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
