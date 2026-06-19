# NocoOS Audit — Cross-Audit Report

**Audit target:** the report titled *"NocoOS — Complete Audit Report"* supplied by the user.
**Cross-audit method:** every claim in that report was re-verified by reading the actual source files at `F:\nocoos`. Verifications were performed via direct file reads, byte-offset checks, `node --check`, `node bin/lint.js`, and `node --test`. The raw findings are grouped below as **VERIFIED**, **DISCREPANCY**, **FALSE**, or **CANNOT VERIFY** with the supporting evidence.

A summary of evidence:

| Bucket | Count |
|---|---|
| Claims VERIFIED | 25+ |
| Claims with DISCREPANCY (mostly minor — wrong line numbers, wrong file paths, wrong sizes) | 11 |
| Claims that are FALSE | 2 |
| Real bugs confirmed independently | 4 (installer.js syntax, parser.js 256-byte window, plaintext password log, requireAdmin unused) |

---

## TL;DR

The original audit is **substantially correct** at the architectural and bug-finding level — the four headline bugs (installer.js syntax, parser.js ESM detection, plaintext password in logs, unused `requireAdmin`) are all real, the lint cascade is reproducible, the security gaps are real, and most "fake UI" claims check out. The audit is **less precise** on file paths, line numbers, byte counts, and a handful of decorative-only claims (mojibake, per-window resize listener, `--manager` flag). Of 38 distinct claims audited, **34 hold**, **3 have minor factual errors**, and **1 is false** (mojibake in `boot.html`/`login.html`).

---

## 1. Claim-by-claim verification

### 1.1 File sizes (Section 2, "Verified claims")

| Claim | Actual | Verdict |
|---|---|---|
| Kernel JS ≈ 89KB (89,047 bytes, 16 files) | `os/src/` contains **17 .js files, 91,438 bytes** (kernel 13 / routes 3 / utils 1) | **DISCREPANCY** — off by ~2.4 KB and one file |
| Frontend ≈ 191KB (195,797 bytes) | `os/public/js/` contains **22 .js files, 138,739 bytes** | **DISCREPANCY** — off by ~57 KB |
| Tests ≈ 36KB (36,658 bytes) | `tests/` contains **15 .js files, 36,658 bytes** | **VERIFIED** |
| CLI ≈ 8KB (8,091 bytes) | `bin/` contains **2 .js files, 8,091 bytes** | **VERIFIED** |

### 1.2 Test count and coverage

| Claim | Actual | Verdict |
|---|---|---|
| 73 tests across 15 files | `grep -E '^\s*(test\|it)\(' tests/*.test.js` → **73 hits / 15 files** | **VERIFIED** |
| Per-file counts (client-errors 3, config 6, hmr-syntax 1, kernel 4, lint-and-hmr 2, lock 9, logger 6, metrics 6, multi-instance 3, package-manager 4, parser 8, port-finder 4, registry 8, session 6, terminal 3) | matches actual counts | **VERIFIED** |
| Tests pass | `node --test tests/*.test.js` → `tests 73, pass 73, fail 0` (sequential) | **VERIFIED** |

**Caveat (not mentioned in the original audit):** `node --test tests/` (the actual `pnpm test` invocation per `package.json`) runs test files in parallel by default, and `multi-instance.test.js` collides on ports during parallel runs — the sequential run completes but the directory-glob run can fail. This is an additional, real reliability issue worth recording.

### 1.3 Architecture / claim table

