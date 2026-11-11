/**
 * Permissions training videos (PERM-xx, ROLE-xx): one demo staff login per Scout role, on top of the stack-up.sh
 * world. TEST databases only (name must start with vayd_api_test). Run from the vayd-api checkout so its packages
 * and .env (JWT key) are used:
 *
 *   cd "$API_DIR" && NODE_ENV=test npx tsx "$FE/cypress/training/stack/perm-seed.ts" "$TRAINING_DB" "$TRAINING_WORK/stack/perm.json"
 *
 * What it does, in the throwaway training database only:
 * - creates any missing Scout role with the production name;
 * - tidies leftovers from other test runs so lists look like a real practice: deactivates every office but
 *   "Raleigh office" and one renamed "Durham office", and moves leftover test staff to a hidden practice;
 * - adds one employee + employee login per role (demo names, example.com emails, no password);
 * - writes their 4-hour tokens to perm.json. That file holds tokens: never commit it.
 * Re-running removes the previous run's demo staff first.
 */
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';

const API = process.cwd();
const req = createRequire(path.join(API, 'package.json'));
req('dotenv/config');
const { Pool } = req('pg');
const { sign } = req('jsonwebtoken');

const [, , database, outFile] = process.argv;
const host = process.env.DB_HOST || 'localhost';
if (!database || !outFile) throw new Error('usage: perm-seed.ts <vayd_api_test* db> <out.json>');
if (!['localhost', '127.0.0.1'].includes(host) || !database.startsWith('vayd_api_test')) {
  console.error(`Refusing: ${database} on ${host} is not a local vayd_api_test* database.`);
  process.exit(2);
}
const pool = new Pool({ host, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USERNAME || 'vayd', password: process.env.DB_PASSWORD || 'vayd', database });
const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;
const db = { query: (sql: string, p?: unknown[]) => q(sql, p ?? []) };

const TAG = 'PERMDEMO';
const HIDDEN_PRACTICE_NAME = 'Leftover test staff (training)';

/** Production names and values (read from the live role table, Nov 9, 2026). */
const ROLES: Record<string, { name: string; value: number; branch: boolean }> = {
  practice_admin: { name: 'Practice Admin', value: 2, branch: false },
  practice_manager: { name: 'Practice Manager', value: 4, branch: false },
  medical_director: { name: 'Medical Director', value: 9, branch: false },
  veterinarian: { name: 'Veterinarian', value: 10, branch: true },
  relief_veterinarian: { name: 'Relief Veterinarian', value: 11, branch: false },
  lead_technician: { name: 'Lead Technician', value: 8, branch: false },
  technician: { name: 'Technician', value: 5, branch: true },
  lead_client_liaison: { name: 'Lead Client Liaison', value: 7, branch: false },
  client_liaison: { name: 'Client Liaison', value: 6, branch: false },
  inventory_manager: { name: 'Inventory Manager', value: 3, branch: true },
  billing_ar: { name: 'Billing / AR', value: 12, branch: false },
  observer: { name: 'Observer', value: 13, branch: false },
  controlled_substances_director: { name: 'Controlled Substances Director', value: 14, branch: false },
  mail_order_manager: { name: 'Mail Order Manager', value: 15, branch: false },
  mail_order_team: { name: 'Mail Order Team Member', value: 16, branch: false },
  executive: { name: 'Executive (read-only)', value: 17, branch: false },
};

