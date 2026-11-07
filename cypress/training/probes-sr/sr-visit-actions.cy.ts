/// <reference types="cypress" />
/** Probe (no voice) for SR-01, SR-02, SR-04, SR-05, SR-09: the visit menu's dialogs, by role. */
import '../../support/e2e';
import { schedulingApi } from '../../support/schedulingWorld';
import { demoDay, dump, menuPick, openDemoDay, srBook } from './srKit';

describe('SR visit actions', () => {
  beforeEach(() => demoDay());

  it('CL: view, edit, reschedule, alternatives, waitlist, remove', () => {
    srBook('maple', 15, 0, 'recheck', 30, 'A', 'Probe visit').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'View appointment');
      dump('sr01-view-appointment');
      cy.screenshot('sr01-view-appointment', { capture: 'viewport' });
      cy.get('body').type('{esc}');
      cy.get('[role="dialog"] button[aria-label="Close"]').click({ multiple: true, force: true });
      menuPick(id, 'Scheduling', 'Edit Appointment');
      dump('sr05-edit-visit');
      cy.get('[role="dialog"] button[aria-label="Close"]').first().click({ force: true });
      menuPick(id, 'Scheduling', 'Reschedule');
      cy.wait(2500);
      dump('sr05-reschedule', 'body');
      cy.screenshot('sr05-reschedule', { capture: 'viewport' });
    });
  });

  it('CL: explore alternatives and add to waitlist', () => {
    srBook('maple', 15, 0, 'recheck', 30, 'A', 'Probe visit').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Explore alternatives');
      cy.wait(2500);
      dump('sr05-explore', 'body');
      cy.screenshot('sr05-explore', { capture: 'viewport' });
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Add to waitlist');
      cy.wait(1500);
      dump('sr09-add-to-waitlist', 'body');
      cy.screenshot('sr09-add-to-waitlist', { capture: 'viewport' });
    });
  });

  it('CL: remove with a reason', () => {
    srBook('maple', 15, 0, 'recheck', 30, 'A', 'Probe visit').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Remove');
      dump('sr02-remove-dialog');
      cy.contains('[role="dialog"] button', 'Remove Visit').click();
      dump('sr02-remove-no-reason');
      cy.get('[role="dialog"] textarea').type('Client cancelled: Maple is feeling better');
      cy.contains('[role="dialog"] button', 'Remove Visit').click();
      cy.wait(1500);
      dump('sr02-after-remove', 'body');
      schedulingApi('cl', 'GET', `/appointments/${id}`).then((r) =>
        cy.writeFile(
          'cypress/training-out/probe-text/sr02-saved.txt',
          JSON.stringify({ status: r.body.confirmStatusName, reason: r.body.cancellationReason, deleted: r.body.isDeleted })
        )
      );
    });
  });

  it('Tech: remove a visit that is not theirs', () => {
    srBook('biscuit', 15, 0, 'recheck', 30, 'A', 'Probe visit tech').then(({ id }) => {
      openDemoDay('technician');
      menuPick(id, 'Scheduling', 'Remove');
      cy.get('[role="dialog"] textarea').type('Tech probe');
      cy.contains('[role="dialog"] button', 'Remove Visit').click();
      cy.wait(1500);
      dump('sr02-tech-remove', 'body');
      schedulingApi('cl', 'GET', `/appointments/${id}`).then((r) =>
        cy.writeFile(
          'cypress/training-out/probe-text/sr02-tech-saved.txt',
          JSON.stringify({ status: r.body.confirmStatusName, reason: r.body.cancellationReason, deleted: r.body.isDeleted })
        )
      );
    });
  });

  it('CL: + Appointment opens the Book screen', () => {
    openDemoDay('cl');
    cy.contains('a,button', '+ Appointment').first().click();
    cy.wait(2500);
    dump('sr03-plus-appointment', 'body');
    cy.screenshot('sr03-plus-appointment', { capture: 'viewport' });
  });
});
