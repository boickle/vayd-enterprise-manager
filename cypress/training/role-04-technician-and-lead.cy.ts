/// <reference types="cypress" />
/**
 * Training video ROLE-04: What a Technician and a Lead Technician see
 * (docs/training/scripts/permissions/ROLE-04-technician-and-lead.md).
 * TEST stack only. Part 1 as Tess Holt (Technician, Raleigh), part 2 as Jess Navarro (Lead Technician + Technician,
 * licensed technician). Setup makes a paid $75 cash bill on the Chens. Nothing is changed on camera.
 */
import '../support/e2e';
import { signInAsPerm } from './probes-perm/permKit';
import {
  analyticsLink, billPayments, paidChenBill, pointAtSteady, reportCategories, reportRow, schWorld, startAs, tapSteady, topBar, topLinks,
} from './permRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const navLink = (label: string) =>
  cy.get('a, button').filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();

describe('Training: ROLE-04 technician and lead', () => {
  it('ROLE-04', () => {
    loadNarration();
    let paidId = '';
    paidChenBill().then((id) => (paidId = id));
    startAs('technician', '/schedule', () => topBar('Home').should('exist'));
    const bill = () => `/schedule/clients?clientId=${schWorld().households.B.clientId}&tab=financial&invoice=${paidId}`;

    const record = () => {
      startClock();
      line('r04-01');
      line('r04-02');
      line('r04-03', () => pointAt(() => topLinks(), 4000));
      line('r04-04', () => pointAtSteady(() => navLink('Create deposit'), 2500));
      line('r04-05', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r04-06', () => pointAtSteady(() => reportCategories(), 3000));
      offCamera(() => {
        cy.visit(bill());
        cy.contains('Receipt · Paid', { timeout: 60000 }).should('exist');
        cy.wait(1500);
      });
      line('r04-07', () => pointAtSteady(() => cy.contains('Receipt · Paid').first(), 2000));
      line('r04-08', () => pointAtSteady(() => billPayments(), 3500));
      offCamera(() => {
        signInAsPerm('lead_technician', '/schedule');
        topBar('Settings').should('exist');
        cy.wait(1500);
      });
      line('r04-09', () => pointAt(() => topBar('Settings'), 2500));
      line('r04-10', () => {
        tap(() => topBar('Settings'));
        cy.contains(/Outside hospitals/, { timeout: 60000 }).should('exist');
        pointAtSteady(() => cy.contains('h1, h2, h3, .settings-card-title, button', /Outside hospitals/).first(), 2000);
      });
      line('r04-11', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r04-12', () => pointAtSteady(() => reportCategories().contains(/Patients/), 2000));
      line('r04-13', () => {
        tapSteady(() => reportCategories().contains(/Appointments/));
        reportRow().contains(/Time Spent/).should('exist');
        pointAtSteady(() => reportRow().contains(/Time Spent/), 2000);
      });
      line('r04-14');
      line('r04-15');
      line('r04-16');
      line('r04-17');
      finish();
    };
    cy.then(() => record());
  });
});
