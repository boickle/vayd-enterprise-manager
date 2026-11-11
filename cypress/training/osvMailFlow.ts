/// <reference types="cypress" />
/** Shared steps for the Mail Order videos (OSV-17 to OSV-26). TEST stack only. */
import { osv, schedulingWorld, signIn, sql } from './osvTraining';
import { schedulingApi } from '../support/schedulingWorld';
import { choose, tap } from './trainingKit';

/** Picks the option whose text matches, in the select inside the label that matches. */
export const selectByText = (label: RegExp, text: RegExp) =>
  cy
    .contains('label', label)
    .find('select')
    .contains('option', text, { timeout: 30000 })
    .parent('select')
    .then(($sel) => {
      const opt = [...($sel[0] as HTMLSelectElement).options].find((x) => text.test(x.text) && x.value);
      choose(() => cy.contains('label', label).find('select'), opt!.value);
    });

/** Off camera: opens an order with a plain click (not counted as an on-camera click), only when it's closed. */
export const openOrderQuietly = (id: () => number) =>
  cy.then(() => cy.contains(`#${id()}`, { timeout: 20000 })).wait(500).then(() => {
    if (!isOpen(id())) cy.contains(`#${id()}`).first().click();
  });

/** True when the order's card in the queue is expanded. */
function isOpen(id: number): boolean {
  return Cypress.$('.mail-queue__card.is-open').filter((_, el) => (el.textContent || '').includes(`#${id}`)).length > 0;
}

/**
 * Opens an order in the queue (a click on an open order closes it, so only when it's closed). Waits for the list
 * to show the order first, so a list still loading isn't taken for a closed order.
 */
export const openOrder = (id: () => number) =>
  cy.then(() => cy.contains(`#${id()}`, { timeout: 20000 })).wait(200).then(() => {
    if (!isOpen(id())) tap(() => cy.contains(`#${id()}`).first());
  });

/** Maple's heartworm Rx back to 3 refills, Juniper's thyroid Rx back to none (earlier takes used them). */
export function resetRefills() {
  const o = osv();
  sql(`UPDATE prescriptions SET refill=3, "discontinuedAt"=NULL, "autoshipStartedAt"=NULL, acuity='chronic' WHERE "patientId"=${o.pets.maple} AND "inventoryItemId"=${o.items.hw} AND "isDeleted"=false`);
  sql(`UPDATE prescriptions SET refill=0, "discontinuedAt"=NULL, "autoshipStartedAt"=NULL, acuity='chronic' WHERE "patientId"=${o.pets.juniper} AND "inventoryItemId"=${o.items.thyroid} AND "isDeleted"=false`);
  // Earlier takes' visit bills (TEST database): otherwise orders show "Account balance due … outside this mail order".
  sql(`UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId"=${o.clients.rivera} AND "isDeleted"=false`);
}

/**
 * The print dialog opens a new window. In the video it is caught instead, and the labels Scout would print are
 * shown over the page, larger, so staff can read them. Call before clicking "Use system print dialog".
 */
export function catchPrintWindow() {
  cy.window().then((win) => {
    (win as any).__printedHtml = '';
    cy.stub(win, 'open').callsFake(() => {
      const fake: any = {
        closed: false,
        document: { write: (h: string) => ((win as any).__printedHtml += h), close: () => undefined, open: () => undefined },
        focus: () => undefined,
        print: () => undefined,
        close: () => undefined,
      };
      return fake;
    });
  });
}

/** Shows the caught labels over the page (Rx label first, then the bag label), scaled up. */
export function showPrintedLabels() {
  cy.window().then((win) => {
    const html = String((win as any).__printedHtml || '').replace(/<script[\s\S]*?<\/script>/gi, '');
    const doc = win.document;
    doc.getElementById('training-labels')?.remove();
    const wrap = doc.createElement('div');
    wrap.id = 'training-labels';
    wrap.setAttribute(
      'style',
      'position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;gap:32px;'
    );
    const pages = html.match(/<section class="label">[\s\S]*?<\/section>/g) || [];
    const style = (html.match(/<style>[\s\S]*?<\/style>/) || [''])[0];
    pages.forEach((page, i) => {
      const box = doc.createElement('div');
      box.className = `training-label training-label-${i + 1}`;
      box.setAttribute('style', 'display:flex;flex-direction:column;align-items:center;gap:10px;');
      const cap = doc.createElement('div');
      cap.textContent = i === 0 ? 'Rx label' : 'Bag label';
      cap.setAttribute('style', 'color:#fff;font:600 20px system-ui;');
      const frame = doc.createElement('iframe');
      // Twice the real size (3.1 x 1.8 in), zoomed inside the frame so the two labels sit side by side.
      frame.setAttribute('style', 'width:6.2in;height:3.6in;border:0;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.3);');
      frame.srcdoc = `<!doctype html><html><head>${style}<style>html{zoom:2}</style></head><body style="margin:0">${page}</body></html>`;
      box.appendChild(cap);
      box.appendChild(frame);
      wrap.appendChild(box);
    });
    doc.body.appendChild(wrap);
  });
}

