// Error reporter + overlay. Loaded as a regular <script> (NOT a module) at the top of
// <head> so it works even when subsequent ES modules fail to parse. Catches:
//   - <script> onerror (parse failures, 404s)
//   - window.onerror (runtime errors)
//   - window.onunhandledrejection (promise rejections)
//   - import() dynamic load failures
// Sends to /api/client-errors via sendBeacon (survives unload) and renders an overlay.
(function () {
  'use strict';

  const ORIGIN = location.origin;
  const ENDPOINT = ORIGIN + '/api/client-errors';
  const MAX_HISTORY = 20;

  const state = {
    history: [],
    overlay: null
  };

  function nowIso() { return new Date().toISOString(); }

  function describe(err, source, lineno, colno) {
    const out = {
      kind: 'runtime',
      message: '',
      file: null,
      line: null,
      col: null,
      stack: null,
      url: location.href,
      userAgent: navigator.userAgent,
      ts: Date.now()
    };
    if (source === 'script-error') {
      out.kind = 'script';
      out.message = 'Script load or parse error (likely syntax error in a module)';
      out.file = 'unknown';
      out.line = lineno || null;
      out.col = colno || null;
      return out;
    }
    if (err && err.stack) {
      out.stack = String(err.stack);
      const m = String(err.stack).match(/at\s+(?:.*?\s+\()?(.+?):(\d+):(\d+)/);
      if (m) { out.file = m[1]; out.line = +m[2]; out.col = +m[3]; }
    }
    if (err && err.message) out.message = String(err.message);
    else if (typeof err === 'string') out.message = err;
    else out.message = String(err || 'Unknown error');
    if (source === 'unhandledrejection') out.kind = 'unhandledrejection';
    if (source === 'import') out.kind = 'import';
    if (lineno) out.line = lineno;
    if (colno) out.col = colno;
    if (source) out.file = source;
    return out;
  }

  function send(payload) {
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: 'application/json' });
        const ok = navigator.sendBeacon(ENDPOINT, blob);
        if (ok) return;
      }
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
    } catch {}
  }

  function pushHistory(p) {
    state.history.unshift(p);
    if (state.history.length > MAX_HISTORY) state.history.pop();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function renderOverlay() {
    if (state.overlay) return state.overlay;
    const el = document.createElement('div');
    el.id = 'nocoos-error-overlay';
    el.style.cssText = 'position:fixed;inset:0;background:rgba(8,10,22,0.92);color:#f1f5f9;z-index:2147483647;display:flex;flex-direction:column;font:13px/1.5 ui-monospace,"SF Mono",Menlo,Consolas,monospace;backdrop-filter:blur(8px);';
    document.documentElement.appendChild(el);
    state.overlay = el;
    return el;
  }

  function showOverlay(payload) {
    pushHistory(payload);
    const el = renderOverlay();
    const items = state.history.slice(0, 6).map((p, i) => `
      <div style="border:1px solid rgba(239,68,68,0.4);background:rgba(239,68,68,0.08);border-radius:8px;padding:0.75rem 1rem;margin-bottom:0.5rem">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;margin-bottom:0.3rem">
          <strong style="color:#fca5a5;font-size:0.95rem">[${escapeHtml(p.kind)}] ${escapeHtml((p.message || '').slice(0, 200))}</strong>
          <span style="color:#94a3b8;font-size:0.75rem">${new Date(p.ts).toLocaleTimeString()}</span>
        </div>
        ${p.file ? `<div style="color:#cbd5e1;font-size:0.8rem;margin-bottom:0.2rem">at <code style="background:rgba(255,255,255,0.06);padding:0.05rem 0.4rem;border-radius:4px">${escapeHtml(p.file)}${p.line ? ':' + p.line + (p.col ? ':' + p.col : '') : ''}</code></div>` : ''}
        ${p.stack ? `<details style="margin-top:0.3rem"><summary style="cursor:pointer;color:#94a3b8;font-size:0.78rem">stack trace</summary><pre style="white-space:pre-wrap;word-break:break-all;margin:0.4rem 0 0;padding:0.5rem;background:rgba(0,0,0,0.4);border-radius:6px;font-size:0.75rem;color:#cbd5e1">${escapeHtml(p.stack.slice(0, 2000))}</pre></details>` : ''}
      </div>
    `).join('');

    el.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:0.85rem 1.25rem;background:rgba(239,68,68,0.18);border-bottom:1px solid rgba(239,68,68,0.5)">
        <div style="display:flex;align-items:center;gap:0.6rem">
          <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ef4444;box-shadow:0 0 12px #ef4444"></span>
          <strong style="color:#fca5a5;font-size:1rem">NocoOS — Frontend error</strong>
        </div>
        <div style="display:flex;gap:0.5rem">
          <button id="nocoos-err-copy" style="background:transparent;border:1px solid rgba(255,255,255,0.18);color:#cbd5e1;padding:0.35rem 0.85rem;border-radius:6px;cursor:pointer;font-size:0.8rem">Copy</button>
          <button id="nocoos-err-dismiss" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.18);color:#cbd5e1;padding:0.35rem 0.85rem;border-radius:6px;cursor:pointer;font-size:0.8rem">Dismiss</button>
          <button id="nocoos-err-reload" style="background:linear-gradient(135deg,#7c5cff,#22d3ee);border:none;color:white;padding:0.35rem 0.85rem;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600">Reload</button>
        </div>
      </div>
      <div style="flex:1;overflow:auto;padding:1rem 1.25rem">
        ${items || '<div style="color:#94a3b8">No errors yet.</div>'}
      </div>
      <div style="padding:0.5rem 1.25rem;border-top:1px solid rgba(255,255,255,0.08);color:#64748b;font-size:0.75rem">
        Errors auto-reported to server. Open DevTools (F12) for full network log.
      </div>
    `;

    const dismiss = el.querySelector('#nocoos-err-dismiss');
    const reload = el.querySelector('#nocoos-err-reload');
    const copy = el.querySelector('#nocoos-err-copy');
    if (dismiss) dismiss.addEventListener('click', () => { el.style.display = 'none'; });
    if (reload) reload.addEventListener('click', () => location.reload());
    if (copy) copy.addEventListener('click', () => {
      const text = state.history.map((p) => `[${p.kind}] ${p.message}\n  at ${p.file || '?'}${p.line ? ':' + p.line : ''}\n  ${(p.stack || '').split('\n').slice(0, 5).join('\n  ')}`).join('\n\n');
      navigator.clipboard?.writeText(text).catch(() => {});
    });
  }

  function report(payload) {
    try { send(payload); } catch {}
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => showOverlay(payload), { once: true });
    } else {
      showOverlay(payload);
    }
  }

  // <script> tag errors fire as "error" events on window with no error/lineno.
  window.addEventListener('error', function (ev) {
    if (ev.target && (ev.target.tagName === 'SCRIPT' || ev.target.tagName === 'LINK' || ev.target.tagName === 'IMG')) {
      const p = describe(ev, ev.target.src || ev.target.href || 'script-error', ev.lineno || 0, ev.colno || 0);
      if (ev.target.tagName === 'SCRIPT') {
        p.kind = 'script';
        p.message = 'Script failed to load or parse: ' + (ev.target.src || '<inline>');
      }
      report(p);
      return;
    }
    report(describe(ev.error || ev.message, ev.filename || null, ev.lineno, ev.colno));
  }, true);

  window.addEventListener('unhandledrejection', function (ev) {
    const reason = ev.reason;
    report(describe(reason, 'unhandledrejection'));
  });

  // Dynamic import() failures
  window.addEventListener('error', function (ev) {
    if (ev.message && /Importing a module script failed/i.test(ev.message)) {
      report(describe(ev.message || 'import failed', 'import'));
    }
  });

  // Expose a manual reporter for app code
  window.NocoOSErrorReporter = { report, showOverlay, history: () => state.history.slice() };
})();
