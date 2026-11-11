/// <reference types="cypress" />
/**
 * Training video OSV-18: the Rx label and the bag label. TEST stack.
 * Setup: Juniper's thyroid order, paid and approved by Dr. Lane. Riley types the checker notes, opens the label
 * window and uses the print dialog; the print window is caught and the two labels are shown over the page.
 */
import '../support/e2e';
import { approvedThyroidOrder, look, press, resetStoreData, signIn } from './osvTraining';
import { catchPrintWindow, hidePrintedLabels, openOrder, resetRefills, showPrintedLabels } from './osvMailFlow';
import { finish, line, loadNarration, offCamera, startClock, tap, typeSlowly } from './trainingKit';

describe('Training: OSV-18 labels', () => {
  it('OSV-18', () => {
    let orderId = 0;
    loadNarration();
    resetStoreData();
    resetRefills();
    approvedThyroidOrder().then((id) => (orderId = Number(id)));
    signIn('mailteam', '/schedule/mail-orders');
    cy.contains('Mail Order Queue', { timeout: 40000 });
    cy.contains('button', /^Fill$/).click();
    cy.wait(2000);
    startClock();

    line('l01-why');
    line('l02-order', () => openOrder(() => orderId));
    line('l03-notes', () =>
      typeSlowly(() => cy.contains('label', 'Notes for the checker').find('textarea, input').first(), 'One bottle, lot TH24117.')
    );
    line('l04-print', () => press(() => cy.contains('button', 'Print Rx + bag labels').first()));
    line('l05-review', () => look(() => cy.contains('label', /^Directions/).parent(), 3500));
    line('l06-dymo', () => look(() => cy.contains('button', /Print on DYMO/), 3000));
    line('l07-dialog', () => {
      catchPrintWindow();
      tap(() => cy.contains('button', /Use system print dialog/));
    });
    offCamera(() => {
      showPrintedLabels();
      cy.wait(1500);
    });
    line('l08-rx', () => look(() => cy.get('.training-label-1 iframe'), 4000));
    line('l09-bag', () => look(() => cy.get('.training-label-2 iframe'), 5000));
    line('l10-where');
    line('l11-only', () => {
      hidePrintedLabels();
      cy.get('body').then(($b) => {
        const close = $b.find('[role="dialog"] button:contains("Close")');
        if (close.length) cy.wrap(close.last()).click();
      });
      look(() => cy.contains('button', /Bag label only/).first(), 3000);
    });
    line('l12-mistakes');
    line('l13-remember');
    finish();
  });
});
