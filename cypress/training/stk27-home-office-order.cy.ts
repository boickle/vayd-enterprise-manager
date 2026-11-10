/// <reference types="cypress" />
/**
 * Training video STK-27: a home office that keeps its stock in the car, and when it gets ordered
 * (docs/training/scripts/inventory/STK-27-home-office-car-stock-ordering.md).
 * TEST stack with cypress/training/setup/inventory-demo.cjs run on it. Dr. Priya Shah (inventory manager of
 * Dr. Shah home) sees her car's doxycycline shortfall on the Transfer List with no source, then orders it.
 */
import '../support/e2e';
import { signInAsScheduling } from '../support/schedulingWorld';
import { hideNonProdBanner } from './srRecord';
import { choose, finish, line, loadNarration, pointAt, startClock, tap } from './trainingKit';

const menu = (group: string, item: string) => {
  tap(() => cy.contains('button.settings-tab-menu__trigger', group));
  tap(() => cy.contains('[role="menuitem"]', item));
};
const office = () => cy.contains('label', 'Office').find('select').first();

describe('Training: STK-27 home office ordering', () => {
  it('STK-27', () => {
    loadNarration();
    hideNonProdBanner();
    // Off camera: clear earlier takes' orders and list rows for Dr. Shah home (test database only).
    const db = String(Cypress.env('SCH_DB'));
    expect(db).to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
    const shah = `(select id from practice_branch where name='Dr. Shah home')`;
    cy.exec(
      `psql -h localhost -U vayd -d ${db} -c "delete from inventory_purchase_order_lines where \\"purchaseOrderId\\" in (select id from inventory_purchase_orders where \\"branchId\\"=${shah}); delete from inventory_purchase_orders where \\"branchId\\"=${shah}; delete from inventory_stock_requests where \\"branchId\\"=${shah} or \\"toBranchId\\"=${shah};"`,
      { env: { PGPASSWORD: 'vayd' } }
    );
    Cypress.config('scrollBehavior', 'center');
    signInAsScheduling('doctorB', '/schedule/inventory/order-list');
    cy.contains('h1', 'Pharmacy', { timeout: 30000 }).should('be.visible');
    cy.contains('button.settings-tab-menu__trigger', 'Move / Order', { timeout: 30000 }).should('be.visible');
    cy.wait(2000);

    const record = () => {
      startClock();
      line('stk27-01');
      line('stk27-02', () => {
        menu('Move / Order', 'Transfer List');
        cy.contains('h1, h2', 'Transfer List', { timeout: 20000 }).should('be.visible');
      });
      line('stk27-03', () => {
        choose(office, 'Dr. Shah home');
        cy.contains('tr', 'Doxycycline 100 mg tablet', { timeout: 30000 }).should('be.visible');
      });
      line('stk27-04', () => pointAt(() => cy.contains('tr', 'Doxycycline 100 mg tablet').contains('td', 'short 70'), 3500));
      line('stk27-05', () => pointAt(() => cy.contains('tr', 'Doxycycline 100 mg tablet').find('td').eq(1), 3000));
      line('stk27-06');
      line('stk27-07', () => {
        menu('Move / Order', 'Order List');
        cy.contains('h1, h2', 'Order List', { timeout: 20000 }).should('be.visible');
      });
      line('stk27-08', () => {
        choose(office, 'Dr. Shah home');
        cy.contains('tr', 'Doxycycline 100 mg tablet', { timeout: 30000 }).should('be.visible');
      });
      line('stk27-09', () => pointAt(() => cy.contains('tr', 'Doxycycline 100 mg tablet'), 3000));
      line('stk27-10', () => {
        tap(() => cy.contains('tr', 'Doxycycline 100 mg tablet').contains('button', 'Show need'));
        cy.get('[data-testid="order-not-covered"]').should('be.visible');
      });
      line('stk27-11', () => {
        pointAt(() => cy.contains('div', /^Home: no count for this item/), 3000);
        pointAt(() => cy.get('[data-testid="order-not-covered"]'), 3000);
      });
      line('stk27-12', () => {
        tap(() => cy.contains('button', /^Order$/));
        cy.contains('Place order', { timeout: 20000 }).should('be.visible');
      });
      line('stk27-13', () => {
        pointAt(() => cy.contains('label', 'Distributor').find('select').first(), 2000);
        pointAt(() => cy.contains('Home · need 70'), 2000);
      });
      line('stk27-14', () => {
        tap(() => cy.contains('button', 'Record order'));
        cy.contains('Ordered by Priya Shah', { timeout: 20000 }).should('exist');
      });
      line('stk27-15', () => {
        cy.contains('Ordered by Priya Shah').scrollIntoView();
        pointAt(() => cy.contains('Northline Vet Supply · Dr. Shah home').parent(), 4000);
      });
      line('stk27-16');
      line('stk27-17');
      finish();
    };
    cy.then(() => record());
  });
});
