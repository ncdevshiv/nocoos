(function () {
  'use strict';

  const stages = [
    { pct: 8, label: 'Initializing kernel…', log: '[ OK ] kernel: process manager online' },
    { pct: 18, label: 'Mounting virtual filesystem…', log: '[ OK ] vfs: mounted at /data, /host' },
    { pct: 30, label: 'Loading app registry…', log: '[ OK ] apps: 8 builtin apps registered' },
    { pct: 42, label: 'Detecting package managers…', log: '[ OK ] pkg: probing npm/pnpm/bun/yarn' },
    { pct: 56, label: 'Starting session manager…', log: '[ OK ] session: secure token system ready' },
    { pct: 68, label: 'Initializing window manager…', log: '[ OK ] wm: compositor online' },
    { pct: 82, label: 'Preparing desktop…', log: '[ OK ] desktop: rendering surface' },
    { pct: 95, label: 'Ready.', log: '[ OK ] boot complete' },
    { pct: 100, label: 'Welcome.', log: '[ OK ] redirecting to login' }
  ];

  const fill = document.getElementById('boot-fill');
  const label = document.getElementById('boot-label');
  const logEl = document.getElementById('boot-log');

  let i = 0;

  function next() {
    if (i >= stages.length) {
      setTimeout(() => { window.location.href = '/login'; }, 350);
      return;
    }
    const s = stages[i++];
    fill.style.width = s.pct + '%';
    label.textContent = s.label;
    const line = document.createElement('div');
    line.className = 'log-line';
    line.textContent = s.log;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
    setTimeout(next, 220 + Math.random() * 180);
  }

  setTimeout(next, 250);
})();
