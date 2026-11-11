/// <reference types="cypress" />
/**
 * Training video ROLE-08: What Billing / AR sees (docs/training/scripts/permissions/ROLE-08-billing-ar.md).
 * TEST stack only. Signed in as Pat Lowe (Billing / AR). Setup makes a paid $75 cash bill on the Chens.
 * Nothing is changed on camera.
 */
import '../support/e2e';
import { analyticsLink, paidChenBill, pointAtSteady, reportCategories, reportRow, schWorld, startAs, topBar, topLinks } from './permRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const exact = (label: string, sel = 'a, button') =>
  cy.get(sel).filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();

describe('Training: ROLE-08 billing', () => {
  it('ROLE-08', () => {
    loadNarration();
    let paidId = '';
    paidChenBill().then((id) => (paidId = id));
    startAs('billing_ar', '/schedule', () => exact('Create deposit').should('exist'));

    const record = () => {
      startClock();
      line('r08-01');
      line('r08-02');
      line('r08-03', () => pointAt(() => topLinks(), 3500));
      line('r08-04', () => pointAtSteady(() => exact('Create deposit'), 2500));
      offCamera(() => {
        cy.visit(`/schedule/clients?clientId=${schWorld().households.B.clientId}&tab=financial&invoice=${paidId}`);
        cy.contains('Receipt · Paid', { timeout: 60000 }).should('exist');
        cy.wait(1500);
      });
      line('r08-05', () => pointAtSteady(() => cy.contains('Receipt · Paid').first(), 1500));
      line('r08-06', () => pointAtSteady(() => exact('Void', 'button'), 1800));
      line('r08-07', () => pointAtSteady(() => exact('Void invoice', 'button'), 1500));
      line('r08-08', () => pointAtSteady(() => exact('Add credit', 'button'), 1500));
      line('r08-09', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r08-10', () => pointAtSteady(() => reportRow(), 3500));
      line('r08-11', () => pointAtSteady(() => reportCategories(), 2500));
      line('r08-12');
      line('r08-13');
      line('r08-14');
      finish();
    };
    cy.then(() => record());
  });
});