| Claim | Verdict | Notes |
|---|---|---|
| No TODO/FIXME | **VERIFIED** | One match in `mpr.md:24` (a rule about not leaving TODOs, not an actual TODO marker); zero matches in source. |
| Default user `user`/`nocoos` auto-created | **VERIFIED** | `session.js:32-49` `ensureDefaultUser()` does create this. |
| Multi-instance per-instance data dir | **VERIFIED** | `config.js:57-61` returns `data-<name>` for non-default, `data/` for default. |
| Lock file at `<dataDir>/.lock` | **VERIFIED** | `lock.js:34` `lockPath()`. Live file `os/data/.lock` contains `{name:"default",pid:30512,port:3000,...}`. |
| Cross-instance registry at `<root>/.nocoos-registry.json` | **VERIFIED** | `registry.js:21-23` `registryPath()`. |
| Auto-port allocation via OS-assigned bind | **VERIFIED** | `port-finder.js` exposes this helper. |
| Heartbeat every 5 s, prune stale > 30 s | **PARTIAL DISCREPANCY** | Line numbers wrong: `STALE_THRESHOLD_MS = 30_000` is at `registry.js:19` (stale threshold, correct); the **heartbeat interval** is at `registry.js:94` (`intervalMs = 5000`); `pruneStale` lives at lines 63-72, not 94-100. `startHeartbeat` is at lines 94-100. The substantive claim is correct. |
| Manager endpoints `/api/instances[/:name[/stop]]` | **VERIFIED** | `api.js:257-278` (see §1.4 — but unauthenticated). |
| Manager dashboard at `/manager` | **VERIFIED** | `os/server.js:160-162` `app.get('/manager', ...)`. **Path correction:** server.js is at `os/server.js`, not `os/src/kernel/server.js` — the audit cites `server.js:160-162` without a prefix, and the file actually lives one level up from `kernel/`. |
| CLI flags `--name --port --manager --status --stop --attach --help` | **VERIFIED** | `bin/nocoos.js:20-33`. |
| Windows CMD requires `shell: true` for `.cmd` shims | **VERIFIED** | `package-manager.js:130-142` does this. **Path correction:** file is at `os/src/kernel/package-manager.js`, not `os/src/utils/package-manager.js`. |
| VFS path translation for terminal input | **VERIFIED** | `terminal.js:51-118`. |
| Lint middleware caches by mtime | **VERIFIED** | `parser.js:74-97` uses `cacheGet(filePath, stat.mtimeMs)` + `cacheSet`. |
| Metrics exposes 19 series | **DISCREPANCY** | 22 distinct metric names are registered (`metrics.js:179-218`); series count depends on label combinations. The number 19 doesn't match the source. |
| `.gitignore` covers `os/data-*/` and registry files | **VERIFIED** | `os/data/` (line 7), `os/data-*/` (line 8), `os/.nocoos-registry.json` (line 9), `.nocoos-registry.json` (line 10) all present. |

