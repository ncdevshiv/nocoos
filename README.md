# NocoOS

A complete Node.js desktop operating environment that runs in your browser. NocoOS gives you a windowed desktop, a virtual filesystem, a real shell terminal, a file manager, a code editor, a one-click package installer, plus production-grade observability and a manager CLI for running multiple isolated instances side-by-side — all running on Node.js.

## Quick start

```bash
pnpm install
pnpm nocoos                  # spawn default instance, auto-allocate port
```

The CLI prints the URL (typically `http://localhost:3000`). Open it in a browser → log in as **`user`** / **`nocoos`**.

Default credentials: **`user`** / **`nocoos`**.

## Running multiple instances (parallel OSes)

```bash
pnpm nocoos                      # default instance, auto-allocated port
pnpm nocoos --name alpha         # second instance on a different port
pnpm nocoos --name beta          # third instance
pnpm nocoos --port 4000          # bind a specific port
pnpm nocoos --status             # list all running instances
pnpm nocoos --stop alpha         # stop instance by name
pnpm nocoos --manager            # launch the manager dashboard (UI lists instances)
NOCOOS_INSTANCE_NAME=gamma pnpm nocoos   # one-off via env var
```

Open `http://localhost:<port>/manager` on any instance to see a live dashboard of all instances (their ports, PIDs, heartbeat age, status). Buttons to open, copy URL, or stop each one.

Each instance has:
- its own data directory (`os/data-<name>/` — `os/data/` for the default `name=default`)
- its own lock file at `<dataDir>/.lock` — refuses to start a second instance pointing at the same dir
- its own auto-allocated port (3000+)
- its own entry in the cross-instance registry at `<project>/.nocoos-registry.json`

## What you get

- **Boot → Login → Desktop** flow with animated boot screen.
- **Window manager** with drag, resize (8 directions), minimize, maximize, focus, and taskbar integration.
- **Taskbar** with Start button, search, running apps, system tray (CPU/MEM), clock.
- **Start menu** with pinned apps, searchable list, lock/logout/restart actions.
- **Manager dashboard** at `/manager` — lists all running instances across the project, lets you stop/copy/open them.
- **Built-in apps**:
  - **Terminal** — xterm.js connected to a real shell (`cmd.exe` on Windows, `/bin/sh` on Unix) via WebSocket. VFS-path translation (`cd /apps/foo` works).
  - **Files** — browse, open, rename, delete, upload, download files in your virtual filesystem.
  - **Code Editor** — multi-tab text editor with line numbers, tabs, save (Ctrl+S), regex-based syntax highlighting.
  - **App Installer** — install packages via npm, pnpm, yarn or bun, run scripts, view installed deps.
  - **System Monitor** — CPU, memory, processes with kill control.
  - **Browser** — embedded iframe browser with URL bar.
  - **Settings** — appearance, accounts, system info, detected package tools.
  - **About** — system summary.
- **Run dialog** (Enter from taskbar search) — launches apps, files, or shell commands.

## Virtual filesystem

Rooted at `os/data/` (or `os/data-<name>/` for named instances):
- `/home/user` — your home (Documents, Projects, Downloads).
- `/apps` — installed packages and workspaces.
- `/system` — internal state (users, info).
- `/host` — the host filesystem (read-write; the parent of the project root).
- `/tmp` — temporary files.

The terminal auto-translates VFS paths (`/apps/foo`) to real host paths before sending to the shell.

## Architecture

```
nocoos/
├── package.json                  # pnpm workspace root + scripts (start, dev, test, lint, nocoos)
├── pnpm-workspace.yaml
├── .env.example                  # all config vars documented
├── mpr.md                        # Master Execution Policy (rules we follow)
├── .nocoos-registry.json         # cross-instance registry (auto-generated, gitignored)
├── bin/
│   └── nocoos.js                 # CLI: spawn, stop, status, manager
├── os/
│   ├── server.js                 # main entry — lock, port, registry, server
│   ├── package.json
│   ├── src/
│   │   ├── kernel/
│   │   │   ├── config.js         # ROOT + env-derived paths (dataDir per instance)
│   │   │   ├── vfs.js            # virtual filesystem (two-root: / and /host)
│   │   │   ├── lock.js           # per-instance lock file
│   │   │   ├── port-finder.js   # auto-allocate free TCP port
│   │   │   ├── registry.js       # cross-instance registry + heartbeat
│   │   │   ├── session.js        # bearer-token auth, SHA-256 hashed passwords
│   │   │   ├── process-manager.js
│   │   │   ├── package-manager.js # npm/pnpm/yarn/bun via child_process
│   │   │   ├── app-registry.js   # built-in + user-installed apps
│   │   │   ├── terminal.js       # PTY-style terminal sessions + VFS path translator
│   │   │   ├── parser.js         # node --check based JS syntax validator
│   │   │   ├── metrics.js        # Prometheus-format metrics registry
│   │   │   └── system-info.js
│   │   ├── routes/
│   │   │   ├── api.js            # Express REST API
│   │   │   ├── ws.js             # /ws/terminal, /ws/pkg (authenticated)
│   │   │   └── hmr.js            # /ws/hmr (unauthenticated) + file watcher
│   │   └── utils/
│   │       └── logger.js         # text/JSON formatter, redaction, env-gated levels
│   └── public/                   # static frontend (HTML + CSS + JS modules)
│       ├── boot.html  login.html  desktop.html  manager.html
│       ├── css/                   # base, desktop, window, taskbar, apps, manager, boot, login
│       └── js/
│           ├── boot.js login.js desktop.js wm.js taskbar.js startmenu.js
│           ├── contextmenu.js manager.js error-reporter.js hmr-client.js
│           ├── core/  api.js notify.js icons.js
│           └── apps/  terminal filemanager editor installer settings monitor browser about launcher
└── tests/                        # 73 node:test unit tests (kernel + integration)
```

