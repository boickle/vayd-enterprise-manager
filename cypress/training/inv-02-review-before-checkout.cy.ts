/// <reference types="cypress" />
/**
 * Training video, INV-02: review the invoice before checkout
 * (docs/training/scripts/invoicing/INV-02-review-before-checkout.md). TEST stack, demo names only: Maple Rivera on
 * the Adult plan, Dr. Avery Lane's visit. Needs invoicing-demo.sql on the test database.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, openVisit, resetInvoicingWorld, setBillBranch, sql } from './invKit';
import { finish, line, loadNarration, pointAt, startClock } from './trainingKit';

describe('Training: INV-02 review before checkout', () => {
  it('INV-02', () => {
    const w = schedulingWorld();
    const [maple] = w.households.A.activePetIds;
    const client = w.households.A.clientId;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();

    let appt = 0;
    openVisit(maple, client, 'Annual exam and vaccines').then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then(() => {
        setBillBranch(client);
        const order = (name: string, body: Record<string, unknown>) =>
          catalogId(name).then((c) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: pid, name, catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', ...body,
            })
          );
        order('Office exam', { unitPrice: 0, isCovered: true });
        order('DHPP vaccine', { unitPrice: 0, isCovered: true });
        order('Dental chews', { unitPrice: 21.6 });
        order('Biohazard disposal', { unitPrice: 7.2 });
        order('Nail trim', { unitPrice: 22.5 });
      });
    });
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${appt}/${maple}?clientId=${client}`));
    cy.contains('.soap-invoice-line', 'Nail trim', { timeout: 60000 }).should('exist');
    cy.contains('.soap-invoice-line', 'Biohazard disposal').should('exist');
    cy.wait(1500);

    const ln = (name: string) => cy.contains('.soap-invoice-line', name);
    startClock();

    line('inv02-01');
    line('inv02-02', () => pointAt(() => cy.get('.soap-invoice-lines'), 4000));
    line('inv02-03');
    line('inv02-04', () => {
      pointAt(() => ln('Office exam'), 2200);
      pointAt(() => ln('DHPP vaccine'), 2200);
    });
    line('inv02-05', () => pointAt(() => ln('Nail trim'), 4500));
    line('inv02-06', () => pointAt(() => ln('Biohazard disposal'), 5000));
    line('inv02-07', () => pointAt(() => ln('Dental chews'), 4500));
    line('inv02-08', () => pointAt(() => cy.contains('.soap-invoice-row', 'Subtotal'), 3000));
    line('inv02-09', () => pointAt(() => cy.contains('.soap-invoice-row', 'Sales tax'), 3000));
    line('inv02-10', () => pointAt(() => cy.get('.soap-invoice-row.total'), 4000));
    line('inv02-11', () => pointAt(() => cy.get('.soap-checkout-reprice'), 4000));
    line('inv02-12');
    finish();
  });
});
