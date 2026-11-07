/// <reference types="cypress" />
/** Probe: which visits does Reschedule move? (a) Biscuit alone, end to end; (b) Juniper when Maple is also booked that day. */
import '../../support/e2e';
import { clearSeededHouseholdVisits, schedulingApi, schedulingWorld } from '../../support/schedulingWorld';
import { dump, menuPick, openDemoDay, srBook } from './srKit';
const T = 'cypress/training-out/probe-text';

function toResched(id: number, name: string) {
  openDemoDay('cl');
  menuPick(id, 'Scheduling', 'Reschedule');
  cy.contains('button', /^Get Best Route$/, { timeout: 20000 }).last().click();
  cy.wait(1500);
  cy.get('body').then(($b) => {
    if ($b.find('button:contains("Search anyway")').length) cy.contains('button', 'Search anyway').click();
  });
  cy.contains('button', 'View Placement', { timeout: 30000 }).first().click();
  cy.wait(2500);
  dump(`${name}-preview`, '.routing-reschedule-preview, [class*="preview"]');
  cy.contains('button', /^Reschedule$/).click();
  cy.wait(2000);
  dump(`${name}-modal`);
}
function saveVisits(name: string) {
  const w = schedulingWorld();
  const start = new Date(Date.now() - 864e5).toISOString();
  const end = new Date(Date.now() + 14 * 864e5).toISOString();
  schedulingApi<any>('cl', 'GET', `/appointments/range?practiceId=${w.practiceId}&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}&primaryProviderId=${w.doctors.A}`).then((r) => {
    const rows = (Array.isArray(r.body) ? r.body : r.body.items).map((a: any) => `${a.id} ${a.patient?.name ?? ''} ${a.appointmentStart} ${a.description}`);
    cy.writeFile(`${T}/${name}-visits.txt`, rows.join('\n'));
  });
}

describe('Reschedule scope', () => {
  it('Biscuit alone, confirmed', () => {
    clearSeededHouseholdVisits();
    srBook('biscuit', 11, 0, 'recheck', 45, 'A', 'Ear recheck').then(({ id }) => {
      toResched(id, 'sr05-biscuit');
      cy.contains('[role="dialog"] button', 'Reschedule appointment').click();
      cy.wait(3000);
      dump('sr05-biscuit-after', 'body');
      cy.screenshot('sr05-biscuit-after', { capture: 'viewport' });
      saveVisits('sr05-biscuit');
    });
  });

  it('Juniper with Maple booked the same day', () => {
    clearSeededHouseholdVisits();
    srBook('maple', 9, 0, 'medical', 60, 'A', 'Limping on the left hind leg');
    srBook('juniper', 13, 30, 'wellness', 60, 'A', 'Annual wellness').then(({ id }) => {
      toResched(id, 'sr05-juniper');
    });
  });
});
