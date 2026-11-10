/**
 * Inventory, Catalog and Pricing training demo data (STK-xx and PRC-xx videos), on top of the training stack's seeded world.
 *   NODE_PATH=$API_DIR/node_modules API_DIR=... node cypress/training/setup/inventory-demo.cjs <test db> <world.json> <out.json> <api url>
 * Writes ONLY to a vayd_api_test* database, and calls ONLY the local test API given. Invented supplier; real drug names, made-up lots.
 * Stock is received through the API (shipments), so lots, shelf totals and the Activity history agree.
 *
 * World after this script (docs/training/scripts/inventory/README.md):
 * - Offices: Raleigh office (Main = default, Car, Car 2), Durham office (Main, Car), Dr. Lane home (Controlled safe).
 *   Every other office in the copied test database is set inactive.
 * - Staff: Jordan Pike (technician, default Car), Dr. Avery Lane (veterinarian, default Car, inventory manager of
 *   Dr. Lane home, controlled drug location = Controlled safe), Dr. Priya Shah (Car 2), Robin Hale (practice manager),
 *   Casey Morgan (client liaison), and a new Sam Ortiz (technician + inventory manager of the Raleigh office, with a login).
 * - Items: vaccines, medications, a controlled liquid, supplies, retail, a hidden-on-invoice injection, an item with
 *   quantity price breaks. Every other active inventory item from earlier test runs is archived.
 * Tokens for new logins go to <out.json> (outside the repo). Nothing is printed except ids and counts.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { sign } = require('jsonwebtoken');
const bcrypt = require('bcrypt');
require('dotenv').config({ path: path.join(process.env.API_DIR || '', '.env') });

const [, , database, worldFile, outFile, apiUrl] = process.argv;
if (!/^vayd_api_test[A-Za-z0-9_]*$/.test(database || '')) {
  console.error(`Refusing: ${database} is not a vayd_api_test* database`);
  process.exit(2);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(apiUrl || '')) {
  console.error(`Refusing: ${apiUrl} is not a local API`);
  process.exit(2);
}
const w = JSON.parse(fs.readFileSync(worldFile, 'utf8'));
const pool = new Pool({ host: 'localhost', port: 5432, user: 'vayd', password: process.env.DB_PASSWORD || 'vayd', database });
const q = async (sql, p) => (await pool.query(sql, p)).rows;
const one = async (sql, p) => (await q(sql, p))[0];
const P = w.practiceId;
const TAG = 'inv-demo';
const secret = (process.env.JWT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const day = (n) => {
  const d = new Date(Date.now() + n * 86400000);
  return d.toISOString().slice(0, 10);
};

async function api(method, url, body, auth = w.auth.manager.Authorization) {
  const res = await fetch(`${apiUrl}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: auth },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function login(email, role, employeeId) {
  const existing = await one(`SELECT id FROM users WHERE email=$1`, [email]);
  const hash = await bcrypt.hash(`inv-${Date.now()}-${Math.random()}`, 10); // nobody types it; the token is used
  const u =
    existing ||
    (await one(
      `INSERT INTO users (email,password,role,"practiceId",employee_id,"isActive") VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
      [email, hash, role, P, employeeId],
    ));
  const token = sign(
    { sub: u.id, email, employeeId, doctorId: null, clientId: null, role, practiceKey: 'vayd', practiceId: P, accountId: null },
    secret,
    { expiresIn: '4h' },
  );
  return { userId: u.id, token, Authorization: `Bearer ${token}` };
}

async function roleId(slug) {
  return (await one(`SELECT id FROM employee_role WHERE slug=$1 ORDER BY id LIMIT 1`, [slug])).id;
}
async function giveRole(employeeId, slug, branchId) {
  const rid = await roleId(slug);
  await q(
    `INSERT INTO employee_role_assignments ("employeeId","roleId","branchId") SELECT $1::int,$2::int,$3::int
     WHERE NOT EXISTS (SELECT 1 FROM employee_role_assignments WHERE "employeeId"=$1 AND "roleId"=$2 AND "branchId" IS NOT DISTINCT FROM $3)`,
    [employeeId, rid, branchId],
  );
}

async function office(name, locations) {
  let b = await one(`SELECT id FROM practice_branch WHERE "practiceId"=$1 AND name=$2 ORDER BY id LIMIT 1`, [P, name]);
  if (!b) b = await one(`INSERT INTO practice_branch ("practiceId",name,"isDefault","isActive",city,state) VALUES ($1,$2,false,true,'Raleigh','NC') RETURNING id`, [P, name]);
  await q(`UPDATE practice_branch SET "isActive"=true WHERE id=$1`, [b.id]);
  const ids = {};
  for (const [code, label, isDefault, sort] of locations) {
    let l = await one(`SELECT id FROM inventory_branch_location WHERE "branchId"=$1 AND code=$2`, [b.id, code]);
    if (!l) l = await one(`INSERT INTO inventory_branch_location ("branchId",code,name,"sortOrder","isDefault","isActive") VALUES ($1,$2,$3,$4,$5,true) RETURNING id`, [b.id, code, label, sort, isDefault]);
    await q(`UPDATE inventory_branch_location SET name=$2, "isDefault"=$3, "isActive"=true, "sortOrder"=$4 WHERE id=$1`, [l.id, label, isDefault, sort]);
    ids[code] = l.id;
  }
  await q(`UPDATE inventory_branch_location SET "isActive"=false, "isDefault"=false WHERE "branchId"=$1 AND NOT (id = ANY($2))`, [b.id, Object.values(ids)]);
  return { id: b.id, loc: ids };
}

/** One demo catalog item. `o` holds column overrides. */
async function item(name, o) {
  const cols = {
    practiceId: P, pimsType: 'scout', pimsId: `${TAG}-${name}`, name, isActive: true, isDeleted: false,
    price: 0, cost: null, markup: null, serviceFee: null, minimumPrice: null, taxLevelValue: 1,
    isMedication: false, isVaccine: false, isControlled: false, isDispensable: false,
    trackLots: false, requireLotNumber: false, requireExpirationOnLots: false, hideOnInvoice: false,
    excludePercentageDiscount: false, sellUnitType: null, staffDiscountMode: 'charge', storeAvailability: 'always',
    code: null, category: null, vendorName: null, manufacturer: null, controlledMeasure: null,
    ...o,
  };
  const keys = Object.keys(cols);
  const existing = await one(`SELECT id FROM inventory_items WHERE "pimsId"=$1`, [cols.pimsId]);
  if (existing) {
    await q(`UPDATE inventory_items SET ${keys.map((k, i) => `"${k}"=$${i + 2}`).join(',')} WHERE id=$1`, [existing.id, ...keys.map((k) => cols[k])]);
    return existing.id;
  }
  const r = await one(
    `INSERT INTO inventory_items (${keys.map((k) => `"${k}"`).join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`,
    keys.map((k) => cols[k]),
  );
  return r.id;
}