export const hidePrintedLabels = () => cy.window().then((win) => win.document.getElementById('training-labels')?.remove());

/**
 * Setup (before the clock, plain clicks): a visit today for Juniper with Dr. Lane; she adds the heartworm chewable at
 * Checkout, writes and approves the script, and sends it to the mail queue (shipping $4.99), as in OSV-05.
 * Yields { orderId, invoiceId }. The visit bill is left unpaid.
 */
export function visitMailOrder() {
  const o = osv();
  const w = schedulingWorld();
  sql(`UPDATE appointments SET "isDeleted"=true WHERE "patientId"=${o.pets.juniper} AND "appointmentStart" > now() - interval '1 day'`);
  // Earlier takes wrote a new heartworm Rx for Juniper at each visit; keep her chart to the demo's own Rx.
  sql(`UPDATE prescriptions SET "isDeleted"=true WHERE "patientId"=${o.pets.juniper} AND "inventoryItemId"=${o.items.hw} AND ("pimsId" IS NULL OR "pimsId" NOT LIKE 'osv-demo-%')`);
  // Earlier takes' visit bills for the Riveras (TEST database), so the ledger and queue show only today's.
  sql(`UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId"=${o.clients.rivera} AND "isDeleted"=false`);
  const start = new Date(Math.floor((Date.now() - 45 * 60_000) / (15 * 60_000)) * 15 * 60_000);
  schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
    practiceId: w.practiceId, primaryProviderId: w.doctors.A, clientId: o.clients.rivera, patientId: o.pets.juniper,
    appointmentTypeId: w.types.medical, appointmentStart: start.toISOString(),
    appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(), description: 'Heartworm refill', bookedViaRouting: true,
  }).then((res: { body: { id: number } }) => {
    const apptId = res.body.id;
    schedulingApi('doctorA', 'POST', '/soap-encounters', {
      practiceId: w.practiceId, appointmentId: apptId, patientId: o.pets.juniper, clientId: o.clients.rivera, mode: 'comprehensive',
    });
    signIn('doctorA', `/schedule/soap/${apptId}/${o.pets.juniper}?clientId=${o.clients.rivera}`);
  });
  const charge = () => cy.get('input[placeholder*="add a charge" i], input[placeholder*="Type here" i]', { timeout: 60000 }).first();
  charge().scrollIntoView().type('Heartworm', { delay: 40 });
  cy.contains('.soap-plan-result', /Heartworm & flea chewable, 22-44 lb/, { timeout: 20000 }).first().click();
  cy.get('label.client-fin__sig, button.soap-invoice-line-expand[aria-expanded="false"]', { timeout: 20000 });
  cy.wait(800);
  cy.get('body').then(($b) => {
    if (!$b.find('label.client-fin__sig').length) cy.get('button.soap-invoice-line-expand[aria-expanded="false"]').first().click();
  });
  cy.contains('label.client-fin__sig', 'Directions (sig)', { timeout: 20000 }).find('textarea').type('Give one chewable by mouth once a month with food.').blur();
  cy.get('label.client-fin__refill input', { timeout: 20000 }).first().should('not.be.disabled').type('5');
  cy.get('select[aria-label="Acute or chronic prescription"]', { timeout: 20000 }).first().should('not.be.disabled').select('chronic');
  cy.contains('button.client-fin__btn-approve', /^Approve$/).click();
  cy.get('button.soap-invoice-line-expand[aria-expanded="false"]', { timeout: 20000 }).first().click();
  cy.get('.mail-mode__toggle', { timeout: 20000 }).first().contains('button', /^Mail order/).click();
  cy.contains('h3', 'Send to mail queue', { timeout: 15000 });
  cy.contains('label', 'Shipping / pick-up type').find('select').select('ship-499');
  cy.contains('button', /^Add to mail queue$/).click();
  cy.get('.mail-mode__stage, .mail-mode', { timeout: 30000 });
  return sql(
    `SELECT id || ' ' || coalesce("scoutInvoiceId"::text, substring(notes from 'invoice:([0-9a-f-]{36})'), '') FROM mail_orders WHERE "clientId"=${o.clients.rivera} ORDER BY id DESC LIMIT 1`
  ).then((v) => {
    const [orderId, invoiceId] = String(v).trim().split(' ');
    return cy.wrap({ orderId: Number(orderId), invoiceId });
  });
}

/** Behind the scenes: pays a visit bill in cash so its mail order can be filled (TEST database, no card). */
export function payVisitBillInCash(invoiceId: string) {
  const w = schedulingWorld();
  return sql(`SELECT round(total - "amountPaid", 2) FROM visit_invoices WHERE id='${invoiceId}'`).then((due) =>
    schedulingApi('cl', 'POST', `/visit-invoices/${invoiceId}/tenders`, {
      practiceId: w.practiceId, method: 'cash', amount: Number(String(due).trim()),
    })
  );
}
