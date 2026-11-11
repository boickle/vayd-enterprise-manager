/// <reference types="cypress" />
/**
 * Training video ROLE-11: What an Observer sees (docs/training/scripts/permissions/ROLE-11-observer.md).
 * TEST stack only. Signed in as Kai Reed (Observer). Setup makes a paid $75 cash bill on the Chens. Nothing is changed.
 */
import '../support/e2e';
import { analyticsLink, paidChenBill, pointAtSteady, reportCategories, schWorld, startAs, topBar, topLinks, billPayments } from './permRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const quickActions = () => cy.contains(/^QUICK ACTIONS$/i).parent();

describe('Training: ROLE-11 observer', () => {
  it('ROLE-11', () => {
    loadNarration();
    let paidId = '';
    paidChenBill().then((id) => (paidId = id));
    startAs('observer', '/schedule', () => topBar('Home').should('exist'));

    const record = () => {
      startClock();
      line('r11-01');
      line('r11-02');
      line('r11-03', () => pointAt(() => topLinks(), 3500));
      line('r11-04', () => pointAtSteady(() => quickActions(), 3000));
      offCamera(() => {
        cy.visit(`/schedule/clients?clientId=${schWorld().households.B.clientId}&tab=financial&invoice=${paidId}`);
        cy.contains('Receipt · Paid', { timeout: 60000 }).should('exist');
        cy.wait(1500);
      });
      line('r11-05', () => pointAtSteady(() => cy.contains('Receipt · Paid').first(), 1500));
      line('r11-06', () => pointAtSteady(() => billPayments(), 3000));
      line('r11-07', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r11-08', () => pointAtSteady(() => reportCategories(), 4000));
      line('r11-09');
      line('r11-10');
      line('r11-11');
      finish();
    };
    cy.then(() => record());
  });
});
