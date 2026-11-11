/// <reference types="cypress" />
/**
 * Training video ROLE-03: What a Veterinarian and a Relief Veterinarian see
 * (docs/training/scripts/permissions/ROLE-03-veterinarian-and-relief.md).
 * TEST stack only. Part 1 as Dr. Maya Ortiz (Veterinarian, Raleigh, licensed; perm-seed.ts gives her a week of demo
 * production), part 2 as Dr. Noah Park (Relief Veterinarian). Setup makes a paid $75 cash bill on the Chens credited
 * to Dr. Ortiz. Nothing is changed on camera.
 */
import '../support/e2e';
import { signInAsPerm } from './probes-perm/permKit';
import {
  analyticsLink, paidChenBill, pointAtSteady, reportCategories, reportRow, schWorld, startAs, topBar, topLinks,
} from './permRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const exactButton = (label: string) =>
  cy.get('button').filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();

describe('Training: ROLE-03 veterinarian and relief', () => {
  it('ROLE-03', () => {
    loadNarration();
    let paidId = '';
    paidChenBill().then((id) => (paidId = id));
    startAs('veterinarian', '/schedule', () => topBar('Settings').should('exist'));
    const bill = () => `/schedule/clients?clientId=${schWorld().households.B.clientId}&tab=financial&invoice=${paidId}`;

    const record = () => {
      startClock();
      line('r03-01');
      line('r03-02');
      line('r03-03', () => pointAt(() => topLinks(), 4500));
      line('r03-04', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r03-04b', () => tap(() => cy.contains('button', /^7D$/)));
      line('r03-05', () => pointAtSteady(() => cy.contains('Totals for selected range').parent().parent(), 3500));
      line('r03-06', () => pointAtSteady(() => reportCategories(), 3000));
      line('r03-07', () => {
        tap(() => topBar('Settings'));
        cy.contains(/Euthanasia consent/, { timeout: 60000 }).should('exist');
      });
      line('r03-08', () => pointAtSteady(() => cy.contains('h1, h2, h3, .settings-card-title', /Euthanasia consent/).first(), 3500));
      offCamera(() => {
        cy.visit(bill());
        exactButton('Void').should('exist');
        cy.wait(1500);
      });
      line('r03-09', () => pointAtSteady(() => cy.contains('Receipt · Paid').first(), 2000));
      line('r03-10', () => pointAtSteady(() => exactButton('Void'), 3000));
      offCamera(() => {
        signInAsPerm('relief_veterinarian', '/schedule');
        topBar('Home').should('exist');
        cy.wait(1500);
      });
      line('r03-11', () => pointAt(() => topLinks(), 4500));
      offCamera(() => {
        cy.visit('/schedule/settings');
        cy.contains('None of your roles includes a Settings permission', { timeout: 60000 }).should('exist');
        cy.wait(800);
      });
      line('r03-12', () => pointAtSteady(() => cy.contains('None of your roles includes a Settings permission'), 4000));
      line('r03-13', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
        pointAtSteady(() => reportCategories(), 2500);
      });
      line('r03-14');
      line('r03-15');
      line('r03-16');
      finish();
    };
    cy.then(() => record());
  });
});
