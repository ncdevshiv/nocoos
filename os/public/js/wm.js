// Window manager: creates draggable, resizable, focusable windows with full taskbar integration.
import icons from './core/icons.js';
import notify from './core/notify.js';

const TASKBAR_HEIGHT = 52;
const Z_BASE = 100;
let zCounter = Z_BASE;
let nextWinId = 1;

const windows = new Map();
const listeners = {
  open: new Set(),
  close: new Set(),
  focus: new Set(),
  change: new Set()
};

function emit(event, payload) {
  for (const cb of listeners[event]) {
    try { cb(payload); } catch (err) { console.error('wm listener error', err); }
  }
}

export function on(event, cb) {
  if (!listeners[event]) throw new Error(`Unknown event: ${event}`);
  listeners[event].add(cb);
  return () => listeners[event].delete(cb);
}

export function list() {
  return Array.from(windows.values()).map((w) => w.summary());
}

export function get(id) {
  return windows.get(id) || null;
}

export function focused() {
  return Array.from(windows.values()).find((w) => w.state.focused) || null;
}

function focusWindow(w) {
  for (const other of windows.values()) {
    if (other !== w && other.state.focused) {
      other.state.focused = false;
      other.el.classList.remove('active');
      emit('focus', other.summary());
    }
  }
  w.state.focused = true;
  w.el.style.zIndex = String(++zCounter);
  w.el.classList.add('active');
  if (w.state.minimized) {
    w.state.minimized = false;
    w.el.classList.remove('minimized');
    w.el.style.display = '';
  }
  emit('focus', w.summary());
  emit('change', { reason: 'focus', window: w.summary() });
}

