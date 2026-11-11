/// <reference types="cypress" />
/**
 * Training video ROLE-01: What a Practice Admin and a Practice Manager see
 * (docs/training/scripts/permissions/ROLE-01-practice-admin-and-manager.md).
 * TEST stack only. Part 1 as Quinn Parker (Practice Admin), part 2 as Jamie Brooks (Practice Manager). The
 * switch between logins happens off camera. Nothing is changed.
 */
import '../support/e2e';
import { signInAsPerm } from './probes-perm/permKit';
import {
  analyticsLink, card, hubTab, pickStaff, pointAtSteady, reportCategories, reportRow, startAs, tapSteady, topBar, topLinks,
} from './permRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const roleItem = (name: string) =>
  cy.get('li button').filter((_, el) => (el as HTMLElement).querySelector('div')?.textContent?.trim() === name).first();
const menuLink = (label: string) =>
  cy.get('a, button, [role="menuitem"]').filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();
const openStaff = (name: string) => {
  cy.visit('/schedule/settings?tab=employee-directory');
  cy.contains('option', 'Select staff', { timeout: 60000 }).should('exist');
  cy.get('select').filter((_, el) => Array.from((el as HTMLSelectElement).options).some((o) => o.text.includes(name))).first()
    .then(($s) => {
      const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) => o.text.includes(name))!;
      cy.wrap($s).select(opt.value);
    });
  cy.get('[role="tab"]').contains(/^Access$/, { timeout: 30000 }).click();
  cy.contains('.settings-card-title', 'License', { timeout: 30000 }).should('exist');
  cy.wait(800);
};
const openRole = (name: string) => {
  cy.visit('/schedule/settings?tab=roles');
  roleItem(name).should('exist').click();
  cy.contains('.settings-card-title', new RegExp(`^Who (is|has) ${name}\\?`), { timeout: 30000 }).should('exist');
  cy.wait(800);
};

describe('Training: ROLE-01 practice admin and manager', () => {
  it('ROLE-01', () => {
    loadNarration();
    startAs('practice_admin', '/schedule', () => topBar('Settings').should('exist'));

    const record = () => {
      startClock();
      line('r01-01');
      line('r01-02');
      line('r01-03', () => pointAt(() => topLinks(), 4500));
      line('r01-04', () => {
        tap(() => topBar('Marketing'));
        pointAtSteady(() => menuLink('Promotions'), 1500);
      });
      line('r01-05', () => pointAtSteady(() => menuLink('Email campaigns'), 1500));
      line('r01-06', () => {
        cy.get('body').type('{esc}');
        tap(() => analyticsLink());
        reportCategories().should('exist');
      });
      line('r01-07', () => {
        pointAtSteady(() => reportCategories(), 3000);
        pointAtSteady(() => reportRow(), 2500);
      });
      offCamera(() => openStaff('Tess Holt'));
      line('r01-08', () => pointAtSteady(() => card('License'), 3000));
      line('r01-09', () => pointAtSteady(() => card('Individual permissions'), 3000));
      offCamera(() => openRole('Client Liaison'));
      line('r01-10', () => pointAtSteady(() => cy.contains('.settings-card-title', /^What can a /).closest('.settings-card'), 3500));
      offCamera(() => {
        signInAsPerm('practice_manager', '/schedule');
        topBar('Settings').should('exist');
        cy.wait(1500);
      });
      line('r01-11', () => pointAt(() => topLinks(), 3500));
      offCamera(() => openStaff('Tess Holt'));
      line('r01-12', () => pointAtSteady(() => card('License').find('.emp-access-license'), 3000));
      line('r01-13', () => pointAtSteady(() => card('Individual permissions'), 2500));
      offCamera(() => openRole('Client Liaison'));
      line('r01-14', () => {
        pointAtSteady(() => cy.contains('.settings-card-title', /^Who has Client Liaison\?/).closest('.settings-card'), 2000);
        pointAtSteady(() => cy.contains('button', 'Save assignees'), 1500);
      });
      line('r01-15');
      line('r01-16', () => {
        tapSteady(() => analyticsLink());
        reportCategories().should('exist');
        pointAtSteady(() => reportCategories(), 2500);
      });
      offCamera(() => openStaff('Jamie Brooks'));
      line('r01-17', () => pointAtSteady(() => cy.contains('Ask a practice admin to change your own access').first(), 3500));
      line('r01-18');
      line('r01-19');
      finish();
    };
    cy.then(() => record());
  });
});
