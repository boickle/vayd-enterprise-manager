/// <reference types="cypress" />
/**
 * Training video, MEM-22: Settings → Memberships (docs/training/scripts/memberships/MEM-22-plan-settings.md).
 * TEST stack, demo names only. The practice's 12 plans (copied read-only). Pepper is on Canine Golden, so the plan's
 * members list has someone on it. Filmed as Robin Hale (practice manager). Nothing is saved.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { enrolPet, pets, PLAN_GOLDEN_DOG, resetMembershipWorld, settle, trace } from './memKit';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: MEM-22 plan settings', () => {
  it('MEM-22', () => {
    const p = pets();
    loadNarration();
    trace('setup');
    resetMembershipWorld();
    enrolPet(p.pepper, PLAN_GOLDEN_DOG, { startDaysAgo: 90 });
    signInAsScheduling('manager', '/schedule/settings?tab=memberships');
    cy.contains('h3', 'Plans', { timeout: 60000 }).should('exist');
    cy.get('.memberships-rail__item', { timeout: 60000 }).should('have.length.greaterThan', 3);
    cy.wait(1500);

    const golden = () => cy.contains('.memberships-rail__item', PLAN_GOLDEN_DOG);
    const section = (title: string) => cy.contains('.memberships-detail__title', title).closest('.settings-card');
    trace('clock');
    startClock();
    trace('m22-01'); line('m22-01');
    trace('m22-02'); line('m22-02');
    trace('m22-11'); line('m22-11', () => {
      const win = () => cy.contains('.settings-card-title', 'Post-visit membership signup').closest('.settings-card');
      settle(win);
      pointAt(win, 5000);
      settle(() => cy.get('.memberships-rail__search'));
    });
    trace('m22-03'); line('m22-03', () => {
      typeSlowly(() => cy.get('.memberships-rail__search'), 'Canine Golden');
      settle(golden);
    });
    trace('m22-03b'); line('m22-03b', () => {
      tap(golden);
      cy.contains('.memberships-detail__title', 'Canine Golden', { timeout: 60000 }).should('be.visible');
      cy.wait(1000);
    });
    trace('m22-04'); line('m22-04', () => {
      const price = () => cy.contains('label.settings-label', /^(Monthly|Annual) price/);
      settle(price);
      pointAt(price, 4000);
    });
    trace('m22-05'); line('m22-05', () => {
      const disc = () => cy.contains('label.settings-label', 'Out-of-plan discount');
      settle(disc);
      pointAt(disc, 4500);
    });
    trace('m22-06'); line('m22-06', () => {
      settle(() => cy.get('.portal-preview__heading'));
      pointAt(() => cy.get('.portal-preview__heading').parent(), 4500);
    });
    trace('m22-07'); line('m22-07', () => {
      const r = () => cy.get('.memberships-restrictions');
      settle(r);
      pointAt(() => r().find('.memberships-restrictions__head'), 5000);
    });
    trace('m22-08'); line('m22-08', () => {
      const renew = () => cy.contains('label.settings-label', 'On renewal, move to');
      settle(renew);
      pointAt(renew, 3000);
      pointAt(() => cy.contains('label.settings-label', 'When they age out'), 3000);
    });
    trace('m22-09'); line('m22-09', () => {
      settle(() => section('What the plan includes'));
      pointAt(() => section('What the plan includes'), 5500);
      settle(() => cy.get('.memberships-audit__toggle').filter(':contains("Members (")'));
    });
    trace('m22-10'); line('m22-10', () => {
      const members = () => cy.get('.memberships-audit__toggle').filter(':contains("Members (")');
      tap(members);
      cy.wait(1500);
    });
    trace('m22-10b'); line('m22-10b', () => pointAt(() => cy.get('.memberships-audit__toggle').filter(':contains("Members (")').parent(), 4000));
    trace('m22-12'); line('m22-12');
    trace('done');
    finish();
  });
});
