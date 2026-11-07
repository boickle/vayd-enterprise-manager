/// <reference types="cypress" />
/** Probe for SR-02: started visit refused; HOLD needs no reason; Dr. Shah removing Dr. Lane's visit. */
import '../../support/e2e';
import { schedulingApi } from '../../support/schedulingWorld';
import { demoDay, dump, menuPick, openDemoDay, srBook } from './srKit';
const T = 'cypress/training-out/probe-text';
const save = (name: string, id: number) =>
  schedulingApi('cl', 'GET', `/appointments/${id}`).then((r) =>
    cy.writeFile(`${T}/${name}.txt`, JSON.stringify({ status: r.body.confirmStatusName, reason: r.body.cancellationReason, deleted: r.body.isDeleted }))
  );

describe('SR-02 remove', () => {
  beforeEach(() => demoDay());
  it.skip('started visit', () => {
    srBook('biscuit', 15, 0, 'recheck', 30, 'A', 'Started probe').then(({ id }) => {
      schedulingApi('doctorA', 'POST', `/appointments/${id}/actual-start`, {});
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Remove');
      cy.get('[role="dialog"] textarea').type('Client cancelled');
      cy.contains('[role="dialog"] button', 'Remove Visit').click();
      dump('sr02-started');
      save('sr02-started-saved', id);
    });
  });
  it.skip('HOLD', () => {
    srBook('juniper', 15, 30, 'hold', 30, 'A', 'Hold probe').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Scheduling', 'Remove');
      dump('sr02-hold-dialog');
      cy.contains('[role="dialog"] button', /Remove/).last().click();
      cy.wait(1500);
      save('sr02-hold-saved', id);
    });
  });
  it('Dr. Shah removes a Dr. Lane visit', () => {
    srBook('juniper', 16, 0, 'recheck', 30, 'A', 'Other doctor probe').then(({ id }) => {
      openDemoDay('doctorB');
      menuPick(id, 'Scheduling', 'Remove');
      cy.get('[role="dialog"] textarea').type('Shah probe');
      cy.contains('[role="dialog"] button', 'Remove Visit').click();
      cy.wait(1500);
      dump('sr02-shah', 'body');
      save('sr02-shah-saved', id);
    });
  });
});