class NocoWindow {
  constructor(opts) {
    this.id = opts.id || `w-${nextWinId++}`;
    this.appId = opts.appId || null;
    this.title = opts.title || 'Untitled';
    this.icon = opts.icon || null;
    this.iconHtml = opts.iconHtml || null;
    this.width = opts.width || 720;
    this.height = opts.height || 480;
    this.minWidth = opts.minWidth || 320;
    this.minHeight = opts.minHeight || 200;
    this.resizable = opts.resizable !== false;
    this.maximizable = opts.maximizable !== false;
    this.minimizable = opts.minimizable !== false;
    this.closable = opts.closable !== false;
    this.singleton = opts.singleton || false;
    this.state = {
      x: 0, y: 0, width: this.width, height: this.height,
      minimized: false, maximized: false, focused: true,
      prev: null
    };
    this.handlers = { onClose: null, onFocus: null, onResize: null, onMove: null };
    this.el = this._build();
    this.body = this.el.querySelector('.window-body');
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'window';
    el.dataset.windowId = this.id;
    el.style.width = this.width + 'px';
    el.style.height = this.height + 'px';

    const header = document.createElement('div');
    header.className = 'window-header';

    const title = document.createElement('div');
    title.className = 'window-title';
    const iconWrap = document.createElement('span');
    iconWrap.className = 'window-icon';
    iconWrap.innerHTML = this.iconHtml || (this.icon ? icons.get(this.icon, { size: 12, stroke: 2.4 }) : icons.get('apps', { size: 12, stroke: 2.4 }));
    title.appendChild(iconWrap);
    const titleText = document.createElement('span');
    titleText.className = 'window-title-text';
    titleText.textContent = this.title;
    title.appendChild(titleText);
    header.appendChild(title);

    const controls = document.createElement('div');
    controls.className = 'window-controls';
    if (this.minimizable) {
      const b = this._control('minimize', icons.get('minimize', { size: 12, stroke: 2.4 }));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.minimize(); });
      controls.appendChild(b);
    }
    if (this.maximizable) {
      const b = this._control('maximize', icons.get('maximize', { size: 12, stroke: 2.4 }));
      b.addEventListener('click', (e) => { e.stopPropagation(); this.toggleMaximize(); });
      controls.appendChild(b);
    }
    if (this.closable) {
      const b = this._control('close', icons.get('close', { size: 12, stroke: 2.4 }));
      b.classList.add('close');
      b.addEventListener('click', (e) => { e.stopPropagation(); this.close(); });
      controls.appendChild(b);
    }
    header.appendChild(controls);

    const body = document.createElement('div');
    body.className = 'window-body';
    if (opts_allowSelect(this)) body.classList.add('allow-select');

    el.appendChild(header);
    el.appendChild(body);

    this._bindDrag(header);
    if (this.resizable) this._bindResizers(el);
    el.addEventListener('mousedown', () => focusWindow(this));

    return el;
  }

  _control(kind, svg) {
    const b = document.createElement('button');
    b.className = `window-control ${kind}`;
    b.title = kind.charAt(0).toUpperCase() + kind.slice(1);
    b.innerHTML = svg;
    return b;
  }

  _bindDrag(handle) {
    let dragging = false;
    let startX, startY, originX, originY;
    const onDown = (e) => {
      if (e.target.closest('.window-control')) return;
      if (this.state.maximized) return;
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = this.el.getBoundingClientRect();
      originX = rect.left;
      originY = rect.top;
      document.body.classList.add('dragging');
      e.preventDefault();
    };
    const onMove = (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      this.state.x = Math.max(0, Math.min(window.innerWidth - 100, originX + dx));
      this.state.y = Math.max(0, Math.min(window.innerHeight - TASKBAR_HEIGHT - 50, originY + dy));
      this.el.style.left = this.state.x + 'px';
      this.el.style.top = this.state.y + 'px';
    };
    const onUp = () => {
      if (dragging) {
        dragging = false;
        document.body.classList.remove('dragging');
        if (this.handlers.onMove) try { this.handlers.onMove(this.summary()); } catch {}
      }
    };
    handle.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  _bindResizers(el) {
    const dirs = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se'];
    const dirHandles = [];
    for (const d of dirs) {
      const h = document.createElement('div');
      h.className = `window-resizer ${d}`;
      el.appendChild(h);
      dirHandles.push({ h, dir: d });
    }
    let active = null;
    let startX, startY, startW, startH, startL, startT;
    for (const { h, dir } of dirHandles) {
      h.addEventListener('mousedown', (e) => {
        if (this.state.maximized) return;
        e.preventDefault();
        e.stopPropagation();
        active = dir;
        const rect = this.el.getBoundingClientRect();
        startX = e.clientX;
        startY = e.clientY;
        startW = rect.width;
        startH = rect.height;
        startL = rect.left;
        startT = rect.top;
        document.body.classList.add('dragging');
        focusWindow(this);
      });
    }
    window.addEventListener('mousemove', (e) => {
      if (!active) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      let newW = startW, newH = startH, newL = startL, newT = startT;
      if (active.includes('e')) newW = Math.max(this.minWidth, startW + dx);
      if (active.includes('s')) newH = Math.max(this.minHeight, startH + dy);
      if (active.includes('w')) {
        newW = Math.max(this.minWidth, startW - dx);
        if (newW > this.minWidth) newL = startL + dx;
      }
      if (active.includes('n')) {
        newH = Math.max(this.minHeight, startH - dy);
        if (newH > this.minHeight) newT = startT + dy;
      }
      this.el.style.width = newW + 'px';
      this.el.style.height = newH + 'px';
      this.el.style.left = newL + 'px';
      this.el.style.top = newT + 'px';
      this.state.width = newW;
      this.state.height = newH;
      this.state.x = newL;
      this.state.y = newT;
      if (this.handlers.onResize) try { this.handlers.onResize(this.summary()); } catch {}
    });
    window.addEventListener('mouseup', () => {
      if (active) {
        active = null;
        document.body.classList.remove('dragging');
      }
    });
  }

  summary() {
    return {
      id: this.id,
      appId: this.appId,
      title: this.title,
      icon: this.icon,
      iconHtml: this.iconHtml,
      x: this.state.x, y: this.state.y,
      width: this.state.width, height: this.state.height,
      minimized: this.state.minimized,
      maximized: this.state.maximized,
      focused: this.state.focused,
      singleton: this.singleton
    };
  }

  setTitle(t) { this.title = t; this.el.querySelector('.window-title-text').textContent = t; emit('change', { reason: 'title', window: this.summary() }); }
  setIcon(name, html) {
    if (html) this.iconHtml = html;
    else if (name) this.icon = name;
    const el = this.el.querySelector('.window-icon');
    if (el) el.innerHTML = this.iconHtml || (this.icon ? icons.get(this.icon, { size: 12, stroke: 2.4 }) : '');
  }

  mount(parent) {
    parent.appendChild(this.el);
  }

  setContent(el) {
    this.body.innerHTML = '';
    if (el) this.body.appendChild(el);
  }

  appendContent(el) {
    this.body.appendChild(el);
  }

  setBodyClass(name) { this.body.className = `window-body ${name || ''}`.trim(); }

  minimize() {
    this.state.minimized = true;
    this.el.classList.add('minimized');
    this.el.style.display = 'none';
    emit('change', { reason: 'minimize', window: this.summary() });
  }

  restore() {
    this.state.minimized = false;
    this.state.maximized = false;
    this.el.classList.remove('minimized');
    this.el.classList.remove('maximized');
    this.el.style.display = '';
    if (this.state.prev) {
      const p = this.state.prev;
      this.el.style.left = p.x + 'px';
      this.el.style.top = p.y + 'px';
      this.el.style.width = p.width + 'px';
      this.el.style.height = p.height + 'px';
      this.state.x = p.x; this.state.y = p.y; this.state.width = p.width; this.state.height = p.height;
    }
    focusWindow(this);
  }

  toggleMaximize() {
    if (this.state.maximized) {
      this.state.maximized = false;
      this.el.classList.remove('maximized');
      if (this.state.prev) {
        const p = this.state.prev;
        this.el.style.left = p.x + 'px';
        this.el.style.top = p.y + 'px';
        this.el.style.width = p.width + 'px';
        this.el.style.height = p.height + 'px';
        this.state.x = p.x; this.state.y = p.y; this.state.width = p.width; this.state.height = p.height;
      }
    } else {
      this.state.prev = {
        x: this.state.x, y: this.state.y,
        width: this.state.width, height: this.state.height
      };
      this.state.maximized = true;
      this.el.classList.add('maximized');
      this.el.style.left = '0px';
      this.el.style.top = '0px';
      this.el.style.width = window.innerWidth + 'px';
      this.el.style.height = (window.innerHeight - TASKBAR_HEIGHT) + 'px';
      this.state.x = 0; this.state.y = 0;
      this.state.width = window.innerWidth;
      this.state.height = window.innerHeight - TASKBAR_HEIGHT;
    }
    emit('change', { reason: 'maximize', window: this.summary() });
  }

  focus() { focusWindow(this); }
  close() {
    if (this.handlers.onClose) {
      try {
        const r = this.handlers.onClose(this.summary());
        if (r === false) return;
      } catch {}
    }
    this.el.remove();
    windows.delete(this.id);
    emit('close', this.summary());
    emit('change', { reason: 'close', window: this.summary() });
  }

  on(event, cb) {
    if (!(event in this.handlers)) throw new Error(`Unknown window event: ${event}`);
    this.handlers[event] = cb;
    return this;
  }
}

