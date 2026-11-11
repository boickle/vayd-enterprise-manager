/// <reference types="cypress" />
/**
 * Training video ROLE-06: What an Inventory Manager sees (docs/training/scripts/permissions/ROLE-06-inventory-manager.md).
 * TEST stack only. Signed in as Lee Grant (Inventory Manager at Raleigh office). Nothing is changed.
 */
import '../support/e2e';
import { analyticsLink, pointAtSteady, reportCategories, reportRow, startAs, topBar, topLinks } from './permRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

const pharmacyTabs = () => cy.get('[aria-label="Pharmacy"]').filter(':visible').first();

describe('Training: ROLE-06 inventory manager', () => {
  it('ROLE-06', () => {
    loadNarration();
    startAs('inventory_manager', '/schedule', () => topBar('Pharmacy').should('exist'));

    const record = () => {
      startClock();
      line('r06-01');
      line('r06-02');
      line('r06-03', () => pointAt(() => topLinks(), 4000));
      line('r06-04', () => {
        tap(() => topBar('Pharmacy'));
        pharmacyTabs().should('exist');
      });
      line('r06-05', () => pointAtSteady(() => cy.contains('Weekly count list').first(), 2000));
      line('r06-06', () => pointAtSteady(() => pharmacyTabs(), 3500));
      line('r06-07', () => {
        tap(() => topBar('Settings'));
        cy.contains(/Branches \(offices\)/, { timeout: 60000 }).should('exist');
        pointAtSteady(() => cy.contains('.settings-card-title, h2, h3', /Branches \(offices\)/).first(), 2500);
      });
      line('r06-08', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r06-09', () => pointAtSteady(() => reportRow(), 3500));
      line('r06-10');
      line('r06-11');
      line('r06-12');
      finish();
    };
    cy.then(() => record());
  });
});
