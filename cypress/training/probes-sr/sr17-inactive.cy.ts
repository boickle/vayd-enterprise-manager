/// <reference types="cypress" />
/** Probe for SR-17: deactivating a pet lists and closes its scheduling items. */
import '../../support/e2e';
import { schedulingApi, schedulingWorld } from '../../support/schedulingWorld';
import { dump, menuPick, openDemoDay, resetDemo, srBook } from './srKit';
describe('SR-17', () => {
  it('deactivate Juniper', () => {
    resetDemo();
    const w = schedulingWorld();
    schedulingApi('doctorA', 'POST', '/forward-bookings', {
      practiceId: w.practiceId, clientId: w.households.A.clientId, patientId: w.households.A.activePetIds[1],
      intervalAmount: 1, intervalUnit: 'months', appointmentTypeId: w.types.recheck, primaryProviderId: w.doctors.A, createdVia: 'manual',
    });
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness').then(({ id }) => {
      openDemoDay('cl');
      menuPick(id, 'Patient', 'View Chart');
      cy.wait(5000);
      cy.contains('button', /^Deactivate$/).click({ force: true });
      cy.wait(3000);
      dump('sr17-deactivate');
      cy.screenshot('sr17-deactivate', { capture: 'viewport' });
    });
  });
});
