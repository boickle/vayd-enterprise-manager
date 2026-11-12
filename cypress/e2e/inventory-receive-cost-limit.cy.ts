/// <reference types="cypress" />
import '../support/e2e';
import { api, inventoryWorld, receiveDraftStorage, signInAs } from '../support/inventoryWorld';

/**
 * INV-01-11: a 180x cost typo on the Receive screen is held for review, not pushed to prices.
 * Owner decision D1: a higher cost auto-applies only up to +15%; anything larger waits in
 * Cost Reviews and leaves prices unchanged. The draft shipment is created through the API and
 * resumed by the Receive screen from this browser's saved in-progress receive.
 */
describe('INV-01-11: held cost increase, screen to Cost Reviews', () => {
  it('shows the hint, holds the price on finalize, and lists the review', () => {
    const w = inventoryWorld();
    const p = `/practice/${w.practiceId}`;
    const invoiceNumber = `INV01-11-${Date.now()}`;
    const stockId = w.items.stockId;

    api('inventoryManager', 'POST', `${p}/inventory-shipments`, {
      branchId: w.counted.branchId,
      supplierId: w.supplierId,
      invoiceNumber,
      defaultToBranchLocationId: w.counted.mainLocationId,
    }).then((shipment: { id: number }) => {
      // 180 tablets at $54.00 each: a bottle price typed as a unit cost.
      api('inventoryManager', 'POST', `${p}/inventory-shipments/${shipment.id}/lines`, {
        inventoryItemId: stockId,
        quantity: 180,
        costPerUnit: 54,
        toBranchLocationId: w.counted.mainLocationId,
        lotNumber: `${w.tag}-NEW`,
        expirationDate: '2030-01-31',
      });

      signInAs(
        'inventoryManager',
        '/schedule/inventory/receive',
        receiveDraftStorage('inventoryManager', {
          branchId: w.counted.branchId,
          supplierId: w.supplierId,
          invoiceNumber,
          locationId: w.counted.mainLocationId,
          shipmentId: shipment.id,
        })
      );
      cy.contains(/Over 15%/, { timeout: 20000 }).should(
        'contain.text',
        'goes to Cost Reviews, prices unchanged'
      );
      cy.contains('button', 'Finalize shipment').click();
      cy.get('.settings-message')
        .should('contain.text', '1 price increase is waiting in Cost Reviews')
        .and('contain.text', 'prices stay the same until a manager applies them');

      // The manager sees it held for review.
      signInAs('practiceManager', '/schedule/inventory/cost-reviews');
      cy.contains('Large increase, held', { timeout: 20000 }).should('be.visible');
    });

    // No client price change recorded.
    api('inventoryManager', 'GET', `${p}/inventory-items/${stockId}/history`).then((body) => {
      expect(JSON.stringify(body)).not.to.contain('shipment #');
    });
  });
});
