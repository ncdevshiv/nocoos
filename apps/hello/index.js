// Sample NocoOS user app.
//
// User-installed apps follow this convention:
//   - /js/<id>/index.js is the entry point served by the kernel.
//   - It must export an `open()` async function that returns a window handle.
//   - It can import from `/js/core/{api,wm,notify,icons}.js` like the built-in
//     apps do. The full built-in API surface is available.
//
// This sample app shows a greeting, the current time, and a button that
// increments a counter. It exists to prove the apps/* workspace works
// end-to-end: install via `pnpm install`, the kernel auto-loads the manifest,
// and the launcher picks it up.

import icons from '../core/icons.js';
import wm from '../wm.js';

const ICON_HTML = (() => {
  const wrap = document.createElement('div');
  wrap.innerHTML = icons.get('star', { size: 12, stroke: 2.4 });
  return wrap.innerHTML;
})();

let count = 0;

export async function open() {
  const win = wm.create({
    appId: 'hello',
    title: 'Hello — Sample App',
    icon: 'star',
    iconHtml: ICON_HTML,
    width: 420,
    height: 280,
    minWidth: 320,
    minHeight: 220,
    singleton: false
  });

  const root = document.createElement('div');
  root.style.padding = '1.5rem';
  root.style.display = 'flex';
  root.style.flexDirection = 'column';
  root.style.gap = '0.8rem';
  root.style.fontFamily = 'var(--font-sans)';

  const greeting = document.createElement('div');
  greeting.style.fontSize = '1.4rem';
  greeting.style.fontWeight = '600';
  greeting.textContent = '👋 Hello from a user-installed app!';

  const sub = document.createElement('div');
  sub.style.color = 'var(--muted)';
  sub.style.fontSize = '0.9rem';
  sub.textContent = 'You are running apps/hello — the apps/* workspace is wired up.';

  const counter = document.createElement('div');
  counter.style.fontFamily = 'var(--font-mono)';
  counter.style.fontSize = '1.05rem';
  counter.style.marginTop = '0.4rem';

  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.textContent = 'Click me';
  btn.addEventListener('click', () => {
    count += 1;
    counter.textContent = `Clicked ${count} time${count === 1 ? '' : 's'}.`;
  });
  // Initial render.
  counter.textContent = `Clicked ${count} times.`;

  root.appendChild(greeting);
  root.appendChild(sub);
  root.appendChild(counter);
  root.appendChild(btn);

  win.setContent(root);
  return win;
}

export default { open };