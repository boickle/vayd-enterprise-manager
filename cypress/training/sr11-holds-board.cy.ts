/// <reference types="cypress" />
/**
 * Training video SR-11: The Holds board
 * (docs/training/scripts/scheduling-routing/SR-11-holds-board.md).
 * TEST stack only. A HOLD for Biscuit Chen with Dr. Lane, "Hold: new kitten exam, owner to confirm".
 * Casey Morgan (CL) works the board, then converts the hold to a Wellness visit.
 */
import '../support/e2e';
import { includeSeededDoctorsInProviderList, signInAsScheduling } from '../support/schedulingWorld';
import { resetDemo, srBook } from './probes-sr/srKit';
import { hideNonProdBanner } from './srRecord';
import { choose, finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

describe('Training: SR-11 holds board', () => {
  it('SR-11', () => {
    loadNarration();
    hideNonProdBanner();
    resetDemo();
    // The demo reset only flags old visits deleted; the app also sets isActive=false when staff remove one,
    // and the Holds board filters on that. Match it so earlier takes' holds don't show (test DB only).
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    cy.exec(`psql -d ${db} -c "update appointments set \\"isActive\\"=false where \\"isDeleted\\"=true and \\"isActive\\"=true"`);
    const ids: Record<string, number> = {};
    let ymd = '';
    srBook('biscuit', 14, 0, 'hold', 45, 'A', 'Hold: new kitten exam, owner to confirm').then((r) => { ids.hold = r.id; ymd = r.ymd; });
    Cypress.config('scrollBehavior', 'center');
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/holds');
    cy.contains('button', 'Open / convert', { timeout: 60000 }).should('exist');
    cy.wait(2000);

    const card = () => cy.contains('button', 'Open / convert').parents().filter((_, el) => el.innerText.includes('Biscuit')).first();
    const record = () => {
      startClock();
      line('sr11-01');
      line('sr11-02', () => pointAt(() => cy.contains(/Calendar holds scheduled today/).first(), 4000));
      line('sr11-03');
      line('sr11-04', () => {
        tap(() => cy.contains('button, [role="tab"]', /^Mine/).first());
        tap(() => cy.contains('button, [role="tab"]', /^All/).first());
        cy.contains('button', 'Open / convert', { timeout: 30000 }).should('exist');
      });
      line('sr11-05', () => pointAt(() => card(), 5000));
      line('sr11-06', () => pointAt(() => card().contains(/Contact log/).first(), 3500));
      line('sr11-07', () => pointAt(() => card().contains('button, select', /Assign to/).first(), 2500));
      line('sr11-08', () => {
        tap(() => card().contains('button', 'Open / convert'));
        cy.location('pathname', { timeout: 60000 }).should('include', '/schedule/scheduler');
        cy.contains('On hold visit', { timeout: 60000 }).should('be.visible');
        cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
      });
      line('sr11-09', () => {
        pointAt(() => cy.contains('On hold visit').parent(), 2500);
        tap(() => cy.contains('button', /^Edit appointment$/));
        cy.contains(/^edit visit$/i, { timeout: 30000 }).should('be.visible');
        choose(
          () => cy.get('select').filter(':visible').filter((_, el) => (el as HTMLSelectElement).selectedOptions[0]?.text === 'HOLD').first(),
          'Wellness'
        );
        cy.contains('button', /^(Preview schedule|Save)$/).filter(':visible').first().then(($btn) => {
          const label = $btn.text().trim();
          tap(() => cy.wrap($btn));
          if (label === 'Preview schedule') {
            cy.get('button[title="Dismiss"]', { timeout: 30000 }).should('exist');
            tap(() => cy.get('button[title="Dismiss"]').parents().filter((_, el) => /\bBook\b/.test(el.innerText)).first().contains('button', /^Book$/));
          }
        });
        cy.contains(/^edit visit$/i, { timeout: 30000 }).should('not.exist');
        cy.contains('Loading drive times', { timeout: 60000 }).should('not.exist');
      });
      line('sr11-10');
      line('sr11-11');
      finish();
    };
    cy.then(() => record());
  });
});
