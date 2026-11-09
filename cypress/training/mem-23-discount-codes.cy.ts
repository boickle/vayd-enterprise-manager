/// <reference types="cypress" />
/**
 * Training video, MEM-23: discount codes and share links (docs/training/scripts/memberships/MEM-23-discount-codes.md).
 * TEST stack on Stripe TEST mode (the promotion becomes a Stripe test-mode coupon and promotion code). Demo names
 * only. Filmed as Robin Hale (practice manager) on Marketing → Membership promotions. The code gets a 3-digit suffix
 * per run because Stripe keeps codes from earlier takes.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-23 discount codes', () => {
  it('MEM-23', () => {
    const code = `LLBEAN${100 + (Math.floor(Date.now() / 1000) % 900)}`;
    loadNarration();
    trace('setup');
    resetMembershipWorld([
      `DELETE FROM membership_discount_link WHERE "discountId" IN (SELECT id FROM membership_discount WHERE name LIKE 'LL Bean%')`,
      `DELETE FROM membership_discount WHERE name LIKE 'LL Bean%'`,
    ]);
    signInAsScheduling('manager', '/schedule/marketing/membership-promotions');
    cy.contains('button', 'New promotion', { timeout: 60000 }).should('be.visible');
    cy.wait(1500);

    const dlg = () => cy.get('[role="dialog"]');
    const field = (label: string) => dlg().contains('label', label).parent().find('input').first();
    const select = (labelId: string) => cy.get(`#${labelId}`).parent().find('[role="combobox"]');
    const row = () => cy.contains('tr', 'LL Bean');
    trace('clock');
    startClock();
    trace('m23-01'); line('m23-01');
    trace('m23-02'); line('m23-02');
    trace('m23-03'); line('m23-03', () => {
      tap(() => cy.contains('button', 'New promotion'));
      dlg().contains('Create membership promotion').should('be.visible');
      cy.wait(600);
    });
    trace('m23-04'); line('m23-04', () => typeSlowly(() => field('Internal name'), 'LL Bean — first month free'));
    trace('m23-05'); line('m23-05', () => typeSlowly(() => field('Public Name'), 'First month free on membership'));
    trace('m23-06'); line('m23-06', () => {
      tap(() => select('discount-type-label'));
      tap(() => cy.contains('li[role="option"]', 'First month off'));
    });
    trace('m23-07'); line('m23-07', () => {
      settle(() => field('Percent off the first month'));
      cy.wait(300);
      field('Percent off the first month').clear();
      typeSlowly(() => field('Percent off the first month'), '100');
    });
    trace('m23-08'); line('m23-08', () => {
      tap(() => dlg().contains('label', 'Use a custom code'));
      settle(() => dlg().find('input[placeholder="e.g. LLBEAN2026"]'));
      typeSlowly(() => dlg().find('input[placeholder="e.g. LLBEAN2026"]'), code);
    });
    trace('m23-09'); line('m23-09', () => pointAt(() => dlg().contains('label', 'Link only — no code'), 3000));
    trace('m23-10'); line('m23-10', () => {
      settle(() => field('Max redemptions (optional)'));
      pointAt(() => field('Max redemptions (optional)').closest('.MuiFormControl-root'), 2500);
      pointAt(() => field('Expires (optional)').closest('.MuiFormControl-root'), 2500);
    });
    trace('m23-11'); line('m23-11', () => {
      tap(() => dlg().contains('button', 'Create promotion'));
      cy.get('[role="dialog"]', { timeout: 60000 }).should('not.exist');
      row().should('be.visible');
      cy.wait(800);
    });
    trace('m23-12'); line('m23-12', () => {
      settle(() => row().find('[aria-label="Create signup link"]'));
      tap(() => row().find('[aria-label="Create signup link"]'));
      cy.wait(1500);
    });
    trace('m23-13'); line('m23-13', () => pointAt(() => cy.get('.MuiAlert-root').first(), 4000));
    trace('m23-14'); line('m23-14', () => {
      pointAt(() => cy.contains('th', 'Redemptions'), 2500);
      pointAt(() => row().find('[aria-label="Archive"]'), 2500);
    });
    trace('m23-15'); line('m23-15');
    trace('done');
    finish();
  });
});