type Person = {
  key: string; first: string; last: string; roles: Array<{ slug: string; office?: 'raleigh' | 'durham' }>;
  licensed?: 'veterinarian' | 'technician'; provider?: boolean;
  /** Home office for someone with no office role yet (Sam Chen starts at Raleigh in PERM-02). */
  home?: 'raleigh' | 'durham';
  /** No office rows at all (Sam Chen in PERM-02: his first office role becomes his default office). */
  noOffice?: boolean;
};
/** Made-up staff. Avoid real VAYD staff first names. */
const PEOPLE: Person[] = [
  { key: 'practice_admin', first: 'Quinn', last: 'Parker', roles: [{ slug: 'practice_admin' }] },
  { key: 'practice_manager', first: 'Jamie', last: 'Brooks', roles: [{ slug: 'practice_manager' }] },
  { key: 'medical_director', first: 'Elena', last: 'Ruiz', roles: [{ slug: 'medical_director' }, { slug: 'veterinarian', office: 'raleigh' }], licensed: 'veterinarian', provider: true },
  { key: 'veterinarian', first: 'Maya', last: 'Ortiz', roles: [{ slug: 'veterinarian', office: 'raleigh' }], licensed: 'veterinarian', provider: true },
  { key: 'departing_vet', first: 'Riley', last: 'Rivera', roles: [{ slug: 'veterinarian', office: 'raleigh' }, { slug: 'veterinarian', office: 'durham' }], licensed: 'veterinarian', provider: true },
  { key: 'relief_veterinarian', first: 'Noah', last: 'Park', roles: [{ slug: 'relief_veterinarian' }], licensed: 'veterinarian', provider: true },
  { key: 'lead_technician', first: 'Jess', last: 'Navarro', roles: [{ slug: 'lead_technician' }, { slug: 'technician', office: 'raleigh' }], licensed: 'technician' },
  { key: 'technician', first: 'Tess', last: 'Holt', roles: [{ slug: 'technician', office: 'raleigh' }] },
  { key: 'new_tech', first: 'Sam', last: 'Chen', roles: [], noOffice: true }, // no office yet: PERM-02's role gives him Raleigh as default (B4)
  { key: 'lead_client_liaison', first: 'Dana', last: 'Cole', roles: [{ slug: 'lead_client_liaison' }] },
  { key: 'client_liaison', first: 'Lou', last: 'Bennett', roles: [{ slug: 'client_liaison' }] },
  { key: 'inventory_manager', first: 'Lee', last: 'Grant', roles: [{ slug: 'inventory_manager', office: 'raleigh' }] },
  { key: 'billing_ar', first: 'Pat', last: 'Lowe', roles: [{ slug: 'billing_ar' }] },
  { key: 'controlled_substances_director', first: 'Drew', last: 'Ellis', roles: [{ slug: 'controlled_substances_director' }] },
  { key: 'mail_order_manager', first: 'Alex', last: 'Kim', roles: [{ slug: 'mail_order_manager' }] },
  { key: 'mail_order_team', first: 'Jesse', last: 'Ward', roles: [{ slug: 'mail_order_team' }] },
  { key: 'observer', first: 'Kai', last: 'Reed', roles: [{ slug: 'observer' }] },
  { key: 'executive', first: 'Blair', last: 'Stone', roles: [{ slug: 'executive' }] },
];

async function ensureRole(slug: string): Promise<number> {
  const def = ROLES[slug];
  const found = await q(`SELECT id FROM employee_role WHERE slug=$1 AND "pimsType"='SCOUT' AND "isDeleted"=false LIMIT 1`, [slug]);
  if (found.length) {
    await q(`UPDATE employee_role SET name=$2, "isBranchSpecific"=$3 WHERE id=$1`, [found[0].id, def.name, def.branch]);
    return Number(found[0].id);
  }
  const [row] = await q(
    `INSERT INTO employee_role (name,"roleValue",slug,"pimsType","isBranchSpecific")
     SELECT $1, CASE WHEN EXISTS (SELECT 1 FROM employee_role WHERE "pimsType"='SCOUT' AND "roleValue"=$2)
                     THEN COALESCE((SELECT MAX("roleValue") FROM employee_role WHERE "pimsType"='SCOUT'),0)+1 ELSE $2 END,
            $3,'SCOUT',$4 RETURNING id`,
    [def.name, def.value, slug, def.branch],
  );
  return Number(row.id);
}

