// Training stack only: the API must not reach real outside services from a test stack.
// Blocks the Datadog log intake (src/logger/logger.ts ships every line there even with no key) and
// Google's Gmail / People / OAuth APIs, and records each blocked call in $NET_GUARD_LOG (one JSON line).
const fs = require('fs');
const http = require('http');
const https = require('https');
const BLOCKED = [
  'http-intake.logs.datadoghq.com',
  'gmail.googleapis.com',
  'people.googleapis.com',
  'oauth2.googleapis.com',
  'www.googleapis.com',
];
const logPath = process.env.NET_GUARD_LOG;
const isBlocked = (host) => BLOCKED.some((b) => String(host || '').toLowerCase().split(':')[0] === b);
const note = (host, path) => {
  if (logPath && !String(host).includes('datadoghq')) {
    fs.appendFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), host, path }) + '\n');
  }
};
const hostOf = (args) => {
  const a = args[0];
  if (typeof a === 'string' || a instanceof URL) { const u = new URL(String(a)); return [u.hostname, u.pathname]; }
  return [(a && (a.hostname || a.host)) || '', (a && a.path) || ''];
};
for (const mod of [http, https]) {
  for (const fn of ['request', 'get']) {
    const real = mod[fn];
    mod[fn] = function (...args) {
      const [host, path] = hostOf(args);
      if (isBlocked(host)) {
        note(host, path);
        const err = new Error(`net-guard: ${host} is blocked on the training stack`);
        err.code = 'ENETGUARD';
        // A request on a dummy socket that never connects anywhere, failing once with err.
        const { Duplex } = require('stream');
        const sock = new Duplex({ read() {}, write(_c, _e, cb) { cb(); } });
        const req = new http.ClientRequest({ host: '127.0.0.1', port: 9, createConnection: () => sock });
        process.nextTick(() => req.emit('error', err));
        return req;
      }
      return real.apply(this, args);
    };
  }
}
const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  const u = new URL(typeof url === 'string' || url instanceof URL ? String(url) : url.url);
  if (isBlocked(u.hostname)) {
    note(u.hostname, u.pathname);
    throw Object.assign(new Error(`net-guard: ${u.hostname} is blocked on the training stack`), { code: 'ENETGUARD' });
  }
  return realFetch.call(this, url, init);
};
// The API also calls out through undici (import { fetch } from 'undici': Stripe, Google and others), which
// bypasses globalThis.fetch. Guard undici's fetch, request and stream the same way.
try {
  const undici = require(require.resolve('undici', { paths: [process.cwd()] }));
  const urlOf = (a) => {
    if (typeof a === 'string' || a instanceof URL) return new URL(String(a));
    if (a && a.url) return new URL(String(a.url));
    if (a && a.origin) return new URL(String(a.origin));
    return null;
  };
  for (const fn of ['fetch', 'request', 'stream']) {
    const real = undici[fn];
    if (typeof real !== 'function') continue;
    undici[fn] = function (target, ...rest) {
      const u = urlOf(target);
      if (u && isBlocked(u.hostname)) {
        note(u.hostname, u.pathname);
        return Promise.reject(Object.assign(new Error(`net-guard: ${u.hostname} is blocked on the training stack`), { code: 'ENETGUARD' }));
      }
      return real.call(this, target, ...rest);
    };
  }
} catch {
  // No undici next to the API: the guards above cover it.
}
