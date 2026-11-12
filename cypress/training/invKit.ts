/// <reference types="cypress" />
/**
 * Setup helpers shared by the invoicing training videos (INV-xx). TEST stack only (a vayd_api_test* database).
 * Everything here runs before startClock(), so none of it is in the video.
 */
import { resetSeededHouseholdsInDb, schedulingApi, schedulingWorld } from '../support/schedulingWorld';

export const testDb = () => {
  const db = String(Cypress.env('SCH_DB'));
  expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
  return db;
};

/** Runs one SQL statement on the test database and yields stdout. */
export const sql = (q: string) =>
  cy.exec(`psql -qAt -d ${testDb()} -c "${q.replace(/"/g, '\\"')}"`).its('stdout');

/** Clears what an earlier take left: both households' visits, bills and estimates; keeps credit and cards alone. */
export function resetInvoicingWorld() {
  const w = schedulingWorld();
  resetSeededHouseholdsInDb();
  const clients = `${w.households.A.clientId},${w.households.B.clientId}`;
  sql(`UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId" IN (${clients}) AND "isDeleted"=false AND COALESCE("staffAudit"->>'seed','') <> 'inv-16-day'`);
  sql(`UPDATE visit_estimates SET "isDeleted"=true WHERE "clientId" IN (${clients})`);
  // INV-03 to INV-05 use their own Stripe emails; put the demo ones back so other screens show them.
  sql(`UPDATE clients SET email='maria.rivera@example.com' WHERE id=${w.households.A.clientId}`);
  sql(`UPDATE clients SET email='tom.chen@example.com' WHERE id=${w.households.B.clientId}`);
  // Estimate emails that earlier takes recorded on the client's history.
  sql(`DELETE FROM client_communication_logs WHERE "communicationMessageLogId" IN (SELECT id FROM communication_message_logs WHERE "communicationTypeLabel" IN ('Estimate email','Receipt email','Invoice email','Ledger email'))`);
  sql(`DELETE FROM communication_message_logs WHERE "communicationTypeLabel" IN ('Estimate email','Receipt email','Invoice email','Ledger email')`);
  sql(`UPDATE scout_chart_notes SET "isDeleted"=true WHERE "clientId" IN (${clients}) AND "isDeleted"=false AND body ILIKE '%Your estimate from%'`);
  // INV-01 leaves a charted decline on Maple; other videos start without it.
  sql(`DELETE FROM treatment_items WHERE "pimsType"='inv-train-decline'`);
}

/** Sets the demo branch and its car shelf on the client's open bills, so the Branch and Location boxes are filled in. */
export function setBillBranch(clientId: number) {
  const w = schedulingWorld();
  sql(
    `UPDATE visit_invoices SET "inventoryBranchId"=${w.branchId}, "inventoryLocationId"=(SELECT id FROM inventory_branch_location WHERE "branchId"=${w.branchId} AND code='CAR') WHERE "clientId"=${clientId} AND "isDeleted"=false AND status='open'`
  );
}

/** A visit today for one pet, with its SOAP encounter, charted just enough to look real. Yields { appt, enc }. */
export function openVisit(patientId: number, clientId: number, description: string, minutesAgo = 90) {
  const w = schedulingWorld();
  const start = new Date(Math.floor((Date.now() - minutesAgo * 60_000) / (15 * 60_000)) * 15 * 60_000);
  return schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
    practiceId: w.practiceId,
    primaryProviderId: w.doctors.A,
    clientId,
    patientId,
    appointmentTypeId: w.types.medical,
    appointmentStart: start.toISOString(),
    appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
    description,
    bookedViaRouting: true,
  }).then((res) =>
    schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
      practiceId: w.practiceId,
      appointmentId: res.body.id,
      patientId,
      clientId,
      mode: 'comprehensive',
    }).then((enc) => ({ appt: res.body.id, enc: enc.body.id }))
  );
}

/** The id of a catalog item by name (procedure or inventory item), as `type:id`. */
export const catalogId = (name: string) =>
  sql(
    `SELECT t || ':' || id FROM (SELECT 'procedure' t, id, name FROM procedures WHERE "isDeleted"=false UNION ALL SELECT 'inventory', id, name FROM inventory_items WHERE "isDeleted"=false) x WHERE name='${name}' ORDER BY id LIMIT 1`
  ).then((s) => {
    const [type, id] = String(s).trim().split(':');
    return { type: type as 'procedure' | 'inventory', id: Number(id) };
  });

/** An open household bill with the given catalog lines, made through the API the way the counter does. */
export function counterBill(patientId: number, clientId: number, items: string[]) {
  const w = schedulingWorld();
  return schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices/counter', {
    practiceId: w.practiceId,
    patientId,
    clientId,
  }).then((res) => {
    const id = res.body.id;
    items.forEach((name) =>
      catalogId(name).then((c) =>
        sql(`SELECT price FROM ${c.type === 'procedure' ? 'procedures' : 'inventory_items'} WHERE id=${c.id}`).then((price) =>
          schedulingApi('cl', 'POST', `/visit-invoices/${id}/lines`, {
            practiceId: w.practiceId,
            patientId,
            description: name,
            qty: 1,
            unitPrice: Number(price),
            catalogItemId: c.id,
            catalogItemType: c.type,
            providerEmployeeId: w.doctors.A,
          })
        )
      )
    );
    return cy.then(() => id);
  });
}

/** Types into one field of Stripe's card box (an iframe), like a person: cardnumber, exp-date, cvc or postal. */
export function stripeField(host: string, name: 'cardnumber' | 'exp-date' | 'cvc' | 'postal', text: string, clearFirst = false) {
  cy.get(`${host} iframe`, { timeout: 60000 })
    .its('0.contentDocument.body')
    .should('not.be.empty')
    .then(cy.wrap)
    .find(`input[name="${name}"]`, { timeout: 30000 })
    .type(`${clearFirst ? '{selectall}{backspace}' : ''}${text}`, { delay: 70 });
}

/** Gives a client a saved Stripe TEST card with the card-on-file agreement on record. `pm` picks the test card. */
export function giveSavedCard(clientId: number, email: string, name: string, pm = 'pm_card_visa') {
  const apiDir = String(Cypress.env('SCH_API_DIR'));
  cy.exec(`bash cypress/training/setup/stripe-test-card.sh "${apiDir}" "${email}" "${name}" ${pm}`, { timeout: 120000 }).then((r) => {
    const [cus, pmId] = r.stdout.trim().split(/\s+/);
    expect(cus, 'Stripe customer').to.match(/^cus_/);
    expect(pmId, 'Stripe payment method').to.match(/^pm_/);
    sql(
      `UPDATE clients SET email='${email}', "stripeCustomerId"='${cus}', "savedPaymentMethodId"='${pmId}', "cardOnFileConsentAt"=now(), "cardOnFileConsentAgreementVersion"='2026-11-12', "cardOnFileConsentSource"='training', "cardOnFileDeclinedAt"=NULL WHERE id=${clientId}`
    );
  });
}

/** Batch C: puts a client's Scout account credit back to $0 (marks any credit invoice, one that is overpaid, as deleted). */
export function clearAccountCredit(clientId: number) {
  sql(
    `UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId"=${clientId} AND "isDeleted"=false AND status<>'void' AND COALESCE(total,0)-COALESCE("amountPaid",0) < -0.009`
  );
}
