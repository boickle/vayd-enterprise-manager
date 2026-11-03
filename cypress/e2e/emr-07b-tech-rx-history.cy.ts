/// <reference types="cypress" />
import '../support/e2e';
import {
  emrApi,
  emrRequest,
  emrSql,
  emrWorld,
  itemName,
  signInEmr,
  soapPath,
  visitInvoice,
} from '../support/emrCoreVisitWorld';

/**
 * EMR-07b (owner decisions, Nov 3, 2026): a technician enters the prescription directions for the
 * visit's vet, approves the script for dispensing, the label is printed, and the staff-only History
 * on the prescription shows each step.
 *
 * - The prescriber recorded is the visit's licensed vet, never the technician.
 * - Every step is logged: "Directions entered by … (tech) for Dr. …", "Approved for dispensing by …",
 *   "Label printed by …, Rx #…".
 *
 * Seed: vayd-api test/scripts/emr-core-visit-seed.ts (household "signoff", whose visit's provider is
 * the seeded licensed vet). See emrCoreVisitWorld.ts for how to run. A DYMO printer can't run here,
 * so the print is the call the label screens make right after the label prints
 * (POST /record-history/rx-label-printed). Nothing reaches Stripe or email.
 */
describe('EMR-07b: tech enters Rx directions for the vet; History shows every step', () => {
  it('tech saves the sig on the SOAP, approves it, prints the label, and opens History', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.signoff;
    const [dog] = pets;
    const sig = '1 tab PO q12h with food';

    emrApi<{ id: string }>('technician', 'POST', '/soap-encounters', {
      practiceId: w.practiceId,
      appointmentId: dog.appointmentId,
      patientId: dog.patientId,
      clientId,
    }).then((enc) => {
      emrApi<{ id: string; invoiceLineId: string | null }>(
        'technician',
        'POST',
        `/soap-encounters/${enc.id}/orders`,
        {
          practiceId: w.practiceId,
          name: itemName('Carprofen 75mg'),
          kind: 'med',
          catalogItemId: w.items.rxId,
          catalogItemType: 'inventory',
          qty: 30,
          unitPrice: 1,
          state: 'accepted',
          confirmDuplicate: true,
        }
      ).then((order) => {
        // 1. The technician writes the directions on the SOAP.
        signInEmr('technician', soapPath(dog, clientId));
        cy.contains(dog.name, { timeout: 40000 });
        cy.contains('.soap-dose-row-head', itemName('Carprofen 75mg'), { timeout: 30000 })
          .scrollIntoView()
          .click();
        cy.contains('.soap-dose-row-head', itemName('Carprofen 75mg'))
          .closest('.soap-dose-row')
          .within(() => {
            cy.get('select[aria-label="Acute or chronic prescription"]').select('acute');
            cy.contains('label', 'Refills').find('input[type="number"]').clear().type('2');
            cy.get('textarea').first().clear().type(sig);
            cy.contains('button', /Save Rx|Update Rx/).click();
          });
        cy.contains('.soap-dose-row-head', itemName('Carprofen 75mg'))
          .closest('.soap-dose-row')
          .should('contain.text', '2 refills');

        // The prescriber is the visit's vet, not the technician.
        emrSql(
          `SELECT "employee_Id" || '|' || instructions || '|' || refill FROM prescriptions WHERE "encounterOrderId" = '${order.id}' AND "isDeleted" = false`
        ).should('eq', `${w.employees.veterinarian}|${sig}|2`);

        // 2. The technician approves the script for dispensing (rx.invoice.approve, as before).
        visitInvoice(dog).then((inv) => {
          const line = inv.lines.find(
            (l) => l.description.includes('Carprofen 75mg') && !l.isDeleted
          );
          expect(line, 'Carprofen line on the visit invoice').to.not.equal(undefined);
          emrRequest('technician', 'PATCH', `/visit-invoices/${inv.id}/lines/${line!.id}`, {
            practiceId: w.practiceId,
            rxApproved: true,
          })
            .its('status')
            .should('eq', 200);
        });

        // 3. The label prints (the label screens log it right after printing).
        emrSql(
          `SELECT "rxNumber" FROM prescriptions WHERE "encounterOrderId" = '${order.id}' AND "isDeleted" = false`
        ).then((rxNumber) => {
          expect(Number(rxNumber)).to.be.greaterThan(0);
          emrRequest('technician', 'POST', '/record-history/rx-label-printed', {
            practiceId: w.practiceId,
            rxNumber: Number(rxNumber),
          })
            .its('status')
            .should('eq', 201);

          // 4. History on the prescription's row lists each step.
          signInEmr('technician', soapPath(dog, clientId));
          cy.contains(dog.name, { timeout: 40000 });
          cy.contains('.soap-dose-row-head', itemName('Carprofen 75mg'), { timeout: 30000 })
            .scrollIntoView()
            .click();
          cy.contains('.soap-dose-row-head', itemName('Carprofen 75mg'))
            .closest('.soap-dose-row')
            .within(() => {
              cy.contains('button', 'History').click();
              cy.get('[aria-label="Record history"] li', { timeout: 20000 }).should(
                'have.length',
                3
              );
              cy.get('[aria-label="Record history"] li')
                .eq(0)
                .should('contain.text', 'Directions entered by')
                .and('contain.text', '(tech) for Dr.')
                .and('contain.text', `'${sig}', qty 30, 2 refills`);
              cy.get('[aria-label="Record history"] li')
                .eq(1)
                .should('contain.text', 'Approved for dispensing by');
              cy.get('[aria-label="Record history"] li')
                .eq(2)
                .should('contain.text', 'Label printed by')
                .and('contain.text', `Rx #${rxNumber}`);
            });
        });
      });
    });
  });
});
