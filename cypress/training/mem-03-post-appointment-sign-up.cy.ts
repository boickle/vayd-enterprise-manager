/// <reference types="cypress" />
/**
 * Training video, MEM-03: post-appointment sign-up (docs/training/scripts/memberships/MEM-03-post-appointment-sign-up.md).
 * TEST stack on Stripe TEST mode, demo names only. Juniper (cat, 6 y) had a wellness visit two hours ago, paid by
 * Maria's saved test Visa: wellness visit, trip fee, FVRCP, rabies and a nail trim. Casey Morgan (client liaison)
 * signs her up on Feline Foundations monthly, shows the email option, then signs in person with Stripe's test Visa.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { chartUrl, drawSignature, paidVisit, pets, quietChart, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-03 post-appointment sign-up', () => {
  it('MEM-03', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    paidVisit(p.juniper, p.maria, [
      'Annual Wellness Visit',
      'Trip Fee',
      'FVRCP (Distemper) Vaccine - 3 year',
      'Rabies Feline Vaccine (Purevax) - 1 year',
      'Revolution Plus for Cats 5.6-11lb',
    ]);
    trace('visit paid');
    signInAsScheduling('cl', chartUrl(p.juniper));
    quietChart();
    cy.contains('button', 'Post-appointment sign-up', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    const modal = () => cy.get('.pvms-modal');
    trace('clock');
    startClock();
    trace('m03-01'); line('m03-01');
    trace('m03-02'); line('m03-02');
    trace('m03-03'); line('m03-03', () => pointAt(() => cy.get('.pmp-signup-window'), 4000));
    trace('m03-04'); line('m03-04', () => {
      tap(() => cy.contains('button', 'Post-appointment sign-up'));
      modal().should('exist');
      cy.get('.pvms-invoice-row', { timeout: 30000 }).should('exist');
      cy.wait(2500);
    });
    trace('m03-05'); line('m03-05', () => {
      tap(() => cy.get('.pvms-invoice-row input').first());
      // Cypress's click on this box doesn't always stick (a native click does); make sure it's ticked.
      cy.get('.pvms-invoice-row input').first().then(($i) => {
        if (!($i[0] as HTMLInputElement).checked) ($i[0] as HTMLInputElement).click();
      });
      cy.get('.pvms-invoice-row input').first().should('be.checked');
    });
    trace('m03-06'); line('m03-06', () => pointAt(() => cy.get('.pvms-plans').last(), 4500));
    trace('m03-07'); line('m03-07', () => tap(() => cy.contains('.pvms-plan', 'Membership - Feline Foundations - Monthly')));
    trace('m03-08'); line('m03-08', () => {
      tap(() => cy.contains('button', 'Calculate refund'));
      cy.get('.pvms-totals', { timeout: 60000 }).should('exist');
    });
    trace('m03-09'); line('m03-09', () => pointAt(() => cy.get('.pvms-totals'), 6000));
    trace('m03-10'); line('m03-10', () => pointAt(() => cy.get('.pvms-owner-sees'), 5000));
    trace('m03-11'); line('m03-11', () => {
      const nc = () => cy.contains('.pvms-lines, section, div', /^Not covered/).first();
      settle(nc);
      pointAt(nc, 4500);
    });
    trace('m03-12'); line('m03-12', () => tap(() => cy.contains('.pvms-sign-mode label', 'Email the agreement to sign').find('input')));
    trace('m03-13'); line('m03-13', () => pointAt(() => cy.get('.pvms-email-sign'), 6000));
    trace('m03-14'); line('m03-14', () => tap(() => cy.contains('.pvms-sign-mode label', 'Owner is here').find('input')));
    trace('m03-15'); line('m03-15', () => {
      const row = () => cy.contains('.pvms-totals > *', 'Charged today');
      settle(row);
      pointAt(row, 5000);
    });
    trace('m03-16'); line('m03-16', () => tap(() => modal().find('.membership-waiver__check input')));
    trace('m03-17'); line('m03-17', () => drawSignature(() => modal().find('.membership-waiver__draw canvas')));
    trace('m03-18'); line('m03-18', () => typeSlowly(() => modal().find('.membership-waiver__sign input'), 'Maria Rivera'));
    trace('m03-19'); line('m03-19', () => tap(() => cy.get('.pvms-foot .btn.primary')));
    offCamera(() => cy.get('.pvms-receipt', { timeout: 120000 }).should('exist'));
    trace('m03-20'); line('m03-20', () => pointAt(() => cy.get('.pvms-receipt'), 6000));
    trace('m03-20b'); line('m03-20b', () => {
      tap(() => cy.contains('.pvms-foot .btn.primary', 'Done'));
      cy.get('.pvms-modal').should('not.exist');
    });
    trace('m03-21'); line('m03-21');
    trace('done');
    finish();
  });
});
