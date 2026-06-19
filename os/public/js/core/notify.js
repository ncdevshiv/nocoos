// Lightweight notification/toast system.

const stack = () => document.getElementById('notification-stack');

let counter = 0;

function makeEl(opts) {
  const el = document.createElement('div');
  el.className = `notification ${opts.level || ''}`;
  el.innerHTML = `
    <div class="notification-icon">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="13"/><line x1="12" y1="16.5" x2="12" y2="16.5"/>
      </svg>
    </div>
    <div class="notification-body">
      <div class="notification-title">${escapeHtml(opts.title || '')}</div>
      <div class="notification-message">${escapeHtml(opts.message || '')}</div>
    </div>
  `;
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function show(opts) {
  const s = stack();
  if (!s) return;
  const el = makeEl(opts);
  const id = ++counter;
  el.dataset.id = id;
  s.appendChild(el);
  const ttl = opts.ttl ?? (opts.level === 'error' ? 6000 : 3500);
  if (ttl > 0) {
    setTimeout(() => dismiss(id), ttl);
  }
  el.addEventListener('click', () => dismiss(id));
  return id;
}

function dismiss(id) {
  const s = stack();
  if (!s) return;
  const el = s.querySelector(`[data-id="${id}"]`);
  if (!el) return;
  el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
  el.style.opacity = '0';
  el.style.transform = 'translateX(20px)';
  setTimeout(() => el.remove(), 220);
}

export const notify = {
  info: (title, message, opts) => show({ ...(opts || {}), title, message }),
  success: (title, message, opts) => show({ ...(opts || {}), title, message, level: 'success' }),
  warn: (title, message, opts) => show({ ...(opts || {}), title, message, level: 'warn' }),
  error: (title, message, opts) => show({ ...(opts || {}), title, message, level: 'error', ttl: 7000 }),
  dismiss,
  show
};

export default notify;
