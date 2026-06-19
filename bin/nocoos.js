#!/usr/bin/env node
// NocoOS CLI: launch an instance, become manager, or query status.
//
// Usage:
//   node bin/nocoos.js                    # spawn instance "default" (or attach if already up)
//   node bin/nocoos.js --name foo         # spawn instance "foo" with auto-port
//   node bin/nocoos.js --manager          # launch manager UI on a new port
//   node bin/nocoos.js --status           # print running instances and exit
//   node bin/nocoos.js --stop <name>      # stop a running instance by name
//   node bin/nocoos.js --attach           # never spawn, always attach to running manager

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

function parseArgs(argv) {
  const args = { name: null, port: null, manager: false, status: false, stop: null, attach: false, help: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name' || a === '-n') args.name = argv[++i];
    else if (a === '--port' || a === '-p') args.port = argv[++i];
    else if (a === '--manager' || a === '-m') args.manager = true;
    else if (a === '--status' || a === '-s') args.status = true;
    else if (a === '--stop') args.stop = argv[++i];
    else if (a === '--attach') {
      // --attach [name] — bare flag attaches to "default", explicit name attaches to that instance
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args.attach = argv[++i];
      } else {
        args.attach = true;
      }
    }
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log(`nocoos — Node.js desktop OS manager

Usage:
  node bin/nocoos.js                       Launch default instance
  node bin/nocoos.js --name foo            Launch instance "foo"
  node bin/nocoos.js --port 4000           Use specific port (default: auto-allocate)
  node bin/nocoos.js --manager             Launch manager UI (lists running instances)
  node bin/nocoos.js --status              Print running instances and exit
  node bin/nocoos.js --stop <name>         Stop instance <name>
  node bin/nocoos.js --attach [name]       Attach to a running instance's admin shell

Environment:
  NOCOOS_PORT        Port to bind (overridden by --port)
  NOCOOS_INSTANCE_NAME  Instance name (overridden by --name)
  NOCOOS_AUTO_PORT=1  Auto-allocate a free port
  NOCOOS_HMR=1        Enable frontend hot reload
  NOCOOS_LINT=1       Enable JS syntax lint middleware
  NOCOOS_LOG_FORMAT   "text" or "json"
`);
}

async function readRegistry() {
  const regPath = path.join(ROOT, '.nocoos-registry.json');
  if (!existsSync(regPath)) return { instances: [] };
  try {
    const data = JSON.parse(await (await import('node:fs/promises')).readFile(regPath, 'utf8'));
    return data;
  } catch { return { instances: [] }; }
}

function isAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

async function printStatus() {
  const { instances } = await readRegistry();
  if (!instances.length) {
    console.log('No running instances.');
    return;
  }
  console.log('Running instances:\n');
  const w = (s, n) => String(s).padEnd(n);
  console.log(w('NAME', 16) + w('PORT', 8) + w('PID', 8) + w('STATUS', 12) + 'AGE');
  console.log('-'.repeat(60));
  for (const inst of instances) {
    const alive = isAlive(inst.pid);
    const age = inst.lastSeen ? Math.round((Date.now() - Date.parse(inst.lastSeen)) / 1000) + 's' : '?';
    console.log(w(inst.name, 16) + w(inst.port, 8) + w(inst.pid, 8) + w(alive ? 'running' : 'stale', 12) + age);
  }
}

