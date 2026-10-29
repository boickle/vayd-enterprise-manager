/// <reference types="cypress" />
import '../support/e2e';
import { api, inventoryWorld, signInAs } from '../support/inventoryWorld';

/**
 * INV-03-6: a weekly count posts once. Count a two-lot item, add a new lot with its expiration
 * left blank (the screen holds Submit back and nothing is posted), add the date, submit: one
 * adjustment per lot that changed, and the Shrink report shows the true variance once.
 *
 * Seeded counted office, Main shelf: carprofen lot EXP (12) and lot OK (40); Car has none.
 * Counted: EXP 12, OK 38, new lot B 3, Car 0 -> OK -2, B +3, net +1 (cost $0.30 each).
 */
describe('INV-03-6: weekly count with a missing expiration', () => {
  it('posts nothing on the bad submit and each lot once after the fix', () => {
    const w = inventoryWorld();
    const p = `/practice/${w.practiceId}`;
    const office = w.counted;
    const item = `${w.tag} carprofen inventory`;
    const newLot = `${w.tag}-B`;
    const adjustments = () =>
      api<{
        rows: Array<{
          movementType: string;
          inventoryItemId: number;
          lotNumber: string | null;
          quantity: number;
        }>;
      }>(
        'inventoryManager',
        'GET',
        `${p}/branches/${office.branchId}/inventory-movements?limit=200`
      ).then((res) =>
        res.rows.filter(
          (m) => m.inventoryItemId === w.items.stockId && m.movementType.startsWith('adjustment')
        )
      );

    // Tall enough that the whole count sheet shows without the sticky header covering rows.
    cy.viewport(1400, 2000);
    signInAs('inventoryManager', '/schedule/inventory/counts');
    cy.contains('option', `${w.tag} counted office`, { timeout: 20000 })
      .parent('select')
      .select(`${w.tag} counted office`);
    cy.contains('tr', item, { timeout: 20000 }).within(() => cy.contains('button', 'Edit').click());
    cy.contains('tr', item).within(() => cy.contains('button', 'Add lot at Main').click());

    const countIn = (rowText: string, label: string, value: string) =>
      cy
        .contains('tr', rowText)
        .find(`input[aria-label="${item} ${label} count"]`)

        .clear()
        .type(value);
    countIn(w.lots.expiredLotNumber, 'Main', '12');
    countIn(w.lots.currentLotNumber, 'Main', '38');
    cy.get(`input[aria-label="${item} lot"]`)
      .filter((_, el) => !(el as HTMLInputElement).value)
      .last()

      .type(newLot);
    cy.get(`input[aria-label="${item} lot"]`)
      .filter((_, el) => (el as HTMLInputElement).value === newLot)
      .parents('tr')
      .find(`input[aria-label="${item} Main count"]`)

      .type('3');
    cy.get(`input[aria-label="${item} Car count"]`).clear().type('0');
    cy.contains('tr', item).within(() => cy.contains('button', 'Save').click());

    // With lot B's expiration blank the screen won't submit (the API refuses too: INV-03-1),
    // and nothing is posted.
    cy.contains('tr', item, { timeout: 15000 }).within(() => {
      cy.contains('Enter the expiration date for the bottles counted at Main');
      cy.contains('button', 'Submit').should('be.disabled');
    });
    adjustments().should('have.length', 0);

    // Add the date and submit again.
    cy.contains('tr', item).within(() => cy.contains('button', 'Edit').click());
    cy.get(`input[aria-label="${item} lot"]`)
      .filter((_, el) => (el as HTMLInputElement).value === newLot)
      .parents('tr')
      .find(`input[aria-label="${item} expiration"]`)

      .clear()
      .type('06/30/2029')
      .blur();
    cy.contains('tr', item).within(() => cy.contains('button', 'Save').click());
    cy.contains('tr', item, { timeout: 15000 }).within(() =>
      cy.contains('button', 'Submit').click()
    );
    cy.get('.settings-error-message').should('not.exist');

    adjustments().then((rows) => {
      expect(
        rows.map((m) => `${m.movementType} ${m.lotNumber} ${Number(m.quantity)}`).sort()
      ).to.deep.equal([
        `adjustment_decrease ${w.lots.currentLotNumber} 2`,
        `adjustment_increase ${newLot} 3`,
      ]);
    });

    // Shrink shows the true variance once: one item counted, +1 unit, +$0.30.
    const today = new Date();
    const ymd = (d: Date) => d.toISOString().slice(0, 10);
    const from = ymd(new Date(today.getFullYear(), today.getMonth(), 1));
    const to = ymd(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    api<{ counts: { itemsCounted: number; netUsd: number } }>(
      'inventoryManager',
      'GET',
      `${p}/inventory-counts/shrink-summary?fromDate=${from}&toDate=${to}&branchId=${office.branchId}`
    ).then((s) => {
      expect(s.counts.itemsCounted).to.eq(1);
      expect(Number(s.counts.netUsd)).to.be.closeTo(0.3, 0.001);
    });
  });
});