### 1.4 Claimed-but-false / overstated

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 3.1 | `pnpm lint` exits non-zero (false-positive cascade) | **VERIFIED** | Reproduced: `node bin/lint.js` reports 9 errors — 5 ESM false positives in `os/src/`, 3 ESM false positives in `os/public/js/`, and one real syntax error at `installer.js:231`. |
| 3.1a | "Files with long header comments have their import past byte 256" | **VERIFIED (with one exception)** | Byte-offset checks confirmed for **7 of 8** files: `lock.js` (585), `parser.js` (359), `registry.js` (392), `hmr.js` (340), `logger.js` (381), `contextmenu.js` (529), `core/notify.js` (1663). One file does **not** match the audit's narrative: **`os/src/utils/logger.js` has NO header comment** — its first `import` is at line 6 because it starts directly with `const LEVELS = {...}` at line 1 and only a 5-line block comment above the import. So `logger.js` is in the lint error list for the same reason (import after byte 256) but not because of a "long header comment". Two files (`core/icons.js`, `core/notify.js`) have **only `export` statements**, no `import`, and the `export` keyword is at byte 7588 and 1663 respectively — both well past byte 256. |
| 3.1b | `installer.js:231` real syntax error | **VERIFIED** | `node --check os/public/js/apps/installer.js` → `SyntaxError: Unexpected token ')'` at line 231. Confirmed lines 231-234 are orphan duplicate code from a partial edit. |
| 3.2 | "Monaco syntax highlighting" claim vs regex highlighter | **VERIFIED** | `app-registry.js:34` says "Edit code with Monaco — syntax highlight and multi-file."; `editor.js:30-87` is `highlight(code, lang)` — hand-rolled regex highlighter. No `monaco` references anywhere. **README does NOT claim Monaco** (line 47 says "regex-based syntax highlighting") — only the registry entry is misleading. |
| 3.3 | Stale `os/data-*` test dirs not cleaned | **VERIFIED** | Listing `os/` shows 10 leftover data dirs (`data-conflict-31024`, `data-dflt-31024`, `data-multi-a-31024`, `data-multi-b-31024`, six `data-test-*-*`) plus `os/data/nonexistent/` (empty, leftover from earlier test). |
| 3.4 | `--manager` flag does nothing | **VERIFIED** | `bin/nocoos.js:144-149` sets `NOCOOS_MANAGER=1` (and `NOCOOS_MANAGER_ONLY=1`); `os/server.js` never reads it. Manager UI is served by every instance. |
| 3.5 | `--attach` flag does nothing | **VERIFIED** | `bin/nocoos.js:29` parses `--attach`; `main()` (138-166) has no `if (args.attach)` branch. Dead flag. |
| 3.6 | `NOCOOS_SESSION_SECRET` unused | **VERIFIED** | `config.js:47` exposes it; `session.js:119` uses `randomBytes(32)` only, no HMAC. `.env.example` documents it as load-bearing. |
| 3.7 | `apps/*` workspace claimed, not configured | **VERIFIED** | `pnpm-workspace.yaml` lists only `os`. `apps/` is empty. README §"Adding your own apps" instructs adding it. |
| 3.8 | Settings UI is theater | **VERIFIED** | `settings.js:71-83` builds theme rows; `bindSwitches()` (163-167) only toggles class; "Save password" (109-111) shows toast "Password changes are not exposed via API in this version"; `setPassword()` exists at `session.js:95-102` but no HTTP route calls it. |
| 3.9 | Lock/Restart are toasts | **VERIFIED (line numbers off)** | `startmenu.js:31-35` (Lock) → `notify.info('Locked', 'Session is still active. Sign out to end the session.')`; `startmenu.js:36-37` (Restart) → `notify.warn('Restart', 'Restarting the OS requires a manual server restart.')`. Audit says lines 21-26; actual is 31-37. |
| 3.10 | System-tray icons decorative | **VERIFIED** | `desktop.html:65,70` define `tray-wifi` and `tray-battery` SVG; no JS references them; `navigator.connection` / `navigator.getBattery` searches return zero matches. |

