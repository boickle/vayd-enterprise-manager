/// <reference types="cypress" />
/**
 * Setup helpers shared by the membership training videos (MEM-xx). TEST stack only (a vayd_api_test* database).
 * Everything here runs before startClock(), so none of it is in the video. Plans come from setup/mem-plans.py
 * (the practice's real plans, pimsType MEM_TRAINING).
 */
import { schedulingApi, schedulingWorld } from '../support/schedulingWorld';
import { catalogId, giveSavedCard, openVisit, setBillBranch, sql } from './invKit';

export { sql };

// Setup calls that reach Stripe test mode can take more than Cypress's default 10 s on a busy machine.
Cypress.config('responseTimeout', 60000);
Cypress.config('pageLoadTimeout', 300000);

export const PLAN = {
  dogFoundationsMonthly: 'Membership - Canine Foundations - Monthly',
  dogFoundationsAnnual: 'Membership - Canine Foundations - Annual',
  dogGoldenMonthly: 'Membership - Canine Golden - Monthly',
  dogGoldenAnnual: 'Membership - Canine Golden - Annual',
  catFoundationsMonthly: 'Membership - Feline Foundations - Monthly',
  catFoundationsAnnual: 'Membership - Feline Foundations - Annual',
  catGoldenMonthly: 'Membership - Feline Golden - Monthly',
  dogPuppyMonthly: 'Membership - Canine Foundations Puppy / Kitten - Monthly',
} as const;

/** The demo pets: Maple (dog), Juniper (cat), Pepper (dog) — the Riveras; Biscuit (dog) — the Chens. */
export function pets() {
  const w = schedulingWorld();
  return {
    maria: w.households.A.clientId,
    tom: w.households.B.clientId,
    maple: w.households.A.activePetIds[0],
    juniper: w.households.A.activePetIds[1],
    pepper: w.households.A.inactivePetId,
    biscuit: w.households.B.petId,
  };
}

export const planId = (name: string) =>
  sql(`SELECT id FROM packages WHERE name='${name}' AND "pimsType"='MEM_TRAINING' ORDER BY id DESC LIMIT 1`).then((s) => Number(String(s).trim()));

/** Runs several SQL statements in one psql call (each cy.exec costs seconds on a busy machine). */
export const sqlBatch = (statements: string[]) => sql(statements.join('; '));

/**
 * Clears every membership the demo households have (and what goes with it), plus what the invoicing and scheduling
 * resets clear, in one database call. Pets get demo birthdays: Maple 4 y, Juniper 6 y, Pepper 10 y (dogs and cat),
 * Biscuit 2 y. `extra` statements run in the same call.
 */
