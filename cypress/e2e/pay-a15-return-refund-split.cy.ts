/// <reference types="cypress" />
import '../support/e2e';
import {
  addOrder,
  emrApi,
  emrWorld,
  giveInvoiceItsShelf,
  openEncounter,
  signInEmr,
  visitInvoice,
  type EmrHousehold,
} from '../support/emrCoreVisitWorld';

/**
 * PAY-A15c (Wave 7): "Return & refund" on a bill paid partly with account credit. The bill is
 * 2 x $60 exam = $120, paid $50 account credit + $70 card. The screen refunds cards first, then
 * gives the rest back as account credit (the server's returnLines rule):
 *  - returning 1 exam ($60): all to the card, as before;
 *  - returning both ($120): "$70.00 to card, $50.00 back as account credit" (it used to refuse
 *    anything over the card's $70).
 *
 * Seed with vayd-api's test/scripts/pay-06-e2e-seed.ts (the $50 credit household):
 *   npx ts-node -T test/scripts/pay-06-e2e-seed.ts seed vayd_api_test_e2e /tmp/pay-06.json
 *   CYPRESS_EMR_CORE_WORLD="$(cat /tmp/pay-06.json)" CYPRESS_E2E_DB=vayd_api_test_e2e \
 *     npx cypress run --spec cypress/e2e/pay-a15-return-refund-split.cy.ts
 * The API must use the same database with EVET_SYNC_ENABLED=false.
 *
 * Nothing reaches Stripe: the card payment is recorded with a made-up PaymentIntent, and the
 * return request is answered by the browser (the server's split is covered by vayd-api's
 * pay-a15-account-credit-returns spec); this spec checks what the screen shows and sends.
 */
type Pay06World = ReturnType<typeof emrWorld> & { households: { credit: EmrHousehold } };

/** With CYPRESS_PAY_A15_SHOTS set: the return footer (refund total, payments, buttons) as a picture for the owner. */
const shot = (name: string) => {
  if (!Cypress.env('PAY_A15_SHOTS')) return;
  if (name.endsWith('confirm')) {
    cy.screenshot(name, { capture: 'viewport', overwrite: true });
    return;
  }
  // Picture only: the invoice pane scrolls on its own and runs past the window's right edge, so the
  // real return footer (same markup and styles) is lifted into a fixed box for the shot, then put back.
  cy.get('.client-fin__actions--stack').then(($el) => {
    const el = $el[0] as HTMLElement;
    el.dataset.shotStyle = el.getAttribute('style') || '';
    Object.assign(el.style, {
      position: 'fixed', top: '160px', left: '40px', width: '760px', zIndex: '99999',
      background: '#fff', padding: '24px', boxShadow: '0 4px 24px rgba(0,0,0,.18)', borderRadius: '10px',
    });
  });
  cy.screenshot(name, { capture: 'viewport', overwrite: true, clip: { x: 20, y: 140, width: 800, height: 420 } });
  cy.get('.client-fin__actions--stack').then(($el) => {
    const el = $el[0] as HTMLElement;
    el.setAttribute('style', el.dataset.shotStyle || '');
    delete el.dataset.shotStyle;
  });
};

describe('PAY-A15c: Return & refund splits card and account credit', () => {
  it('within the card: all to the card; above it: card first, the rest back as account credit', () => {
    const w = emrWorld() as unknown as Pay06World;
    const { clientId, pets } = w.households.credit;
    const [dog] = pets;
    cy.viewport(1920, 1080);

    openEncounter(dog, clientId).then((enc) => {
      addOrder(enc.id, w.items.examId, 'Wellness exam', 60, { qty: 2 });
      giveInvoiceItsShelf(dog);
      visitInvoice(dog).then((inv) => {
        expect(Number(inv.total)).to.eq(120);
        emrApi('practice_manager', 'POST', `/visit-invoices/${inv.id}/tenders`, {
          practiceId: w.practiceId,
          method: 'account_credit',
          amount: 50,
        });
        emrApi('practice_manager', 'POST', `/visit-invoices/${inv.id}/tenders`, {
          practiceId: w.practiceId,
          method: 'card',
          amount: 70,
          stripePaymentIntentId: `pi_paya15c_e2e_${Date.now()}`,
        });
        visitInvoice(dog).then((paid) => {
          expect(paid.status).to.eq('paid');

          let sent: { refundViaStripe?: boolean; items?: Array<{ qty: number }> } | null = null;
          cy.intercept('POST', `**/visit-invoices/${paid.id}/returns`, (req) => {
            sent = req.body;
            req.reply({ statusCode: 201, body: paid });
          }).as('returns');

          signInEmr('practice_manager', `/schedule/clients?clientId=${clientId}&tab=financial&invoice=${paid.id}`);
          cy.contains('button', 'Return items', { timeout: 40000 }).click();
          cy.contains('.client-fin__return-paid', 'Paid on this invoice', { timeout: 20000 })
            .should('contain', 'Account credit $50.00')
            .and('contain', '$70.00 can still go back to the card')
            .and('not.contain', 'then $50.00 back as account credit');

          // 1 of 2 exams: $60, inside the card's $70.
          cy.get('input[placeholder="≤ 2"]').first().clear().type('1');
          cy.contains('.client-fin__return-total', 'Refund total: $60.00');
          cy.contains('button', 'Refund $60.00 to card').should('not.be.disabled');
          cy.get('.client-fin__return-split').should('not.exist');
          shot('pay-a15-return-within-card');

          // Both exams: $120, more than the card's $70.
          cy.get('input[placeholder="≤ 2"]').first().clear().type('2');
          cy.contains('.client-fin__return-total', 'Refund total: $120.00');
          cy.contains('.client-fin__return-split', 'More than the card can take: $70.00 to card, $50.00 back as account credit.');
          cy.contains('button', 'Refund $120.00 ($70.00 to card, $50.00 back as account credit)')
            .should('not.be.disabled')
            .scrollIntoView();
          shot('pay-a15-return-above-card');
          cy.contains('button', 'Refund $120.00 ($70.00 to card, $50.00 back as account credit)').click();

          cy.get('[role="dialog"]', { timeout: 10000 }).within(() => {
            cy.contains('Return & refund?');
            cy.contains('Return the selected items and refund $120.00: $70.00 to card, $50.00 back as account credit.');
            cy.contains("to the client's card").should('not.exist');
          });
          shot('pay-a15-return-confirm');
          cy.get('[role="dialog"]').contains('button', 'Refund $120.00').click();

          cy.wait('@returns').then(() => {
            expect(sent?.refundViaStripe).to.eq(true);
            expect(sent?.items?.[0]?.qty).to.eq(2);
          });
          cy.contains('Returned items and refunded $120.00: $70.00 to card, $50.00 back as account credit.', { timeout: 20000 });
        });
      });
    });
  });
});
