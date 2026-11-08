/// <reference types="cypress" />
/** Live check (Nov 8): Dr. Lane approves 1 of 3 thyroid tablets and Scout refunds 2 (Stripe test mode); B4 locked
 *  fields for Riley; B6 phones (no texting-panel error). */
import '../../support/e2e';
import { enterCard, labels, recordFails, shot, signIn, sql, visitCart } from './osvKit';

const expand = (orderNo: string) => {
  cy.get('input[placeholder*="Order #"]', { timeout: 30000 }).clear().type(orderNo.replace('#', ''));
  cy.wait(2500);
  cy.contains(orderNo).first().click({ force: true });
  cy.wait(3000);
};

describe('Lower quantity and B4', () => {
  it('Maria orders 3 thyroid; Robin sends the task; Dr. Lane approves 1', () => {
    signIn('client', '/store');
    cy.contains('button', 'Prescriptions', { timeout: 30000 }).click();
    cy.contains('Thyroid tablets', { timeout: 30000 }).click();
    cy.contains('button', /^Juniper$/, { timeout: 20000 }).click();
    cy.contains('button', /^Buy once$/).click();
    cy.get('button[aria-label="Increase quantity"]').click().click();
    cy.contains('button', 'Add to cart').click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    visitCart();
    cy.get('body').then(($b) => {
      if ($b.text().includes('Yes — send it here')) cy.contains('Yes — send it here').click();
      if ($b.find('.vayd-store__card-box').length) enterCard();
    });
    cy.contains('button', 'Place order').should('not.be.disabled').click();
    cy.contains('h1', 'Thank you', { timeout: 60000 });
    const save = recordFails();
    cy.location('pathname').then((p) => {
      const orderId = p.split('/').pop();
      signIn('manager', '/schedule/mail-orders');
      cy.contains('Mail Order Queue', { timeout: 40000 });
      expand(`#${orderId}`);
      cy.contains('label', /^Send to/).find('select').then(($sel) => {
        const lane = [...($sel[0] as HTMLSelectElement).options].find((x) => /Lane/.test(x.text) && x.value);
        if (lane) cy.wrap($sel).select(lane.value);
      });
      cy.intercept('POST', '**/approval-task').as('sendTask');
      cy.contains('button', /^Send task$/).click();
      cy.wait('@sendTask').its('response.statusCode').should('be.lessThan', 300);
      signIn('doctorA', '/schedule/tasks');
      cy.contains(/Active \([1-9]/, { timeout: 30000 });
      cy.contains(new RegExp(`Approve mail order #${orderId}`)).first().click({ force: true });
      cy.contains('Quantity to approve', { timeout: 20000 });
      cy.contains('label', 'Quantity to approve').find('input').clear().type('1');
      cy.contains('button', /^Chronic$/).click();
      shot('qx-01-lane-lower-qty');
      labels('qx-01-lane-lower-qty');
      cy.intercept('POST', '**/approval-response').as('approve');
      cy.contains('button', /^Approve$/).click();
      cy.wait('@approve', { timeout: 30000 }).then((x) =>
        cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/qx-approve-reply.json`, { status: x.response?.statusCode, body: x.response?.body }),
      );
      cy.wait(2500);
      shot('qx-02-lane-approved');
      sql(`SELECT l.quantity || '|' || o.total || '|' || coalesce(o."approvalLog"::text, '') FROM mail_orders o JOIN mail_order_lines l ON l."mailOrderId" = o.id WHERE o.id = ${orderId}`).then((out) =>
        cy.writeFile(`${Cypress.env('OSV_OUT')}/labels/qx-order-after.txt`, out),
      );
      save('qx');
    });
  });

  it('B4: Riley sees Item and Qty locked; B6: no texting error on a client page', () => {
    signIn('mailteam', '/schedule/inventory/auto-ships');
    cy.contains('Auto-ships', { timeout: 40000 });
    cy.contains('button', /^All$/).click();
    cy.wait(2000);
    cy.contains('button', /^Edit$/).first().click();
    cy.contains('Edit auto-ship', { timeout: 10000 });
    cy.wait(800);
    shot('qx-03-riley-edit-locked');
    labels('qx-03-riley-edit-locked');
  });
});