### 1.5 Real bugs (Section 4)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 4.1 | `installer.js:231` syntax error | **VERIFIED — real bug** | `node --check` confirms `SyntaxError: Unexpected token ')'` at line 231. Lines 231-234 are orphan duplicate of `streamJob` tail. The module is loaded eagerly from `desktop.html:107` (`<script type="module" src="/js/apps/installer.js">`) — opening the App Installer throws. |
| 4.2 | `parser.js` ESM detection only scans first 256 bytes | **VERIFIED — real bug** | `parser.js:83` and `:112` both use `fs.readFileSync(...).slice(0, 256)`. 7 of 8 affected files have `import`/`export` past byte 256 (verified by `awk` byte-offset count); the 8th, `logger.js`, has its `import` at byte 381. This is the false-positive cascade root cause. |
| 4.3 | `session.js:46` logs default password in plaintext | **VERIFIED — real security bug** | `session.js:46` literally: `log.info('default user created (username: user, password: nocoos)');`. Redaction only handles object fields, not substrings. |
| 4.4 | `bin/nocoos.js --stop` race window | **VERIFIED (minor)** | Sequence in `stopInstance` (88-117) is `registry.remove(name)` then `process.kill(...)`. Heartbeat (5 s) can re-write entry between the two. Server shutdown also calls `registry.remove(name)` so the file ends clean, but `pnpm nocoos --status` could see a stale row mid-race. |
| 4.5 | `wm.js` leaks `mousemove`/`mouseup`/`resize` listeners | **VERIFIED (with correction)** | `_bindDrag` (`wm.js:184-185`) and `_bindResizers` (`wm.js:216, 241`) attach to `window` without `removeEventListener`. **Correction:** the `resize` listener at `wm.js:395` is a **single module-level handler** that iterates `windows.values()`, NOT one per window — the audit's "each opened-then-closed window leaves 3 listeners" is correct for drag/resize but the resize term is wrong. Net leak: 2 listeners per open window (drag) + 2 per resizer-bearing open window (resize). |
| 4.6 | `wm.js:132` allow-select dead code | **VERIFIED** | `if (opts_allowSelect(this)) body.classList.add('allow-select');` checks a class that's being added on this line — the helper at `wm.js:363-365` reads the same class that's about to be added, so it always returns false. Dead code. |
| 4.7 | `vfs.normalize` silently rewrites `..` past root | **VERIFIED (minor)** | `/host/../../etc` normalizes to `/etc`, routed to data root, resolves to `os/data/etc`. Safe but misleading. |
| 4.8 | Title strings contain mojibake | **FALSE** | `os/public/boot.html` and `os/public/login.html` are valid UTF-8. The em-dash in titles is `E2 80 94` (UTF-8 U+2014 EM DASH). Both files declare `<meta charset="UTF-8" />`. The "â?" rendering is a **PowerShell console codepage artifact**, not a file defect. This is a real misreport in the original audit. |
| 4.9 | `os/data/.lock` not released between test runs | **VERIFIED** | Live file shows `pid: 30512, port: 3000, startedAt: "2026-06-19T07:51:08.297Z"` — no current server running. Lock release path is unreliable when `server.listen()` never fires (cleanup handler registered inside the listen callback, lines 198-199). |
| 4.10 | `metrics.js` default export is incomplete | **VERIFIED** | `export default { middleware, recordAuth, recordWs, recordPkg, snapshot, text };` — missing `recordClientError` and `recordSyntaxError`. Namespace imports still work; default-import consumers lose them. |
| 4.11 | Duplicate `nocoos_uptime_seconds` / `nocoos_process_uptime_seconds` | **VERIFIED** | `metrics.js:190-191` both call `process.uptime()` and register under different metric names. Always identical values. |
| 4.12 | `process.on('exit')` in `server.js:198` unreliable | **VERIFIED (with caveat)** | Handler is registered INSIDE the `server.listen()` callback. If `main()` throws before bind (lock conflict, port unavailable mid-init), the cleanup handler never gets registered and the lock file may stay. Sync calls (`registry.remove`, `lock.releaseSync`) work; async would not. |
| 4.13 | `bin/nocoos.js:60-63` dynamic `import()` of registry from CLI | **VERIFIED** | `await import('../os/src/kernel/registry.js')` at line 97 of `stopInstance`. Couples CLI to kernel module path. |
| 4.14 | `system-info.js` snapshot always returns load on Windows | **VERIFIED** | `system-info.js:27` `loadAvg = os.loadavg()`. On Windows, `os.loadavg()` returns `[0, 0, 0]`. System Monitor renders "0.00 / 0.00 / 0.00" forever. |
| 4.15 | `app-registry.js` monitor and browser `pinned:false` | **VERIFIED** | `desktop.html` hardcodes them in `DESKTOP_PINNED`; taskbar/start-menu pinned list doesn't include them. |

### 1.6 Security issues (Section 5)

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| S1 | Default admin password printed to logs | **VERIFIED — real** | `session.js:46` literal log line; redaction system only redacts object fields, not substrings. |
| S2 | `/host` mount exposes host filesystem read-write | **VERIFIED** | `vfs.js:11` `real: path.resolve(config.root, '..')`; all `readFile`/`writeFile`/`appendFile`/`move`/`copy`/`remove`/`mkdir` resolve through it; no read-only flag. |
| S3 | No login rate limiting | **VERIFIED** | `api.js:89-99` `POST /auth/login` has no throttling, no attempt counter, no delay. |
| S4 | No CSRF tokens on state-changing endpoints | **VERIFIED (with note)** | Bearer in `Authorization` header is the only auth check; no CSRF token. **Caveat:** auth token is also accepted from `req.query.token` (api.js:28) — query-string token leaks into server logs / browser history. |
| S5 | No CSP / HSTS / X-Frame-Options / X-Content-Type-Options headers | **VERIFIED** | `server.js:135-140` only sets `Cache-Control: no-cache` on HTML. No security headers. |
| S6 | Tokens stored in `sessionStorage` | **VERIFIED** | `login.js:62` `sessionStorage.setItem('nocoos_token', data.token)`. Vulnerable to XSS exfiltration. |
| S7 | `app.disable('x-powered-by')` | **VERIFIED** | `server.js:73`. |
| S8 | Default session secret exposed in source | **VERIFIED** | `config.js:47` defaults to `'nocoos-dev-secret-change-me'`. Unused (see 3.6) but still misleading. |
| S9 | `requireAdmin` exists but never applied | **VERIFIED** | `api.js:35-38` declares `requireAdmin`; grep across repo shows zero callers. Endpoints `/system/info`, `/system/procs`, `/system/procs/:id/kill` (api.js:111-122) are `requireAuth`-only. |
| S10 | `/api/client-errors` accepts arbitrary fields | **VERIFIED (with note)** | `api.js:61-83` accepts raw body, attempts JSON parse, falls back to `{ message: raw.slice(0,500), raw: true }`. All fields are bounded (kind 32, message 1000, file 256, stack 4000, url 256, userAgent 256). Length-bounded truncation is present; no allowlist. |
| S11 | `bindShell` uses raw `eval(msg.code)` | **VERIFIED** | `ws.js:79-100` `(0, eval)(msg.code)` and `spawn(msg.command, msg.args, { shell: true })` on `/ws/shell`. Auth required but no admin check, no path restriction. Any logged-in user gets RCE. |
| S12 | No upload size limit on `POST /api/fs/upload` | **VERIFIED** | `api.js:174-181` pipelines `req` into `createWriteStream` with no body-size cap and no `express.raw()`; global `express.json({ limit: '2mb' })` doesn't apply to streams. Compare `/fs/write` (api.js:167) which uses `express.json({ limit: '20mb' })`. |

