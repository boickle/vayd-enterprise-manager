/// <reference types="cypress" />
import { catalogWorld } from './catalogWorld';

/**
 * Helpers shared by the catalog end-to-end specs. The database is the dedicated local test database
 * (CYPRESS_E2E_DB, default vayd_api_test_e2e): never vayd_api_local.
 */
const db = () => String(Cypress.env('E2E_DB') || 'vayd_api_test_e2e');

/** Runs one SQL statement on the test database and yields the trimmed output (use RETURNING ... for ids). */
export function sql(statement: string): Cypress.Chainable<string> {
  if (/vayd_api_local|prod/i.test(db())) throw new Error('Refusing: not a dedicated test database');
  return cy
    .exec('psql -h localhost -U vayd -d ' + db() + ' -tA -c "$CAT_SQL"', {
      env: { PGPASSWORD: 'vayd', CAT_SQL: statement },
    })
    .then((r) => r.stdout.trim().split('\n')[0] ?? '');
}

/** A client with a working email and one active pet, on no status, so nothing discounts the totals. */
export function plainClient(label: string): Cypress.Chainable<{ clientId: number; patientId: number; petName: string }> {
  const w = catalogWorld();
  const key = `${w.tag}-${label}-${Date.now()}`;
  const petName = `${label} pet`;
  return sql(
    `INSERT INTO clients ("firstName", "lastName", email, "practiceId", "pimsType", "pimsId", "doNotEmail", "doNotSendReminders", "smsOptOut", "noEmail")
     VALUES ('Cat', '${label}', '${key}@vayd.test', ${w.practiceId}, 'CATTEST', '${key}', false, false, true, false) RETURNING id`
  ).then((clientId) =>
    sql(
      `INSERT INTO patients (name, "practiceId", "pimsType", "pimsId", "isActive") VALUES ('${petName}', ${w.practiceId}, 'CATTEST', '${key}-pet', true) RETURNING id`
    ).then((patientId) =>
      sql(`INSERT INTO clients_patients_patients ("clientsId","patientsId") VALUES (${clientId}, ${patientId})`).then(() => ({
        clientId: Number(clientId),
        patientId: Number(patientId),
        petName,
      }))
    )
  );
}

/**
 * Stands in for Gmail (the staff email composer talks to Gmail through the API). Every send is
 * captured in memory instead of leaving the machine; `sent()` yields what the composer sent.
 */
export function stubGmail() {
  const sent: Array<Record<string, any>> = [];
  cy.intercept('GET', '**/gmail/access', { allowed: true });
  cy.intercept('GET', '**/gmail/mailboxes*', {
    mailboxes: [{ email: 'info@vetatyourdoor.com', kind: 'shared', connected: true, authMode: 'service_account' }],
  });
  cy.intercept('GET', '**/gmail/send-as*', {
    aliases: [{ sendAsEmail: 'info@vetatyourdoor.com', displayName: 'Vet At Your Door', isDefault: true, isPrimary: true, treatAsAlias: false, signature: '' }],
  });
  cy.intercept('POST', '**/gmail/messages/send*', (req) => {
    sent.push(req.body);
    req.reply({ id: 'captured-1', threadId: 'captured-t1' });
  });
  return { sent: () => sent };
}

/** Opens the client's financial tab as the given staff role. */
export function openFinancial(clientId: number) {
  return `/schedule/clients?clientId=${clientId}&tab=financial`;
}

/** Adds a charge to the open counter invoice through the "Add a charge for <pet>" box and waits for the line. */
export function addCharge(petName: string, itemName: string) {
  cy.get(`input[placeholder="Add a charge for ${petName}"]`).clear().type(itemName);
  cy.contains('[role="option"], li, button', itemName, { timeout: 20000 }).first().click();
}

/** Starts a new counter invoice on the client's financial tab. */
export function startInvoice() {
  cy.contains('button', 'New invoice', { timeout: 30000 }).click();
}

/** Clicks Email invoice, sends it through the stubbed Gmail, and yields the sent message as plain text. */
export function emailInvoiceText(gmail: { sent: () => Array<Record<string, any>> }, before = 0): Cypress.Chainable<string> {
  cy.contains('button', 'Email invoice').click();
  cy.contains('button', 'Send email', { timeout: 20000 }).should('not.be.disabled').click();
  cy.wrap(null).should(() => expect(gmail.sent()).to.have.length(before + 1));
  return cy.then(() => {
    const mail = gmail.sent()[before];
    const html = String(mail.bodyHtml || mail.bodyText || '');
    return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  });
}

/** Gives every seeded catalog branch a stock location so checkout can take payment. */
export function ensureLocations() {
  return sql(
    `INSERT INTO inventory_branch_location ("branchId", code, name, "sortOrder", "isDefault", "isActive")
     SELECT b.id, 'MAIN', 'Main', 0, true, true FROM practice_branch b
     WHERE b.name LIKE 'hcat-%' AND NOT EXISTS (SELECT 1 FROM inventory_branch_location l WHERE l."branchId" = b.id)`
  );
}
