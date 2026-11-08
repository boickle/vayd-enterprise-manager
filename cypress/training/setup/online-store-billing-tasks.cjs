/**
 * OSV-12 demo data: makes Scout open its store Billing tasks the real way, by posting signed TEST Stripe webhook
 * events to the training API. Test mode only; never a live key.
 *   NODE_PATH=$API_DIR/node_modules node cypress/training/setup/online-store-billing-tasks.cjs <test db> <osv-world.json> <api url>
 * - Tom Chen gets a monthly Joint support chews auto-ship for Biscuit (a made-up Stripe subscription id).
 * - "invoice.payment_failed" (Stripe has given up) then "customer.subscription.deleted" for it: Scout marks the
 *   auto-ship "Ended: card failed" and opens a Billing task to call Tom.
 * The training API must run with CONTROL_DB_ENABLED=false, so it reads STRIPE_WEBHOOK_SECRET from its .env.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config({ path: path.join(process.env.API_DIR || '', '.env'), quiet: true });

const [, , database, osvFile, apiUrl] = process.argv;
if (!/^vayd_api_test[A-Za-z0-9_]*$/.test(database || '')) {
  console.error(`Refusing: ${database} is not a vayd_api_test* database`);
  process.exit(2);
}
if (!/^sk_test_/.test(process.env.STRIPE_SECRET_KEY || '')) {
  console.error('Refusing: the API .env has no sk_test_ Stripe key');
  process.exit(2);
}
const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
if (!secret) {
  console.error('No STRIPE_WEBHOOK_SECRET in the API .env');
  process.exit(2);
}
const o = JSON.parse(fs.readFileSync(osvFile, 'utf8'));
const pool = new Pool({ host: 'localhost', port: 5432, user: 'vayd', password: 'vayd', database });
const q = async (sql, p) => (await pool.query(sql, p)).rows;

const post = async (type, object) => {
  const event = { id: `evt_osv_${Date.now()}_${Math.floor(Math.random() * 1e6)}`, object: 'event', api_version: '2024-06-20', created: Math.floor(Date.now() / 1000), livemode: false, type, data: { object } };
  const body = JSON.stringify(event);
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  const res = await fetch(`${apiUrl}/stripe/webhooks`, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': `t=${t},v1=${sig}` }, body });
  console.log(`${type}: ${res.status}`);
  if (!res.ok) console.log((await res.text()).slice(0, 300));
};

(async () => {
  const sub = 'sub_osv_demo_chen_biscuit';
  await q(`DELETE FROM online_store_subscriptions WHERE "stripeSubscriptionId" = $1`, [sub]);
  const [client] = await q(`SELECT "firstName" || ' ' || "lastName" AS name, email FROM clients WHERE id = $1`, [o.clients.chen]);
  await q(
    `INSERT INTO online_store_subscriptions ("practiceId","inventoryItemId","clientId","patientId","customerEmail",frequency,"renewalDate",
       "stripeSubscriptionId","stripeCustomerId",active,"itemName",quantity,"unitPrice","taxRate","customerName","shipName","shipLine1","shipCity","shipState","shipPostal")
     VALUES (1,$1,$2,$3,$4,'every_month',(now() + interval '3 days')::date,$5,'cus_osv_demo_chen',true,'Joint support chews (60 ct)',1,36,0,$6,$6,'22 Pine Street','Raleigh','NC','27601')`,
    [o.items.joint, o.clients.chen, o.pets.biscuit, client.email, sub, client.name],
  );
  await post('invoice.payment_failed', {
    id: `in_osv_${Date.now()}`, object: 'invoice', subscription: sub, customer: 'cus_osv_demo_chen', customer_email: client.email,
    billing_reason: 'subscription_cycle', amount_due: 3600, amount_paid: 0, currency: 'usd', status: 'open',
    attempt_count: 4, next_payment_attempt: null, hosted_invoice_url: 'https://invoice.stripe.test/osv',
  });
  await post('customer.subscription.deleted', {
    id: sub, object: 'subscription', status: 'canceled', customer: 'cus_osv_demo_chen', cancel_at_period_end: false,
    items: { data: [{ id: `si_${sub}`, price: { id: 'price_osv_demo', nickname: 'Auto-ship' } }] }, metadata: {},
  });
  const [row] = await q(`SELECT active, "paymentStatus" FROM online_store_subscriptions WHERE "stripeSubscriptionId" = $1`, [sub]);
  console.log(`Tom's auto-ship: active=${row.active} paymentStatus=${row.paymentStatus}`);
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