### Backend (Node.js)

- **Express** for HTTP API and static asset serving.
- **ws** for WebSocket channels (terminal, package install, HMR).
- **child_process.spawn** with `shell: true` for shell sessions — works on Windows and Unix.
- **Prometheus-format metrics** via custom in-process registry (no external dep).
- **Structured JSON logs** with secret redaction.

### Frontend (browser)

- Vanilla ES modules — no build step.
- xterm.js loaded from CDN for the terminal renderer.
- Custom window manager handles all windowing.
- Each app is a self-contained ES module registered in `os/src/kernel/app-registry.js`.

## Configuration

Copy `.env.example` to `.env` and customize, or set inline.

| Variable | Default | Description |
|----------|---------|-------------|
| `NOCOOS_PORT` | 3000 | HTTP port (overridden by `--port` or auto-allocate) |
| `NOCOOS_HOST` | 0.0.0.0 | Bind address |
| `NOCOOS_SESSION_SECRET` | _(dev default)_ | Secret for session tokens — change for production |
| `NOCOOS_MAX_TERMINALS` | 8 | Concurrent terminal sessions |
| `NOCOOS_INSTANCE_NAME` | `default` | Per-instance name → data dir is `os/data-<name>/` |
| `NOCOOS_DATA_DIR` | _(auto)_ | Override data dir (absolute path) |
| `NOCOOS_APPS_DIR` | `<dataDir>/apps` | Where installed packages live |
| `NOCOOS_AUTO_PORT` | `0` | Set to `1` to scan for a free port (CLI sets this) |
| `NOCOOS_LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `NOCOOS_LOG_FORMAT` | `text` | `text` (human) or `json` (machine) |
| `NOCOOS_LOG_FILE` | _(none)_ | Append logs to this file |
| `NOCOOS_HMR` | `0` | Set to `1` to enable frontend hot reload |
| `NOCOOS_LINT` | `0` | Set to `1` to enable JS syntax lint middleware (returns 500 on bad JS) |

## Observability

### Metrics

`GET /metrics` returns Prometheus text format. `GET /api/metrics/snapshot` returns JSON.

| Metric | Type | Labels | Description |
|---|---|---|---|
| `nocoos_uptime_seconds` | gauge | — | Server uptime |
| `nocoos_memory_rss_bytes` / `_heap_used_bytes` / `_heap_total_bytes` / `_external_bytes` | gauge | — | Node memory |
| `nocoos_host_memory_total_bytes` / `_free_bytes` | gauge | — | Host memory |
| `nocoos_host_load_average` | gauge | `period` | 1/5/15 min load |
| `nocoos_host_cpu_count` | gauge | — | Logical CPU count |
| `nocoos_terminals_active` / `_total` | gauge | — | Terminal sessions |
| `nocoos_processes_total` | gauge | `kind` | Tracked processes |
| `nocoos_http_requests_total` | counter | `method`, `route`, `status` | HTTP requests |
| `nocoos_http_errors_total` | counter | `method`, `route`, `status` | 4xx/5xx |
| `nocoos_http_request_duration_seconds` | histogram | `method`, `route` | Request latency |
| `nocoos_auth_logins_total` | counter | `outcome` | Login attempts |
| `nocoos_ws_connections_total` | counter | `channel`, `result` | WS connections |
| `nocoos_fs_operations_total` | counter | `op` | VFS ops |
| `nocoos_pkg_jobs_total` | counter | `manager`, `status` | Package job results |
| `nocoos_client_errors_total` | counter | `kind`, `file` | Browser-side errors reported via `/api/client-errors` |
| `nocoos_syntax_errors_total` | counter | `file` | JS syntax errors detected by the server (lint or HMR) |

### Structured logs

`NOCOOS_LOG_FORMAT=json` produces one-JSON-object-per-line logs:

```json
{"ts":"2026-06-19T06:00:47Z","level":"info","scope":"server","msg":"NocoOS listening on http://0.0.0.0:3000"}
```

Pipe to a file with `NOCOOS_LOG_FILE=/var/log/nocoos.log`. Sensitive fields (`password`, `token`, `authorization`, `secret`, `cookie`) are auto-redacted to `[REDACTED]`.

### Hot Module Reload (HMR)

`NOCOOS_HMR=1` enables:
- `fs.watch` on `os/public/` (150ms debounce)
- `ws://<host>/ws/hmr` broadcasts a `reload` event on change
- The frontend shows a banner and calls `window.location.reload()`

