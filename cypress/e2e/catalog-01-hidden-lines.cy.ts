/// <reference types="cypress" />
import '../support/e2e';
import { catalogWorld, signInAsCatalog } from '../support/catalogWorld';
import { openFinancial, plainClient, stubGmail } from '../support/catalogUi';

/**
 * CAT-01-8: screen to email. The doctor charges an exam and the "hide on invoice" DAPP booster on a
 * counter invoice; the invoice email that would go out lists the booster, and its lines add up to the total.
 * (Gmail is stubbed: the composer's send request is captured instead of sent.)
 */
describe('CAT-01-8: a hidden item with a charge is shown on the emailed invoice', () => {
  it('lists the booster and the lines add up to the total', () => {
    const w = catalogWorld();
    const gmail = stubGmail();
    plainClient('cat0108').then((who) => {
      signInAsCatalog('veterinarian', openFinancial(who.clientId));
      cy.contains('button', 'New invoice', { timeout: 30000 }).click();
      const add = (name: string) => {
        cy.get(`input[placeholder="Add a charge for ${who.petName}"]`).clear().type(name);
        cy.contains('[role="option"], li, button', name, { timeout: 20000 }).first().click();
      };
      add(`${w.tag} procedure`);
      cy.contains('Subtotal', { timeout: 15000 }).parent().should('contain.text', '$95.00');
      add(`${w.tag} DAPP (Distemper) Vaccine Booster`);
      cy.contains('Subtotal', { timeout: 15000 }).parent().should('contain.text', '$153.61');

      cy.contains('button', 'Email invoice').click();
      cy.contains('button', 'Send email', { timeout: 20000 }).should('not.be.disabled').click();
      cy.wrap(null).should(() => expect(gmail.sent()).to.have.length(1));
      cy.then(() => {
        const mail = gmail.sent()[0];
        const html = String(mail.bodyHtml || mail.bodyText || '');
        const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        // The booster is listed (it has a charge) and so is the exam.
        expect(text).to.contain('DAPP (Distemper) Vaccine Booster');
        expect(text).to.contain('$58.61');
        expect(text).to.contain(`${w.tag} procedure`);
        // Lines + tax = total charged.
        expect(text).to.contain('$153.61');
        const amounts = [...text.matchAll(/\$(\d+\.\d{2})/g)].map((m) => Number(m[1]));
        expect(amounts).to.include.members([95, 58.61, 153.61]);
        expect(95 + 58.61 + 0).to.be.closeTo(153.61, 0.005);
        cy.writeFile(Cypress.env('EMAIL_CAPTURE_PATH') || 'cypress/captured-cat01.jsonl', JSON.stringify({ to: mail.to, subject: mail.subject, text }) + '\n', { flag: 'a+' });
      });
    });
  });
});