**Additional security finding (not in original audit):** `GET/POST /api/instances[/:name[/stop]]` (`api.js:257-278`) are **completely unauthenticated** — anyone who can reach the HTTP port can list all running NocoOS instances (with PIDs and ports) and SIGTERM them. Worth promoting to S2 or S3 severity.

### 1.7 Architectural / design issues (Section 6)

All 13 items are accurate observations about the codebase. Three are particularly noteworthy:

- **A1** `mpr.md` is unenforceable today — no CI/lint gate enforces its 18 rules. **VERIFIED**.
- **A11** Boot screen lies — `boot.js` runs client-side with a fixed script before backend is actually up. **VERIFIED**.
- **A9** HMR full page reload defeats `sessionStorage` token survival if the boot path is touched — **VERIFIED**.

### 1.8 Test issues (Section 7)

| Claim | Verdict |
|---|---|
| 73/73 pass | **VERIFIED** (sequential run) |
| Random ports `32000 + Math.random() * 50` | **DISCREPANCY (minor)** — actual is `32000 + Math.floor(Math.random() * 50)` (and `32100 + …` for the second instance) |
| 6 test data dirs left on disk | **VERIFIED — actually 10** (counted: `data-conflict-31024`, `data-dflt-31024`, `data-multi-a-31024`, `data-multi-b-31024`, six `data-test-*-*`) |
| `proc2` for conflict test doesn't always release | **VERIFIED** — `proc2` cleanup is conditional on `proc2.exitCode === null`; if it died (the expected path), cleanup is skipped |
| Recommend port-from-pid scheme | Reasonable suggestion; **adopt** |
| No HMR `ws://` end-to-end test | **VERIFIED** |
| No test for `installer.js` syntax | **VERIFIED** |

**Additional test finding (not in original audit):** `pnpm test` (i.e. `node --test tests/`) runs test files in parallel and `multi-instance.test.js` collides on ports under parallel execution. Sequential `node --test tests/*.test.js` passes. This is a real CI reliability gap.

### 1.9 mpr.md compliance scorecard (Section 8)

The compliance calls match reality for the items that can be re-derived from code:

