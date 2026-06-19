// End-to-end FRONTEND runtime test for NocoOS.
//
// Boots the server in a child process, then opens it in a real Chromium
// browser via Playwright. Exercises the full boot → login → desktop →
// open-each-app flow. Captures browser console output AND queries the
// server's /api/client-errors/recent telemetry endpoint so we can assert
// that no runtime errors fired.
//
// This is the test that should have caught the xterm.js CDN regression
// in Phase 2/3. The previous backend-only e2e (tests/e2e-backend.test.js)
// only verified HTTP API shapes and never opened a real browser.
//
// Requirements:
//   - Playwright installed: `pnpm install` (devDependency)
//   - Chromium binary: `npx playwright install chromium`
//   - No internet required at runtime — all assets vendored locally
//
// Run: `pnpm test:e2e:frontend`
//   (or `node tests/e2e-frontend.test.js`)

import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');

const PORT = 33998;
const DATA_DIR = path.join(ROOT, 'os', 'data-test-e2e-fe');
const SERVER_PATH = path.join(ROOT, 'os', 'server.js');

const results = [];
let server = null;

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`  ${mark} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) process.exitCode = 1;
}

async function section(name, fn) {
  console.log(`\n=== ${name} ===`);
  await fn();
}

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/health`);
      if (r.ok) return true;
    } catch {}
    await wait(100);
  }
  throw new Error('server did not start');
}

