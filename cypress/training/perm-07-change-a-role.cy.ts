/// <reference types="cypress" />
/**
 * Training video PERM-07: Change what a role can do (docs/training/scripts/permissions/PERM-07-change-a-role.md).
 * TEST stack only. Signed in as Quinn Parker (Practice Admin). Nothing is saved.
 */
import '../support/e2e';
import { pointAtSteady, showTitle, startAs, tapSteady } from './permRecord';
import { finish, line, loadNarration, startClock, tap, typeSlowly } from './trainingKit';

const roleItem = (name: string) =>
  cy.get('li button').filter((_, el) => (el as HTMLElement).querySelector('div')?.textContent?.trim() === name).first();
const editor = () => cy.contains('.settings-card-title', /^What can a /).closest('.settings-card');
const search = () => editor().find('input[placeholder="Search permissions"]');
const onlyChanges = () => editor().contains('label', 'Only show changes from default').find('input');
const permRow = (label: string) =>
  editor().find('.perm-editor-label').filter((_, el) => (el as HTMLElement).innerText.includes(label)).first().parent();

describe('Training: PERM-07 change a role', () => {
  it('PERM-07', () => {
    loadNarration();
    startAs('practice_admin', '/schedule/settings?tab=roles', () => roleItem('Client Liaison').should('exist'));

    const record = () => {
      startClock();
      line('p07-01');
      line('p07-02');
      line('p07-03', () => {
        tapSteady(() => roleItem('Client Liaison'));
        cy.contains('.settings-card-title', 'What can a Client Liaison do?', { timeout: 30000 }).should('exist');
      });
      line('p07-04', () => pointAtSteady(() => editor().find('.settings-card-subtitle'), 3500));
      line('p07-05', () => typeSlowly(() => search(), 'deposit'));
      line('p07-06', () => {
        pointAtSteady(() => permRow('Create a bank deposit'), 2500);
        pointAtSteady(() => permRow('Create a bank deposit').find('select'), 2500);
      });
      line('p07-07', () => {
        search().clear();
        tap(() => onlyChanges());
      });
      line('p07-08', () => pointAtSteady(() => editor().find('.perm-editor-toolbar').parent(), 2000));
      line('p07-09', () => tap(() => onlyChanges()));
      line('p07-09b', () => typeSlowly(() => search(), 'export'));
      line('p07-10', () => pointAtSteady(() => permRow('Export or download data in bulk'), 4000));
      line('p07-11', () =>
        showTitle(() => permRow('Export or download data in bulk').find('.emp-access-tag').filter((_, el) => el.innerText.includes('Not enforced yet')).first(), 5000)
      );
      line('p07-12', () => pointAtSteady(() => permRow('Export or download data in bulk').find('select'), 3000));
      line('p07-13', () => pointAtSteady(() => editor().contains('button', /No unsaved changes|Save/), 2500));
      line('p07-14');
      line('p07-15');
      finish();
    };
    cy.then(() => record());
  });
});