export function resetMembershipWorld(extra: string[] = []) {
  const w = schedulingWorld();
  const p = pets();
  const petIds = `${p.maple},${p.juniper},${p.pepper},${p.biscuit}`;
  const clients = `${p.maria},${p.tom}`;
  const plans = `SELECT id FROM wellness_plans WHERE "patientId" IN (${petIds})`;
  sqlBatch([
    // resetSeededHouseholdsInDb (support/schedulingWorld.ts)
    `update appointments set "isDeleted"=true where "clientId" in (${clients}) and "appointmentStart">now() - interval '2 days'`,
    `delete from room_loader_appointments where "appointmentId" in (select id from appointments where "clientId" in (${clients}))`,
    `update patients set "isActive"=false where id in (select "patientsId" from clients_patients_patients where "clientsId" in (${clients})) and id not in (${petIds})`,
    // resetInvoicingWorld (invKit.ts)
    `UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId" IN (${clients}) AND "isDeleted"=false AND COALESCE("staffAudit"->>'seed','') <> 'inv-16-day'`,
    `UPDATE visit_estimates SET "isDeleted"=true WHERE "clientId" IN (${clients})`,
    `UPDATE clients SET email='maria.rivera@example.com' WHERE id=${p.maria}`,
    `UPDATE clients SET email='tom.chen@example.com' WHERE id=${p.tom}`,
    // Client history entries earlier takes left (agreement filings, membership and invoice emails).
    `DELETE FROM client_communication_logs WHERE "clientId" IN (${clients}) AND "communicationMessageLogId" IN (SELECT id FROM communication_message_logs WHERE "communicationTypeLabel" ILIKE '%membership%' OR "communicationTypeLabel" IN ('Estimate email','Receipt email','Invoice email','Ledger email'))`,
    `DELETE FROM communication_message_logs m WHERE ("communicationTypeLabel" ILIKE '%membership%' OR "communicationTypeLabel" IN ('Estimate email','Receipt email','Invoice email','Ledger email')) AND NOT EXISTS (SELECT 1 FROM client_communication_logs c WHERE c."communicationMessageLogId"=m.id)`,
    // Visit charts earlier takes opened for the demo pets (a chart would otherwise show "SOAPs (14) · 14 open").
    `UPDATE soap_encounters SET "isDeleted"=true WHERE "patientId" IN (${petIds}) AND "isDeleted"=false`,
    // Memberships
    `DELETE FROM wellness_plan_redemption WHERE "wellnessPlanId" IN (${plans})`,
    `DELETE FROM wellness_plan_items WHERE "wellnessPlanId" IN (${plans})`,
    `DELETE FROM wellness_plan_item_group WHERE "wellnessPlanId" IN (${plans})`,
    `DELETE FROM membership_audit_event WHERE "wellnessPlanId" IN (${plans})`,
    `DELETE FROM membership_renewal_notice WHERE "wellnessPlanId" IN (${plans})`,
    `DELETE FROM membership_agreement_requests WHERE "patientId" IN (${petIds})`,
    `DELETE FROM wellness_plans WHERE "patientId" IN (${petIds})`,
    `DELETE FROM chart_documents WHERE "patientId" IN (${petIds}) AND "pimsId" LIKE 'membership-agreement-%'`,
    `DELETE FROM membership_transactions WHERE "clientId" IN (${clients})`,
    `UPDATE patients SET "isActive"=true, "inactiveAt"=NULL, dob=now() - interval '4 years 2 months' WHERE id=${p.maple}`,
    `UPDATE patients SET "isActive"=true, "inactiveAt"=NULL, dob=now() - interval '6 years 5 months' WHERE id=${p.juniper}`,
    `UPDATE patients SET "isActive"=true, "inactiveAt"=NULL, dob=now() - interval '10 years 1 month' WHERE id=${p.pepper}`,
    `UPDATE patients SET "isActive"=true, "inactiveAt"=NULL, dob=now() - interval '2 years 3 months' WHERE id=${p.biscuit}`,
    // A product plans don't cover, from the real catalog (name, code and price only).
    `INSERT INTO inventory_items (name, code, price, "practiceId", "isActive", "isDeleted", "isMedication", "pimsType") SELECT 'Revolution Plus for Cats 5.6-11lb', 'REVPLUS5.6-11', 32.02, 1, true, false, false, 'MEM_TRAINING' WHERE NOT EXISTS (SELECT 1 FROM inventory_items WHERE name='Revolution Plus for Cats 5.6-11lb' AND "isDeleted"=false)`,
    // No stock is counted on the test stack (same as demo-names.sh does for its demo medication).
    `UPDATE inventory_items SET "trackLots"=false WHERE "pimsType"='MEM_TRAINING' OR name='Revolution Plus for Cats 5.6-11lb'`,
    ...extra,
  ]);
  void w;
}

/**
 * A Stripe TEST-mode subscription for a demo member (setup/stripe-mem.sh): the household's test customer with
 * Stripe's test Visa, on the plan's test price. Yields { customer, subscription }.
 */
export function testSubscription(clientId: number, plan: string, pm = 'pm_card_visa') {
  const apiDir = String(Cypress.env('SCH_API_DIR'));
  return sql(
    `SELECT c.email || '|' || c."firstName" || ' ' || c."lastName" || '|' || COALESCE(p."stripeMonthlyPriceId", p."stripeAnnualPriceId") FROM clients c, packages p WHERE c.id=${clientId} AND p.name='${plan}' AND p."pimsType"='MEM_TRAINING' ORDER BY p.id DESC LIMIT 1`
  ).then((row) => {
    const [email, name, price] = String(row).trim().split('|');
    return cy
      .exec(`bash cypress/training/setup/stripe-mem.sh sub "${apiDir}" "${email}" "${name}" ${price} ${pm}`, { timeout: 120000 })
      .then((r) => {
        const [customer, subscription] = r.stdout.trim().split(/\s+/);
        expect(subscription, 'Stripe test subscription').to.match(/^sub_/);
        return { customer, subscription };
      });
  });
}

