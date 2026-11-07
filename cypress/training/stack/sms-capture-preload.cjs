// Training stack only: OpenPhone text sends are written to SMS_CAPTURE_PATH (JSONL) and never delivered.
const fs = require('fs');
const FILE = process.env.SMS_CAPTURE_PATH;
if (!FILE) throw new Error('SMS_CAPTURE_PATH required');
const realFetch = globalThis.fetch;
globalThis.fetch = async function (url, init) {
  const u = typeof url === 'string' ? url : (url && url.url) || String(url);
  if (u.startsWith('https://api.openphone.com')) {
    let body = {};
    try { body = JSON.parse((init && init.body) || '{}'); } catch (e) {}
    fs.appendFileSync(FILE, JSON.stringify({ at: new Date().toISOString(), url: u, to: body.to, from: body.from, content: body.content }) + '\n');
    return new Response(JSON.stringify({ data: { id: 'captured-' + Date.now(), status: 'sent' } }), { status: 202, headers: { 'content-type': 'application/json' } });
  }
  return realFetch.apply(this, arguments);
};
