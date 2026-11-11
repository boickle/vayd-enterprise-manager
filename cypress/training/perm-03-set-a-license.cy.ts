/// <reference types="cypress" />
/**
 * Training video PERM-03: Set a license (docs/training/scripts/permissions/PERM-03-set-a-license.md).
 * TEST stack only. Signed in as Quinn Parker (Practice Admin). Setup gives Sam Chen the Technician role at Raleigh
 * office (as after PERM-02); the take saves one change: Sam becomes a licensed technician.
 * Re-run perm-seed.ts before each take.
 */
import '../support/e2e';
import { card, giveRole, hubTab, permWorld, pickStaff, pointAtSteady, startAs } from './permRecord';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

const licenseChoice = (label: string) =>
  card('License').find('label').filter((_, el) => (el as HTMLElement).innerText.trim() === label).first();

describe('Training: PERM-03 set a license', () => {
  it('PERM-03', () => {
    loadNarration();
    cy.then(() => giveRole(permWorld().staff.new_tech.employeeId, 'technician', 'raleigh'));
    startAs('practice_admin', '/schedule/settings?tab=employee-directory', () =>
      cy.contains('option', 'Select staff', { timeout: 60000 }).should('exist')
    );

    const record = () => {
      startClock();
      line('p03-01');
      line('p03-02');
      line('p03-03', () => pickStaff('Sam Chen'));
      line('p03-04', () => {
        tap(() => hubTab('Access'));
        cy.contains('.settings-card-title', 'License', { timeout: 30000 }).should('exist');
      });
      line('p03-05', () => pointAtSteady(() => card('License'), 6000));
      line('p03-06', () => {
        tap(() => licenseChoice('Licensed technician').find('input'));
        cy.contains('.settings-card-title', 'Recent changes', { timeout: 30000 }).should('exist');
      });
      line('p03-07', () => pointAtSteady(() => card('Recent changes'), 4000));
      line('p03-08', () => pointAtSteady(() => licenseChoice('Veterinarian'), 3000));
      line('p03-09', () => pickStaff('Quinn Parker'));
      line('p03-10', () => {
        tap(() => hubTab('Access'));
        cy.contains('Ask a practice admin to change your own access', { timeout: 30000 }).should('exist');
      });
      line('p03-11', () => {
        pointAtSteady(() => card('License').find('.emp-access-license'), 2500);
        pointAtSteady(() => card('License').contains('Ask a practice admin to change your own access'), 2500);
      });
      line('p03-12');
      line('p03-13');
      line('p03-14');
      finish();
    };
    cy.then(() => record());
  });
});
