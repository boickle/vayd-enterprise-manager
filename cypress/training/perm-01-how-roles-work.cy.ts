/// <reference types="cypress" />
/**
 * Training video PERM-01: How roles work in Scout
 * (docs/training/scripts/permissions/PERM-01-how-roles-work.md).
 * TEST stack only. Signed in as Quinn Parker (Practice Admin, perm-seed.ts). Nothing is changed.
 */
import '../support/e2e';
import { card, hubTab, openItem, openMenu, pickStaff, pointAtSteady, showTitle, startAs, topBar } from './permRecord';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

const roleItem = (name: string) =>
  cy.get('li button').filter((_, el) => (el as HTMLElement).querySelector('div')?.textContent?.trim() === name).first();

describe('Training: PERM-01 how roles work', () => {
  it('PERM-01', () => {
    loadNarration();
    startAs('practice_admin', '/schedule', () => topBar('Settings').should('exist'));

    const record = () => {
      startClock();
      line('p01-01');
      line('p01-02');
      line('p01-03', () => {
        tap(() => topBar('Settings'));
        cy.get('button.settings-tab-menu__trigger', { timeout: 60000 }).should('exist');
      });
      line('p01-04', () => openMenu('Staff'));
      line('p01-05', () => {
        openItem('Staff');
        cy.contains('option', 'Select staff', { timeout: 30000 }).should('exist');
      });
      line('p01-06', () => pickStaff('Tess Holt'));
      line('p01-07', () => {
        tap(() => hubTab('Access'));
        cy.contains('.settings-card-title', 'What they can do today', { timeout: 30000 }).should('exist');
      });
      line('p01-08', () => pointAtSteady(() => card('What they can do today').find('.settings-card-subtitle'), 3500));
      line('p01-09', () => pointAtSteady(() => cy.get('.emp-access-section').first(), 3500));
      line('p01-10', () => showTitle(() => cy.get('.emp-access-section li[title]').first(), 5000));
      line('p01-11', () => pointAtSteady(() => card('Individual permissions'), 4000));
      line('p01-12');
      line('p01-13', () => pointAtSteady(() => card('License'), 2500));
      line('p01-14', () => pointAtSteady(() => card('License').find('.settings-card-subtitle'), 3500));
      line('p01-15', () => openMenu('Staff'));
      line('p01-16', () => {
        openItem('Roles');
        roleItem('Technician').should('exist');
      });
      line('p01-17', () => pointAtSteady(() => roleItem('Technician'), 3000));
      line('p01-18', () => pointAtSteady(() => roleItem('Client Liaison'), 3000));
      line('p01-19');
      line('p01-20');
      line('p01-21');
      line('p01-22');
      finish();
    };
    cy.then(() => record());
  });
});
