/// <reference types="cypress" />
/** Probe for SR-10 (Forward booking list) and SR-11 (Holds board). */
import '../../support/e2e';
import { includeSeededDoctorsInProviderList, schedulingApi, schedulingWorld, signInAsScheduling } from '../../support/schedulingWorld';
import { dump, resetDemo, srBook } from './srKit';

describe('SR-10/11', () => {
  before(() => {
    resetDemo();
    const w = schedulingWorld();
    schedulingApi('doctorA', 'POST', '/forward-bookings', {
      practiceId: w.practiceId, clientId: w.households.A.clientId, patientId: w.households.A.activePetIds[0],
      intervalAmount: 2, intervalUnit: 'weeks', appointmentTypeId: w.types.recheck, primaryProviderId: w.doctors.A,
      description: 'Recheck left hind leg', note: 'Call the cell; gate code 4412', createdVia: 'manual',
    });
    srBook('biscuit', 14, 0, 'hold', 45, 'A', 'Hold: new kitten exam, owner to confirm');
  });
  it.skip('Forward booking list', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/scheduling-tools/forward-booking');
    cy.wait(5000);
    dump('sr10-list', 'body');
    cy.screenshot('sr10-list', { capture: 'viewport' });
  });
  it('Holds board', () => {
    includeSeededDoctorsInProviderList();
    signInAsScheduling('cl', '/schedule/holds');
    cy.wait(5000);
    cy.contains('button', 'Open / convert').click();
    cy.wait(3000);
    dump('sr11-convert', 'body');
    cy.screenshot('sr11-convert', { capture: 'viewport' });
  });
});
