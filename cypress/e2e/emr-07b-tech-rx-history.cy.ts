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
 * Seed: vayd-api test/scripts/emr-core-visit-seed.ts (household "rxtech", pet Hazel, its own visit whose provider is
 * the seeded licensed vet; the "signoff" visit is locked by EMR-07-9). See emrCoreVisitWorld.ts for how to run. A DYMO printer can't run here,
 * so the print is the call the label screens make right after the label prints
 * (POST /record-history/rx-label-printed). Nothing reaches Stripe or email.
 */
describe('EMR-07b: tech enters Rx directions for the vet; History shows every step', () => {
  it('tech saves the sig on the SOAP, approves it, prints the label, and opens History', () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.rxtech;
    const [dog] = pets;
    const sig = '1 tab PO q12h with food';
    const discardAfter = new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10);

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
        // The Rx form is not a row with a name header: it sits in the drawer under the checkout line for this
        // order (VisitCheckoutPanel -> VisitDoseAndRxSection embedded). Find the line by order id and expand it.
        const openRxDrawer = () => {
          visitInvoice(dog).then((inv) => {
            const line = (inv.lines as Array<{ id: string; orderId?: string | null; isDeleted?: boolean }>).find(
              (l) => l.orderId === order.id && !l.isDeleted,
            );
            expect(line, 'checkout line for the Carprofen order').to.exist;
            cy.get(`#checkout-line-${line!.id} .soap-invoice-line-expand`, { timeout: 40000 }).then(($btn) => {
              if ($btn.attr('aria-expanded') !== 'true') cy.wrap($btn).click({ scrollBehavior: 'center' });
            });
          });
          cy.get('.soap-invoice-line-drawer.is-open .soap-checkout-invoice-rx-match', { timeout: 20000 }).should('exist');
        };
        // 1. The technician writes the directions on the SOAP.
        signInEmr('technician', soapPath(dog, clientId));
        cy.contains(dog.name, { timeout: 40000 });
        openRxDrawer();
        // A medication's drawer shows the checkout Rx form (VisitCheckoutPanel), not the dose-row form.
        cy.get('.soap-invoice-line-drawer.is-open .soap-checkout-invoice-rx-match').within(() => {
          cy.get('textarea').clear().type(sig);
          cy.contains('button', 'Save sig').click();
          cy.contains('.client-fin__entered', 'Entered by', { timeout: 20000 }).should('exist');
          cy.contains('label', 'refills').find('input').clear().type('2');
          cy.get('select[aria-label="Acute or chronic prescription"]').select('acute');
          cy.contains('label', 'Discard after').find('input[type="date"]').type(discardAfter);
          // 2. Two clicks (owner, Nov 6, 2026): Save sig, then Approve, which saves the refills,
          // acute/chronic and discard date with the script (rx.invoice.approve). No Save Rx for approvers.
          cy.contains('button', 'Save Rx').should('not.exist');
          cy.get('.client-fin__btn-approve').click();
          cy.contains('.client-fin__entered', 'Approved', { timeout: 20000 }).should('exist');
        });

        // The prescriber is the visit's vet, not the technician.
        emrSql(
          `SELECT "employee_Id" || '|' || instructions || '|' || refill FROM prescriptions WHERE "encounterOrderId" = '${order.id}' AND "isDeleted" = false`
        ).should('eq', `${w.employees.veterinarian}|${sig}|2`);

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
          openRxDrawer();
          cy.get('.soap-invoice-line-drawer.is-open .soap-checkout-invoice-rx-match').within(() => {
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