/**
 * Enrols a pet the way an online signup lands (a Stripe test-mode subscription, agreement signed online), through
 * the API. `startDaysAgo` backdates the start (and the term) so the membership looks lived-in. `subscription: null`
 * leaves it unbilled (a staff enrolment before the fee is paid). Yields the membership id.
 */
export function enrolPet(
  patientId: number,
  plan: string,
  opts: { startDaysAgo?: number; interval?: 'monthly' | 'annual'; subscription?: string | null; clientId?: number } = {}
) {
  const w = schedulingWorld();
  const interval = opts.interval ?? (/Annual/.test(plan) ? 'annual' : 'monthly');
  const start = new Date(Date.now() - (opts.startDaysAgo ?? 30) * 86_400_000);
  const clientId = opts.clientId ?? (patientId === pets().biscuit ? pets().tom : pets().maria);
  const sub =
    opts.subscription === undefined
      ? testSubscription(clientId, plan).then((s) => s.subscription)
      : cy.wrap(opts.subscription, { log: false });
  return sub.then((subscription) =>
    planId(plan).then((packageId) =>
      schedulingApi<{ id: number }>('manager', 'POST', '/memberships/patient-memberships', {
        practiceId: w.practiceId,
        patientId,
        packageId,
        billingInterval: interval,
        startDate: start.toISOString(),
        stripeSubscriptionId: subscription,
        agreementAccepted: true,
        agreementSignature: clientId === pets().tom ? 'Tom Chen' : 'Maria Rivera',
        agreementSignedAt: start.toISOString(),
        // A 1x1 PNG stands in for the drawn signature (setup only; the video never shows it).
        agreementSignatureData:
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      }).then((res) => res.body.id)
    )
  );
}

/**
 * Records benefits a pet already used this term, the way a paid visit does: a redemption-ledger row (shows under
 * "Used this term") and the used count on the benefit row. `daysAgo` dates the use.
 */
export function useBenefits(membershipId: number, items: Array<{ name: string; daysAgo: number }>) {
  const statements: string[] = [];
  items.forEach(({ name, daysAgo }) => {
    const pick =
      `SELECT i.id, i."groupId", CASE WHEN i."procedureId" IS NOT NULL THEN 'procedure' WHEN i."labId" IS NOT NULL THEN 'lab' ELSE 'inventory' END t, ` +
      `COALESCE(i."procedureId", i."labId", i."inventoryItemId") cid FROM wellness_plan_items i LEFT JOIN procedures pr ON pr.id=i."procedureId" ` +
      `LEFT JOIN inventory_items ii ON ii.id=i."inventoryItemId" LEFT JOIN labs l ON l.id=i."labId" ` +
      `WHERE i."wellnessPlanId"=${membershipId} AND COALESCE(pr.name, ii.name, l.name)='${name}' ORDER BY i.id LIMIT 1`;
    statements.push(
      `INSERT INTO wellness_plan_redemption ("isActive","isDeleted","pimsType","practiceId","wellnessPlanId","wellnessPlanItemId","groupId","itemType","catalogItemId",quantity,"redeemedAt","isReversed","note") ` +
        `SELECT true,false,'mem-train',1,${membershipId},x.id,x."groupId",x.t,x.cid,1,now() - interval '${daysAgo} days',false,null FROM (${pick}) x`,
      `UPDATE wellness_plan_items SET "usedQuantity"=COALESCE("usedQuantity",0)+1 WHERE id=(SELECT id FROM (${pick}) y)`
    );
  });
  return sqlBatch(statements);
}

/**
 * Files a stand-in signed agreement on the pet's chart, the way a paid signup does, so the panel reads
 * "Benefits are available right away" instead of "fee not collected yet". Internal-use: not on the printed record.
 */
