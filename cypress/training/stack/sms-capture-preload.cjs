// Training stack only: OpenPhone text sends are written to SMS_CAPTURE_PATH (JSONL) and never delivered.
const fs = require('fs');
const FILE = process.env.SMS_CAPTURE_PATH;
if (!FILE) throw new Error('SMS_CAPTURE_PATH required');
const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  const u = typeof url === 'string' ? url : (url && url.url) || String(url);
  if (u.startsWith('https://api.openphone.com')) {
    const method = String((init && init.method) || 'GET').toUpperCase();
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
    // Lookups (no message is sent): one made-up training line, and empty lists for message and call history.
    if (method === 'GET') {
      if (u.includes('/v1/phone-numbers')) {
        return json({ data: [{ id: 'PNtraining', number: process.env.OPENPHONE_FROM || '+19195550100', name: 'Pharmacy RX (training)' }] });
      }
      return json({ data: [], totalItems: 0 });
    }
    let body = {};
    try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
    fs.appendFileSync(FILE, JSON.stringify({ at: new Date().toISOString(), url: u, to: body.to, from: body.from, content: body.content }) + '\n');
    return new Response(JSON.stringify({ data: { id: 'captured-' + Date.now(), status: 'sent' } }), { status: 202, headers: { 'content-type': 'application/json' } });
  }
  return realFetch.apply(this, arguments);
};