(async () => {
  const [{ current_database: actual }] = await q('SELECT current_database()');
  if (actual !== database) throw new Error(`connected to ${actual}`);
  const raleighId = w.branchId;
  const E = w.employees;

  // 1. Offices. Main is each office's default location (the Transfer List fills cars from it).
  await q(`UPDATE practice_branch SET name='Raleigh office' WHERE id=$1`, [raleighId]);
  // The API makes each office's default shelf with code 'main'; demo-names.sh made Raleigh's as 'MAIN' (Office shelf).
  await q(`UPDATE inventory_branch_location SET code='main', name='Main' WHERE "branchId"=$1 AND code='MAIN'`, [raleighId]);
  const raleigh = await office('Raleigh office', [['main', 'Main', true, 0], ['CAR', 'Car', false, 1], ['CAR2', 'Car 2', false, 2]]);
  const durham = await office('Durham office', [['main', 'Main', true, 0], ['CAR', 'Car', false, 1]]);
  const home = await office('Dr. Lane home', [['main', 'Controlled safe', true, 0]]);
  const keep = [raleigh.id, durham.id, home.id];
  const off = await q(`UPDATE practice_branch SET "isActive"=false WHERE "practiceId"=$1 AND NOT (id = ANY($2)) AND "isActive" RETURNING id`, [P, keep]);

  // 2. Staff: default locations, roles, controlled drug location, and Sam Ortiz.
  for (const id of [E.technician, E.doctorA, E.cl, E.manager]) {
    await q(`UPDATE employee_branch SET "defaultInventoryLocationId"=$2 WHERE "employeeId"=$1 AND "branchId"=$3`, [id, raleigh.loc.CAR, raleigh.id]);
  }
  await q(`UPDATE employee_branch SET "defaultInventoryLocationId"=$2 WHERE "employeeId"=$1 AND "branchId"=$3`, [E.doctorB, raleigh.loc.CAR2, raleigh.id]);
  await q(`UPDATE employees SET "controlledInventoryLocationId"=$2 WHERE id=$1`, [E.doctorA, home.loc.main]);
  await giveRole(E.doctorA, 'inventory_manager', home.id);
  await q(
    `INSERT INTO employee_branch ("employeeId","branchId","isPrimary") SELECT $1::int,$2::int,false WHERE NOT EXISTS (SELECT 1 FROM employee_branch WHERE "employeeId"=$1 AND "branchId"=$2)`,
    [E.doctorA, home.id],
  );
  let sam = await one(`SELECT id FROM employees WHERE "firstName"='Sam' AND "lastName"='Ortiz' AND "practiceId"=$1`, [P]);
  if (!sam) {
    sam = await one(
      `INSERT INTO employees ("firstName","lastName","practiceId","isActive","isProvider",email,title)
       VALUES ('Sam','Ortiz',$1,true,false,'sam.ortiz@example.com','Technician') RETURNING id`,
      [P],
    );
  }
  await q(
    `INSERT INTO employee_branch ("employeeId","branchId","isPrimary","defaultInventoryLocationId") SELECT $1::int,$2::int,true,$3::int WHERE NOT EXISTS (SELECT 1 FROM employee_branch WHERE "employeeId"=$1 AND "branchId"=$2)`,
    [sam.id, raleigh.id, raleigh.loc.main],
  );
  await giveRole(sam.id, 'technician', raleigh.id);
  await giveRole(sam.id, 'inventory_manager', raleigh.id);
  // Only the demo staff show in pickers (Witness, providers): the copied test database holds hundreds of test employees.
  await q(`UPDATE employees SET "isActive"=false WHERE "practiceId"=$1 AND "isActive" AND NOT (id = ANY($2))`, [P, [...Object.values(E), sam.id]]);
  // Demo login emails (the seed's are long test tags and show on Staff profiles).
  for (const [key, email] of [['cl', 'casey.morgan'], ['technician', 'jordan.pike'], ['manager', 'robin.hale'], ['doctorA', 'avery.lane'], ['doctorB', 'priya.shah']]) {
    await q(`UPDATE users SET email=$2 WHERE id=$1`, [w.users[key], `${email}@example.com`]);
  }
  const samLogin = await login('sam.ortiz@example.com', 'employee', sam.id);
  // An admin login for the screens only admins open (full Settings: Staff profile, Waste / disposal, Sales Tax).
  const adminLogin = await login('robin.admin@example.com', 'admin', E.manager);

  // 3. Supplier.
  let sup = await one(`SELECT id FROM inventory_suppliers WHERE "practiceId"=$1 AND name='Northline Vet Supply'`, [P]);
  if (!sup) sup = await one(`INSERT INTO inventory_suppliers ("practiceId",name,"supplierType","isActive","roundOrdersToPackSize","allowBackorders","isDeleted") VALUES ($1,'Northline Vet Supply','distributor',true,false,true,false) RETURNING id`, [P]);

  await q(`UPDATE inventory_suppliers SET "isActive"=false WHERE "practiceId"=$1 AND id <> $2`, [P, sup.id]);

  // 4. Catalog: archive earlier test items, then the demo items.
  const archived = await q(
    `UPDATE inventory_items SET "isActive"=false WHERE "practiceId"=$1 AND "isActive" AND (name ~ '^h[a-z]+-[0-9]{10,}' OR name ILIKE '%EMRTEST%') RETURNING id`,
    [P],
  );
  await q(`UPDATE procedures SET "isActive"=false WHERE "practiceId"=$1 AND "isActive" AND (name ~ '^h[a-z]+-[0-9]{10,}' OR "pimsId" ILIKE '%EMRTEST%' OR name ILIKE '%cremation%')`, [P]).catch(() => null);
  await q(`UPDATE labs SET "isActive"=false WHERE "practiceId"=$1 AND "isActive" AND name ~ '^h[a-z]+-[0-9]{10,}'`, [P]).catch(() => null);
  const I = {};
  I.rabies = await item('Rabies 3 yr vaccine', { code: 'RAB3', price: 32, cost: 6.5, markup: 492, isVaccine: true, taxLevelValue: 0, trackLots: true, requireLotNumber: true, requireExpirationOnLots: true, manufacturer: 'Merck', sellUnitType: 'dose' });
  I.dhpp = await item('DHPP vaccine', { code: 'DHPP', price: 34, cost: 5.8, markup: 586, isVaccine: true, taxLevelValue: 0, trackLots: true, requireLotNumber: true, requireExpirationOnLots: true, manufacturer: 'Zoetis', sellUnitType: 'dose' });
  I.carprofen = await item('Carprofen 100 mg caplet', { code: 'CARP100', price: 1.29, cost: 0.42, markup: 307, serviceFee: 15, minimumPrice: 31.9, isMedication: true, isDispensable: true, trackLots: true, requireExpirationOnLots: true, sellUnitType: 'tablet', dispenseNote: 'Give 1 caplet by mouth twice a day with food.' });
  I.bup = await item('Buprenorphine 0.3 mg/mL injection', { code: 'BUP03', price: 12.5, cost: 3.2, markup: 390, isMedication: false, isControlled: true, controlledMeasure: 'volume', trackLots: true, requireLotNumber: true, requireExpirationOnLots: true, sellUnitType: 'mL', taxLevelValue: 0 });
  I.bord = await item('Bordetella intranasal vaccine', { code: 'BORD', price: 28, cost: 4.9, markup: 571, isVaccine: true, taxLevelValue: 0, trackLots: true, requireLotNumber: true, requireExpirationOnLots: true, manufacturer: 'Merck', sellUnitType: 'dose' });
  I.apoquel = await item('Apoquel 16 mg tablet', { code: 'APQ16', price: 2.85, cost: 1.1, markup: 259, isMedication: true, isDispensable: true, trackLots: true, requireExpirationOnLots: true, sellUnitType: 'tablet' });
  I.cerenia = await item('Cerenia 24 mg tablet', { code: 'CER24', price: 9.5, cost: 3.6, markup: 264, isMedication: true, isDispensable: true, sellUnitType: 'tablet' });
  I.gaba = await item('Gabapentin 100 mg capsule', { code: 'GAB100', price: 0.65, cost: 0.12, markup: 542, serviceFee: 12, isMedication: true, isDispensable: true, sellUnitType: 'capsule' });
  I.metro = await item('Metronidazole 250 mg tablet', { code: 'MET250', price: 0.55, cost: 0.09, markup: 611, isMedication: true, isDispensable: true, trackLots: true, requireExpirationOnLots: true, sellUnitType: 'tablet' });
  I.amoxi = await item('Amoxicillin drops 15 mL', { code: 'AMXD15', price: 22, cost: 7.4, markup: 297, isMedication: true, isDispensable: true, trackLots: true, requireExpirationOnLots: true, sellUnitType: 'bottle' });
  I.lrs = await item("Lactated Ringer's 1 L bag", { code: 'LRS1L', price: 14, cost: 2.1, markup: 667, sellUnitType: 'bag', taxLevelValue: 0 });
  I.syringe = await item('Syringes 3 mL, box of 100', { code: 'SYR3', price: 18, cost: 9, markup: 200, sellUnitType: 'box' });
  I.chews = await item('Dental chews, medium (30 ct)', { code: 'DCHEW', price: 24, cost: 11, markup: 218, sellUnitType: 'bag' });
  I.diet = await item('Prescription diet, 8 lb bag', { code: 'RXD8', price: 60, cost: 31, markup: 194, trackLots: true, requireExpirationOnLots: true, sellUnitType: 'bag', taxLevelValue: 0 });
  I.ace = await item('Acepromazine 10 mg/mL injection', { code: 'ACE10', price: 0.14, cost: 0.04, markup: 350, isMedication: true, hideOnInvoice: true, sellUnitType: 'mL', taxLevelValue: 0 });
  I.simparica = await item('Simparica Trio chewable, 22-44 lb', { code: 'SIMP2244', price: 28, cost: 15.5, markup: 181, isMedication: true, isDispensable: true, sellUnitType: 'chew' });
  await q(`DELETE FROM quantity_price_breaks WHERE "inventoryItemId"=$1`, [I.simparica]);
  for (const [lo, hi, price] of [[1, 2, 28], [3, 5, 26.5], [6, 11, 25], [12, 999, 23.5]]) {
    await q(`INSERT INTO quantity_price_breaks ("practiceId","inventoryItemId","lowQuantity","highQuantity",price,"isActive","isDeleted","pimsType") VALUES ($1,$2,$3,$4,$5,true,false,'scout')`, [P, I.simparica, lo, hi, price]);
  }
  const procs = [['Nail trim', 25, 0], ['Heartworm antigen test', 45, 0]];
  for (const [name, price, tax] of procs) {
    await q(`INSERT INTO procedures (name, price, cost, "practiceId", "isActive", "isDeleted", "pimsType", "taxLevelValue") SELECT $1::varchar,$2::numeric,0,$3::int,true,false,'scout',$4::numeric WHERE NOT EXISTS (SELECT 1 FROM procedures WHERE name=$1 AND "isDeleted"=false)`, [name, price, P, tax]);
  }

  // 5. Clear stock history. Other items' rows come from earlier automated test runs and would fill the reports.
  const ids = Object.values(I);
  await q(`DELETE FROM inventory_waste_events WHERE "practiceId"=$1 AND NOT ("inventoryItemId" = ANY($2))`, [P, ids]);
  await q(`DELETE FROM inventory_stock_movement WHERE "practiceId"=$1 AND NOT ("inventoryItemId" = ANY($2))`, [P, ids]);
  await q(`DELETE FROM inventory_count_line_locations WHERE "countLineId" IN (SELECT id FROM inventory_count_lines WHERE NOT ("inventoryItemId" = ANY($1)))`, [ids]).catch(() => null);
  await q(`DELETE FROM inventory_count_lines WHERE NOT ("inventoryItemId" = ANY($1))`, [ids]);
  await q(`DELETE FROM inventory_count_sessions WHERE "practiceId"=$1`, [P]);
  await q(`DELETE FROM inventory_waste_events WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_cost_reviews WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_stock_requests WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_purchase_order_lines WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_count_line_locations WHERE "countLineId" IN (SELECT id FROM inventory_count_lines WHERE "inventoryItemId" = ANY($1))`, [ids]).catch(() => null);
  await q(`DELETE FROM inventory_count_lines WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_shipment_lines WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_shipments WHERE "practiceId"=$1 AND id NOT IN (SELECT "shipmentId" FROM inventory_shipment_lines)`, [P]);
  await q(`DELETE FROM inventory_stock_movement WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_lot_balances WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_location_balance WHERE "inventoryItemId" = ANY($1)`, [ids]);
  await q(`DELETE FROM inventory_branch_stock WHERE "inventoryItemId" = ANY($1)`, [ids]);

  // 6. Receive the opening stock through the API, one finalized shipment per office (as Robin Hale).
  const cost = async (id) => Number((await one(`SELECT cost FROM inventory_items WHERE id=$1`, [id])).cost);
  async function receive(branchId, invoiceNumber, lines, defaultLoc) {
    const s = await api('POST', `/practice/${P}/inventory-shipments`, { branchId, supplierId: sup.id, invoiceNumber, defaultToBranchLocationId: defaultLoc });
    for (const l of lines) {
      await api('POST', `/practice/${P}/inventory-shipments/${s.id}/lines`, {
        inventoryItemId: l.item, quantity: l.qty, costPerUnit: await cost(l.item), lotNumber: l.lot ?? null,
        expirationDate: l.exp ?? null, toBranchLocationId: l.to ?? defaultLoc,
      });
    }
    await api('POST', `/practice/${P}/inventory-shipments/${s.id}/finalize`, {});
    return s.id;
  }
  const R = raleigh.loc;
  await receive(raleigh.id, 'NL-40211', [
    { item: I.rabies, qty: 8, lot: 'RB-2611', exp: day(25), to: R.CAR },
    { item: I.rabies, qty: 10, lot: 'RB-2702', exp: day(200), to: R.CAR },
    { item: I.rabies, qty: 20, lot: 'RB-2702', exp: day(200), to: R.main },
    { item: I.dhpp, qty: 12, lot: 'DH-3301', exp: day(300), to: R.CAR },
    { item: I.carprofen, qty: 12, lot: 'CP-4471', exp: day(60), to: R.CAR },
    { item: I.carprofen, qty: 30, lot: 'CP-4520', exp: day(400), to: R.CAR },
    { item: I.carprofen, qty: 100, lot: 'CP-4520', exp: day(400), to: R.main },
    { item: I.cerenia, qty: 3, to: R.CAR },
    { item: I.cerenia, qty: 40, to: R.main },
    { item: I.gaba, qty: 10, to: R.CAR },
    { item: I.metro, qty: 40, lot: 'MT-5001', exp: day(20), to: R.main },
    { item: I.metro, qty: 60, lot: 'MT-5120', exp: day(260), to: R.main },
    { item: I.amoxi, qty: 6, lot: 'AX-1150', exp: day(150), to: R.main },
    { item: I.lrs, qty: 4, to: R.main },
    { item: I.syringe, qty: 1, to: R.main },
    { item: I.chews, qty: 4, to: R.CAR },
    { item: I.chews, qty: 20, to: R.main },
    { item: I.diet, qty: 6, lot: 'DIET-2611', exp: day(240), to: R.main },
    { item: I.simparica, qty: 24, to: R.main },
    { item: I.ace, qty: 50, to: R.CAR },
  ], R.main);
  await receive(durham.id, 'NL-40212', [
    { item: I.gaba, qty: 60, to: durham.loc.main },
    { item: I.cerenia, qty: 12, to: durham.loc.main },
  ], durham.loc.main);
  await receive(home.id, 'NL-40213', [
    { item: I.bup, qty: 8.5, lot: 'BU-1101', exp: day(300), to: home.loc.main },
    { item: I.bup, qty: 10, lot: 'BU-1102', exp: day(420), to: home.loc.main },
  ], home.loc.main);
  // A buprenorphine lot in a Raleigh car, so STK-14 can show a dose that didn't come from Dr. Lane's safe (Q9).
  await receive(raleigh.id, 'NL-40214', [
    { item: I.bup, qty: 2, lot: 'BU-0990', exp: day(240), to: R.CAR },
  ], R.CAR);

  // Expired stock can't be received (the API refuses it), so these lots are put on the shelf the way an old count would.
  async function oldLot(itemId, branchId, locId, lot, exp, qty) {
    const l = await one(
      `INSERT INTO inventory_lot_balances ("practiceId","inventoryItemId","branchId","branchLocationId","lotNumber","expirationDate","quantityOnHand","isActive","isDeleted","pimsType")
       VALUES ($1,$2,$3,$4,$5,$6,$7,true,false,'scout') RETURNING id`,
      [P, itemId, branchId, locId, lot, exp, qty],
    );
    const bal = await one(`SELECT id, "quantityOnHand" FROM inventory_location_balance WHERE "inventoryItemId"=$1 AND "branchLocationId"=$2`, [itemId, locId]);
    const before = bal ? Number(bal.quantityOnHand) : 0;
    if (bal) await q(`UPDATE inventory_location_balance SET "quantityOnHand"=$2 WHERE id=$1`, [bal.id, before + qty]);
    else await q(`INSERT INTO inventory_location_balance ("inventoryItemId","branchLocationId","quantityOnHand") VALUES ($1,$2,$3)`, [itemId, locId, qty]);
    await q(
      `INSERT INTO inventory_stock_movement ("practiceId","branchId","inventoryItemId","movementType",quantity,"toBranchLocationId","toQuantityBefore","toQuantityAfter","movedByEmployeeId",note,"lotNumber","expirationDate","inventoryLotBalanceId",created)
       VALUES ($1,$2,$3,'opening_increase',$4,$5,$6,$7,$8,'First count',$9,$10,$11, now() - interval '40 days')`,
      [P, branchId, itemId, qty, locId, before, before + qty, E.manager, lot, exp, l.id],
    );
  }
  await oldLot(I.rabies, raleigh.id, R.CAR, 'RB-2508', '2026-10-15', 2);
  await oldLot(I.carprofen, raleigh.id, R.CAR, 'CP-4390', '2026-11-01', 4);
  await oldLot(I.amoxi, raleigh.id, R.main, 'AX-0921', '2026-10-28', 3);

  // 7. Counted shelves: everything above has been counted except Apoquel on the Car (its first bottle isn't in Scout yet)
  // and Dr. Lane's controlled safe (nothing has to be counted at launch; STK-16 counts it).
  await q(
    `UPDATE inventory_location_balance SET "firstCountedAt"=now() - interval '30 days', "firstCountedByEmployeeId"=$2 WHERE "inventoryItemId" = ANY($1) AND "branchLocationId" <> $3`,
    [ids, E.manager, home.loc.main],
  );

  // 8. Par levels and re-order points (as Robin Hale, through the API).
  async function par(branchId, itemId, reorderPoint, max, locs) {
    await api('PUT', `/practice/${P}/branches/${branchId}/inventory-items/${itemId}/stock`, {
      reorderPoint, parLevel: max, locations: locs.map(([branchLocationId, parLevel]) => ({ branchLocationId, parLevel })),
    });
  }
  await par(raleigh.id, I.carprofen, 60, 200, [[R.CAR, 60], [R.CAR2, 30]]);
  await par(raleigh.id, I.cerenia, 10, 40, [[R.CAR, 10]]);
  await par(raleigh.id, I.gaba, 20, 0, [[R.CAR, 30]]);
  await par(raleigh.id, I.rabies, 10, 40, [[R.CAR, 10]]);
  await par(raleigh.id, I.dhpp, 10, 40, [[R.CAR, 10]]);
  await par(raleigh.id, I.lrs, 6, 24, []);
  await par(raleigh.id, I.syringe, 2, 6, []);
  await par(raleigh.id, I.chews, 10, 30, [[R.CAR, 6]]);
  await par(durham.id, I.gaba, 20, 60, [[durham.loc.CAR, 20]]);

  // 9. Pending Cost Review: a Carprofen invoice at $0.55 (+31%), received at Main by Sam Ortiz.
  const s2 = await api('POST', `/practice/${P}/inventory-shipments`, { branchId: raleigh.id, supplierId: sup.id, invoiceNumber: 'NL-40415', defaultToBranchLocationId: R.main }, samLogin.Authorization);
  await api('POST', `/practice/${P}/inventory-shipments/${s2.id}/lines`, { inventoryItemId: I.carprofen, quantity: 100, costPerUnit: 0.55, lotNumber: 'CP-4602', expirationDate: day(500), toBranchLocationId: R.main }, samLogin.Authorization);
  await api('POST', `/practice/${P}/inventory-shipments/${s2.id}/finalize`, {}, samLogin.Authorization);

  // Earlier test runs' history (other items) would fill the Activity log and reports.
  await q(`UPDATE inventory_cost_reviews SET status='dismissed' WHERE "practiceId"=$1 AND status='pending' AND NOT ("inventoryItemId" = ANY($2))`, [P, ids]);

  // 10. History for the controlled-drug videos: Biscuit Chen got 0.6 mL of buprenorphine from Dr. Lane's safe (lot BU-1101),
  // paid in cash, so the Controlled Drugs report, the Activity log and the Vet Snap file have a real row.
  const B = w.households.B;
  const A = w.households.A;
  await q(
    `UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId" = ANY($1) AND id IN (SELECT "invoiceId" FROM visit_invoice_lines WHERE "catalogItemId"=$2)`,
    [[B.clientId, A.clientId], I.bup],
  );
  const bu1101 = (await one(`SELECT id FROM inventory_lot_balances WHERE "lotNumber"='BU-1101' AND "inventoryItemId"=$1`, [I.bup])).id;
  const lane = w.auth.doctorA.Authorization;
  const bill = await api('POST', '/visit-invoices/counter', { practiceId: P, patientId: B.petId, clientId: B.clientId }, lane);
  await api('PATCH', `/visit-invoices/${bill.id}`, { practiceId: P, inventoryBranchId: raleigh.id, inventoryLocationId: R.CAR }, lane);
  const billed = await api('POST', `/visit-invoices/${bill.id}/lines`, {
    practiceId: P, patientId: B.petId, description: 'Buprenorphine 0.3 mg/mL injection', qty: 0.6, unitPrice: 12.5, catalogItemId: I.bup,
    catalogItemType: 'inventory', inventoryLotBalanceId: bu1101, lotNumber: 'BU-1101', providerEmployeeId: E.doctorA,
  }, lane);
  await api('POST', `/visit-invoices/${bill.id}/tenders`, { practiceId: P, method: 'cash', amount: Number(billed.total), cashReceived: Number(billed.total), changeGiven: 0 }, lane);
  // Q9: a second dose under Dr. Lane (Maple Rivera, 0.4 mL) drawn from Raleigh office · Car, not her safe, so the
  // Controlled Drugs report flags its shelf in STK-14.
  const bu0990 = (await one(`SELECT id FROM inventory_lot_balances WHERE "lotNumber"='BU-0990' AND "inventoryItemId"=$1`, [I.bup])).id;
  const carBill = await api('POST', '/visit-invoices/counter', { practiceId: P, patientId: A.activePetIds[0], clientId: A.clientId }, lane);
  await api('PATCH', `/visit-invoices/${carBill.id}`, { practiceId: P, inventoryBranchId: raleigh.id, inventoryLocationId: R.CAR }, lane);
  const carBilled = await api('POST', `/visit-invoices/${carBill.id}/lines`, {
    practiceId: P, patientId: A.activePetIds[0], description: 'Buprenorphine 0.3 mg/mL injection', qty: 0.4, unitPrice: 12.5, catalogItemId: I.bup,
    catalogItemType: 'inventory', inventoryLotBalanceId: bu0990, lotNumber: 'BU-0990', providerEmployeeId: E.doctorA,
  }, lane);
  await api('POST', `/visit-invoices/${carBill.id}/tenders`, { practiceId: P, method: 'cash', amount: Number(carBilled.total), cashReceived: Number(carBilled.total), changeGiven: 0 }, lane);

  // 11. Stale lots (CAT-10): a diet lot that hasn't moved in 120 days, and a DHPP lot with 2 doses left and no draw in 40 days.
  await q(`UPDATE inventory_stock_movement SET created = now() - interval '120 days' WHERE "inventoryItemId"=$1 AND "lotNumber"='DIET-2611'`, [I.diet]);
  await oldLot(I.dhpp, raleigh.id, R.CAR, 'DH-2990', day(90), 2);
  await q(`UPDATE inventory_stock_movement SET created = now() - interval '60 days' WHERE "inventoryItemId"=$1 AND "lotNumber"='DH-2990'`, [I.dhpp]);
  const dh2990 = (await one(`SELECT id FROM inventory_lot_balances WHERE "lotNumber"='DH-2990'`)).id;
  await q(
    `INSERT INTO inventory_stock_movement ("practiceId","branchId","inventoryItemId","movementType",quantity,"fromBranchLocationId","fromQuantityBefore","fromQuantityAfter","movedByEmployeeId",note,"lotNumber","inventoryLotBalanceId",created)
     VALUES ($1,$2,$3,'sold',1,$4,3,2,$5,'Visit charge','DH-2990',$6, now() - interval '40 days')`,
    [P, raleigh.id, I.dhpp, R.CAR, E.technician, dh2990],
  );

  // 12. Store: Dental chews listed at $24 with two active monthly auto-ships (Stripe is the stack's fake), for PRC-05.
  await q(`DELETE FROM practice_settings WHERE "practiceId"=$1 AND key='inventory.onlineStoreImplemented'`, [P]);
  await q(`INSERT INTO practice_settings ("practiceId",key,value) VALUES ($1,'inventory.onlineStoreImplemented','true')`, [P]);
  await q(`UPDATE inventory_items SET "showOnOnlineStore"=true, "onlineStorePrice"=24 WHERE id=$1`, [I.chews]);
  await q(`DELETE FROM online_store_item_settings WHERE "inventoryItemId"=$1`, [I.chews]);
  await q(`INSERT INTO online_store_item_settings ("practiceId","inventoryItemId","approvalTag",listed,"featuredOnHome") VALUES ($1,$2,'approved',true,false)`, [P, I.chews]);
  await q(`DELETE FROM online_store_subscriptions WHERE "inventoryItemId"=$1`, [I.chews]);
  for (const [clientId, petId, name, email] of [[w.households.A.clientId, w.households.A.activePetIds[0], 'Maria Rivera', 'maria.rivera@example.com'], [B.clientId, B.petId, 'Tom Chen', 'tom.chen@example.com']]) {
    await q(
      `INSERT INTO online_store_subscriptions ("practiceId","inventoryItemId","clientId","patientId","customerEmail","customerName",frequency,"renewalDate","stripeSubscriptionId",active,"itemName",quantity,"unitPrice","taxRate",paused,"paymentStatus")
       VALUES ($1,$2,$3,$4,$5,$6,'every_month',$7,$8,true,'Dental chews, medium (30 ct)',1,24,0.055,false,'ok')`,
      [P, I.chews, clientId, petId, email, name, day(18), `sub_demo_${clientId}`],
    );
  }
  // Clean eVet ids on the demo households (the return panel shows them).
  await q(`UPDATE clients SET "pimsId"=CASE id WHEN $1 THEN '40917' ELSE '40918' END WHERE id IN ($1,$2)`, [w.households.A.clientId, B.clientId]);

  // Client discount statuses from earlier test runs carry tag codes; give them plain ones.
  await q(`UPDATE client_status SET code=CASE WHEN name ILIKE 'Employee%' THEN 'EMP' WHEN name ILIKE 'Senior%' THEN 'SR10' ELSE code END WHERE code ~ '^h[a-z]+-[0-9]{10,}'`).catch(() => null);

  const out = { practiceId: P, offices: { raleigh, durham, home }, supplierId: sup.id, items: I, employees: { ...E, sam: sam.id }, auth: { sam: samLogin, admin: adminLogin }, };
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
  const reviews = await one(`SELECT count(*)::int n FROM inventory_cost_reviews WHERE "inventoryItemId"=$1 AND status='pending'`, [I.carprofen]);
  console.log(`offices ${keep.join(',')} (${off.length} others inactive); items archived ${archived.length}; demo items ${ids.length}; Sam Ortiz ${sam.id}; pending cost reviews ${reviews.n}`);
  await pool.end();
})().catch(async (e) => {
  console.error(e.message || e);
  await pool.end();
  process.exit(1);
});