export function fileAgreement(patientId: number, clientId: number, daysAgo = 30) {
  sql(
    `INSERT INTO chart_documents ("pimsId","pimsType","practiceId","patientId","clientId",name,"internalUse","fileSize",extension,"contentType","documentOwner","documentOwnerTypeValue","serviceDate") ` +
      `VALUES ('membership-agreement-${patientId}-memtrain','SCOUT',1,${patientId},${clientId},'Membership agreement (signed)',true,0,'pdf','application/pdf',0,0,now() - interval '${daysAgo} days')`
  );
}

export const chartUrl = (patientId: number, focusMembership = true) =>
  `/schedule/patients?patientId=${patientId}${focusMembership ? '&focus=membership' : ''}`;

/**
 * Scrolls a far-away target to the middle and lets the smooth scroll finish before the kit measures it, so the
 * outline lands on the target (the kit's own 450 ms wait is too short for long scrolls).
 */
export function settle(get: () => Cypress.Chainable<JQuery<HTMLElement>>) {
  get().then(($el) => $el[0].scrollIntoView({ block: 'center', behavior: 'smooth' }));
  cy.wait(1100, { log: false });
}

/**
 * Off camera: closes the chart's "Case summary + chat" section. The test stack has no AI key, so that box would
 * only show "Request failed". The choice is saved per login, so later pages open with it closed too.
 */
export function quietChart() {
  cy.get('#pims-emr-case-prep', { timeout: 60000 }).then(($b) => {
    if ($b.attr('aria-expanded') === 'true') cy.get('#pims-emr-case-prep').click();
  });
  cy.get('#pims-emr-case-prep').should('have.attr', 'aria-expanded', 'false');
}

/**
 * Draws a signature in a signature box (a canvas) the way a finger would, with the training cursor following the
 * stroke. Synthetic pointer events have no live pointer to capture, so the canvas's setPointerCapture is stubbed
 * first (test only; the app is unchanged).
 */
export function drawSignature(get: () => Cypress.Chainable<JQuery<HTMLElement>>) {
  get().then(($c) => $c[0].scrollIntoView({ block: 'center', behavior: 'smooth' }));
  cy.wait(900, { log: false });
  // A loose cursive "M Rivera": x/y as fractions of the box.
  const path: Array<[number, number]> = [];
  for (let i = 0; i <= 60; i++) {
    const t = i / 60;
    path.push([0.12 + t * 0.72, 0.62 - 0.28 * Math.abs(Math.sin(t * Math.PI * 4.5)) + 0.06 * Math.sin(t * 19)]);
  }
  // Cypress waits between strokes, not page timers: a hidden test window throttles chained setTimeouts to about
  // one a minute, which made a 3-second signature take 11 minutes.
  const fire = (type: string, pt: [number, number]) =>
    get().then(($c) => {
      const canvas = $c[0] as HTMLCanvasElement;
      (canvas as any).setPointerCapture = () => undefined;
      const r = canvas.getBoundingClientRect();
      const clientX = r.left + pt[0] * r.width;
      const clientY = r.top + pt[1] * r.height;
      canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'pen', clientX, clientY, buttons: 1 }));
      const cursor = canvas.ownerDocument.getElementById('training-pointer');
      if (cursor) {
        cursor.style.transition = 'left .08s linear,top .08s linear';
        cursor.style.left = `${clientX}px`;
        cursor.style.top = `${clientY}px`;
      }
    });
  fire('pointerdown', path[0]);
  path.slice(1).forEach((pt) => {
    fire('pointermove', pt);
    cy.wait(30, { log: false });
  });
  fire('pointerup', path[path.length - 1]);
  cy.document({ log: false }).then((doc) => {
    const cursor = doc.getElementById('training-pointer');
    if (cursor) cursor.style.transition = 'left .55s ease,top .55s ease,transform .15s ease';
  });
  cy.wait(300, { log: false });
}

/** Debug aid: appends "<time> <label>" to $TRAINING_OUT/progress.log when the command queue reaches it. */
export function trace(label: string) {
  cy.then(() => {
    const out = Cypress.env('TRACE_FILE');
    if (out) cy.writeFile(out, `${new Date().toISOString()} ${label}\n`, { flag: 'a+', log: false });
  });
}