async function main() {
  const [{ current_database: actual }] = await q('SELECT current_database()');
  if (!String(actual).startsWith('vayd_api_test')) throw new Error(`Connected to ${actual}; aborting.`);

  // Offices: keep Raleigh, rename one leftover to Durham, deactivate the rest.
  const [raleigh] = await q(`SELECT id FROM practice_branch WHERE "practiceId"=1 AND name='Raleigh office' ORDER BY id LIMIT 1`);
  if (!raleigh) throw new Error('No "Raleigh office": run stack-up.sh (demo-names.sh) first.');
  let [durham] = await q(`SELECT id FROM practice_branch WHERE "practiceId"=1 AND name='Durham office' LIMIT 1`);
  if (!durham) {
    [durham] = await q(`SELECT id FROM practice_branch WHERE "practiceId"=1 AND id<>$1 ORDER BY id LIMIT 1`, [raleigh.id]);
    if (!durham) [durham] = await q(`INSERT INTO practice_branch ("practiceId",name) VALUES (1,'Durham office') RETURNING id`);
    await q(`UPDATE practice_branch SET name='Durham office', "isActive"=true WHERE id=$1`, [durham.id]);
  }
  await q(`UPDATE practice_branch SET "isActive"=false WHERE "practiceId"=1 AND id NOT IN ($1,$2)`, [raleigh.id, durham.id]);
  // Archived leftovers from other test runs show in Settings → Branches with test names; give them plain ones.
  await q(`UPDATE practice_branch SET name='Closed office ' || id WHERE "practiceId"=1 AND id NOT IN ($1,$2)`, [raleigh.id, durham.id]);
  const office = { raleigh: Number(raleigh.id), durham: Number(durham.id) };

  // Leftover staff from other test runs (names like "Inv technician") move to a hidden practice so the Staff,
  // Roles and picker lists show only the demo team. Seeded scheduling staff (SCHTEST) and ours stay.
  let [hidden] = await q(`SELECT id FROM practices WHERE name=$1 LIMIT 1`, [HIDDEN_PRACTICE_NAME]).catch(() => []);
  if (!hidden) {
    const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_name='practices' AND is_nullable='NO' AND column_default IS NULL`);
    const needed = cols.map((c: { column_name: string }) => c.column_name).filter((c: string) => c !== 'name');
    if (needed.length) console.warn(`practices has required columns ${needed.join(', ')}; leaving leftover staff in place`);
    else [hidden] = await q(`INSERT INTO practices (id,name) SELECT MAX(id)+1, $1 FROM practices RETURNING id`, [HIDDEN_PRACTICE_NAME]);
  }
  if (hidden) {
    const moved = await q(
      `UPDATE employees SET "practiceId"=$1 WHERE "practiceId"=1 AND COALESCE("pimsType",'') NOT IN ('SCHTEST',$2)
         AND NOT EXISTS (SELECT 1 FROM users u WHERE u.employee_id=employees.id AND u.role IN ('admin','superadmin')) RETURNING id`,
      [hidden.id, TAG],
    );
    await q(`UPDATE users SET "practiceId"=$1 WHERE employee_id = ANY($2)`, [hidden.id, moved.map((r: { id: number }) => r.id)]);
    console.log(`moved ${moved.length} leftover staff to practice ${hidden.id}`);
    // GET /employees is not scoped by practice (one practice per database in production), so also mark them deleted.
    await q(`UPDATE employees SET "isDeleted"=true WHERE "practiceId"=$1`, [hidden.id]);
  }

  // Previous run's demo staff.
  const old = await q(`SELECT id FROM employees WHERE "pimsType"=$1`, [TAG]);
  if (old.length) {
    const ids = old.map((r: { id: number }) => r.id);
    for (const t of ['employee_offboardings', 'employee_permission_grants', 'employee_role_assignments', 'employee_branch']) {
      const col = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name=$1 AND column_name='employeeId'`, [t])).length;
      if (col) await q(`DELETE FROM ${t} WHERE "employeeId" = ANY($1)`, [ids]);
    }
    await q(`DELETE FROM treatment_items WHERE "pimsType" = $1`, [TAG]);
    await q(`DELETE FROM treatments WHERE "pimsType" = $1`, [TAG]);
    await q(`DELETE FROM tasks WHERE "createdByEmployeeId" = ANY($1) OR "assignedToEmployeeId" = ANY($1)`, [ids]);
    await q(`DELETE FROM appointments WHERE "primaryProviderId" = ANY($1)`, [ids]).catch(() =>
      q(`UPDATE appointments SET "isDeleted"=true WHERE "primaryProviderId" = ANY($1)`, [ids]));
    await q(`UPDATE clients SET "primaryProviderId"=NULL WHERE "primaryProviderId" = ANY($1)`, [ids]);
    await q(`UPDATE patients SET "primaryProviderId"=NULL WHERE "primaryProviderId" = ANY($1)`, [ids]);
    await q(`UPDATE users SET doctor_id=NULL WHERE doctor_id = ANY($1)`, [ids]);
    await q(`DELETE FROM users WHERE employee_id = ANY($1)`, [ids]);
    await q(`DELETE FROM employees WHERE id = ANY($1)`, [ids]).catch((e: Error) => {
      console.warn(`could not delete old demo staff (${e.message}); deactivating instead`);
      return q(`UPDATE employees SET "isActive"=false, "pimsType"='PERMDEMO-OLD' WHERE id = ANY($1)`, [ids]);
    });
  }

  // The Permission Audit Log should start empty for PERM-05 (the base test database carries hundreds of old rows).
  await q(`DELETE FROM permission_audit_entry WHERE "practiceId"=1`);

  const roleIds: Record<string, number> = {};
  for (const slug of Object.keys(ROLES)) roleIds[slug] = await ensureRole(slug);

  const secret = (process.env.JWT_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const out: Record<string, { employeeId: number; userId: number; name: string; token: string }> = {};
  for (const p of PEOPLE) {
    const email = `${p.first}.${p.last}`.toLowerCase() + '@example.com';
    const [e] = await q(
      `INSERT INTO employees ("practiceId","firstName","lastName",email,"isProvider","pimsType",timezone,"isActive","isLicensed","licenseType")
       VALUES (1,$1,$2,$3,$4,$5,'America/New_York',true,$6,$7) RETURNING id`,
      [p.first, p.last, email, !!p.provider, TAG, !!p.licensed, p.licensed ?? null],
    );
    const [u] = await q(
      `INSERT INTO users (email,password,role,"practiceId",employee_id,"isActive","allowEmail","allowText")
       VALUES ($1,'x-not-a-real-hash','employee',1,$2,true,false,false) RETURNING id`,
      [email, e.id],
    );
    // As in production (Nov 9): every vet's login is linked to themselves as the doctor.
    if (p.provider) await q(`UPDATE users SET doctor_id=$1 WHERE id=$2`, [e.id, u.id]);
    for (const r of p.roles) {
      await q(`INSERT INTO employee_role_assignments ("employeeId","roleId","branchId") VALUES ($1,$2,$3)`, [e.id, roleIds[r.slug], r.office ? office[r.office] : null]);
    }
    // Offices on the Profile tab: the first office role's office is primary; practice-wide people get every office
    // (shown as "All offices (practice-wide)"). Without rows the Profile tab falls back to the practice default.
    const offices = [...new Set(p.roles.map((r) => r.office).filter(Boolean) as Array<'raleigh' | 'durham'>)];
    if (!offices.length && p.home) offices.push(p.home);
    if (offices.length) {
      for (const [i, o] of offices.entries()) {
        await q(`INSERT INTO employee_branch ("employeeId","branchId","isPrimary") VALUES ($1,$2,$3)`, [e.id, office[o], i === 0]);
      }
    } else if (!p.noOffice) {
      for (const o of ['raleigh', 'durham'] as const) {
        await q(`INSERT INTO employee_branch ("employeeId","branchId","isPrimary") VALUES ($1,$2,false)`, [e.id, office[o]]);
      }
    }
    const token = sign(
      { sub: u.id, email, employeeId: e.id, doctorId: null, clientId: null, role: 'employee', practiceKey: process.env.DEFAULT_PRACTICE_KEY || 'vayd', practiceId: 1, accountId: null },
      secret,
      { expiresIn: '4h' },
    );
    out[p.key] = { employeeId: Number(e.id), userId: Number(u.id), name: `${p.first} ${p.last}`, token };
  }
  // PERM-04 (Offboard): Dr. Riley Rivera has visits after a last day a week out, is the Chens' primary doctor,
  // has two open tasks, and Tess Holt (tech) "works with" her. Leftover tasks from other test runs are hidden.
  const world = JSON.parse(fs.readFileSync(path.join(path.dirname(outFile), 'world.json'), 'utf8'));
  const fx = req(path.join(API, 'test/integration/scheduling.fixtures.ts'));
  const riley = out.departing_vet.employeeId;
  await q(`UPDATE tasks SET "isDeleted"=true WHERE "practiceId"=1 AND "isDeleted"=false`);
  await q(`UPDATE appointments SET "isDeleted"=true WHERE "primaryProviderId"=$1`, [riley]);
  const rileyVisits: number[] = [];
  for (const [ahead, hour, pet] of [[7, 10, 'B'], [8, 13, 'A'], [9, 9, 'B']] as const) {
    const h = world.households[pet];
    const v = await fx.createAppointment(db, world, {
      doctorId: riley,
      clientId: h.clientId,
      patientId: pet === 'A' ? h.activePetIds[0] : h.petId,
      start: fx.workdayAt(hour, 0, ahead),
    });
    rileyVisits.push(v.id);
  }
  await q(`UPDATE clients SET "primaryProviderId"=$1 WHERE id=$2`, [riley, world.households.B.clientId]);
  await q(`UPDATE patients SET "primaryProviderId"=$1 WHERE id=$2`, [riley, world.households.B.petId]);
  for (const title of ['Call back the Chens about Biscuit’s lab results', 'Sign the Rivera rabies certificate']) {
    await q(
      `INSERT INTO tasks ("practiceId",title,status,"createdByEmployeeId",source,"assignedToEmployeeId") VALUES (1,$1,'assigned',$2,'manual',$2)`,
      [title, riley],
    );
  }
  await q(`UPDATE users SET doctor_id=$1 WHERE id=$2`, [riley, out.technician.userId]);

  // ROLE-01/02/03 (Analytics): a week of production for Dr. Ortiz and Dr. Ruiz, so Veterinary Services
  // Delivered isn't empty. Made-up lines on the demo pets (owner, Nov 9: real-vet copies were fine, but
  // made-up lines need no anonymizing).
  await q(`DELETE FROM treatment_items WHERE "pimsType" = $1`, [TAG]);
  await q(`DELETE FROM treatments WHERE "pimsType" = $1`, [TAG]);
  const pets = [world.households.A.activePetIds[0], world.households.A.activePetIds[1], world.households.B.petId];
  const lines = [75, 120, 45, 38.5, 210];
  let n = 0;
  for (const vet of [out.veterinarian, out.medical_director]) {
    for (let day = 1; day <= 6; day++) {
      const d = new Date(Date.now() - day * 86400000);
      if ([0, 6].includes(d.getDay())) continue;
      const serviceDate = d.toLocaleDateString('en-CA');
      for (const price of lines.slice(0, 3 + (day % 3))) {
        const [t] = await q(
          `INSERT INTO treatments ("practiceId","patientId","pimsId","pimsType","isActive","isDeleted","isEstimate")
           VALUES (1,$1,$2,$3,true,false,false) RETURNING id`,
          [pets[n % pets.length], `permdemo-t${n}`, TAG],
        );
        await q(
          `INSERT INTO treatment_items ("practiceId","treatmentId",quantity,price,"serviceDate","productionEmployeeId","pimsId","pimsType","isActive","isDeleted","serviceFee")
           VALUES (1,$1,1,$2,$3,$4,$5,$6,true,false,0)`,
          [t.id, price, serviceDate, vet.employeeId, `permdemo-ti${n}`, TAG],
        );
        n++;
      }
    }
  }

  fs.writeFileSync(outFile, JSON.stringify({ offices: office, roleIds, staff: out, rileyVisits }, null, 2));
  console.log(`seeded ${PEOPLE.length} demo staff; offices ${JSON.stringify(office)}; wrote ${outFile}`);
}

main().then(() => pool.end(), async (e) => { console.error(e); await pool.end(); process.exit(1); });
