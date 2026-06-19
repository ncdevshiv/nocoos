// Browser app — in-OS browser using iframe.
import icons from '../core/icons.js';
import wm from '../wm.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('globe', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

export async function open(opts = {}) {
  const win = wm.create({
    appId: 'browser',
    title: 'Browser',
    icon: 'globe',
    iconHtml: ICON_HTML,
    width: 880,
    height: 560,
    minWidth: 480,
    minHeight: 320,
    singleton: false
  });

  const root = document.createElement('div');
  root.className = 'app-browser';
  root.innerHTML = `
    <div class="browser-bar">
      <button class="icon-button" data-act="back" title="Back"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg></button>
      <button class="icon-button" data-act="forward" title="Forward"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg></button>
      <button class="icon-button" data-act="reload" title="Reload"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 5.64 5.64"/></svg></button>
      <input class="browser-url" data-role="url" placeholder="https://example.com" value="${opts.url || ''}" />
      <button class="btn" data-act="go">Go</button>
    </div>
    <div data-role="content"></div>
  `;
  win.setContent(root);

  const urlInput = root.querySelector('[data-role="url"]');
  const content = root.querySelector('[data-role="content"]');

  function normalizeUrl(input) {
    if (!input) return '';
    const t = input.trim();
    if (!t) return '';
    if (/^https?:\/\//i.test(t)) return t;
    if (/^[a-z]+:\/\//i.test(t)) return t;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(t)) return 'https://' + t;
    return 'https://www.google.com/search?q=' + encodeURIComponent(t);
  }

  function load(url) {
    const normalized = normalizeUrl(url);
    urlInput.value = normalized;
    win.setTitle(`Browser — ${normalized}`);
    content.innerHTML = '';
    if (!normalized) {
      content.innerHTML = `<div class="browser-empty"><h2>Browser</h2><p>Type a URL above to navigate.</p></div>`;
      return;
    }
    const iframe = document.createElement('iframe');
    iframe.className = 'browser-frame';
    iframe.src = normalized;
    iframe.referrerPolicy = 'no-referrer';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.addEventListener('load', () => win.setTitle(`Browser — ${normalized}`));
    iframe.addEventListener('error', () => {
      content.innerHTML = `<div class="browser-empty"><h2>Failed to load</h2><p>The page could not be displayed. Many sites block embedding via X-Frame-Options.</p></div>`;
    });
    content.appendChild(iframe);
  }

  root.querySelector('[data-act="go"]').addEventListener('click', () => load(urlInput.value));
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') load(urlInput.value); });
  root.querySelector('[data-act="reload"]').addEventListener('click', () => load(urlInput.value));

  if (opts.url) load(opts.url);
  else content.innerHTML = `<div class="browser-empty">
    <h2>Browser</h2>
    <p>Type a URL or search above. Many sites block embedding — try search engines, raw GitHub, or documentation sites.</p>
    <div style="display:flex;gap:0.5rem;flex-wrap:wrap;justify-content:center;margin-top:0.5rem">
      <button class="btn-ghost" data-quick="https://github.com">GitHub</button>
      <button class="btn-ghost" data-quick="https://developer.mozilla.org">MDN</button>
      <button class="btn-ghost" data-quick="https://nodejs.org/en/docs">Node.js Docs</button>
      <button class="btn-ghost" data-quick="https://wikipedia.org">Wikipedia</button>
    </div>
  </div>`;
  root.querySelectorAll('[data-quick]').forEach((b) => {
    b.addEventListener('click', () => load(b.dataset.quick));
  });

  return win;
}

export default { open };