async function stopInstance(name) {
  const { instances } = await readRegistry();
  const inst = instances.find((i) => i.name === name);
  if (!inst) {
    console.error(`No instance named "${name}" found.`);
    process.exit(1);
  }
  // Always remove from registry immediately — on Windows SIGTERM is force-kill
  // (no graceful shutdown handler runs), so the server can't clean itself up.
  const { default: registry } = await import('../os/src/kernel/registry.js');
  registry.remove(name);
  if (!isAlive(inst.pid)) {
    console.log(`Instance "${name}" (pid ${inst.pid}) was not running. Registry entry cleared.`);
    return;
  }
  console.log(`Stopping instance "${name}" (pid ${inst.pid})...`);
  try { process.kill(inst.pid); }
  catch (err) {
    console.error('Failed to stop:', err.message);
    process.exit(1);
  }
  for (let i = 0; i < 30; i++) {
    if (!isAlive(inst.pid)) {
      console.log(`Stopped.`);
      return;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  console.log(`Process did not exit; check pid ${inst.pid}.`);
}

// --attach <name>: open an admin WebSocket to a running instance's /ws/shell
// and pipe stdin/stdout. Reuses the server's admin-only shell binding from
// Phase 1.6 — a username/password prompt is required, and only admin sessions
// can attach. Useful for live triage of a remote instance.
async function attachInstance(name) {
  const { instances } = await readRegistry();
  const inst = instances.find((i) => i.name === name);
  if (!inst) {
    console.error(`No instance named "${name}" found.`);
    process.exit(1);
  }
  if (!isAlive(inst.pid)) {
    console.error(`Instance "${name}" is not running.`);
    process.exit(1);
  }
  const WebSocket = (await import('ws')).default;
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

  const username = await new Promise((resolve) => rl.question('username: ', resolve));
  const password = await new Promise((resolve) => rl.question('password: ', (a) => resolve(a)));

  const loginRes = await fetch(`http://localhost:${inst.port}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password })
  });
  if (!loginRes.ok) {
    console.error(`Login failed: ${loginRes.status}`);
    process.exit(1);
  }
  const { token, user } = await loginRes.json();
  if (!user.isAdmin) {
    console.error('Attach requires an admin account.');
    process.exit(1);
  }

  const ws = new WebSocket(`ws://localhost:${inst.port}/ws/shell?token=${encodeURIComponent(token)}`);
  ws.on('open', () => {
    console.log(`[attached to "${name}"]`);
    console.log('Type code to eval, "exec <cmd>" to run, "exit" to detach.\n');
  });
  ws.on('message', (raw) => {
    try {
      const m = JSON.parse(raw.toString());
      if (m.event === 'hello') console.log(m.prompt || '');
      else if (m.event === 'data') process.stdout.write(m.text);
      else if (m.event === 'result') console.log('\n=> ' + (m.value !== undefined ? m.value : m.error));
      else if (m.event === 'exit') console.log(`\n[exit ${m.code}]`);
      else if (m.event === 'error') console.error('\n[error] ' + m.error);
    } catch { /* ignore */ }
  });
  ws.on('close', () => { console.log('\n[detached]'); process.exit(0); });
  ws.on('error', (err) => { console.error('ws error:', err.message); process.exit(1); });

  rl.on('line', (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    if (trimmed === 'exit' || trimmed === 'quit') { ws.close(); return; }
    if (trimmed.startsWith('exec ')) {
      const rest = trimmed.slice(5);
      const parts = rest.split(/\s+/);
      ws.send(JSON.stringify({ type: 'exec', command: parts[0], args: parts.slice(1) }));
    } else {
      ws.send(JSON.stringify({ type: 'eval', code: line }));
    }
  });
}

function spawnServer(args, extraEnv = {}) {
  const env = {
    ...process.env,
    NOCOOS_INSTANCE_NAME: args.name || 'default',
    NOCOOS_AUTO_PORT: '1',
    NOCOOS_LOG_LEVEL: process.env.NOCOOS_LOG_LEVEL || 'info',
    ...extraEnv
  };
  if (args.port) env.NOCOOS_PORT = String(args.port);
  if (args.manager) env.NOCOOS_MANAGER = '1';

  const child = spawn(process.execPath, [path.join(ROOT, 'os', 'server.js')], {
    cwd: ROOT,
    env,
    stdio: 'inherit'
  });
  return child;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); return; }
  if (args.status) { await printStatus(); return; }
  if (args.stop) { await stopInstance(args.stop); return; }
  if (args.attach) {
    if (typeof args.attach === 'string') {
      await attachInstance(args.attach);
    } else {
      // --attach without a name → attach to default
      await attachInstance('default');
    }
    return;
  }

  if (args.manager) {
    // Manager UI: server with manager-only flag, no real OS instance.
    console.log('Launching manager UI...');
    const child = spawnServer(args, { NOCOOS_MANAGER_ONLY: '1' });
    child.on('exit', (code) => process.exit(code ?? 0));
    return;
  }

  // Default behavior: spawn an instance. If a registry already has matching
  // instance running, attach (just print info, don't spawn duplicate).
  const { instances } = await readRegistry();
  const targetName = args.name || 'default';
  const existing = instances.find((i) => i.name === targetName);
  if (existing && isAlive(existing.pid)) {
    console.log(`Instance "${targetName}" is already running at http://localhost:${existing.port} (pid ${existing.pid}).`);
    console.log('Use --status to list all instances, --manager to open the dashboard, or --stop to terminate.');
    return;
  }

  console.log(`Spawning instance "${targetName}"...`);
  const child = spawnServer(args);
  child.on('exit', (code) => process.exit(code ?? 0));
}

main().catch((err) => {
  console.error('nocoos:', err.message);
  process.exit(1);
});
