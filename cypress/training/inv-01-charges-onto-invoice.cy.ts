/// <reference types="cypress" />
/**
 * Training video, INV-01: how charges get onto the invoice, and who does what
 * (docs/training/scripts/invoicing/INV-01-charges-onto-the-invoice.md). TEST stack, demo names only: Maria Rivera's
 * Maple (on the Adult plan) with Dr. Avery Lane's visit open. Run invoicing-demo.sql on the test database first.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, openVisit, resetInvoicingWorld, setBillBranch, sql } from './invKit';
import { finish, line, loadNarration, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: INV-01 charges onto the invoice', () => {
  it('INV-01', () => {
    const w = schedulingWorld();
    const [maple] = w.households.A.activePetIds;
    const client = w.households.A.clientId;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();

    // Maple's visit with an open bill.
    let appt = 0;
    openVisit(maple, client, 'Annual exam and vaccines').then(({ appt: a, enc }) => {
      appt = a;
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then(() => {
        // The visit's branch is set, so the Branch list stays closed.
        setBillBranch(client);
        const order = (name: string, body: Record<string, unknown>) =>
          catalogId(name).then((c) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: pid, name, catalogItemId: c.id, catalogItemType: c.type, qty: 1, ...body,
            })
          );
        // Two things the family agreed to on the pre-visit form, at the member price.
        order('Nail trim', { kind: 'treatment', state: 'proposed', unitPrice: 22.5 });
        order('Dental chews', { kind: 'treatment', state: 'proposed', unitPrice: 21.6 });
        // The vaccine, covered by the plan, with no dose recorded yet.
        order('DHPP vaccine', { kind: 'treatment', state: 'accepted', unitPrice: 0, isCovered: true });
      });
    });
    // Dental cleaning, declined at an earlier visit and charted.
    sql(`DELETE FROM treatment_items WHERE "pimsType"='inv-train-decline'`);
    sql(`INSERT INTO treatments ("practiceId","patientId","pimsType") VALUES (1,${maple},'inv-train-decline')`);
    sql(
      `INSERT INTO treatment_items ("practiceId","treatmentId","procedureId","isDeclined","serviceDate","pimsType")
       SELECT 1, t.id, (SELECT id FROM procedures WHERE name='Dental cleaning' AND "isDeleted"=false ORDER BY id LIMIT 1), true, now() - interval '30 days', 'inv-train-decline'
         FROM treatments t WHERE t."pimsType"='inv-train-decline' ORDER BY t.id DESC LIMIT 1`
    );
    cy.then(() => signInAsScheduling('doctorA', `/schedule/soap/${appt}/${maple}?clientId=${client}`));
    cy.contains('.soap-checkout', 'Checkout', { timeout: 60000 }).should('be.visible');
    cy.contains('.soap-invoice-previsit-row', 'Nail trim', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    const panel = () => cy.get('.soap-checkout');
    const row = (name: string) => cy.contains('.soap-invoice-previsit-row', name);
    startClock();

    line('inv01-01');
    line('inv01-02', () => pointAt(() => panel().find('.soap-checkout-head'), 3500));
    line('inv01-03');
    line('inv01-04', () => tap(() => panel().find('input[placeholder^="Type here to add a charge"]')));
    line('inv01-05', () => typeSlowly(() => panel().find('input[placeholder^="Type here to add a charge"]'), 'Office exam'));
    line('inv01-06', () => tap(() => cy.contains('button[role="option"]', 'Office exam')));
    line('inv01-07', () => {
      pointAt(() => cy.contains('.soap-invoice-line', 'Office exam'), 4000);
    });
    line('inv01-08', () => pointAt(() => cy.contains('.soap-invoice-previsit-banner', /pre-visit accepts/i), 4000));
    line('inv01-09', () => tap(() => row('Nail trim').contains('button', 'Accept')));
    line('inv01-10', () => {
      pointAt(() => cy.contains('.soap-invoice-line', 'Nail trim'), 3000);
    });
    line('inv01-11', () => tap(() => row('Dental chews').contains('button', 'Decline')));
    line('inv01-12', () => typeSlowly(() => cy.get('#app-dialog-decline-note'), 'Owner wants to wait until spring'));
    line('inv01-13', () => tap(() => cy.get('.app-dialog__choice--chart')));
    line('inv01-14', () => {
      pointAt(() => row('Dental chews'), 5000);
    });
    line('inv01-15', () => pointAt(() => cy.contains('.soap-invoice-earlier-declines-head', 'Declined at an earlier visit'), 3500));
    line('inv01-16', () => pointAt(() => cy.contains('.soap-invoice-earlier-decline button', 'Add to invoice'), 3500));
    line('inv01-17', () => pointAt(() => cy.contains('.soap-invoice-line', 'DHPP vaccine'), 3500));
    line('inv01-18', () => pointAt(() => cy.contains('still need doses'), 4500));
    line('inv01-19');
    line('inv01-20');
    finish();
  });
});
