/// <reference types="cypress" />
import '../support/e2e';
import { api, inventoryWorld, receiveDraftStorage, signInAs } from '../support/inventoryWorld';

/**
 * INV-05-8: anyone may receive (owner decision D3) and Scout shows who did; Cost Reviews, which
 * change client prices, are for management. A technician receives a shipment with one lower cost;
 * the practice manager applies the review; the technician can't open Cost Reviews.
 */
describe('INV-05-8: technician receives, practice manager applies the Cost Review', () => {
  it('records the technician, lets the manager apply, and keeps the technician out', () => {
    const w = inventoryWorld();
    const p = `/practice/${w.practiceId}`;
    const invoiceNumber = `INV05-8-${Date.now()}`;

    api('technician', 'POST', `${p}/inventory-shipments`, {
      branchId: w.counted.branchId,
      supplierId: w.supplierId,
      invoiceNumber,
      defaultToBranchLocationId: w.counted.mainLocationId,
    }).then((shipment: { id: number }) => {
      // 0.25 is below the 0.30 catalog cost: a "lower cost" Cost Review.
      api('technician', 'POST', `${p}/inventory-shipments/${shipment.id}/lines`, {
        inventoryItemId: w.items.stockId,
        quantity: 60,
        costPerUnit: 0.25,
        toBranchLocationId: w.counted.mainLocationId,
        lotNumber: `${w.tag}-LC`,
        expirationDate: '2029-01-31',
      });

      signInAs(
        'technician',
        '/schedule/inventory/receive',
        receiveDraftStorage('technician', {
          branchId: w.counted.branchId,
          supplierId: w.supplierId,
          invoiceNumber,
          locationId: w.counted.mainLocationId,
          shipmentId: shipment.id,
        })
      );
      cy.contains('Lower than catalog', { timeout: 20000 });
      cy.contains('button', 'Finalize shipment').click();
      cy.get('.settings-message').should('contain.text', 'Shipment finalized');
      cy.contains(invoiceNumber)
        .parents('li')
        .first()
        .should('contain.text', 'Received by Inv technician');

      // The technician has no Cost Reviews: no tab, and the page sends them back to Counts.
      cy.contains('a', 'Cost Reviews').should('not.exist');
      cy.visit('/schedule/inventory/cost-reviews');
      cy.location('pathname', { timeout: 15000 }).should('eq', '/schedule/inventory/counts');

      // The practice manager applies it.
      signInAs('practiceManager', '/schedule/inventory/cost-reviews');
      cy.contains(`${w.tag} carprofen inventory`, { timeout: 20000 })
        .parents('li, tr, .settings-card')
        .first()
        .within(() => cy.contains('button', 'Update catalog').click());
      cy.intercept('POST', '**/inventory-cost-reviews/*/resolve').as('resolve');
      cy.contains('button', 'Save & update catalog', { timeout: 20000 }).click();
      cy.wait('@resolve', { timeout: 20000 }).its('response.statusCode').should('eq', 201);

      api<Array<{ status: string; resolvedByEmployeeId: number | null; shipmentId: number }>>(
        'practiceManager',
        'GET',
        `${p}/inventory-cost-reviews?status=all`
      ).then((rows) => {
        const review = rows.find((r) => r.shipmentId === shipment.id);
        expect(review?.status).to.eq('applied_catalog');
        expect(review?.resolvedByEmployeeId).to.eq(w.employees.practiceManager);
      });
      api<{ shipment: { receivedByEmployeeId: number; receivedByName: string } }>(
        'practiceManager',
        'GET',
        `${p}/inventory-shipments/${shipment.id}`
      ).then((bundle) => {
        expect(bundle.shipment.receivedByEmployeeId).to.eq(w.employees.technician);
        expect(bundle.shipment.receivedByName).to.eq('Inv technician');
      });
    });
  });
});
