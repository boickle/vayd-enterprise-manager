/// <reference types="cypress" />
/**
 * Training video ROLE-10: What the Mail Order Manager and Team see (docs/training/scripts/permissions/ROLE-10-mail-order.md).
 * TEST stack only. Part 1 as Jesse Ward (Mail Order Team Member), part 2 as Alex Kim (Mail Order Manager).
 * Nothing is changed.
 */
import '../support/e2e';
import { signInAsPerm } from './probes-perm/permKit';
import { pointAtSteady, startAs, topBar, topLinks } from './permRecord';
import { finish, line, loadNarration, offCamera, pointAt, startClock, tap } from './trainingKit';

const exact = (label: string, sel = 'a, button') =>
  cy.get(sel).filter((_, el) => (el as HTMLElement).innerText.trim() === label && !!(el as HTMLElement).offsetParent).first();
const quickActions = () => cy.contains(/^QUICK ACTIONS$/i).parent();

describe('Training: ROLE-10 mail order', () => {
  it('ROLE-10', () => {
    loadNarration();
    startAs('mail_order_team', '/schedule', () => topBar('Pharmacy').should('exist'));

    const record = () => {
      startClock();
      line('r10-01');
      line('r10-02');
      line('r10-03', () => pointAt(() => topLinks(), 3500));
      line('r10-04', () => {
        tap(() => topBar('Pharmacy'));
        exact('Mail Order Queue').should('exist');
      });
      line('r10-05', () => {
        tap(() => exact('Mail Order Queue'));
        cy.contains('+ New mail order', { timeout: 30000 }).should('exist');
      });
      line('r10-06', () => pointAtSteady(() => exact('Cancel requests', 'button, a, [role="tab"]').parent(), 4000));
      line('r10-07', () => pointAtSteady(() => cy.contains('+ New mail order'), 2000));
      line('r10-08', () => pointAtSteady(() => quickActions(), 3000));
      offCamera(() => {
        signInAsPerm('mail_order_manager', '/schedule/mail-orders');
        exact('Store').should('exist');
        cy.wait(1500);
      });
      line('r10-09', () => pointAtSteady(() => exact('Store'), 2500));
      line('r10-10');
      line('r10-11');
      line('r10-12');
      finish();
    };
    cy.then(() => record());
  });
});
