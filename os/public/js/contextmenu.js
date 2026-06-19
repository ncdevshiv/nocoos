// Context menu utility.

let menuEl = null;
let itemsEl = null;
let initialized = false;

export function init() {
  if (initialized) return;
  initialized = true;
  // Pre-cache element refs and bind document-level dismiss handlers.
  menuEl = document.getElementById('context-menu');
  itemsEl = document.getElementById('context-menu-items');
  document.addEventListener('mousedown', (e) => {
    if (!menuEl || menuEl.hidden) return;
    if (menuEl.contains(e.target)) return;
    hide();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuEl && !menuEl.hidden) hide();
  });
}

// Legacy: ensure() was the original init function, called lazily by show().
// Now both the explicit init() and show() share the same lazy ensure path.
function ensure() {
  init();
  if (!menuEl) menuEl = document.getElementById('context-menu');
  if (!itemsEl) itemsEl = document.getElementById('context-menu-items');
}

export function show(x, y, items) {
  ensure();
  itemsEl.innerHTML = '';
  for (const it of items) {
    if (it.separator) {
      const li = document.createElement('li');
      li.className = 'separator';
      itemsEl.appendChild(li);
      continue;
    }
    const li = document.createElement('li');
    li.className = it.danger ? 'danger' : '';
    if (it.disabled) li.classList.add('disabled');
    li.innerHTML = `${it.icon ? `<span style="width:14px;display:inline-flex">${it.icon}</span>` : ''}<span>${escapeHtml(it.label || '')}</span>${it.shortcut ? `<span style="margin-left:auto;color:var(--muted);font-size:0.78rem">${escapeHtml(it.shortcut)}</span>` : ''}`;
    li.addEventListener('click', () => {
      hide();
      if (it.disabled) return;
      try { it.onClick && it.onClick(); } catch (err) { console.error(err); }
    });
    itemsEl.appendChild(li);
  }
  menuEl.hidden = false;
  menuEl.style.left = '0px';
  menuEl.style.top = '0px';
  const rect = menuEl.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width - 4;
  const maxY = window.innerHeight - rect.height - 4;
  menuEl.style.left = Math.min(x, maxX) + 'px';
  menuEl.style.top = Math.min(y, maxY) + 'px';
}

export function hide() {
  if (!menuEl) return;
  menuEl.hidden = true;
}

export default { show, hide };