function opts_allowSelect(w) {
  return w.body && w.body.classList && w.body.classList.contains('allow-select');
}

export function create(opts = {}) {
  if (opts.singleton) {
    const existing = Array.from(windows.values()).find((w) => w.appId === opts.appId && w.singleton);
    if (existing) { existing.focus(); return existing; }
  }
  const w = new NocoWindow(opts);
  windows.set(w.id, w);

  const container = document.getElementById('windows');
  w.mount(container);

  // Center if not positioned
  if (w.state.x === 0 && w.state.y === 0) {
    const cw = w.width, ch = w.height;
    const maxW = window.innerWidth, maxH = window.innerHeight - TASKBAR_HEIGHT;
    const cx = Math.max(20, (maxW - cw) / 2);
    const cy = Math.max(20, (maxH - ch) / 2);
    w.state.x = cx; w.state.y = cy;
    w.el.style.left = cx + 'px';
    w.el.style.top = cy + 'px';
  }

  focusWindow(w);
  emit('open', w.summary());
  emit('change', { reason: 'open', window: w.summary() });
  return w;
}

window.addEventListener('resize', () => {
  for (const w of windows.values()) {
    if (w.state.maximized) {
      w.el.style.width = window.innerWidth + 'px';
      w.el.style.height = (window.innerHeight - TASKBAR_HEIGHT) + 'px';
      w.state.width = window.innerWidth;
      w.state.height = window.innerHeight - TASKBAR_HEIGHT;
    }
  }
});

export default { create, list, get, focused, on };
