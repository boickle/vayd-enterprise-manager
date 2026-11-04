/// <reference types="cypress" />
/**
 * SCH-03-4 (docs/test-plans/scheduling-and-routing.md in vayd-api): Remove in the Scheduler cancels the visit
 * with the typed reason (kept, not deleted) and it leaves the calendar.
 *
 * NOT RUN YET. Seed the world (vayd-api test/scripts/scheduling-e2e-seed.ts, a vayd_api_test* database) and
 * export CYPRESS_SCHEDULING_WORLD, with the API running on that database.
 * The Cancellations analytics screen is not driven here; the check is the saved row (confirm status and reason
 * read back through GET /appointments/:id), which is what the analytics count.
 */
import '../support/e2e';
import { schedulingApi } from '../support/schedulingWorld';
import { bookVisit, openRemoveDialog } from '../support/schedulingRemove';

describe('SCH-03-4: Remove in the Scheduler cancels with a reason', () => {
  it('keeps the visit as cancelled with the reason and drops it from the calendar', () => {
    bookVisit('SCH-03 e2e remove', 9).then(({ id, ymd }) => {
      openRemoveDialog(ymd, id);
      cy.get('[role="dialog"] textarea').type('Client sick');
      cy.contains('[role="dialog"] button', 'Remove Visit').click();
      cy.get('[role="dialog"].scheduler-modal--remove-visit').should('not.exist');
      cy.get(`[data-appt-id="${id}"]`).should('not.exist');
      schedulingApi('cl', 'GET', `/appointments/${id}`).then((res) => {
        expect(res.body.isDeleted).to.not.equal(true);
        expect(res.body.confirmStatusName).to.equal('Canceled Appointment');
        expect(res.body.cancellationReason).to.equal('Client sick');
      });
    });
  });
});
