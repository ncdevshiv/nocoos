# NocoOS — Project Status

This document is the **honest** state of the NocoOS codebase. It
distinguishes what is verified, what is partially verified, and what
is known-broken or untested. Read it before assuming any feature
"just works".

## Test layers (run them in order before merging)

| Layer | Command | What it covers | What it does NOT cover |
|---|---|---|---|
| **Lint** | `pnpm lint` | Syntax of every `.js` and `.mjs` file under `os/src`, `os/public/js`, and `apps/` | Runtime behavior, types, semantics |
| **Unit** | `pnpm test:unit` | 73 isolated tests of kernel modules (lock, parser, registry, session, terminal, port-finder, etc.) | Anything that requires a running server or a browser |
| **Backend e2e** | `pnpm test:e2e:backend` | 57 checks against a running server: every HTTP endpoint, both WebSocket channels, ACL enforcement, auth flows | Any frontend behavior — does not exercise the browser at all |
| **Frontend e2e** | `pnpm test:e2e:frontend` | 30 checks against a real Chromium browser via Playwright: page load, login, every app launches, no console errors, no `/api/client-errors` reports | Visual rendering quality; only asserts presence and non-error |

**Combined:** `pnpm test:all` runs lint → unit → both e2e suites.

## Architectural guarantees

| Property | How enforced | Status |
|---|---|---|
| **Local, isolated, portable** | All assets vendored under `os/public/vendor/`. CSP allows only `'self'`. No runtime fetches to external origins. | ✅ Verified |
| **No CDN dependencies** | xterm.js, xterm-addon-fit, xterm-addon-web-links vendored as MIT under `os/public/vendor/xterm/`. | ✅ Verified by frontend e2e (xterm loads on `/desktop`) |
| **CSRF-protected state changes** | Bearer token in `Authorization` header. Token is HMAC-SHA256 signed with `NOCOOS_SESSION_SECRET`. | ✅ Verified by backend e2e (auth flows) |
| **No plaintext credentials in logs** | Bootstrap password is replaced by a README pointer. | ✅ Verified |
| **Default admin actions gated** | `requireAdmin` middleware applied to destructive routes. `/ws/shell` admin-only. | ✅ Verified by backend e2e (403 for non-admin) |
| **/host mount sandboxed** | Read-only by default. Opt-in via `NOCOOS_HOST_WRITABLE=1` with boot-time warning. | ✅ Verified by backend e2e (403 on /host write) |
| **Login rate-limited** | 10 fails per 60s per (IP, username), 429 response. | ✅ Verified |
| **Upload size-capped** | 100 MB default with Content-Length fail-fast and stream counter. | ✅ Verified |
| **bindShell sandboxed** | `vm.Script` context with allow-listed global. `typeof require` and `typeof process` both `undefined`. | ✅ Verified by backend e2e (sandbox assertions) |

## Frontend runtime errors policy

The `/api/client-errors` endpoint accepts browser-sent errors and
`/api/client-errors/recent` exposes them. The frontend e2e test
queries this endpoint after exercising every app and FAILS if any
runtime error was reported. This is the telemetry gap that was
missed before this commit.

To inspect errors manually after running the desktop:

```bash
curl http://localhost:3000/api/client-errors/recent | jq
```

To clear the buffer:

```bash
curl 'http://localhost:3000/api/client-errors/recent?clear=1'
```

## Known issues / known-untested

- **Browser-based tests run against headless Chromium only.** Firefox
  and Safari rendering paths are not exercised. The code targets modern
  evergreen browsers, but a manual smoke test in Firefox is recommended
  before releases.
- **`/host` RW mode** (`NOCOOS_HOST_WRITABLE=1`) is not in any automated
  test. The default (RO) is. If you opt in, manually verify file writes
  don't escape the host root.
- **WSL/CI environments** — Playwright's Chromium requires a working
  display subsystem. On bare Linux CI, run with `xvfb-run`. On
  Windows / macOS, no extra setup.
- **No visual regression tests.** The frontend e2e asserts presence
  and absence of errors; it does not screenshot diff against a baseline.

## File layout (what's where)

```
os/                    # Kernel + frontend
  public/              # Static-served frontend
    vendor/xterm/      # Vendored MIT assets (no CDN)
    js/                # ES modules
      boot-desktop.js  # Entry point — initializes all subsystems
      core/            # api, wm, notify, icons
      apps/            # Built-in apps (terminal, editor, etc.)
    css/               # Stylesheets
    desktop.html       # Main UI page
  src/
    kernel/            # Core modules (lock, vfs, session, etc.)
    routes/            # api.js, ws.js, hmr.js
    utils/             # logger
  server.js            # Main entry — boot.listen()
apps/                  # User-app workspace (loaded by /js/<id>/)
bin/
  lint.js              # Lint runner
  nocoos.js            # CLI (--name, --manager, --attach, --stop, --status)
tests/
  *.test.js            # Unit tests (run via `node --test`)
  e2e-backend.test.js  # HTTP/WebSocket e2e
  e2e-frontend.test.js # Browser e2e (Playwright)
```

## Commits at a glance

- Initial commit: baseline + cross-audit
- Phase 1: lint cascade + installer crash + plaintext password + unauth endpoints + shell RCE
- Phase 2: helmet headers + admin gating + rate limiting + upload cap + /host ACL
- Phase 3: settings persistence + lock screen + restart + uninstall + editor tokenizer + CLI flags + apps/* + Windows metrics + opts_allowSelect + uptime metrics + icon set + metrics export
- Phase 4: WM listener leaks + test parallelism + cleanup reliability + monitor/browser pin + CLI/kernel decoupling
- Phase 5: HMAC tokens + VM sandbox for shell
- E2e backend test: 57 checks
- CSP audit: xterm.js vendored locally, CSP tightened, boot-desktop entry point, telemetry endpoint, frontend browser test

## Versioning

`1.0.0` — the version string is hardcoded in `os/server.js` line 250 and
in `os/public/js/apps/about.js`. Bump on releases.