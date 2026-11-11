/// <reference types="cypress" />
/**
 * Training video PERM-02: Give someone a role, for one office or the whole practice
 * (docs/training/scripts/permissions/PERM-02-give-a-role.md).
 * TEST stack only. Signed in as Quinn Parker (Practice Admin). Saves one change: Sam Chen becomes a Technician at
 * Raleigh office. Re-run perm-seed.ts before each take to undo it.
 */
import '../support/e2e';
import { card, hubTab, openItem, openMenu, pickStaff, pointAtSteady, startAs, tapSteady } from './permRecord';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

const roleItem = (name: string) =>
  cy.get('li button').filter((_, el) => (el as HTMLElement).querySelector('div')?.textContent?.trim() === name).first();
const whoCard = () => cy.contains('.settings-card-title', /^Who (is|has) /).closest('.settings-card');
const officeBlock = (office: string) =>
  whoCard().find('div').filter((_, el) => (el.firstElementChild as HTMLElement | null)?.innerText?.trim() === office).first();
const personBox = (office: string, name: string) =>
  officeBlock(office).find('label').filter((_, el) => (el as HTMLElement).innerText.includes(name)).first();

describe('Training: PERM-02 give a role', () => {
  it('PERM-02', () => {
    loadNarration();
    startAs('practice_admin', '/schedule/settings?tab=employee-directory', () =>
      cy.contains('option', 'Select staff', { timeout: 60000 }).should('exist')
    );

    const record = () => {
      startClock();
      line('p02-01');
      line('p02-02');
      line('p02-03', () => pickStaff('Sam Chen'));
      line('p02-04', () => {
        tap(() => hubTab('Access'));
        cy.contains('.settings-card-title', 'What they can do today', { timeout: 30000 }).should('exist');
      });
      line('p02-05', () => pointAtSteady(() => cy.contains('No permissions yet'), 3500));
      line('p02-06', () => openMenu('Staff'));
      line('p02-07', () => {
        openItem('Roles');
        roleItem('Technician').should('exist');
      });
      line('p02-08', () => {
        tapSteady(() => roleItem('Technician'));
        cy.contains('.settings-card-title', 'Who is Technician?', { timeout: 30000 }).should('exist');
      });
      line('p02-09', () => pointAtSteady(() => whoCard(), 4000));
      line('p02-10', () => tap(() => personBox('Raleigh office', 'Sam Chen').find('input')));
      line('p02-11', () => {
        tap(() => cy.contains('button', 'Save assignees'));
        cy.contains('was added to', { timeout: 30000 }).should('exist');
      });
      line('p02-12', () => pointAtSteady(() => cy.get('[data-testid="recent-role-changes"]'), 4000));
      line('p02-13');
      line('p02-14', () => {
        tapSteady(() => roleItem('Veterinarian'));
        cy.contains('.settings-card-title', 'Who is Veterinarian?', { timeout: 30000 }).should('exist');
      });
      line('p02-15', () => {
        pointAtSteady(() => personBox('Raleigh office', 'Riley Rivera'), 2200);
        pointAtSteady(() => personBox('Durham office', 'Riley Rivera'), 2200);
      });
      line('p02-16', () => openMenu('Staff'));
      line('p02-17', () => {
        openItem('Staff');
        cy.contains('option', 'Select staff', { timeout: 30000 }).should('exist');
      });
      line('p02-18', () => pickStaff('Sam Chen'));
      line('p02-19', () => {
        tap(() => hubTab('Access'));
        cy.contains('.settings-card-title', 'What they can do today', { timeout: 30000 }).should('exist');
      });
      line('p02-20', () => {
        pointAtSteady(() => card('What they can do today').find('.settings-card-subtitle'), 2500);
        pointAtSteady(() => cy.get('.emp-access-section').first(), 2500);
      });
      line('p02-21a', () => {
        tap(() => hubTab('Profile'));
        cy.contains('legend', 'Default office', { timeout: 30000 }).should('exist');
        cy.contains('legend', 'Default office')
          .parent()
          .find('select')
          .first()
          .find('option:selected')
          .should('contain.text', 'Raleigh');
        pointAtSteady(() => cy.contains('legend', 'Default office').parent(), 4500);
      });
      line('p02-21', () => pointAtSteady(() => cy.contains('Practice-wide Scout roles only').parent(), 3500));
      line('p02-22');
      line('p02-23');
      finish();
    };
    cy.then(() => record());
  });
});
