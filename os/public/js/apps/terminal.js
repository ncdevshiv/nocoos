// Terminal app — uses xterm.js with WebSocket to the server-side PTY bridge.
import icons from '../core/icons.js';
import wm from '../wm.js';
import api from '../core/api.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('terminal', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

export async function open() {
  const win = wm.create({
    appId: 'terminal',
    title: 'Terminal',
    icon: 'terminal',
    iconHtml: ICON_HTML,
    width: 800,
    height: 480,
    minWidth: 480,
    minHeight: 240,
    singleton: false
  });

  const root = document.createElement('div');
  root.className = 'app-terminal';
  root.innerHTML = `
    <div class="terminal-toolbar">
      <button class="icon-button" data-act="new" title="New terminal">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        <span>New</span>
      </button>
      <button class="icon-button" data-act="kill" title="Send Ctrl+C">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="1.5"/></svg>
        <span>Interrupt</span>
      </button>
      <button class="icon-button" data-act="reset" title="Restart shell">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15A9 9 0 1 1 5.64 5.64"/></svg>
        <span>Restart</span>
      </button>
      <span class="spacer"></span>
      <span class="pill" data-role="cwd">~</span>
      <span class="pill" data-role="pid">pid: …</span>
      <span class="pill" data-role="status">connecting…</span>
    </div>
    <div class="terminal-host" data-role="host"></div>
  `;

  win.setContent(root);

  const host = root.querySelector('[data-role="host"]');
  const pillCwd = root.querySelector('[data-role="cwd"]');
  const pillPid = root.querySelector('[data-role="pid"]');
  const pillStatus = root.querySelector('[data-role="status"]');

  let term = null;
  let fitAddon = null;
  let ws = null;
  let termId = null;
  let inputBuffer = '';

  function setStatus(text, kind) {
    pillStatus.textContent = text;
    pillStatus.style.color = kind === 'error' ? 'var(--danger)' : kind === 'ok' ? 'var(--success)' : '';
  }

  async function start() {
    setStatus('starting…');
    try {
      const cols = 100, rows = 30;
      const r = await api.post('/api/terminals', { cols, rows });
      termId = r.id;
      pillCwd.textContent = r.cwd;
    } catch (err) {
      setStatus('failed: ' + err.message, 'error');
      return;
    }
    term = new window.Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#050816',
        foreground: '#e6e8f2',
        cursor: '#22d3ee',
        cursorAccent: '#050816',
        selectionBackground: 'rgba(124,92,255,0.4)',
        black: '#0a0e1f', red: '#f87171', green: '#34d399', yellow: '#fbbf24',
        blue: '#60a5fa', magenta: '#c084fc', cyan: '#22d3ee', white: '#e6e8f2',
        brightBlack: '#475569', brightRed: '#fca5a5', brightGreen: '#6ee7b7',
        brightYellow: '#fde68a', brightBlue: '#93c5fd', brightMagenta: '#d8b4fe',
        brightCyan: '#67e8f9', brightWhite: '#f8fafc'
      }
    });
    fitAddon = new window.FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    const linksAddon = new window.WebLinksAddon.WebLinksAddon();
    term.loadAddon(linksAddon);
    term.open(host);
    try { fitAddon.fit(); } catch {}

    const token = sessionStorage.getItem('nocoos_token') || '';
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws/terminal?id=${encodeURIComponent(termId)}&token=${encodeURIComponent(token)}`;
    ws = new WebSocket(url);

    ws.addEventListener('open', () => {
      setStatus('connected', 'ok');
      try { fitAddon.fit(); ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows })); } catch {}
    });
    ws.addEventListener('close', () => setStatus('disconnected', 'error'));
    ws.addEventListener('error', () => setStatus('error', 'error'));

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.event === 'hello') {
        pillPid.textContent = `pid: ${msg.pid || '-'}`;
        pillCwd.textContent = msg.cwd || '~';
      } else if (msg.event === 'data') {
        term.write(msg.data || '');
      } else if (msg.event === 'exit') {
        setStatus(`exited (${msg.code ?? '?'})`, 'error');
        term.write(`\r\n\x1b[2m[shell exited code=${msg.code ?? '?'}]\x1b[0m\r\n`);
      }
    });

    term.onData((data) => {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'input', data }));
    });

    term.onResize(({ cols, rows }) => {
      if (!ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: 'resize', cols, rows }));
    });

    term.focus();
  }

  async function kill() {
    if (!termId) return;
    try { await api.delete(`/api/terminals/${termId}`); } catch {}
  }

  async function restart() {
    if (ws) try { ws.close(); } catch {}
    if (termId) try { await kill(); } catch {}
    term && term.dispose();
    if (term) { term = null; fitAddon = null; }
    host.innerHTML = '';
    start();
  }

  root.querySelector('[data-act="new"]').addEventListener('click', () => open());
  root.querySelector('[data-act="kill"]').addEventListener('click', () => {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'signal', signal: 'SIGINT' }));
      if (term) term.write('\x03');
    }
  });
  root.querySelector('[data-act="reset"]').addEventListener('click', restart);

  const onResize = () => { try { fitAddon && fitAddon.fit(); } catch {} };
  const ro = new ResizeObserver(onResize);
  ro.observe(host);
  window.addEventListener('resize', onResize);

  win.on('close', async () => {
    ro.disconnect();
    window.removeEventListener('resize', onResize);
    try { ws && ws.close(); } catch {}
    try { term && term.dispose(); } catch {}
    try { await kill(); } catch {}
  });

  await start();
  return win;
}

export default { open };