/**
 * A finished visit today for one pet, its charges, and payment by the household's saved Stripe TEST card (the way a
 * CL takes card on file at checkout). `items` are catalog names; prices come from the catalog. Yields
 * { appt, invoiceId }.
 */
export function paidVisit(patientId: number, clientId: number, items: string[], minutesAgo = 120) {
  const w = schedulingWorld();
  const email = clientId === pets().tom ? 'tom.chen@example.com' : 'maria.rivera@example.com';
  const name = clientId === pets().tom ? 'Tom Chen' : 'Maria Rivera';
  giveSavedCard(clientId, email, name);
  return openVisit(patientId, clientId, 'Wellness visit', minutesAgo).then(({ appt, enc }) =>
    schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices', { practiceId: w.practiceId, appointmentId: appt, clientId }).then((inv) => {
      setBillBranch(clientId);
      items.forEach((item) =>
        catalogId(item).then((c) =>
          sql(`SELECT price FROM ${c.type === 'procedure' ? 'procedures' : 'inventory_items'} WHERE id=${c.id}`).then((price) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: w.practiceId, name: item, catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: Number(price),
            })
          )
        )
      );
      const invoiceId = inv.body.id;
      cy.then(() => schedulingApi('cl', 'POST', `/visit-payments/${invoiceId}/charge-saved-card`, { practiceId: w.practiceId }));
      return cy.then(() => ({ appt, invoiceId }));
    })
  );
}

/**
 * Off camera: adds charges on a visit's Checkout panel through the screen (so Scout prices and covers them exactly as
 * it does live). Picks the first offered benefit (the included one) when the coverage picker asks.
 */
export function addChargesOnScreen(items: string[]) {
  const box = () => cy.get('.soap-checkout input[placeholder^="Type here to add a charge"]');
  items.forEach((name) => {
    cy.wait(800);
    box().should('not.be.disabled').clear().type(name, { delay: 0 });
    box().should('have.value', name);
    cy.get('button[role="option"] .soap-plan-result-name', { timeout: 30000 })
      .filter((_, el) => (el.textContent || '').trim().startsWith(name))
      .first()
      .closest('button')
      .click();
    const short = name.slice(0, 18);
    cy.get('body', { timeout: 30000 }).should(($b) => {
      const lines = $b.find('.soap-invoice-line').filter((_, el) => (el.textContent || '').includes(short)).length;
      expect($b.find('.mcp-modal').length + lines, 'picker or new line').to.be.greaterThan(0);
    });
    cy.get('body').then(($b) => {
      if ($b.find('.mcp-modal').length) {
        cy.get('.mcp-option input').first().check({ force: true });
        cy.contains('.mcp-btn--primary', 'Use this benefit').click();
      }
    });
    cy.contains('.soap-invoice-line', name.slice(0, 18), { timeout: 30000 }).should('exist');
  });
}

export const PLAN_GOLDEN_DOG = 'Membership - Canine Golden - Monthly';

/**
 * The owner's renewal-review link for a membership (the one the 14-day notice email carries), signed with the test
 * stack's MEMBERSHIP_RENEWAL_TOKEN_SECRET (a test-only value set when the stack starts). Yields the app path.
 */
export function renewalLink(membershipId: number) {
  const secret = 'mem-training-renewal-links-test-only';
  return sql(`SELECT to_char("expirationDate" AT TIME ZONE 'UTC', 'YYYY-MM-DD') FROM wellness_plans WHERE id=${membershipId}`).then((d) => {
    const payload = { v: 1, w: membershipId, t: String(d).trim(), iat: Date.now(), p: 1 };
    const js = `const c=require('crypto');const p=Buffer.from(process.argv[1]).toString('base64url');process.stdout.write(p+'.'+c.createHmac('sha256',process.argv[2]).update(p).digest('base64url'))`;
    return cy
      .exec(`node -e "${js}" '${JSON.stringify(payload)}' '${secret}'`)
      .then((r) => `/membership/renewal?token=${encodeURIComponent(r.stdout.trim())}`);
  });
}
