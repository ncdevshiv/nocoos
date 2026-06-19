// Core API client. Wraps fetch with auth, JSON, error handling, and streaming helpers.

const TOKEN_KEY = 'nocoos_token';
const USER_KEY = 'nocoos_user';

export function getToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function setToken(token) {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}

export function getUser() {
  try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
}

export function setUser(user) {
  if (user) sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  else sessionStorage.removeItem(USER_KEY);
}

export function logout() {
  setToken('');
  setUser(null);
  window.location.href = '/login';
}

async function request(method, path, { body, headers, query } = {}) {
  const url = new URL(path, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      ...(headers || {})
    }
  };
  if (body !== undefined && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';
    opts.body = typeof body === 'string' ? body : JSON.stringify(body);
  } else if (body instanceof FormData) {
    opts.body = body;
  }
  const resp = await fetch(url.toString(), opts);
  if (resp.status === 401) {
    logout();
    throw new Error('Unauthorized');
  }
  if (!resp.ok) {
    let err = { error: resp.statusText, message: '' };
    try { err = await resp.json(); } catch {}
    const e = new Error(err.message || err.error || resp.statusText);
    e.status = resp.status;
    e.code = err.error;
    throw e;
  }
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('application/json')) return resp.json();
  return resp.text();
}

export const api = {
  get: (path, opts) => request('GET', path, opts),
  post: (path, body, opts) => request('POST', path, { ...(opts || {}), body }),
  put: (path, body, opts) => request('PUT', path, { ...(opts || {}), body }),
  patch: (path, body, opts) => request('PATCH', path, { ...(opts || {}), body }),
  delete: (path, opts) => request('DELETE', path, opts),
  upload: (path, file, { query } = {}) => {
    const fd = new FormData();
    fd.append('file', file);
    return request('POST', path, { body: fd, query });
  },
  getRaw: async (path, query) => {
    const url = new URL(path, window.location.origin);
    if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    const resp = await fetch(url.toString(), { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return resp;
  }
};

export default api;
