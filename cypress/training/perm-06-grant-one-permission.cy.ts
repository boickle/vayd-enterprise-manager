/// <reference types="cypress" />
/**
 * Training video PERM-06: Give one person one extra permission, with an end date
 * (docs/training/scripts/permissions/PERM-06-grant-one-permission.md).
 * TEST stack only. Signed in as Quinn Parker (Practice Admin). Saves one grant: Lou Bennett may cancel memberships
 * for two weeks. Re-run perm-seed.ts before each take.
 */
import '../support/e2e';
import { card, chooseByText, hubTab, pickStaff, pointAtSteady, startAs } from './permRecord';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

const grantSelect = () => card('Individual permissions').find('select').first();
const endsInput = () => card('Individual permissions').find('input[type="date"]').first();
const dialog = () => cy.get('[role="dialog"]').filter(':visible').last();

describe('Training: PERM-06 grant one permission', () => {
  it('PERM-06', () => {
    loadNarration();
    startAs('practice_admin', '/schedule/settings?tab=employee-directory', () =>
      cy.contains('option', 'Select staff', { timeout: 60000 }).should('exist')
    );
    const ends = new Date(Date.now() + 14 * 86400000).toLocaleDateString('en-CA');

    const record = () => {
      startClock();
      line('p06-01');
      line('p06-02');
      line('p06-03', () => pickStaff('Lou Bennett'));
      line('p06-04', () => {
        tap(() => hubTab('Access'));
        cy.contains('.settings-card-title', 'Individual permissions', { timeout: 30000 }).should('exist');
      });
      line('p06-05', () => pointAtSteady(() => card('Individual permissions'), 3500));
      line('p06-06', () => chooseByText(() => grantSelect(), 'Cancel a membership'));
      line('p06-07', () => {
        pointAtSteady(() => endsInput(), 1500);
        endsInput().clear().type(ends);
      });
      line('p06-08', () => {
        tap(() => card('Individual permissions').contains('button', /^Grant$/));
        dialog().contains('button', 'Covering while manager is away', { timeout: 30000 }).should('exist');
      });
      line('p06-09', () => tap(() => dialog().contains('button', 'Covering while manager is away')));
      line('p06-10', () => {
        tap(() => dialog().contains('button', /^Grant$/));
        card('Individual permissions').find('ul.emp-access-grants li', { timeout: 30000 }).should('exist');
      });
      line('p06-11', () => pointAtSteady(() => card('Individual permissions').find('ul.emp-access-grants li').first(), 4000));
      line('p06-12', () => pointAtSteady(() => cy.get('.emp-access-tag.is-grant').first().closest('li'), 3000));
      line('p06-13', () => pointAtSteady(() => card('Individual permissions').contains('button', 'Remove'), 2500));
      line('p06-14', () => pointAtSteady(() => card('License'), 3000));
      line('p06-15');
      line('p06-16');
      finish();
    };
    cy.then(() => record());
  });
});
