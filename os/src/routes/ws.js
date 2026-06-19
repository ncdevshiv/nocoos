import { WebSocketServer } from 'ws';
import { URL } from 'node:url';
import { spawn } from 'node:child_process';
import sessionMgr from '../kernel/session.js';
import termMgr from '../kernel/terminal.js';
import pkg from '../kernel/package-manager.js';
import logger from '../utils/logger.js';

const log = logger.make('ws');

function authFromRequest(req) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const proto = req.headers['sec-websocket-protocol'];
    let token = url.searchParams.get('token');
    if (!token && proto) {
      const parts = proto.split(',').map((p) => p.trim());
      const t = parts.find((p) => p.startsWith('token='));
      if (t) token = t.slice(6);
    }
    if (!token) token = req.headers['authorization']?.toString().replace(/^Bearer\s+/i, '') || '';
    if (!token) return null;
    return sessionMgr.resolve(token);
  } catch {
    return null;
  }
}

function safeSend(ws, payload) {
  if (ws.readyState !== 1) return false;
  try {
    ws.send(JSON.stringify(payload));
    return true;
  } catch (err) {
    log.warn('send failed', { err: err.message });
    return false;
  }
}

function bindTerminal(ws, sessionId) {
  const session = termMgr.get(sessionId);
  if (!session) {
    safeSend(ws, { event: 'error', error: 'terminal_not_found' });
    return () => {};
  }
  safeSend(ws, { event: 'hello', id: session.id, shell: session.shell, cwd: session.cwd, cols: session.cols, rows: session.rows, pid: session.proc?.pid });
  const off = session.on(({ event, ...rest }) => {
    safeSend(ws, { event, ...rest });
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'input') session.write(msg.data || '');
    else if (msg.type === 'resize') session.resize(msg.cols || 80, msg.rows || 24);
    else if (msg.type === 'signal') session.kill(msg.signal || 'SIGTERM');
  });
  return () => off();
}

function bindPackage(ws, jobId) {
  const job = pkg.jobs.get(jobId);
  if (!job) {
    safeSend(ws, { event: 'error', error: 'job_not_found' });
    return () => {};
  }
  safeSend(ws, { event: 'hello', jobId, manager: job.manager, args: job.args, cwd: job.cwd });
  pkg.runJob(job, {
    onData: ({ stream, text }) => safeSend(ws, { event: 'data', stream, text }),
    onExit: ({ code, signal }) => safeSend(ws, { event: 'exit', code, signal })
  });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'cancel') pkg.cancelJob(jobId);
  });
  return () => {};
}

function bindShell(ws) {
  let buffer = '';
  safeSend(ws, { event: 'hello', prompt: 'nocoos-shell>' });
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (msg.type === 'eval') {
      try {
        const result = (0, eval)(msg.code);
        safeSend(ws, { event: 'result', value: typeof result === 'object' ? JSON.stringify(result) : String(result) });
      } catch (err) {
        safeSend(ws, { event: 'result', error: err.message });
      }
    } else if (msg.type === 'exec') {
      const child = spawn(msg.command, msg.args || [], { shell: true });
      child.stdout.on('data', (d) => safeSend(ws, { event: 'data', stream: 'stdout', text: d.toString() }));
      child.stderr.on('data', (d) => safeSend(ws, { event: 'data', stream: 'stderr', text: d.toString() }));
      child.on('exit', (code) => safeSend(ws, { event: 'exit', code }));
    }
  });
  return () => {};
}

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://localhost');
    // HMR is an unauthenticated public channel — let the HMR handler deal with it.
    if (url.pathname === '/ws/hmr') return;
    const session = authFromRequest(req);
    if (!session) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userSession = session;
      if (url.pathname === '/ws/terminal') {
        const id = url.searchParams.get('id');
        if (!id) {
          safeSend(ws, { event: 'error', error: 'missing_terminal_id' });
          return ws.close();
        }
        bindTerminal(ws, id);
      } else if (url.pathname === '/ws/pkg') {
        const jobId = url.searchParams.get('id');
        if (!jobId) {
          safeSend(ws, { event: 'error', error: 'missing_job_id' });
          return ws.close();
        }
        bindPackage(ws, jobId);
      } else if (url.pathname === '/ws/shell') {
        bindShell(ws);
      } else {
        safeSend(ws, { event: 'error', error: 'unknown_channel' });
        ws.close();
      }
      ws.on('close', () => log.debug('ws closed', { url: url.pathname }));
    });
  });

  return wss;
}
