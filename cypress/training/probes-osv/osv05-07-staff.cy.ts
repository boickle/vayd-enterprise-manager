/// <reference types="cypress" />
/** OSV-05/06/07 probe: mail an item from a bill (tech), New mail order (CL), doctor approval (Dr. Lane). */
import '../../support/e2e';
import { schedulingApi, schedulingWorld } from '../../support/schedulingWorld';
import { osv, shot, signIn, sql, visitCart } from './osvKit';

describe('OSV-05 to 07 staff', () => {
  it('OSV-05: the tech sends Juniper joint chews by mail from the bill', () => {
    const w = schedulingWorld();
    const o = osv();
    
    schedulingApi<{ id: string }>('technician', 'POST', '/visit-invoices/counter', {
      practiceId: w.practiceId,
      patientId: o.pets.juniper,
      clientId: o.clients.rivera,
    }).then((res) => {
      const id = res.body.id;
      schedulingApi('technician', 'POST', `/visit-invoices/${id}/lines`, {
        practiceId: w.practiceId,
        patientId: o.pets.juniper,
        description: 'Joint support chews (60 ct)',
        qty: 1,
        unitPrice: 36,
        catalogItemId: o.items.joint,
        catalogItemType: 'inventory',
        providerEmployeeId: w.doctors.A,
      });
      signIn('technician', `/schedule/clients?clientId=${o.clients.rivera}&tab=financial&invoice=${id}`);
      cy.contains('Joint support chews', { timeout: 40000 });
      cy.wait(2500);
      shot('osv05-01-bill');
      cy.get('.mail-mode__toggle').contains('button', /^Mail order/).first().scrollIntoView().click();
      cy.wait(1500);
      shot('osv05-02-mail-ask');
      cy.contains('Send to mail queue', { timeout: 10000 });
      cy.get('select').filter(':visible').last().then(($sel) => {
        const opts = [...$sel.find('option')].map((o) => (o as HTMLOptionElement).value).filter(Boolean);
        if (opts.length) cy.wrap($sel).select(opts[0]);
      });
      cy.wait(800);
      shot('osv05-03-prompt-filled');
      cy.contains('button', 'Add to mail queue').click();
      cy.wait(3000);
      shot('osv05-04-after-send');
    });
  });

  it('OSV-06: the mail team opens New mail order', () => {
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2500);
    shot('osv06-01-queue-mailteam');
    cy.contains('button', 'New mail order').click();
    cy.wait(1500);
    shot('osv06-02-new-order');
  });

  it('OSV-06: what a CL sees on the Mail Orders link', () => {
    signIn('cl', '/schedule/mail-orders');
    cy.wait(6000);
    shot('osv06-03-cl-mail-orders');
  });

  it('OSV-07: Maria orders Juniper thyroid (no refills), Dr. Lane reviews', () => {
    signIn('client', '/store');
    cy.contains('button', 'Prescriptions', { timeout: 30000 }).click();
    cy.contains('Thyroid tablets', { timeout: 30000 }).click();
    cy.contains('button', /^Juniper$/, { timeout: 20000 }).click();
    cy.contains('button', /^Buy once$/).click();
    cy.contains('button', 'Add to cart').click();
    cy.contains(/Added to cart/i, { timeout: 15000 });
    visitCart();
    cy.contains(/Card on file/i, { timeout: 30000 });
    cy.get('body').then(($b) => {
      if ($b.text().includes('Yes — send it here')) cy.contains('Yes — send it here').click();
    });
    cy.contains('button', 'Place order').click();
    cy.contains('h1', 'Thank you', { timeout: 60000 });
    // The mail team's view of the new order.
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.wait(2500);
    shot('osv07-01-queue-mailteam');
    cy.contains(/Thyroid tablets/).first().click({ force: true });
    cy.wait(2500);
    shot('osv07-02-order-mailteam');
    // Dr. Lane's tasks.
    signIn('doctorA', '/schedule/tasks');
    cy.wait(6000);
    shot('osv07-03-tasks-doctor');
    cy.get('body').then(($b) => {
      const t = $b.find('*').filter((_, el) => el.children.length === 0 && /mail order|Thyroid/i.test(el.textContent || ''));
      if (t.length) {
        cy.wrap(t.first()).click({ force: true });
        cy.wait(3000);
        shot('osv07-04-task-open');
      } else cy.log('NO MAIL TASK FOR DOCTOR');
    });
  });
});
