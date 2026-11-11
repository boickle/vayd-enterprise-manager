/// <reference types="cypress" />
/**
 * Training video ROLE-02: What the Medical Director sees (docs/training/scripts/permissions/ROLE-02-medical-director.md).
 * TEST stack only. Signed in as Dr. Elena Ruiz (Medical Director + Veterinarian at Raleigh, licensed). Nothing is changed.
 */
import '../support/e2e';
import {
  analyticsLink, card, giveRole, hubTab, openItem, openMenu, permWorld, pickStaff, pointAtSteady, reportCategories, reportRow,
  startAs, topBar, topLinks,
} from './permRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: ROLE-02 medical director', () => {
  it('ROLE-02', () => {
    loadNarration();
    cy.then(() => giveRole(permWorld().staff.new_tech.employeeId, 'technician', 'raleigh'));
    startAs('medical_director', '/schedule', () => topBar('Settings').should('exist'));

    const record = () => {
      startClock();
      line('r02-01');
      line('r02-02');
      line('r02-03', () => pointAt(() => topLinks(), 4000));
      line('r02-04', () => {
        tap(() => topBar('Settings'));
        cy.get('button.settings-tab-menu__trigger', { timeout: 60000 }).should('exist');
      });
      line('r02-05', () => pointAtSteady(() => cy.get('button.settings-tab-menu__trigger').first().parent(), 4000));
      line('r02-06', () => openMenu('Staff'));
      line('r02-07', () => {
        openItem('Staff');
        cy.contains('option', 'Select staff', { timeout: 30000 }).should('exist');
      });
      line('r02-08', () => {
        pickStaff('Sam Chen');
        cy.contains('.settings-card-title', 'License', { timeout: 30000 }).should('exist');
      });
      line('r02-09', () => {
        pointAtSteady(() => hubTab('Access'), 1800);
        pointAtSteady(() => card('License'), 2500);
      });
      line('r02-10', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r02-10b', () => {
        tap(() => cy.contains('button', /^7D$/));
        cy.contains(/Elena Ruiz total: \$[1-9]/, { timeout: 30000 }).should('exist');
        cy.wait(1200, { log: false });
      });
      line('r02-11', () => {
        pointAt(() => cy.contains('label', 'Show in graph').parent(), 3000);
        pointAtSteady(() => reportCategories(), 3500);
      });
      line('r02-12');
      line('r02-13');
      line('r02-14');
      finish();
    };
    cy.then(() => record());
  });
});
