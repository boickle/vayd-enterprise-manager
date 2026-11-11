/// <reference types="cypress" />
/**
 * Training video ROLE-09: What the Controlled Substances Director sees
 * (docs/training/scripts/permissions/ROLE-09-controlled-substances-director.md).
 * TEST stack only. Signed in as Drew Ellis (Controlled Substances Director). Nothing is changed.
 */
import '../support/e2e';
import { analyticsLink, pointAtSteady, reportCategories, reportRow, startAs, topBar, topLinks, permSqlFile } from './permRecord';
import { finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

describe('Training: ROLE-09 controlled substances director', () => {
  it('ROLE-09', () => {
    loadNarration();
    permSqlFile('perm-controlled-demo.sql');
    startAs('controlled_substances_director', '/schedule', () => topBar('Pharmacy').should('exist'));

    const record = () => {
      startClock();
      line('r09-01');
      line('r09-02');
      line('r09-03', () => pointAt(() => topLinks(), 3500));
      line('r09-04', () => {
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r09-05', () => pointAtSteady(() => reportRow(), 4500));
      line('r09-06', () => pointAtSteady(() => cy.contains('Controlled drugs only.').first(), 2500));
      line('r09-07', () => pointAtSteady(() => reportRow().contains(/Controlled Drugs/), 3000));
      line('r09-08');
      line('r09-09');
      line('r09-10');
      finish();
    };
    cy.then(() => record());
  });
});