This is a full reload, not module-level hot-swap. For vanilla ESM with no JSX/TS/transpilation, the build-step benefit of Vite/Parcel is marginal — sessionStorage preserves your login across reloads.

### Error visibility

Frontend errors (syntax errors, runtime exceptions, unhandled promise rejections, script load failures) are automatically caught by `os/public/js/error-reporter.js` (loaded as a regular script in `<head>`, works even when subsequent ES modules fail to parse) and sent to `POST /api/client-errors` which logs structured events and increments `nocoos_client_errors_total`. A full-screen overlay renders the error with file:line:col, stack trace, and copy-to-clipboard.

With `NOCOOS_LINT=1`:
- `os/src/kernel/parser.js` validates every `.js` request via `node --check` (cached, ~50ms cold)
- Broken JS returns `500 syntax_error` with `{file, line, column, message}` instead of being served to the browser
- `pnpm lint` walks all `.js` files in `os/src/` and `os/public/` for static checks

HMR also parses before reload — if a saved file has a syntax error, the browser gets a `syntax-error` event (overlay, no reload) instead of a broken page.

## Installing and running packages

Open **App Installer** from the taskbar or desktop:

1. Pick a manager (npm, pnpm, yarn, bun — auto-detected).
2. Choose a workspace under `/apps` (or create a new one).
3. Type package names and click **Install**.

Installations stream their full output live via WebSocket. Once installed, switch to the **Terminal** app, `cd /apps/<workspace>`, and run any package's CLI:

```bash
cd /apps/workspace
npm install cowsay
node node_modules/cowsay/cli.js "Hello from NocoOS"
```

You can also install coding agents and other CLIs (Codex, Claude Code, Aider, etc.) the same way — they all run inside the **Terminal** app.

## CLI reference (`bin/nocoos.js`)

| Command | Effect |
|---|---|
| `pnpm nocoos` | Spawn default instance (auto-port). Refuses if already running. |
| `pnpm nocoos --name <n>` | Spawn named instance `<n>` with auto-port. |
| `pnpm nocoos --port <p>` | Use explicit port. |
| `pnpm nocoos --status` | Print running instances table; exit. |
| `pnpm nocoos --stop <n>` | Stop instance `<n>` (removes lock + registry entry, kills process). |
| `pnpm nocoos --manager` | Launch the manager dashboard. |
| `pnpm nocoos --attach` | Attach to existing manager (don't spawn). |
| `pnpm nocoos --help` | Show usage. |

## Adding your own apps

Drop a directory under `apps/` with a `nocoos.json` manifest:

```json
{
  "id": "myapp",
  "name": "My App",
  "description": "What it does",
  "icon": "star",
  "category": "development",
  "entry": "/js/apps/myapp.js"
}
```

Add `apps/*` to `pnpm-workspace.yaml` when you have your first app installed there. Built-in apps live in `os/public/js/apps/` and are defined in `os/src/kernel/app-registry.js`.

## Development

```bash
pnpm dev        # auto-restart backend on .js changes
pnpm test       # run all 73 unit tests
pnpm lint       # static JS syntax check across os/src + os/public
pnpm nocoos     # CLI (preferred way to start)
```

## Security notes

- Default user `user/nocoos` is auto-created on first run. Change the password by deleting `os/data/system/users.json` (regenerates defaults) or via a future Settings UI.
- The `/host` mount exposes the host filesystem — restrict access at the network layer if exposing NocoOS externally.
- Authentication tokens are 32-byte random hex; sessions expire in 24h.
- Multi-instance lock files are per-data-dir; deleting `.lock` while an instance is running lets you take it over (only do this if you're sure the old process is gone).

## License

MIT
