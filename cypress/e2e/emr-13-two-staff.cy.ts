/// <reference types="cypress" />
import '../support/e2e';
import {
  addOrder,
  emrApi,
  emrSql,
  emrWorld,
  openEncounter,
  signInEmr,
  soapPath,
  visitInvoice,
} from '../support/emrCoreVisitWorld';

/**
 * EMR-13-5: two staff edit the same rabies dose; the second to save is told, and loses nothing.
 *
 * The technician (tablet) opens the SOAP with the dose loaded. The vet (laptop, the API here) then changes the
 * rabies tag to 123 and saves. The technician types a serial number and presses "Update dose": the save is
 * refused with "Changed by Emr veterinarian, reload", what the technician typed is still in the box, and the
 * vet's tag 123 is still the saved tag. "Reload their version" then shows tag 123.
 *
 * Seed: vayd-api test/scripts/emr-core-visit-seed.ts (household "signoff", pet Fennel). See emrCoreVisitWorld.ts.
 * Nothing reaches Stripe or email.
 */
describe('EMR-13-5: tech saves second on a dose the vet changed', () => {
  it('shows "Changed by <vet>, reload", keeps the typed serial number, and keeps the vet\'s tag', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.signoff;
    const [dog] = pets;
    const next = new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10);

    openEncounter(dog, clientId).then((enc) => {
      addOrder(enc.id, w.items.rabiesId, 'Rabies vaccine', 28, { confirmDuplicate: true }).then((order) => {
        const dose = (tag: string, expectedUpdatedAt?: string) =>
          emrApi('veterinarian', 'PUT', `/soap-encounters/${enc.id}/orders/${order.id}/vaccination`, {
            practiceId: w.practiceId,
            nextVaccinationDate: next,
            inventoryLotBalanceId: w.lots.rabies.lotBalanceId,
            lotNumber: w.lots.rabies.lotNumber,
            tagNumber: tag,
            employeeId: w.employees.veterinarian,
            ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}),
          });
        const loadedVersion = () =>
          emrApi<{ vaccinations: Array<{ encounterOrderId: string; updated: string }> }>(
            'veterinarian',
            'GET',
            `/soap-encounters/${enc.id}/order-clinical-details?practiceId=${w.practiceId}`,
          ).then((d) => d.vaccinations.find((v) => v.encounterOrderId === order.id)!.updated);

        // The dose exists; the technician opens the SOAP and so loads this version of it.
        dose('R-1000');
        signInEmr('technician', soapPath(dog, clientId));
        cy.contains(dog.name, { timeout: 40000 });
        // The dose form is not a row of its own: it sits in the drawer under the checkout line for this order
        // (VisitCheckoutPanel -> VisitDoseAndRxSection embedded, no row header). Find that line by order id (other
        // specs add Rabies lines to this pet too), open it, and work inside the open drawer.
        visitInvoice(dog).then((inv) => {
          const line = (inv.lines as Array<{ id: string; orderId?: string | null; isDeleted?: boolean }>).find(
            (l) => l.orderId === order.id && !l.isDeleted,
          );
          expect(line, 'checkout line for the rabies order').to.exist;
          cy.get(`#checkout-line-${line!.id} .soap-invoice-line-expand`, { timeout: 40000 }).then(($btn) => {
            if ($btn.attr('aria-expanded') !== 'true') cy.wrap($btn).click({ scrollBehavior: 'center' });
          });
        });
        cy.get('.soap-invoice-line-drawer.is-open .soap-dose-row', { timeout: 20000 }).should('exist');
        cy.contains('label', 'Rabies tag', { timeout: 20000 }).find('input').should('have.value', 'R-1000');

        // Meanwhile the vet saves tag 123 from the laptop, based on the version they loaded.
        loadedVersion().then((version) => dose('123', version));
        emrSql(`SELECT "tagNumber" FROM vaccination_logs WHERE "encounterOrderId" = '${order.id}' AND "isDeleted" = false`).should('eq', '123');

        // The technician types a serial number and saves second.
        cy.contains('label', 'Serial number').find('input').clear().type('TABLET-77');
        cy.contains('button', 'Update dose').click();

        cy.get('[data-cy="record-conflict-message"]', { timeout: 20000 })
          .should('contain.text', 'Changed by Emr veterinarian')
          .and('contain.text', 'reload');
        // Nothing the technician typed was lost, and the vet's tag was not overwritten.
        cy.contains('label', 'Serial number').find('input').should('have.value', 'TABLET-77');
        emrSql(`SELECT "tagNumber" FROM vaccination_logs WHERE "encounterOrderId" = '${order.id}' AND "isDeleted" = false`).should('eq', '123');
        emrSql(`SELECT coalesce("serialNumber",'') FROM vaccination_logs WHERE "encounterOrderId" = '${order.id}' AND "isDeleted" = false`).should('eq', '');

        // Reloading shows the vet's version.
        cy.get('[data-cy="record-conflict-reload"]').click();
        cy.get('[data-cy="record-conflict"]').should('not.exist');
        cy.contains('label', 'Rabies tag').find('input').should('have.value', '123');
      });
    });
  });
});
