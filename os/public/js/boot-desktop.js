// Desktop entry point. Imported only by desktop.html. Calls init() on each
// subsystem module in dependency order after the DOM is ready. Without this,
// none of the UI wiring (taskbar, start menu, desktop icons, window manager)
// would be active — the page would render but nothing would respond to clicks.
//
// Note: wm.js has no init() — its handlers are wired lazily on create().
// Each other module's init() is idempotent so re-running on HMR reload is safe.
import * as desktop from './desktop.js';
import { init as taskbarInit } from './taskbar.js';
import { init as startmenuInit } from './startmenu.js';
import { init as contextmenuInit } from './contextmenu.js';

function boot() {
  try {
    taskbarInit();
    startmenuInit();
    contextmenuInit();
    desktop.init();
    console.log('[NocoOS] desktop ready');
  } catch (err) {
    console.error('[NocoOS] desktop init failed:', err);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  // Script is type=module so it always runs after parsing, but be defensive.
  boot();
}

// Expose for HMR / debug — calling boot() again is safe because each
// module's init() guards against duplicate wiring.
if (typeof window !== 'undefined') {
  window.__nocoos_boot = boot;
}