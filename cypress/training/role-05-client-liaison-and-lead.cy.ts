/// <reference types="cypress" />
/**
 * Training video ROLE-05: What a Client Liaison and a Lead Client Liaison see
 * (docs/training/scripts/permissions/ROLE-05-client-liaison-and-lead.md).
 * TEST stack only. Part 1 as Lou Bennett (Client Liaison), part 2 as Dana Cole (Lead Client Liaison). Setup makes a
 * paid $75 cash bill on the Chens. Nothing is changed on camera.
 */
import '../support/e2e';
import { signInAsPerm } from './probes-perm/permKit';
import { analyticsLink, paidChenBill, pointAtSteady, reportCategories, reportRow, schWorld, startAs, topBar, billPayments } from './permRecord';
import { finish, line, loadNarration, offCamera, startClock, tap } from './trainingKit';

const exact = (label: string, sel = 'a, button') =>
  cy.get(sel).filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();
const quickActions = () => cy.contains(/^QUICK ACTIONS$/i).parent();

describe('Training: ROLE-05 client liaison and lead', () => {
  it('ROLE-05', () => {
    loadNarration();
    let paidId = '';
    paidChenBill().then((id) => (paidId = id));
    startAs('client_liaison', '/schedule', () => topBar('Home').should('exist'));
    const bill = () => `/schedule/clients?clientId=${schWorld().households.B.clientId}&tab=financial&invoice=${paidId}`;
    const openBill = () =>
      offCamera(() => {
        cy.visit(bill());
        cy.contains('Receipt · Paid', { timeout: 60000 }).should('exist');
        cy.wait(1500);
      });

    const record = () => {
      startClock();
      line('r05-01');
      line('r05-02');
      line('r05-03', () => pointAtSteady(() => topBar('Home').parent().parent(), 2000));
      line('r05-04', () => pointAtSteady(() => quickActions(), 5000));
      openBill();
      line('r05-05', () => pointAtSteady(() => cy.contains('Receipt · Paid').first(), 2000));
      line('r05-06', () => pointAtSteady(() => billPayments(), 3000));
      line('r05-07', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r05-08', () => pointAtSteady(() => reportCategories(), 4000));
      offCamera(() => {
        signInAsPerm('lead_client_liaison', '/schedule');
        exact('Create deposit').should('exist');
        cy.wait(1500);
      });
      line('r05-09', () => pointAtSteady(() => exact('Create deposit'), 3000));
      openBill();
      line('r05-10', () => pointAtSteady(() => cy.contains('Receipt · Paid').first(), 1500));
      line('r05-11', () => pointAtSteady(() => exact('Void', 'button'), 1800));
      line('r05-12', () => pointAtSteady(() => exact('Void invoice', 'button'), 1500));
      line('r05-13', () => pointAtSteady(() => exact('Add credit', 'button'), 1500));
      line('r05-14', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r05-15', () => {
        pointAtSteady(() => reportCategories().contains(/Financial/), 1800);
        pointAtSteady(() => reportRow(), 1800);
      });
      line('r05-16');
      line('r05-17');
      line('r05-18');
      finish();
    };
    cy.then(() => record());
  });
});
