/// <reference types="cypress" />
/** Probe for SR-05: Explore alternatives, and a time change through Edit Appointment. */
import '../../support/e2e';
import { schedulingApi } from '../../support/schedulingWorld';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';

describe('SR-05 more', () => {
  beforeEach(() => resetDemo());
  it('explore alternatives', () => {
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Explore alternatives');
      cy.wait(4000);
      dump('sr05-explore', 'body');
      cy.screenshot('sr05-explore', { capture: 'viewport' });
    });
  });
  it('edit time same day', () => {
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Edit Appointment');
      cy.get('[role="dialog"] input[type="time"]').first().clear().type('11:30');
      cy.get('[role="dialog"] input[type="time"]').eq(1).clear().type('12:15');
      cy.wait(1500);
      dump('sr05-edit-changed');
      cy.contains('[role="dialog"] button', /^Save$/).click();
      cy.wait(2500);
      dump('sr05-edit-after', 'body');
      schedulingApi('cl', 'GET', `/appointments/${id}`).then((r) =>
        cy.writeFile('cypress/training-out/probe-text/sr05-edit-saved.txt', `${r.body.appointmentStart} ${r.body.appointmentEnd}`)
      );
    });
  });
});
