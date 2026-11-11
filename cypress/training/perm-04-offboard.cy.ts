/// <reference types="cypress" />
/**
 * Training video PERM-04: Offboard someone who's leaving (docs/training/scripts/permissions/PERM-04-offboard.md).
 * TEST stack only. Signed in as Quinn Parker (Practice Admin). Saves the offboard of Dr. Riley Rivera with her last
 * day next Friday (perm-seed.ts gives her 3 visits 7-9 workdays out, the Chens, 2 tasks and Tess Holt).
 * Re-run perm-seed.ts before each take.
 */
import '../support/e2e';
import { chooseByText, pickStaff, pointAtSteady, startAs } from './permRecord';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

const dialog = () => cy.get('[role="dialog"]').filter(':visible').last();
const nextFriday = () => {
  const d = new Date();
  d.setDate(d.getDate() + (((5 - d.getDay() + 7) % 7) || 7));
  return d.toLocaleDateString('en-CA');
};

describe('Training: PERM-04 offboard', () => {
  it('PERM-04', () => {
    loadNarration();
    startAs('practice_admin', '/schedule/settings?tab=employee-directory', () =>
      cy.contains('option', 'Select staff', { timeout: 60000 }).should('exist')
    );

    const record = () => {
      startClock();
      line('p04-01');
      line('p04-02');
      line('p04-03', () => pickStaff('Riley Rivera'));
      line('p04-04', () => {
        tap(() => cy.contains('button', /^Offboard$/));
        dialog().find('input[aria-label="Last day"]', { timeout: 30000 }).should('exist');
      });
      line('p04-05', () => {
        pointAtSteady(() => dialog().find('input[aria-label="Last day"]'), 1500);
        dialog().find('input[aria-label="Last day"]').clear().type(nextFriday());
        dialog().contains('still booked with them after their last day', { timeout: 30000 }).should('exist');
      });
      line('p04-06', () => pointAtSteady(() => dialog().contains(/Nothing changes until the end of their last day/), 5000));
      line('p04-07', () => chooseByText(() => dialog().find('select[aria-label="Their tasks go to"]'), 'Maya Ortiz'));
      line('p04-08', () => pointAtSteady(() => dialog().find('[aria-label="Future visits"]'), 3500));
      line('p04-09', () => pointAtSteady(() => dialog().contains(/Rebook/), 4000));
      line('p04-10', () => chooseByText(() => dialog().find('select[aria-label="New primary doctor"]'), 'Maya Ortiz'));
      line('p04-11', () => chooseByText(() => dialog().find('select[aria-label="Tess Holt works with"]'), 'Maya Ortiz'));
      line('p04-12', () => pointAtSteady(() => dialog().find('[aria-label="Search their household"]'), 3500));
      line('p04-14', () => {
        tap(() => dialog().contains('button', /^Offboard$/));
        cy.contains('Offboarded.', { timeout: 30000 }).should('exist');
      });
      line('p04-15', () => {
        pointAtSteady(() => cy.contains('Offboarded.'), 2500);
        pointAtSteady(() => cy.contains('option', 'Select staff').parent(), 2500);
      });
      line('p04-16', () => pointAtSteady(() => cy.contains(/Show deactivated/), 3000));
      line('p04-17', () => pointAtSteady(() => cy.contains('button', /Cancel offboarding/), 3000));
      line('p04-18');
      line('p04-19');
      finish();
    };
    cy.then(() => record());
  });
});
