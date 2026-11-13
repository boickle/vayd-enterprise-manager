// Training stack only (INV-20, owner Nov 13, 2026): Stripe test mode refuses a past expiry date, so an expired card
// can't be made for real. For each payment method id listed in $TRAINING_EXPIRED_PMS (one per line), this rewrites
// Stripe's answer to GET /v1/payment_methods/<id> so the card expired last month. Everything else passes through, and
// Scout's own expired-card handling (PAY-C5) does the rest.
const fs = require('fs');
const listPath = process.env.TRAINING_EXPIRED_PMS;
const listed = () => {
  try {
    return new Set(fs.readFileSync(listPath, 'utf8').split(/\s+/).filter(Boolean));
  } catch {
    return new Set();
  }
};
const wrap = (realFetch) =>
  async function (input, init) {
    const res = await realFetch(input, init);
    const url = typeof input === 'string' || input instanceof URL ? String(input) : input && input.url;
    const method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    const m = /^https:\/\/api\.stripe\.com\/v1\/payment_methods\/([^/?]+)$/.exec(String(url || ''));
    if (!m || method !== 'GET' || !res.ok || !listed().has(decodeURIComponent(m[1]))) return res;
    const pm = await res.clone().json();
    if (!pm || !pm.card) return res;
    const d = new Date();
    d.setUTCDate(1);
    d.setUTCMonth(d.getUTCMonth() - 1);
    pm.card.exp_month = d.getUTCMonth() + 1;
    pm.card.exp_year = d.getUTCFullYear();
    return new Response(JSON.stringify(pm), { status: res.status, headers: { 'content-type': 'application/json' } });
  };
if (listPath) {
  if (typeof globalThis.fetch === 'function') globalThis.fetch = wrap(globalThis.fetch);
  // The API's Stripe calls use undici's fetch (import { fetch } from 'undici'), not the global one.
  try {
    const undici = require(require.resolve('undici', { paths: [process.cwd()] }));
    if (typeof undici.fetch === 'function') undici.fetch = wrap(undici.fetch);
  } catch {
    // No undici next to the API: the global fetch is the only one.
  }
}
