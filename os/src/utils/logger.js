const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const ACTIVE = (process.env.NOCOOS_LOG_LEVEL || 'info').toLowerCase();
const FORMAT = (process.env.NOCOOS_LOG_FORMAT || 'text').toLowerCase();
const FILE_TARGET = process.env.NOCOOS_LOG_FILE || '';
const REDACT_KEYS = ['password', 'token', 'authorization', 'secret', 'cookie'];
import { appendFileSync } from 'node:fs';

function shouldLog(level) {
  return (LEVELS[level] ?? LEVELS.info) >= (LEVELS[ACTIVE] ?? LEVELS.info);
}

function redact(meta) {
  if (!meta || typeof meta !== 'object') return meta;
  const out = Array.isArray(meta) ? [] : {};
  for (const [k, v] of Object.entries(meta)) {
    if (REDACT_KEYS.includes(k.toLowerCase())) {
      out[k] = '[REDACTED]';
    } else if (v && typeof v === 'object') {
      out[k] = redact(v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function formatText(level, scope, msg, meta) {
  const ts = new Date().toISOString();
  const tag = scope ? `[${scope}]` : '';
  const tail = meta && Object.keys(meta).length ? ` ${JSON.stringify(redact(meta))}` : '';
  return `${ts} ${level.toUpperCase()}${tag} ${msg}${tail}`;
}

function formatJson(level, scope, msg, meta) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    scope: scope || null,
    msg,
    ...(meta && Object.keys(meta).length ? { meta: redact(meta) } : {})
  });
}

function emit(level, scope, msg, meta, sink) {
  if (!shouldLog(level)) return;
  const text = FORMAT === 'json' ? formatJson(level, scope, msg, meta) : formatText(level, scope, msg, meta);
  sink(level, text);
  if (FILE_TARGET) {
    try {
      appendFileSync(FILE_TARGET, text + '\n');
    } catch (err) {
      // Fall back to stderr if file write fails — do not throw.
      try { process.stderr.write(`[logger] failed to write log file: ${err.message}\n`); } catch {}
    }
  }
}

function make(scope) {
  return {
    debug: (msg, meta) => emit('debug', scope, msg, meta, (lvl, t) => console.log(t)),
    info: (msg, meta) => emit('info', scope, msg, meta, (lvl, t) => console.log(t)),
    warn: (msg, meta) => emit('warn', scope, msg, meta, (lvl, t) => console.warn(t)),
    error: (msg, meta) => emit('error', scope, msg, meta, (lvl, t) => console.error(t)),
    child: (subScope) => make(scope ? `${scope}.${subScope}` : subScope)
  };
}

export default { make, LEVELS, redact, formatText, formatJson };

