import { randomBytes, createHash, createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import logger from '../utils/logger.js';

const log = logger.make('session');
const USERS_FILE = path.join(config.dataDir, 'system', 'users.json');
const DEFAULT_SECRET = 'nocoos-dev-secret-change-me';
const secret = config.sessionSecret || DEFAULT_SECRET;
if (secret === DEFAULT_SECRET) {
  log.warn('using default session secret — set NOCOOS_SESSION_SECRET to a long random string for production');
}

function loadUsers() {
  try {
    if (fs.existsSync(USERS_FILE)) {
      const raw = fs.readFileSync(USERS_FILE, 'utf8');
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return arr;
    }
  } catch (err) {
    log.warn('failed to load users', { err: err.message });
  }
  return [];
}

function saveUsers(users) {
  fs.mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
}

function hashPassword(pw, salt) {
  return createHash('sha256').update(`${salt}::${pw}`).digest('hex');
}

// HMAC-signed token: <payload>.<signature>
//   payload   = base64url(JSON({u:username, d:displayName, a:isAdmin, e:expiresAt}))
//   signature = base64url(HMAC-SHA256(payload, secret))
// The signature binds the token to the server's session secret, so a stolen
// token alone (without the secret) can't be forged or used by an attacker
// running their own NocoOS instance.
function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
function signToken(payload) {
  const json = JSON.stringify(payload);
  const b64 = b64urlEncode(json);
  const sig = b64urlEncode(createHmac('sha256', secret).update(b64).digest());
  return `${b64}.${sig}`;
}
function verifyToken(token) {
  const dot = token.indexOf('.');
  if (dot === -1) return null;
  const b64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = b64urlEncode(createHmac('sha256', secret).update(b64).digest());
  // Constant-time comparison to avoid timing attacks on the signature.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    return JSON.parse(b64urlDecode(b64).toString('utf8'));
  } catch { return null; }
}

function defaultPrefs() {
  return {
    accent: '#7c5cff',
    accent2: '#22d3ee',
    wallpaper: 'aurora',
    animate: true,
    showIcons: true,
    confirmDelete: true
  };
}

function ensureDefaultUser() {
  const users = loadUsers();
  if (users.length === 0) {
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword('nocoos', salt);
    users.push({
      username: 'user',
      displayName: 'User',
      salt,
      passwordHash,
      isAdmin: true,
      createdAt: Date.now()
    });
    saveUsers(users);
    // Don't log the password — the redaction helper only redacts object fields,
    // not substrings of free-form messages. The bootstrap password is documented
    // in README.md; users who need to reset it can delete os/data/system/users.json.
    log.info('default user created (username: user; see README for bootstrap password)');
  }
  return users;
}

class SessionManager {
  constructor() {
    this.users = ensureDefaultUser();
    this.tokens = new Map();
    this.cleanupTimer = setInterval(() => this._cleanup(), 60 * 1000);
    if (this.cleanupTimer.unref) this.cleanupTimer.unref();
  }

  listUsers() {
    return this.users.map((u) => ({
      username: u.username,
      displayName: u.displayName,
      isAdmin: !!u.isAdmin,
      createdAt: u.createdAt
    }));
  }

  verify(username, password) {
    const user = this.users.find((u) => u.username === username);
    if (!user) return { ok: false, error: 'invalid_credentials' };
    const hash = hashPassword(password, user.salt);
    if (hash !== user.passwordHash) return { ok: false, error: 'invalid_credentials' };
    return { ok: true, user: { username: user.username, displayName: user.displayName, isAdmin: user.isAdmin } };
  }

  create(user) {
    const { username, password, displayName, isAdmin } = user;
    if (!username || !password) throw new Error('username and password required');
    if (this.users.find((u) => u.username === username)) throw new Error('user_exists');
    const salt = randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, salt);
    const newUser = {
      username,
      displayName: displayName || username,
      salt,
      passwordHash,
      isAdmin: !!isAdmin,
      createdAt: Date.now()
    };
    this.users.push(newUser);
    saveUsers(this.users);
    return { username: newUser.username, displayName: newUser.displayName, isAdmin: newUser.isAdmin };
  }

  setPassword(username, newPassword) {
    const user = this.users.find((u) => u.username === username);
    if (!user) throw new Error('not_found');
    user.salt = randomBytes(16).toString('hex');
    user.passwordHash = hashPassword(newPassword, user.salt);
    saveUsers(this.users);
    return true;
  }

  // Per-user preferences (theme, switches). Stored on the user record itself
  // so settings survive restarts. Defaults are merged in on first read.
  getPrefs(username) {
    const user = this.users.find((u) => u.username === username);
    if (!user) throw new Error('not_found');
    return { ...defaultPrefs(), ...(user.prefs || {}) };
  }

  setPrefs(username, partial) {
    const user = this.users.find((u) => u.username === username);
    if (!user) throw new Error('not_found');
    const allowed = Object.keys(defaultPrefs());
    const merged = { ...defaultPrefs(), ...(user.prefs || {}) };
    for (const [k, v] of Object.entries(partial || {})) {
      if (!allowed.includes(k)) continue;
      if (typeof v !== typeof merged[k]) continue;
      merged[k] = v;
    }
    user.prefs = merged;
    saveUsers(this.users);
    return merged;
  }

  delete(username) {
    const idx = this.users.findIndex((u) => u.username === username);
    if (idx === -1) throw new Error('not_found');
    if (this.users.length === 1) throw new Error('cannot_delete_last_user');
    this.users.splice(idx, 1);
    saveUsers(this.users);
    for (const [token, sess] of this.tokens.entries()) {
      if (sess.u === username) this.tokens.delete(token);
    }
    return true;
  }

  login(username, password) {
    const result = this.verify(username, password);
    if (!result.ok) return result;
    const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
    const payload = {
      u: result.user.username,
      d: result.user.displayName,
      a: result.user.isAdmin,
      e: expiresAt
    };
    const token = signToken(payload);
    this.tokens.set(token, payload);
    return { ok: true, token, user: result.user };
  }

  logout(token) {
    return this.tokens.delete(token);
  }

  resolve(token) {
    if (!token) return null;
    // Verify HMAC signature first (cheap, no DB). Then check expiry and
    // the in-memory revocation set.
    const payload = verifyToken(token);
    if (!payload) return null;
    if (Date.now() > payload.e) return null;
    if (!this.tokens.has(token)) return null;
    // Translate compact payload keys back to the canonical session shape
    // used by the rest of the kernel.
    return {
      username: payload.u,
      displayName: payload.d,
      isAdmin: !!payload.a,
      createdAt: payload.e - 24 * 60 * 60 * 1000,
      expiresAt: payload.e
    };
  }

  _cleanup() {
    const now = Date.now();
    for (const [token, sess] of this.tokens.entries()) {
      if (now > sess.e) this.tokens.delete(token);
    }
  }

  activeSessions() {
    return Array.from(this.tokens.entries()).map(([token, s]) => ({
      token: token.slice(0, 8) + '…',
      username: s.username,
      displayName: s.displayName,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt
    }));
  }
}

const instance = new SessionManager();
export default instance;
