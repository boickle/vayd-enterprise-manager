/// <reference types="cypress" />
import '../support/e2e';
import { api, inventoryWorld, receiveDraftStorage, signInAs } from '../support/inventoryWorld';

/**
 * INV-02-7: finalizing is all-or-nothing. A draft with a lot-tracked line missing its expiration
 * is refused on the Receive screen with the item named; after adding the date on screen, the
 * second finalize receives each line exactly once.
 */
describe('INV-02-7: fix a missing expiration and finalize again', () => {
  it('names the item, receives nothing, then receives each line once', () => {
    const w = inventoryWorld();
    const p = `/practice/${w.practiceId}`;
    const invoiceNumber = `INV02-7-${Date.now()}`;
    const office = w.uncounted;

    api('inventoryManager', 'POST', `${p}/inventory-shipments`, {
      branchId: office.branchId,
      supplierId: w.supplierId,
      invoiceNumber,
      defaultToBranchLocationId: office.mainLocationId,
    }).then((shipment: { id: number }) => {
      const line = (body: Record<string, unknown>) =>
        api('inventoryManager', 'POST', `${p}/inventory-shipments/${shipment.id}/lines`, {
          toBranchLocationId: office.mainLocationId,
          ...body,
        });
      line({
        inventoryItemId: w.items.vaccineId,
        quantity: 10,
        costPerUnit: 8,
        lotNumber: `${w.tag}-V1`,
        expirationDate: '2029-01-31',
      });
      line({
        inventoryItemId: w.items.stockId,
        quantity: 60,
        costPerUnit: 0.3,
        lotNumber: `${w.tag}-C1`,
      });

      signInAs(
        'inventoryManager',
        '/schedule/inventory/receive',
        receiveDraftStorage('inventoryManager', {
          branchId: office.branchId,
          supplierId: w.supplierId,
          invoiceNumber,
          locationId: office.mainLocationId,
          shipmentId: shipment.id,
        })
      );
      cy.contains(`${w.tag} carprofen inventory × 60`, { timeout: 20000 });

      cy.contains('button', 'Finalize shipment').click();
      cy.get('.settings-error-message', { timeout: 15000 })
        .should('contain.text', `${w.tag} carprofen inventory`)
        .and('contain.text', 'expiration date is required');
      const receives = () =>
        api<{ rows: Array<{ movementType: string; inventoryItemId: number }> }>(
          'inventoryManager',
          'GET',
          `${p}/branches/${office.branchId}/inventory-movements?limit=200`
        ).then((res) => res.rows.filter((m) => m.movementType === 'receive'));
      receives().should('have.length', 0);

      // Add the date on the screen.
      cy.contains(`${w.tag} carprofen inventory × 60`)
        .parents('li')
        .first()
        .within(() => {
          cy.contains('button', 'Edit').click();
          cy.get('input[placeholder="MM/DD/YYYY"]').clear().type('06/30/2029').blur();
          cy.contains('button', 'Save changes').click();
        });
      cy.contains(`${w.tag} carprofen inventory × 60`, { timeout: 15000 }).should(
        'contain.text',
        'Exp 2029-06-30'
      );

      cy.contains('button', 'Finalize shipment').click();
      cy.get('.settings-message', { timeout: 15000 }).should('contain.text', 'Shipment finalized');

      receives().then((rows) => {
        expect(rows.filter((m) => m.inventoryItemId === w.items.vaccineId)).to.have.length(1);
        expect(rows.filter((m) => m.inventoryItemId === w.items.stockId)).to.have.length(1);
      });
      // Activity shows them.
      cy.visit('/schedule/inventory/activity');
      cy.contains('option', `${w.tag} uncounted office`, { timeout: 20000 })
        .parent('select')
        .select(`${w.tag} uncounted office`);
      cy.contains(`${w.tag} carprofen inventory`, { timeout: 20000 });
      cy.contains(`${w.tag} rabies vaccine`);
    });
  });
});
