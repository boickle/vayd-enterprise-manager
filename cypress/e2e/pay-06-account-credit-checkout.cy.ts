/// <reference types="cypress" />
import '../support/e2e';
import {
  addOrder,
  emrApi,
  emrSql,
  emrWorld,
  giveInvoiceItsShelf,
  openEncounter,
  signInEmr,
  soapPath,
  stubCardPayments,
  visitInvoice,
  type EmrHousehold,
} from '../support/emrCoreVisitWorld';

/**
 * PAY-06-10: a visit paid partly with account credit. The client has a $50 Scout credit ("Add
 * credit"); the $120 wellness visit takes $50 of credit at checkout and the rest by card.
 *
 * Seed with vayd-api's test/scripts/pay-06-e2e-seed.ts (its world JSON has the EMR core shape, so
 * the emrCoreVisitWorld helpers work):
 *   npx ts-node -T test/scripts/pay-06-e2e-seed.ts seed vayd_api_test_e2e /tmp/pay-06.json
 *   CYPRESS_EMR_CORE_WORLD="$(cat /tmp/pay-06.json)" CYPRESS_E2E_DB=vayd_api_test_e2e \
 *     npx cypress run --spec cypress/e2e/pay-06-account-credit-checkout.cy.ts
 * The API must use the same database with EVET_SYNC_ENABLED=false (eVet sync off).
 *
 * The card is the browser stub from stubCardPayments (records a card tender with a made-up
 * PaymentIntent): nothing reaches Stripe.
 */
type Pay06World = ReturnType<typeof emrWorld> & {
  households: { credit: EmrHousehold };
  scoutCreditInvoiceId: string;
};

describe('PAY-06-10: account credit at visit checkout', () => {
  it('applies $50 credit, the card pays $70, the bill is paid and the client has $0 credit', () => {
    const w = emrWorld() as unknown as Pay06World;
    const { clientId, pets } = w.households.credit;
    const [dog] = pets;
    stubCardPayments(dog);

    emrApi('practice_manager', 'GET', `/visit-invoices/client/${clientId}/account-credit?practiceId=${w.practiceId}`).then((c) => {
      expect(c.total).to.eq(50);
      expect(c.evetHeld).to.eq(false);
    });

    openEncounter(dog, clientId).then((enc) => {
      addOrder(enc.id, w.items.examId, 'Wellness exam', 120);
      giveInvoiceItsShelf(dog);
      visitInvoice(dog).then((inv) => expect(Number(inv.total)).to.eq(120));

      signInEmr('practice_manager', soapPath(dog, clientId, '/checkout'));
      cy.contains('h1', 'Checkout', { timeout: 30000 });
      cy.contains('button', 'Account credit', { timeout: 30000 }).should('not.be.disabled').click();
      cy.contains(/Account credit:\s*\$50\.00 available/, { timeout: 20000 });
      cy.get('input[aria-label="Account credit amount"]').should('have.value', '50.00');
      cy.contains('button', 'Apply credit').click();
      cy.contains(/Used \$50\.00 of account credit/, { timeout: 20000 });

      visitInvoice(dog).then((mid) => {
        expect(mid.status).to.not.eq('paid');
        expect(Number(mid.amountPaid)).to.eq(50);
      });

      // The rest on the card (stubbed: records a card tender for what is due).
      cy.contains('button', 'Card on file', { timeout: 30000 }).should('not.be.disabled').click();
      cy.contains(/Charged the card on file/i, { timeout: 30000 });

      visitInvoice(dog).then((inv) => {
        expect(inv.status).to.eq('paid');
        expect(Number(inv.amountPaid)).to.eq(120);
        const live = (inv.tenders ?? []).filter((t) => !t.voidedAt);
        expect(live.map((t) => [t.method, Number(t.amount)])).to.deep.eq([
          ['account_credit', 50],
          ['card', 70],
        ]);

        // The credit is used up: Scout credit invoice settled, nothing left to spend.
        emrSql(`SELECT status || ',' || ("amountPaid" - total)::numeric(10,2) FROM visit_invoices WHERE id = '${w.scoutCreditInvoiceId}'`).should(
          'eq',
          'paid,0.00',
        );
        emrApi('practice_manager', 'GET', `/visit-invoices/client/${clientId}/account-credit?practiceId=${w.practiceId}`).then((c) => {
          expect(c.total).to.eq(0);
        });

        // Billing workspace: the receipt lists both payments.
        signInEmr('practice_manager', `/schedule/clients?clientId=${clientId}&tab=financial&invoice=${inv.id}`);
        cy.get('.client-fin__paid-line', { timeout: 40000 }).filter(':contains("Account credit")').should('have.length', 1).and('contain', '$50.00');
        cy.get('.client-fin__paid-line').filter(':contains("$70.00")').should('have.length.at.least', 1);
      });
    });
  });
});
