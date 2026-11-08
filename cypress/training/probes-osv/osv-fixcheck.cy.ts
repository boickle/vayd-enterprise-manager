/// <reference types="cypress" />
/** Re-walk after the Nov 7 fixes: B2 guest product page, B1 direct-invoice Mail order, B3 approval task (OSV-07),
 *  Q8 lot picking (OSV-08), OSV-12 Billing task and "Ended: card failed". */
import '../../support/e2e';
import { schedulingApi, schedulingWorld } from '../../support/schedulingWorld';
import { enterCard, labels, osv, recordFails, shot, signIn, sql, visitCart } from './osvKit';

const expand = (orderNo: string) => {
  cy.get('input[placeholder*="Order #"]', { timeout: 30000 }).clear().type(orderNo.replace('#', ''));
  cy.wait(2500);
  cy.contains(orderNo).first().click({ force: true });
  cy.wait(3000);
};

describe('Fix check', () => {
  it.skip('B2: a guest on a prescription item', () => {
    cy.clearLocalStorage();
    cy.visit('/store');
    cy.contains('button', 'Prescriptions', { timeout: 30000 }).click();
    cy.contains('Heartworm & flea chewable', { timeout: 30000 }).click();
    cy.contains('Log in to your client portal to order it', { timeout: 20000 });
    cy.contains('a', 'Log in to order');
    cy.contains('button', /Add to cart/).should('not.exist');
    cy.contains('button', /^Auto-ship/).should('not.exist');
    shot('fx-01-guest-rx');
  });

  it.skip('B1: Mail order on a direct invoice (tech)', () => {
    const w = schedulingWorld();
    const o = osv();
    const save = recordFails();
    schedulingApi<{ id: string }>('technician', 'POST', '/visit-invoices/counter', { practiceId: w.practiceId, patientId: o.pets.juniper, clientId: o.clients.rivera }).then((res) => {
      const id = res.body.id;
      schedulingApi('technician', 'POST', `/visit-invoices/${id}/lines`, {
        practiceId: w.practiceId, patientId: o.pets.juniper, description: 'Joint support chews (60 ct)', qty: 1, unitPrice: 36,
        catalogItemId: o.items.joint, catalogItemType: 'inventory', providerEmployeeId: w.doctors.A,
      });
      signIn('technician', `/schedule/clients?clientId=${o.clients.rivera}&tab=financial&invoice=${id}`);
      cy.contains('Joint support chews', { timeout: 40000 });
      cy.wait(2500);
      cy.get('.mail-mode__toggle').contains('button', /^Mail order/).first().scrollIntoView().click();
      cy.contains('Send to mail queue', { timeout: 10000 });
      cy.contains('Shipping / pick-up type').parent().find('select').select('ship-499');
      cy.intercept('POST', '**/mail-orders*').as('createMail');
      cy.contains('button', 'Add to mail queue').click();
      cy.wait('@createMail', { timeout: 20000 }).its('response.statusCode').should('be.lessThan', 300);
      cy.wait(3000);
      shot('fx-02-direct-invoice-mailed');
      save('fx-02');
    });
  });

  it('B3: Maria orders Juniper thyroid; Robin sends the task; Dr. Lane approves', () => {
    signIn('client', '/store');
    cy.contains('button', 'Prescriptions', { timeout: 30000 }).click();
    cy.contains('Thyroid tablets', { timeout: 30000 }).click();
    cy.contains('button', /^Juniper$/, { timeout: 20000 }).click();
    cy.contains('button', /^Buy once$/).click();
    cy.contains('button', 'Add to cart').click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    visitCart();
    cy.get('body').then(($b) => {
      if ($b.text().includes('Yes — send it here')) cy.contains('Yes — send it here').click();
      if ($b.find('.vayd-store__card-box').length) enterCard();
    });
    cy.contains('button', 'Place order').click();
    cy.contains('h1', 'Thank you', { timeout: 60000 });
    cy.location('pathname').then((p) => cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/fx-thyroid-order.txt`, p));
    // Robin sends the approval task to Dr. Lane.
    const save = recordFails();
    cy.location('pathname').then((p) => {
      const orderNo = `#${p.split('/').pop()}`;
      signIn('manager', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      expand(orderNo);
      cy.contains('label', /^Send to/).find('select').then(($sel) => {
        const lane = [...($sel[0] as HTMLSelectElement).options].find((x) => /Lane/.test(x.text) && x.value);
        if (lane) cy.wrap($sel).select(lane.value);
      });
      cy.intercept('POST', '**/approval-task').as('sendTask');
      cy.contains('button', /^Send task$/).click();
      cy.wait('@sendTask').its('response.statusCode').should('be.lessThan', 300);
      cy.wait(2500);
      shot('fx-03-task-sent');
      labels('fx-03-task-sent');
      save('fx-03');
      // Dr. Lane opens the task.
      signIn('doctorA', '/schedule/tasks');
      cy.contains(/Active \(1\)|Active \([1-9]/, { timeout: 30000 });
      cy.wait(3000);
      shot('fx-04-lane-tasks');
      labels('fx-04-lane-tasks');
      cy.contains(/Thyroid|mail order|Mail order|approval/i).first().click({ force: true });
      cy.wait(4000);
      shot('fx-05-lane-task-open');
      labels('fx-05-lane-task-open');
    });
  });
});

describe('OSV-12 and Auto-ships', () => {
  it('Robin: Billing task about Tom, and Ended: card failed', () => {
    signIn('manager', '/schedule/tasks');
    cy.wait(6000);
    shot('fx-06-robin-tasks');
    labels('fx-06-robin-tasks');
    signIn('manager', '/schedule/inventory/auto-ships');
    cy.contains('Auto-ships', { timeout: 40000 });
    cy.contains('button', 'Payment problems').click();
    cy.wait(2500);
    shot('fx-07-payment-problems');
    labels('fx-07-payment-problems');
  });
});
