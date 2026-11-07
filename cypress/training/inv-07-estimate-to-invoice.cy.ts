/// <reference types="cypress" />
/**
 * Training video, INV-07: turn an estimate into the invoice
 * (docs/training/scripts/invoicing/INV-07-estimate-to-invoice.md). TEST stack, demo names only: Maria Rivera,
 * Juniper (a visit today, her dental estimate) and Maple (a visit tomorrow, on her plan, a second estimate made on the ledger).
 * Needs invoicing-demo.sql.
 */
import '../support/e2e';
import { schedulingApi, schedulingWorld, signInAsScheduling } from '../support/schedulingWorld';
import { catalogId, openVisit, resetInvoicingWorld, setBillBranch, sql } from './invKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: INV-07 estimate to invoice', () => {
  it('INV-07', () => {
    const w = schedulingWorld();
    const client = w.households.A.clientId;
    const pid = w.practiceId;
    loadNarration();
    resetInvoicingWorld();
    sql(`UPDATE visit_estimates SET "isDeleted"=true WHERE "clientId"=${client}`);

    const [maple, juniper] = w.households.A.activePetIds;

    // An approved (Sent) estimate: lines at the catalog prices, through the API.
    const makeEstimate = (patientId: number, title: string, items: Record<string, number>) =>
      schedulingApi<{ id: string }>('cl', 'POST', '/visit-estimates', { practiceId: pid, clientId: client, patientId, title }).then((est) => {
        Object.entries(items).forEach(([name, price]) =>
          catalogId(name).then((c) =>
            schedulingApi('cl', 'POST', `/visit-estimates/${est.body.id}/lines`, {
              practiceId: pid, patientId, description: name, qty: 1, unitPrice: price, catalogItemId: c.id, catalogItemType: c.type, providerEmployeeId: w.doctors.A,
            })
          )
        );
        cy.then(() => schedulingApi('cl', 'POST', `/visit-estimates/${est.body.id}/sent`, { practiceId: pid }));
      });

    let appt = 0;
    cy.then(() => {
      // Maple's visit tomorrow (she has a plan, so her prices are member prices), and a second estimate for her made on the ledger (no visit yet).
      openVisit(maple, client, 'Wellness', -24 * 60);
      makeEstimate(maple, 'Dental X-rays and nails', { 'Dental X-rays': 162, 'Nail trim': 22.5 });
      cy.wait(1500); // Juniper's estimate is made last, so it is the newest and the first in the list.
      makeEstimate(juniper, 'Dental', { 'Dental cleaning': 450, 'Dental X-rays': 180 });
      openVisit(juniper, client, 'Dental', 90).then(({ appt: a, enc }) => {
        appt = a;
        schedulingApi('cl', 'POST', '/visit-invoices', { practiceId: pid, appointmentId: a, clientId: client }).then(() => {
          setBillBranch(client);
          catalogId('Office exam').then((c) =>
            schedulingApi('doctorA', 'POST', `/soap-encounters/${enc}/orders`, {
              practiceId: pid, name: 'Office exam', catalogItemId: c.id, catalogItemType: c.type, qty: 1, kind: 'treatment', state: 'accepted', unitPrice: 75,
            })
          );
        });
      });
    });
    cy.then(() => signInAsScheduling('cl', `/schedule/soap/${appt}/${juniper}/checkout?clientId=${client}`));
    cy.contains('.soap-invoice-row.total', '$75.00', { timeout: 60000 }).should('exist');
    cy.contains('.find-estimate__toggle', 'Find estimate', { timeout: 60000 }).should('exist');
    cy.wait(1500);

    startClock();
    line('inv07-01');
    line('inv07-02', () => pointAt(() => cy.get('.soap-invoice-row.total'), 3500));
    line('inv07-03', () => pointAt(() => cy.get('.find-estimate__toggle'), 3000));
    line('inv07-04', () => {
      tap(() => cy.get('.find-estimate__toggle'));
      cy.get('.find-estimate__row', { timeout: 30000 }).should('have.length.at.least', 1);
    });
    line('inv07-05', () => pointAt(() => cy.get('.find-estimate__row').first(), 5500));
    line('inv07-06', () => {
      tap(() => cy.get('.find-estimate__expand').first());
      cy.get('.find-estimate__lines').should('be.visible');
    });
    line('inv07-07', () => pointAt(() => cy.get('.find-estimate__lines'), 3500));
    line('inv07-08', () => {
      tap(() => cy.contains('.find-estimate__actions button', 'Convert'));
      cy.contains('.soap-note-banner', 'Added', { timeout: 30000 }).should('exist');
    });
    line('inv07-09', () => pointAt(() => cy.contains('.soap-note-banner', 'Added'), 3500));
    line('inv07-10', () => pointAt(() => cy.get('.soap-invoice-row.total'), 4500));
    offCamera(() => {
      cy.visit(`/schedule/clients?clientId=${client}&tab=financial`);
      cy.contains('tr.is-click', 'Dental X-rays and nails', { timeout: 60000 }).should('exist');
      cy.wait(1500);
    });
    line('inv07-11', () => pointAt(() => cy.contains('tr.is-click', 'Dental X-rays and nails'), 4000));
    line('inv07-12', () => {
      tap(() => cy.contains('tr.is-click', 'Dental X-rays and nails'));
      cy.contains('.euth-estimate-actions button', 'Convert to invoice', { timeout: 30000 }).should('exist');
    });
    line('inv07-13', () => {
      tap(() => cy.contains('.euth-estimate-actions button', 'Convert to invoice'));
      cy.contains('Which visit is this for?', { timeout: 30000 }).should('exist');
    });
    line('inv07-14', () => pointAt(() => cy.get('[data-testid="estimate-visit-pick"]'), 6500));
    line('inv07-15', () => tap(() => cy.contains('.estimate-visit-pick__row', 'Maple').find('input')));
    line('inv07-16', () => {
      tap(() => cy.contains('.euth-estimate-actions button', 'Convert to this visit'));
      cy.get('.euth-estimate-modal', { timeout: 30000 }).should('not.exist');
    });
    line('inv07-17', () => pointAt(() => cy.contains('Converted'), 4000));
    line('inv07-18');
    finish();
  });
});
