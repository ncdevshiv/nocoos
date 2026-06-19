// HMR client: connects to /ws/hmr, listens for reload events, soft-reloads the page.
(function () {
  'use strict';

  const ENABLED = document.documentElement.dataset.hmr === '1';
  if (!ENABLED) return;
  if (!('WebSocket' in window)) return;

  let ws = null;
  let reconnectTimer = null;
  let suppressReload = false;
  let attempts = 0;
  const MAX_ATTEMPTS = 3;

  function showBanner(text, kind) {
    let banner = document.getElementById('hmr-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'hmr-banner';
      banner.style.cssText = 'position:fixed;bottom:64px;left:50%;transform:translateX(-50%);background:rgba(15,20,38,0.95);border:1px solid rgba(124,92,255,0.5);color:#fff;padding:0.5rem 1rem;border-radius:8px;font-family:ui-monospace,monospace;font-size:0.8rem;z-index:99999;box-shadow:0 8px 24px rgba(0,0,0,0.45);transition:opacity 0.2s ease';
      document.body.appendChild(banner);
    }
    banner.textContent = text;
    banner.style.opacity = '1';
    banner.style.background = kind === 'reloaded' ? 'rgba(34,197,94,0.85)' : kind === 'error' ? 'rgba(239,68,68,0.85)' : 'rgba(15,20,38,0.95)';
  }

  function hideBanner() {
    const banner = document.getElementById('hmr-banner');
    if (banner) banner.style.opacity = '0';
  }

  function giveUp() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    console.log('[hmr] giving up — server has no HMR endpoint');
  }

  function connect() {
    if (attempts >= MAX_ATTEMPTS) return giveUp();
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    attempts++;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws/hmr`;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      console.warn('[hmr] connect failed', err);
      scheduleReconnect();
      return;
    }
    ws.addEventListener('open', () => {
      attempts = 0;
      console.log('[hmr] connected');
      hideBanner();
    });
    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.type === 'hello') {
        console.log('[hmr] server hello');
      } else if (msg.type === 'syntax-error') {
        console.warn('[hmr] syntax error(s) detected — NOT reloading', msg.errors);
        if (window.NocoOSErrorReporter) {
          for (const err of (msg.errors || [])) {
            window.NocoOSErrorReporter.report({
              kind: 'syntax',
              message: err.message || 'syntax error',
              file: err.path,
              line: err.line,
              col: err.column,
              url: location.href,
              userAgent: navigator.userAgent,
              ts: Date.now()
            });
          }
        }
      } else if (msg.type === 'reload') {
        const paths = (msg.events || []).map((e) => e.path).filter(Boolean);
        if (suppressReload) {
          console.log('[hmr] suppressed reload (we are the trigger)', paths);
          return;
        }
        showBanner(`Reloading — ${paths.length || 1} file${paths.length === 1 ? '' : 's'} changed`, 'reloaded');
        setTimeout(() => {
          try { window.location.reload(); } catch (err) { console.error('[hmr] reload failed', err); }
        }, 120);
      }
    });
    ws.addEventListener('close', (ev) => {
      if (ev && ev.code === 1008) return giveUp();
      if (attempts >= MAX_ATTEMPTS) return giveUp();
      scheduleReconnect();
    });
    ws.addEventListener('error', () => {
      showBanner('HMR connection error — retrying…', 'error');
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    if (attempts >= MAX_ATTEMPTS) return giveUp();
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, 2000);
  }

  window.addEventListener('beforeunload', () => {
    suppressReload = true;
  });

  connect();
})();
