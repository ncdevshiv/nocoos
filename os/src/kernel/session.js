import { randomBytes, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import logger from '../utils/logger.js';

const log = logger.make('session');
const USERS_FILE = path.join(config.dataDir, 'system', 'users.json');

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
    log.info('default user created (username: user, password: nocoos)');
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

  delete(username) {
    const idx = this.users.findIndex((u) => u.username === username);
    if (idx === -1) throw new Error('not_found');
    if (this.users.length === 1) throw new Error('cannot_delete_last_user');
    this.users.splice(idx, 1);
    saveUsers(this.users);
    for (const [token, sess] of this.tokens.entries()) {
      if (sess.username === username) this.tokens.delete(token);
    }
    return true;
  }

  login(username, password) {
    const result = this.verify(username, password);
    if (!result.ok) return result;
    const token = randomBytes(32).toString('hex');
    this.tokens.set(token, {
      username: result.user.username,
      displayName: result.user.displayName,
      isAdmin: result.user.isAdmin,
      createdAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    });
    return { ok: true, token, user: result.user };
  }

  logout(token) {
    return this.tokens.delete(token);
  }

  resolve(token) {
    if (!token) return null;
    const sess = this.tokens.get(token);
    if (!sess) return null;
    if (Date.now() > sess.expiresAt) {
      this.tokens.delete(token);
      return null;
    }
    return sess;
  }

  _cleanup() {
    const now = Date.now();
    for (const [token, sess] of this.tokens.entries()) {
      if (now > sess.expiresAt) this.tokens.delete(token);
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
