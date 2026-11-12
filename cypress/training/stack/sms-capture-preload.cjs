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
    // Lookups (no message is sent): one made-up training line; message history is the texts this stack captured
    // plus any client replies a training spec put in sms-inbox.jsonl (owner, Nov 11, 2026: OSV-19 shows a reply).
    if (method === 'GET') {
      if (u.includes('/v1/phone-numbers')) {
        return json({ data: [{ id: 'PNtraining', number: process.env.OPENPHONE_FROM || '+19195550100', name: 'Pharmacy RX (training)' }] });
      }
      if (u.includes('/v1/messages')) {
        const line = process.env.OPENPHONE_FROM || '+19195550100';
        const wanted = new URL(u).searchParams.getAll('participants').map((p) => p.replace(/\D/g, '').slice(-10));
        const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
        const sent = read(FILE).map((r, i) => ({
          id: 'out-' + i, direction: 'outgoing', from: r.from || line, to: Array.isArray(r.to) ? r.to : [r.to],
          text: r.content, content: r.content, body: r.content, createdAt: r.at, phoneNumberId: 'PNtraining',
        }));
        const inbox = read(require('path').join(require('path').dirname(FILE), 'sms-inbox.jsonl')).map((r, i) => ({
          id: 'in-' + i, direction: 'incoming', from: r.from, to: [line],
          text: r.text, content: r.text, body: r.text, createdAt: r.at, phoneNumberId: 'PNtraining',
        }));
        const other = (m) => String(m.direction === 'incoming' ? m.from : m.to[0] || '').replace(/\D/g, '').slice(-10);
        const data = [...sent, ...inbox].filter((m) => !wanted.length || wanted.includes(other(m)));
        return json({ data, totalItems: data.length });
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