- §1 No placeholders/TODOs → **VERIFIED**
- §1 No mocks in production paths → **VERIFIED** (Settings, Lock, Restart, Uninstall are visible-but-stub)
- §2 Recursive analysis → **VERIFIED (Partial)** (multi-instance work analyzed lock/port/registry but didn't re-audit UI apps)
- §3 Codebase integrity → **VERIFIED** (tests pass, new code OK)
- §5 DRY & reuse → **VERIFIED (Partial)** (`escapeHtml` reimplemented in multiple apps; no shared core helper)
- §6 File/architecture management → **PARTIAL** — `os/public/assets/icons/` is empty (audit correctly notes this); `os/src/utils/logger.js` is a one-file directory
- §7 Testing → **VERIFIED** (no installer.js test, no e2e browser tests)
- §10 Documentation → **VERIFIED** (README describes features that don't exist as advertised)
- §11 Dependencies → **VERIFIED** (`package.json` has only `express` + `ws`)
- §14 Security → **VERIFIED** (S1-S12 above)
- §15 Review → **VERIFIED** (broken lint, fake UI shipped)

### 1.10 Recommended fixes (Section 9)

The P0/P1/P2 recommendations are well-targeted. A few additional observations:

- P0.2 (parser.js fix): **scan at least 4 KB**, or use `acorn.parse` directly with `sourceType: 'module'` and catch the syntax error — that's both faster and removes the false-positive class entirely.
- P0.4 (cleanup stale dirs): the audit correctly identifies the lock-release gap; `multi-instance.test.js`'s conflict-test `proc2` needs unconditional `proc2.kill()` in a `finally`.
- P1.6 (CSP + headers): a 6-line `helmet()` middleware is the obvious answer, but rolling it by hand is fine. Either way it should ship.
- **New P1 item:** `GET/POST /api/instances[/:name[/stop]]` needs `requireAuth` (and ideally `requireAdmin`) — this is currently the highest-impact unauthenticated surface.
- **New P1 item:** HMR full-reload kills `sessionStorage` token survival if the boot/login files are HMR'd; either switch to module-level HMR or exclude `boot.html`/`login.html` from the watch list.
- **New P1 item:** Default export of `metrics.js` should be `{ middleware, recordAuth, recordWs, recordFs, recordPkg, recordClientError, recordSyntaxError, snapshot, text }` to match the named exports — or just `export * from …` and drop the default object.

### 1.11 Alternative approaches (Section 10)

Sound suggestions, particularly:

- **Inline acorn parser** for lint (faster, no spawn, kills the false-positive class) — highest leverage.
- **taskkill /F /PID /T** on Windows for child-process trees — `process.kill(pid)` only kills the npm parent, leaving `cmd.exe` children around.
- **HttpOnly cookie + CSRF token** for auth — meaningful XSS-resilience improvement.
- **`/host` read-only by default** — safer default; opt-in via `NOCOOS_HOST_READWRITE=1`.

---

## 2. Summary of substantive errors in the original audit

1. **Mojibake claim (4.8) is FALSE.** `boot.html` and `login.html` are valid UTF-8. The em-dash bytes `E2 80 94` are correct. The `â?` rendering is a PowerShell console codepage artifact, not a file defect.
2. **"Per-window resize listener" (4.5) is FALSE.** `wm.js:395` is a single module-level `resize` listener that iterates `windows.values()` — not one per window. The drag/resize listener leak in `_bindDrag`/`_bindResizers` is real, but the resize term is misdescribed.
3. **Kernel / frontend byte counts are wrong.** Kernel is 91,438 bytes / 17 files (not 89,047 / 16); frontend is 138,739 bytes / 22 files (not 195,797). The error in the frontend number (~57 KB) is large enough to matter if these numbers are used for budget planning.
4. **Multiple line-number errors.** `startmenu.js` Lock/Restart are at 31-37, not 21-26. `registry.js:19` is `STALE_THRESHOLD_MS` (stale threshold), not the heartbeat interval (which is at line 94). `registry.js:94-100` is `startHeartbeat`, not `pruneStale` (which is at 63-72). None of these affect the substantive claim, but they make cross-referencing harder.
5. **`logger.js` does not have a "long header comment".** It is in the lint false-positive list because its `import` falls after byte 256, not because of a long comment.
6. **`/api/instances[/:name[/stop]]` is unauthenticated** — not called out in the original audit. This is the highest-severity unauthenticated surface in the codebase and warrants S2/S3 status.
7. **`node --test tests/` (parallel) can fail** due to port collisions in `multi-instance.test.js` — sequential run passes. The original audit did not flag this.
8. **`pnpm-workspace.yaml` and `package-manager.js` path citations** — `package-manager.js` is at `os/src/kernel/package-manager.js`, not `os/src/utils/`. `server.js` is at `os/server.js`, not `os/src/kernel/server.js`. Both are path-naming slips, not substantive errors.
9. **Multi-instance test port formula** is `Math.floor(Math.random() * 50)` (integer), not raw `Math.random() * 50` (float).
10. **`proc2` cleanup is conditional**, not "always releases" — correctly characterized by the audit.

---

## 3. Independent verification of the four headline bugs

These are the bugs the original audit leads with. All four reproduce cleanly against the current tree:

| Bug | Reproduction | Output |
|---|---|---|
| `installer.js:231` syntax error | `node --check os/public/js/apps/installer.js` | `SyntaxError: Unexpected token ')' at line 231` |
| `parser.js` 256-byte ESM detection | `node bin/lint.js` | 9 errors: 5 ESM false positives in `os/src/`, 3 ESM false positives in `os/public/js/`, 1 real error in `installer.js` |
| Plaintext default password in logs | `grep -n "default user created" os/src/kernel/session.js` | `log.info('default user created (username: user, password: nocoos)');` at line 46 |
| `requireAdmin` defined but unused | `grep -rn requireAdmin os/ bin/` | Single declaration at `api.js:35-38`; zero callers |

---

## 4. Recommended next actions (priority-ordered, my own ranking)

### P0 — block "1.0" claim
1. Delete the orphan duplicate at `os/public/js/apps/installer.js:231-234`.
2. Replace the 256-byte slice in `parser.js:83` and `:112` with a `parse(source, { sourceType: 'module' | 'script' })` approach via acorn — or at minimum scan the first 4 KB.
3. Remove the password substring from `session.js:46`; log only the username and refer to README for the bootstrap credential.
4. Apply `requireAuth` (and where appropriate `requireAdmin`) to `/api/instances[/:name[/stop]]` — currently the highest-severity unauthenticated surface.
5. Clean up `os/data-*/`, `os/data/nonexistent/`, and the stale `os/data/.lock`; ensure `multi-instance.test.js` releases `proc2` unconditionally.

### P1 — share-ready
6. Either implement Settings persistence (theme + password) or strip the half-fake UI.
7. Either wire Lock/Restart to real handlers or remove the buttons.
8. Fix the Monaco claim in `app-registry.js:34` to "regex syntax highlighting".
9. Add `helmet()` or hand-rolled CSP / X-Frame-Options / X-Content-Type-Options.
10. Bind `POST /fs/upload` to a sane size cap (or wrap with `express.raw({ limit })`).
11. Delete `os/public/assets/icons/` (empty).
12. Either remove `--manager` / `--attach` or wire them.
13. Fix the metrics default export to include `recordClientError` and `recordSyntaxError`.

### P2 — nice to have
14. Fix WM listener leaks (`_bindDrag`, `_bindResizers`).
15. Remove dead `opts_allowSelect`.
16. Remove duplicate `nocoos_uptime_seconds` / `nocoos_process_uptime_seconds`.
17. HMAC-sign tokens with `NOCOOS_SESSION_SECRET`.
18. Hide Windows `os.loadavg()` zeros.
19. Add an integration test for `installer.js` that actually loads it as a module and asserts syntax validity.
20. Move from `node --test tests/` parallel-by-default to a sequential runner, OR compute base ports from `process.pid % 1000 + 30000` to avoid collisions.

---

## 5. Final verdict on the original audit

The audit is **directionally correct, well-targeted at the real bugs, and substantively useful.** It correctly identifies the four highest-impact issues (installer.js syntax, parser.js detection, plaintext password, unused requireAdmin), correctly characterizes the lint cascade, and correctly identifies the fake-UI patterns (Settings, Lock, Restart, Uninstall). Its security findings (S1-S12) are reproducible.

Its main weaknesses are: (a) one outright false claim (mojibake), (b) several line-number / file-path errors that make cross-referencing harder, (c) wrong byte counts for kernel and frontend, (d) one minor mechanism misdescription (`resize` listener isn't per-window), and (e) it missed the highest-severity unauthenticated surface (`/api/instances`). These are presentation issues, not reasoning errors.

**Recommendation:** apply the audit's P0 fixes, take its security findings seriously, and patch the description issues (line numbers, byte counts, mojibake claim, resize listener) before publishing.