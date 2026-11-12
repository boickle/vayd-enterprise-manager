/**
 * Online Store training demo data (OSV videos), on top of the training stack's seeded world.
 *   NODE_PATH=$API_DIR/node_modules node cypress/training/setup/online-store-demo.cjs <test db> <world.json> <out.json>
 * Writes ONLY to a vayd_api_test* database. Invented product names; the Riveras and Chens from demo-names.sh.
 * - Takes every other store product and item off the store, so only the demo catalog shows; old unlisted products
 *   are dropped so Removed stays empty, and leftover consent-filing tasks from earlier test runs are closed.
 * - Demo catalog: Dental chews (OTC), Joint support chews (OTC, monthly), Heartworm & flea chewable (Rx),
 *   Thyroid tablets (Rx), a Gift card product, and an unlisted controlled item (Gabapentin) for OSV-15.
 * - Maple: heartworm Rx with 3 refills (Dr. Avery Lane). Juniper: thyroid Rx with no refills left.
 * - Tom Chen: an old eVet invoice ($85 open) and a portal login. A $50 gift card for the balance check.
 * - Riley Brooks, mail order team (and a login); Robin Hale also gets mail_order_manager.
 * - Morgan Ellis, Billing / AR (and a login), so store Billing tasks land in the billing queue (Q12a). The role is
 *   added when the test database lacks it, as the scout-permissions migration defines it.
 * Tokens for the new logins go to <out.json> (outside the repo). Nothing is printed except ids.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { sign } = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config({ path: path.join(process.env.API_DIR || '', '.env') });

const [, , database, worldFile, outFile] = process.argv;
if (!/^vayd_api_test[A-Za-z0-9_]*$/.test(database || '')) {
  console.error(`Refusing: ${database} is not a vayd_api_test* database`);
  process.exit(2);
}
const w = JSON.parse(fs.readFileSync(worldFile, 'utf8'));
const pool = new Pool({ host: 'localhost', port: 5432, user: 'vayd', password: process.env.DB_PASSWORD || 'vayd', database });
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const P = w.practiceId;
const TAG = 'osv-demo';
const secret = (process.env.JWT_PRIVATE_KEY || '').replace(/\\n/g, '\n');

async function item(name, price, o = {}) {
  const r = await one(
    `INSERT INTO inventory_items ("practiceId","pimsType","pimsId",name,price,cost,"taxLevelValue","showOnOnlineStore","onlineStorePrice",
       "requiresDoctorApproval","isMedication","isControlled","isActive","trackLots","autoshipRecommendedFrequency")
     VALUES ($1,'scout',$2,$3,$4,$5,$6,$7,$8,$9,$9,$10,true,false,$11) RETURNING id`,
    [P, `${TAG}-${name}`, name, price, Math.round(price * 0.45 * 100) / 100, o.taxed ? 1 : 0, !!o.listed, o.listed ? price : null,
      !!o.rx, !!o.controlled, o.freq || null],
  );
  return r.id;
}
async function product(name, itemIds, o = {}) {
  const p = await one(
    `INSERT INTO online_store_products ("practiceId",name,description,"storeCategory","optionNames","approvalTag","recommendedFrequency",
       listed,"featuredOnHome",kind,"requiresPet","giftCardAmounts","giftCardAllowCustom","giftCardMin","giftCardMax")
     VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [P, name, o.description || null, o.category || null, JSON.stringify(o.options ? [o.options.name] : []), o.rx ? 'needs_doctor_approval' : 'approved',
      o.freq || null, !!o.featured, o.giftCard ? 'gift_card' : 'standard', !!o.pet, JSON.stringify(o.giftCard ? [25, 50, 100] : []), !!o.giftCard,
      o.giftCard ? 10 : null, o.giftCard ? 500 : null],
  );
  for (let i = 0; i < itemIds.length; i++) {
    await q(
      `INSERT INTO online_store_product_variants ("practiceId","productId","inventoryItemId","optionLabel","optionValues","sortOrder")
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [P, p.id, itemIds[i].id, itemIds[i].label || null, JSON.stringify(itemIds[i].label ? [itemIds[i].label] : []), i],
    );
    await q(
      `INSERT INTO online_store_item_settings ("practiceId","inventoryItemId","approvalTag",listed,"recommendedFrequency","storeCategory","featuredOnHome")
       VALUES ($1,$2,$3,true,$4,$5,$6)
       ON CONFLICT DO NOTHING`,
      [P, itemIds[i].id, o.rx ? 'needs_doctor_approval' : 'approved', o.freq || null, o.category || null, !!o.featured],
    );
  }
  return p.id;
}
async function login(email, role, ids) {
  const hash = await bcrypt.hash(`osv-${Date.now()}-${Math.random()}`, 10); // nobody types it; the token is used
  const u = await one(
    `INSERT INTO users (email,password,role,"practiceId","clientId",employee_id,"isActive") VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
    [email, hash, role, P, ids.clientId || null, ids.employeeId || null],
  );
  const token = sign(
    { sub: u.id, email, employeeId: ids.employeeId || null, doctorId: null, clientId: ids.clientId || null, role, practiceKey: 'vayd', practiceId: P, accountId: null },
    secret,
    { expiresIn: '4h' },
  );
  return { userId: u.id, token, Authorization: `Bearer ${token}` };
}

(async () => {
  const [{ current_database: actual }] = await q('SELECT current_database()');
  if (actual !== database) throw new Error(`connected to ${actual}`);
  // Clear an earlier run of this script.
  const old = (await q(`SELECT id FROM inventory_items WHERE "pimsId" LIKE $1`, [`${TAG}-%`])).map((r) => r.id);
  if (old.length) {
    await q(`DELETE FROM online_store_product_variants WHERE "inventoryItemId" = ANY($1)`, [old]);
    await q(`DELETE FROM online_store_item_settings WHERE "inventoryItemId" = ANY($1)`, [old]);
    await q(`UPDATE prescriptions SET "isDeleted" = true WHERE "inventoryItemId" = ANY($1)`, [old]);
    await q(`UPDATE inventory_items SET "isDeleted" = true, "showOnOnlineStore" = false, "pimsId" = "pimsId" || '-old-' || id WHERE id = ANY($1)`, [old]);
  }
  await q(`DELETE FROM online_store_products WHERE "practiceId" = $1 AND id NOT IN (SELECT "productId" FROM online_store_product_variants)`, [P]);
  // Only the demo catalog on the store.
  await q(`UPDATE online_store_products SET listed = false WHERE "practiceId" = $1`, [P]);
  await q(`UPDATE online_store_item_settings SET listed = false WHERE "practiceId" = $1`, [P]);
  await q(`UPDATE inventory_items SET "showOnOnlineStore" = false WHERE "practiceId" = $1`, [P]);
  // The products just taken off would all show under Removed (115 of them in OSV-15): the test database's old store
  // products aren't part of the demo, so drop them (their variants go with them). The demo's own come next.
  await q(`DELETE FROM online_store_products WHERE "practiceId" = $1 AND listed = false`, [P]);
  // Earlier test runs leave "Consent signed for Pippin: not filed to the chart" open in Unassigned (seen in OSV-12).
  await q(
    `UPDATE tasks SET status = 'done', "completedAt" = now()
      WHERE "practiceId" = $1 AND status <> 'done' AND title LIKE 'Consent signed for %: not filed to the chart'`,
    [P],
  );

  const chews = await item('Dental chews, medium (30 ct)', 24.99, { listed: true, taxed: true });
  const joint = await item('Joint support chews (60 ct)', 36, { listed: true, taxed: true, freq: 'every_month' });
  const hw = await item('Heartworm & flea chewable, 22-44 lb (6 doses)', 89, { listed: true, rx: true, freq: 'every_6_months' });
  const thyroid = await item('Thyroid tablets 0.4 mg (90 ct)', 38, { listed: true, rx: true, freq: 'every_3_months' });
  const gaba = await item('Gabapentin 100 mg capsules', 0.6, { rx: true, controlled: true });
  await product('Dental chews', [{ id: chews, label: 'Medium, 30 count' }], { category: 'Dental', featured: true, options: { name: 'Size' }, description: 'Daily chews that help keep tartar down.' });
  await product('Joint support chews', [{ id: joint, label: '60 count' }], { category: 'Supplements', featured: true, freq: 'every_month', pet: true, options: { name: 'Size' }, description: 'Glucosamine and omega-3 chews for stiff joints.' });
  await product('Heartworm & flea chewable', [{ id: hw, label: '22-44 lb, 6 doses' }], { category: 'Prescriptions', rx: true, pet: true, freq: 'every_6_months', options: { name: 'Weight' }, description: 'Monthly heartworm and flea prevention. Prescription: a doctor checks every order.' });
  await product('Thyroid tablets 0.4 mg', [{ id: thyroid, label: '90 count' }], { category: 'Prescriptions', rx: true, pet: true, freq: 'every_3_months', options: { name: 'Size' }, description: 'Prescription thyroid supplement.' });
  const giftItem = await item('Gift card', 0, {});
  await product('Gift card', [{ id: giftItem }], { giftCard: true, category: 'Gift Cards' });

  const A = w.households.A, B = w.households.B;
  // The demo office ships from a real-looking address (EasyPost quotes need a ZIP). Phones in 10 digits.
  await q(`UPDATE practice_branch SET address1 = '410 Glenwood Ave', city = 'Raleigh', state = 'NC', zipcode = '27603', country = 'US' WHERE id = $1`, [w.branchId]);
  await q(`UPDATE clients SET phone1 = '9195550101' WHERE id = $1`, [w.households.A.clientId]).catch(() => undefined);
  await q(`UPDATE clients SET phone1 = '9195550102' WHERE id = $1`, [w.households.B.clientId]).catch(() => undefined);
  // Only the demo office in office pickers (other test seeds leave offices behind).
  await q(`UPDATE practice_branch SET "isActive" = false WHERE "practiceId" = $1 AND id <> $2`, [P, w.branchId]);
  // Only the demo households in the mail queue and on the Auto-ships list (other test seeds leave orders behind).
  // Deleted, not cancelled: the queue counts cancelled orders as rejected ones still waiting for a call.
  await q(`DELETE FROM mail_orders WHERE "practiceId" = $1 AND ("clientId" IS NULL OR "clientId" NOT IN ($2, $3))`, [P, A.clientId, B.clientId]);
  await q(`UPDATE online_store_subscriptions SET active = false WHERE "practiceId" = $1 AND ("clientId" IS NULL OR "clientId" NOT IN ($2, $3))`, [P, A.clientId, B.clientId]);
  const maple = A.activePetIds[0], juniper = A.activePetIds[1], biscuit = B.petId;
  const lane = w.doctors.A;
  await q(
    `INSERT INTO prescriptions ("practiceId","patientId","inventoryItemId","pimsType","pimsId",name,refill,"startDate","refillExpiration","expirationPeriodValue","isOwned","isActive","isDeleted",quantity,instructions,"employee_Id")
     VALUES ($1,$2,$3,'scout',$4,$5,3,now() - interval '30 days',now() + interval '330 days',12,true,true,false,1,'Give one chewable by mouth once a month with food.',$6)`,
    [P, maple, hw, `${TAG}-rx-maple`, 'Heartworm & flea chewable, 22-44 lb (6 doses)', lane],
  ).catch(async () => {
    await q(
      `INSERT INTO prescriptions ("practiceId","patientId","inventoryItemId","pimsType","pimsId",name,refill,"startDate","refillExpiration","expirationPeriodValue","isOwned","isActive","isDeleted",quantity,instructions)
       VALUES ($1,$2,$3,'scout',$4,$5,3,now() - interval '30 days',now() + interval '330 days',12,true,true,false,1,'Give one chewable by mouth once a month with food.')`,
      [P, maple, hw, `${TAG}-rx-maple`, 'Heartworm & flea chewable, 22-44 lb (6 doses)'],
    );
  });
  await q(
    `INSERT INTO prescriptions ("practiceId","patientId","inventoryItemId","pimsType","pimsId",name,refill,"startDate","refillExpiration","expirationPeriodValue","isOwned","isActive","isDeleted",quantity,instructions)
     VALUES ($1,$2,$3,'scout',$4,$5,0,now() - interval '200 days',now() + interval '160 days',12,true,true,false,1,'Give one tablet by mouth twice daily.')`,
    [P, juniper, thyroid, `${TAG}-rx-juniper`, 'Thyroid tablets 0.4 mg (90 ct)'],
  );
  await q(`UPDATE prescriptions SET "employee_Id" = $1 WHERE "pimsId" LIKE $2`, [lane, `${TAG}-rx-%`]);
  // Owner (Nov 11, 2026): a prescription item needs a licensed filler or checker. Robin Hale (practice manager
  // and mail order manager) is a licensed technician in the demo, so her checks of Riley's fills count.
  await q(`UPDATE employees SET "isLicensed" = true, "licenseType" = 'technician' WHERE id = $1`, [w.employees.manager]);
  // The pharmacy RX line, so mail order texts show on the order (the stack's made-up OpenPhone line).
  await q(`DELETE FROM practice_settings WHERE "practiceId" = $1 AND key = 'inventory.mailOrderRxLinePhone'`, [P]);
  await q(`INSERT INTO practice_settings ("practiceId", key, value) VALUES ($1, 'inventory.mailOrderRxLinePhone', '+19195550100')`, [P]);
  // Both are long-term meds: chronic, so they show under Chronic medications and print as chronic.
  await q(`UPDATE prescriptions SET acuity = 'chronic', "discontinuedAt" = NULL WHERE "pimsId" LIKE $1`, [`${TAG}-rx-%`]);
  // Tom Chen: an old eVet bill still open.
  await q(`DELETE FROM invoices WHERE "pimsType" = 'EVET' AND "pimsId" = $1`, [`${TAG}-evet-chen`]);
  await q(
    `INSERT INTO invoices ("practiceId","clientId","pimsType","pimsId","invoiceNumber","invoicedDate",total,"amountPaid",discount,"discountTypeValue","invoiceStatusValue","isActive","isDeleted")
     VALUES ($1,$2,'EVET',$3,48213,now() - interval '40 days',85,0,0,0,1,true,false)`,
    [P, B.clientId, `${TAG}-evet-chen`],
  );
  // A $50 gift card someone already has (for the balance check).
  await q(`DELETE FROM gift_cards WHERE code = 'RVRAGKCDHMNP2345' OR "printToken" = 'osv-demo-print-1'`);
  await q(
    `INSERT INTO gift_cards ("practiceId",code,"printToken",status,"faceValue","amountPaid",balance,source,"purchaserEmail","purchaserName","recipientName","issueReason")
     VALUES ($1,'RVRAGKCDHMNP2345','osv-demo-print-1','active',50,0,50,'staff_issued','maria.rivera@example.com','Maria Rivera','Maria Rivera','Service recovery')`,
    [P],
  );
  // Its history: an "issue" entry, so it counts on the Sold gift cards totals (issued through the app does the same).
  await q(
    `INSERT INTO gift_card_transactions ("practiceId","giftCardId",type,"faceAmount","paidValueAmount","balanceAfter",channel,note,"employeeId")
     SELECT $1, id, 'issue', 50, 0, 50, 'staff', 'Service recovery', $2 FROM gift_cards WHERE code = 'RVRAGKCDHMNP2345'`,
    [P, w.employees.manager],
  );
  // Mail order team: Riley Brooks. Robin Hale (practice manager) also mail order manager.
  const role = async (slug) => (await one(`SELECT id FROM employee_role WHERE slug = $1`, [slug])).id;
  let riley = await one(`SELECT id FROM employees WHERE email = 'riley.brooks@example.com'`);
  if (!riley) {
    riley = await one(`INSERT INTO employees ("practiceId","firstName","lastName",email) VALUES ($1,'Riley','Brooks','riley.brooks@example.com') RETURNING id`, [P]);
    await q(`INSERT INTO employee_role_assignments ("employeeId","roleId","branchId") VALUES ($1,$2,$3)`, [riley.id, await role('mail_order_team'), w.branchId]);
    await q(`INSERT INTO employee_branch ("employeeId","branchId","isPrimary") VALUES ($1,$2,true)`, [riley.id, w.branchId]).catch(() => undefined);
  }
  const robin = w.employees.manager;
  const mom = await role('mail_order_manager');
  await q(`INSERT INTO employee_role_assignments ("employeeId","roleId","branchId") SELECT $1,$2,$3 WHERE NOT EXISTS (SELECT 1 FROM employee_role_assignments WHERE "employeeId"=$1 AND "roleId"=$2)`, [robin, mom, w.branchId]);
  await q(`DELETE FROM users WHERE email IN ('riley.brooks@example.com','tom.chen@example.com') AND "practiceId" = $1`, [P]);
  const mailteam = await login('riley.brooks@example.com', 'employee', { employeeId: riley.id });
  // Q12a: Billing / AR, held practice-wide (no branch), which is how the Unassigned queue matches it.
  let billingRole = await one(`SELECT id FROM employee_role WHERE slug = 'billing_ar' AND "pimsType" = 'SCOUT'`);
  if (!billingRole) {
    billingRole = await one(
      `INSERT INTO employee_role (name, slug, "roleValue", "isBranchSpecific", "pimsType", description, "isActive", "isDeleted")
       VALUES ('Billing / AR', 'billing_ar', 12, false, 'SCOUT', 'Payments, statements and collections without clinical access.', true, false) RETURNING id`,
    );
  }
  let morgan = await one(`SELECT id FROM employees WHERE email = 'morgan.ellis@example.com'`);
  if (!morgan) {
    morgan = await one(`INSERT INTO employees ("practiceId","firstName","lastName",email) VALUES ($1,'Morgan','Ellis','morgan.ellis@example.com') RETURNING id`, [P]);
    await q(`INSERT INTO employee_branch ("employeeId","branchId","isPrimary") VALUES ($1,$2,true)`, [morgan.id, w.branchId]).catch(() => undefined);
  }
  await q(
    `INSERT INTO employee_role_assignments ("employeeId","roleId","branchId") SELECT $1,$2,NULL WHERE NOT EXISTS (SELECT 1 FROM employee_role_assignments WHERE "employeeId"=$1 AND "roleId"=$2)`,
    [morgan.id, billingRole.id],
  );
  await q(`DELETE FROM users WHERE email = 'morgan.ellis@example.com' AND "practiceId" = $1`, [P]);
  const billing = await login('morgan.ellis@example.com', 'employee', { employeeId: morgan.id });
  const chen = await login('tom.chen@example.com', 'client', { clientId: B.clientId });

  // Q8: Juniper's thyroid tablets are lot-tracked, with one lot on the shelf in Raleigh office (Main).
  await q(`UPDATE inventory_items SET "trackLots" = true WHERE id = $1`, [thyroid]);
  let loc = await one(`SELECT id FROM inventory_branch_location WHERE "branchId" = $1 AND "isActive" = true ORDER BY (code = 'MAIN') DESC, "isDefault" DESC, id LIMIT 1`, [w.branchId]);
  if (!loc) loc = await one(`INSERT INTO inventory_branch_location ("branchId", code, name, "sortOrder", "isDefault", "isActive") VALUES ($1, 'MAIN', 'Main', 0, true, true) RETURNING id`, [w.branchId]);
  await q(
    `INSERT INTO inventory_lot_balances ("practiceId","pimsType","pimsId","inventoryItemId","branchId","branchLocationId","lotNumber","expirationDate","quantityOnHand","isActive","isDeleted")
     VALUES ($1,'scout',$2,$3,$4,$5,'TH24117', now() + interval '300 days', 6, true, false)`,
    [P, `${TAG}-lot-thyroid`, thyroid, w.branchId, loc.id],
  ).catch((e) => console.error('lot:', e.message));
  await q(
    `INSERT INTO inventory_location_balance ("inventoryItemId","branchLocationId","quantityOnHand") VALUES ($1,$2,6)
     ON CONFLICT DO NOTHING`,
    [thyroid, loc.id],
  ).catch((e) => console.error('location balance:', e.message));
  // Only the demo staff in staff pickers (Send to, Choose staff): other test seeds leave dozens behind.
  const demoStaff = [...Object.values(w.employees), riley.id, morgan.id].map(Number);
  await q(`UPDATE employees SET "isActive" = false WHERE "practiceId" = $1 AND NOT (id = ANY($2))`, [P, demoStaff]);

  fs.writeFileSync(
    outFile,
    JSON.stringify({
      items: { chews, joint, hw, thyroid, gaba, giftItem },
      pets: { maple, juniper, biscuit },
      clients: { rivera: A.clientId, chen: B.clientId },
      employees: { riley: riley.id, robin, lane, morgan: morgan.id },
      giftCard: { code: 'RVRAGKCDHMNP2345', balance: 50 },
      auth: { mailteam, chen, billing },
    }),
  );
  console.log(`online store demo ready in ${database}: items ${[chews, joint, hw, thyroid, gaba].join(',')}, Riley ${riley.id}`);
})()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
