/// <reference types="cypress" />
/**
 * SCH-15-5 (docs/test-plans/scheduling-and-routing.md in vayd-api): Remove on a visit whose chart has started
 * shows the API's message in the dialog and the visit stays on the calendar.
 *
 * NOT RUN YET. Seed the world (vayd-api test/scripts/scheduling-e2e-seed.ts, a vayd_api_test* database) and
 * export CYPRESS_SCHEDULING_WORLD, with the API running on that database.
 * "Started" is recorded the way the chart does it: POST /appointments/:id/actual-start.
 */
import '../support/e2e';
import { schedulingApi } from '../support/schedulingWorld';
import { bookVisit, openRemoveDialog } from '../support/schedulingRemove';

describe('SCH-15-5: a started visit cannot be removed from the Scheduler', () => {
  it('shows the started-visit message and keeps the visit', () => {
    bookVisit('SCH-15 e2e started', 10).then(({ id, ymd }) => {
      schedulingApi('doctorA', 'POST', `/appointments/${id}/actual-start`, {});
      openRemoveDialog(ymd, id);
      cy.get('[role="dialog"] textarea').type('Changed mind');
      cy.contains('[role="dialog"] button', 'Remove Visit').click();
      cy.contains(
        '[role="dialog"]',
        'This visit has been started. Finish or void it in the chart first.'
      ).should('be.visible');
      cy.get('[role="dialog"] button').contains('Cancel').click();
      cy.get(`[data-appt-id="${id}"]`).should('exist');
      schedulingApi('cl', 'GET', `/appointments/${id}`).then((res) => {
        expect(res.body.confirmStatusName).to.not.equal('Canceled Appointment');
        expect(res.body.isDeleted).to.not.equal(true);
      });
    });
  });
});