async function bootServer() {
  console.log('\n=== Booting server ===');
  if (fs.existsSync(DATA_DIR)) fs.rmSync(DATA_DIR, { recursive: true, force: true });
  server = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT,
    env: {
      ...process.env,
      NOCOOS_PORT: String(PORT),
      NOCOOS_INSTANCE_NAME: 'e2e-fe',
      NOCOOS_LOG_LEVEL: 'warn'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', (d) => process.stdout.write(`[srv] ${d}`));
  server.stderr.on('data', (d) => process.stderr.write(`[srv-err] ${d}`));
  await waitForServer();
  console.log('  server up');
}

async function killServer() {
  if (server && !server.killed) {
    server.kill('SIGTERM');
    await new Promise((r) => { server.once('exit', r); setTimeout(r, 2000); });
  }
}

async function getRecentClientErrors(since = 0) {
  const r = await fetch(`http://localhost:${PORT}/api/client-errors/recent?since=${since}`);
  return r.json();
}

async function clearRecentClientErrors() {
  await fetch(`http://localhost:${PORT}/api/client-errors/recent?clear=1`);
}

async function main() {
  await bootServer();

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Capture browser console output for diagnostics.
  const consoleMessages = [];
  const consoleErrors = [];
  page.on('console', (msg) => {
    const text = `[${msg.type()}] ${msg.text()}`;
    consoleMessages.push(text);
    if (msg.type() === 'error') consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`[pageerror] ${err.message}`);
  });
  page.on('requestfailed', (req) => {
    consoleErrors.push(`[requestfailed] ${req.url()} — ${req.failure()?.errorText}`);
  });

  let lastSince = Date.now();

  try {
    // 1. Load the index page → redirects to /boot
    await section('Boot flow', async () => {
      await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
      check('index redirects to /boot', page.url().endsWith('/boot'));
      await wait(500);
      // Boot auto-redirects to /login
      await page.waitForURL(/\/login/, { timeout: 5000 });
      check('boot redirects to /login', page.url().endsWith('/login'));
    });

    // 2. Login
    await section('Login', async () => {
      await page.fill('input[name="username"], input#username, input[type="text"]', 'user');
      await page.fill('input[name="password"], input#password, input[type="password"]', 'nocoos');
      await page.click('button[type="submit"], button#login-button, button:has-text("Sign in")');
      await page.waitForURL(/\/desktop/, { timeout: 5000 });
      check('login redirects to /desktop', page.url().endsWith('/desktop'));
      // Wait for desktop to fully render
      await wait(1500);
    });

    // 3. Verify window/global API surface that the desktop depends on
    await section('Runtime checks', async () => {
      const hasXterm = await page.evaluate(() => typeof window.Terminal !== 'undefined');
      check('xterm.js loaded (window.Terminal)', hasXterm);

      const hasFitAddon = await page.evaluate(() => {
        return typeof window.FitAddon !== 'undefined' || typeof window.FitAddon === 'function';
      });
      check('xterm-addon-fit loaded', hasFitAddon);

      const hasWebLinksAddon = await page.evaluate(() => {
        return typeof window.WebLinksAddon !== 'undefined';
      });
      check('xterm-addon-web-links loaded', hasWebLinksAddon);

      // Verify the CSRF/security headers are in place
      const cspHeader = await page.evaluate(async () => {
        const r = await fetch('/');
        return r.headers.get('content-security-policy');
      });
      check('CSP header present', !!cspHeader && cspHeader.includes("default-src 'self'"));
      check('CSP does not allow external origins', !cspHeader.includes('cdn.jsdelivr.net') && !cspHeader.includes('https://'));
    });

    // 4. Open each built-in app and verify it loads
    await section('Built-in apps', async () => {
      // Verify the registry has all built-in apps via the API.
      // Use the token from sessionStorage (set by the login flow) so
      // the Authorization header is set; raw fetch() wouldn't add it.
      const appsResp = await page.evaluate(async () => {
        const token = sessionStorage.getItem('nocoos_token') || '';
        const r = await fetch('/api/registry/apps', { headers: { Authorization: `Bearer ${token}` } });
        return { status: r.status, body: r.ok ? await r.json() : null };
      });
      const registeredIds = (appsResp.body?.apps || []).map((a) => a.id);
      check('apps registry returns 200', appsResp.status === 200, `status=${appsResp.status}`);
      const expected = ['terminal', 'filemanager', 'editor', 'installer', 'settings', 'about', 'monitor', 'browser'];
      for (const appId of expected) {
        check(`app "${appId}" registered`, registeredIds.includes(appId));
      }
      check('user app "hello" registered', registeredIds.includes('hello'));

      // Open the start menu by clicking #taskbar-start via page.evaluate
      // (more reliable than selector clicks when z-index/stacking is involved).
      await page.evaluate(() => document.getElementById('taskbar-start')?.click());
      // Wait for the start menu to become visible.
      await page.waitForFunction(
        () => document.getElementById('start-menu')?.hidden === false,
        { timeout: 3000 }
      ).catch(() => {});
      // Wait a bit more for the async render to complete.
      await wait(1500);

      // Debug: inspect the start menu state.
      const debug = await page.evaluate(() => ({
        startMenuHidden: document.getElementById('start-menu')?.hidden,
        startBodyHtml: (document.getElementById('start-body')?.innerHTML || '').slice(0, 300),
        startBodyChildren: document.getElementById('start-body')?.children?.length || 0,
        tokenPresent: !!sessionStorage.getItem('nocoos_token')
      }));
      console.log('  [debug]', JSON.stringify(debug, null, 2));

      // Wait for tiles to render (render() is async; tiles appear after getApps() resolves).
      await page.waitForFunction(
        () => document.querySelectorAll('#start-body [data-app-id]').length > 0,
        { timeout: 5000 }
      ).catch(() => {});

      const tileCount = await page.evaluate(() => document.querySelectorAll('#start-body [data-app-id]').length);
      check('start menu populated with tiles', tileCount > 0, `${tileCount} tiles rendered`);

      // Launch each built-in app by clicking its tile in-page. We close
      // any open windows between launches to keep state clean.
      for (const appId of expected) {
        const launched = await page.evaluate(async (id) => {
          const tile = document.querySelector(`#start-body [data-app-id="${id}"]`);
          if (!tile) return { ok: false, reason: 'tile-not-found' };
          tile.click();
          await new Promise((r) => setTimeout(r, 400));
          const windows = document.querySelectorAll('.window');
          return { ok: windows.length > 0, count: windows.length };
        }, appId);
        check(`app "${appId}" launches`, launched.ok, launched.reason || `${launched.count} windows`);
        // Close all open windows
        await page.evaluate(() => {
          document.querySelectorAll('.window-control.close').forEach((b) => b.click());
        });
        await wait(300);
      }

      // Verify the user-installed "hello" app is also in the start menu
      const helloTile = await page.evaluate(() => !!document.querySelector('#start-body [data-app-id="hello"]'));
      check('user app "hello" tile present in start menu', helloTile);
    });

    // 6. Telemetry: no client errors should have been reported
    await section('Telemetry: /api/client-errors/recent', async () => {
      const recent = await getRecentClientErrors(lastSince);
      if (recent.count > 0) {
        console.log('  Recent client errors:');
        for (const evt of recent.events) {
          console.log(`    - [${evt.kind}] ${evt.message} (${evt.file || 'no file'}:${evt.line || '?'})`);
        }
      }
      check('no runtime errors reported via /api/client-errors', recent.count === 0,
        recent.count > 0 ? `${recent.count} errors reported` : '');

      // Also check the captured console for error-level messages.
      // Tolerate: favicon 404, third-party iframes, and the pre-login 401
      // for /api/registry/apps (the page renders before login completes).
      const significantConsoleErrors = consoleErrors.filter((m) =>
        !m.includes('favicon') &&
        !m.includes('the server responded with a status of 404') &&
        !m.includes('the server responded with a status of 401')
      );
      if (significantConsoleErrors.length > 0) {
        console.log('  Significant console errors:');
        for (const m of significantConsoleErrors.slice(0, 5)) {
          console.log(`    - ${m}`);
        }
      }
      check('no significant browser console errors', significantConsoleErrors.length === 0,
        significantConsoleErrors.length > 0 ? `${significantConsoleErrors.length} errors` : '');
    });

    await browser.close();
    await killServer();

    // Summary
    console.log('\n=== Summary ===');
    const passed = results.filter((r) => r.ok).length;
    const failed = results.filter((r) => !r.ok).length;
    console.log(`  ${passed} passed, ${failed} failed (of ${results.length} checks)`);
    if (failed > 0) {
      console.log('\n  Failures:');
      for (const r of results.filter((r) => !r.ok)) {
        console.log(`    - ${r.name}${r.detail ? ': ' + r.detail : ''}`);
      }
    }
    process.exit(failed > 0 ? 1 : 0);
  } catch (err) {
    console.error('E2E frontend test crashed:', err);
    await browser.close().catch(() => {});
    await killServer();
    process.exit(1);
  }
}

main().catch(async (err) => {
  console.error('Fatal:', err);
  await killServer();
  process.exit(1);
});