/// <reference types="cypress" />
/**
 * Training video PERM-05: Check who changed what: the Permission Audit Log
 * (docs/training/scripts/permissions/PERM-05-audit-log.md).
 * TEST stack only. Signed in as Quinn Parker (Practice Admin). Setup makes, through the API as Quinn, the changes
 * PERM-02, PERM-03 and PERM-06 make on camera (Sam Chen: Technician at Raleigh, licensed technician; Lou Bennett:
 * a 2-week grant to cancel memberships). Nothing is changed on camera. Re-run perm-seed.ts before each take.
 */
import '../support/e2e';
import { card, hubTab, makeEarlierChanges, openItem, openMenu, pickStaff, pointAtSteady, startAs, tapSteady } from './permRecord';
import { finish, line, loadNarration, startClock, tap } from './trainingKit';

const roleItem = (name: string) =>
  cy.get('li button').filter((_, el) => (el as HTMLElement).querySelector('div')?.textContent?.trim() === name).first();
const rows = () => cy.get('table.perm-audit-table tbody tr');
const rowFor = (text: string) => rows().filter((_, el) => (el as HTMLElement).innerText.includes(text)).first();

describe('Training: PERM-05 audit log', () => {
  it('PERM-05', () => {
    loadNarration();
    makeEarlierChanges();
    startAs('practice_admin', '/schedule/settings?tab=employee-directory', () =>
      cy.contains('option', 'Select staff', { timeout: 60000 }).should('exist')
    );

    const record = () => {
      startClock();
      line('p05-01');
      line('p05-02');
      line('p05-03', () => pickStaff('Sam Chen'));
      line('p05-04', () => {
        tap(() => hubTab('Access'));
        cy.contains('.settings-card-title', 'Recent changes', { timeout: 30000 }).should('exist');
      });
      line('p05-05', () => pointAtSteady(() => card('Recent changes'), 4000));
      line('p05-06', () => {
        tapSteady(() => cy.contains('a', 'See the full Permission Audit Log'));
        // An in-app link since Nov 10 (B2): the log opens without a reload.
        cy.get('table.perm-audit-table tbody tr', { timeout: 30000 }).should('have.length.greaterThan', 1);
      });
      line('p05-07', () => {
        pointAtSteady(() => rows().first().find('td').eq(0), 1300);
        pointAtSteady(() => rows().first().find('td').eq(1), 1300);
        pointAtSteady(() => rows().first().find('td').eq(2), 1600);
      });
      line('p05-08', () => pointAtSteady(() => rows().first().find('td').eq(3), 1800));
      line('p05-09', () => {
        // Role rows read in words since Nov 10 (B3): "Roles: added Technician (Raleigh office)".
        rowFor('Roles: added Technician').find('td').eq(6).should('not.contain.text', '{');
        pointAtSteady(() => rowFor('Roles: added Technician').find('td').eq(6), 1800);
        pointAtSteady(() => rowFor('Set whether an employee is licensed').find('td').eq(6), 1600);
      });
      line('p05-10', () => pointAtSteady(() => rowFor('Covering while manager is away').find('td').eq(5), 3500));
      line('p05-11', () => openMenu('Staff'));
      line('p05-12', () => {
        openItem('Roles');
        roleItem('Technician').should('exist');
      });
      line('p05-13', () => {
        tapSteady(() => roleItem('Technician'));
        cy.get('[data-testid="recent-role-changes"]', { timeout: 30000 }).should('exist');
      });
      line('p05-14', () => pointAtSteady(() => cy.get('[data-testid="recent-role-changes"]'), 4000));
      line('p05-15');
      line('p05-16');
      line('p05-17');
      finish();
    };
    cy.then(() => record());
  });
});
