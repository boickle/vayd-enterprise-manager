/// <reference types="cypress" />
import '../../support/e2e';
import { dumpPage, PermKey, permWorld, signInAsPerm } from './permKit';

/** State licenses (owner, Nov 12, 2026). DEA numbers stay in Vet Snap. */
describe('Permissions probe: staff state licenses', () => {
  it('server: save, read, print number, and who may change them', () => {
    const p = permWorld();
    const api = Cypress.env('API_URL');
    const vet = p.staff.veterinarian.employeeId;
    const auth = (k: PermKey) => ({ Authorization: `Bearer ${p.staff[k].token}` });
    const lines: string[] = [];
    const licenses = [
      { kind: 'veterinary', state: 'me', number: 'VET-PROBE-1' },
      { kind: 'veterinary', state: 'NH', number: 'NH-77' },
    ];
    cy.request({ method: 'PUT', url: `${api}/employee-licenses/${vet}`, headers: auth('practice_admin'), body: { licenses } }).then((r) => {
      lines.push(`admin save: ${r.status} ${JSON.stringify(r.body.licenses)}`);
      expect(r.body.practiceState).to.match(/^[A-Z]{2}$/); // ME in production; the demo seed is in NC
      expect(r.body.licenses).to.have.length(2);
    });
    cy.request({ url: `${api}/employee-licenses?employeeId=${vet}`, headers: auth('technician') }).then((r) => {
      lines.push(`technician read: ${r.status} ${r.body.licenses.length} rows`);
      expect(r.body.licenses.map((l: { number: string }) => l.number)).to.include('NH-77');
    });
    cy.request({ url: `${api}/employees/${vet}`, headers: auth('practice_admin') }).then((r) => {
      lines.push(`employees.licenseNumber: ${r.body.licenseNumber}`);
      expect(r.body.licenseNumber).to.eq('VET-PROBE-1');
    });
    cy.request({
      method: 'PUT',
      url: `${api}/employee-licenses/${vet}`,
      headers: auth('practice_admin'),
      body: { licenses: [...licenses, { kind: 'veterinary', state: 'ME', number: 'X' }] },
      failOnStatusCode: false,
    }).then((r) => {
      lines.push(`second ME license: ${r.status} ${JSON.stringify(r.body.message)}`);
      expect(r.status).to.eq(400);
    });
    cy.request({
      method: 'PUT',
      url: `${api}/employee-licenses/${vet}`,
      headers: auth('practice_admin'),
      body: { licenses: [...licenses, { kind: 'dea', number: 'AB1234567' }] },
      failOnStatusCode: false,
    }).then((r) => {
      lines.push(`DEA number: ${r.status} ${JSON.stringify(r.body.message)}`);
      expect(r.status).to.eq(400);
    });
    for (const [k, want] of [['executive', 403], ['technician', 403], ['medical_director', 200]] as [PermKey, number][]) {
      cy.request({
        method: 'PUT',
        url: `${api}/employee-licenses/${vet}`,
        headers: auth(k),
        body: { licenses },
        failOnStatusCode: false,
      }).then((r) => {
        lines.push(`${k} save: ${r.status}`);
        expect(r.status, k).to.eq(want);
      });
    }
    cy.then(() => cy.writeFile(`${Cypress.env('PROBE_OUT')}/licenses.txt`, lines.join('\n') + '\n'));
  });

  it('Settings → Staff shows the list', () => {
    const p = permWorld();
    signInAsPerm('practice_admin', '/schedule/settings?tab=employee-directory');
    cy.contains('option', 'Select staff', { timeout: 90000 })
      .parent('select')
      .then(($s) => {
        const opt = Array.from(($s[0] as HTMLSelectElement).options).find((o) =>
          o.text.includes(p.staff.veterinarian.name),
        );
        expect(opt, 'vet in picker').to.exist;
        cy.wrap($s).select(opt!.value);
      });
    cy.contains('legend', 'State licenses', { timeout: 60000 }).scrollIntoView();
    cy.get('input[aria-label="License number"]', { timeout: 30000 }).should(($i) => {
      const values = Array.from($i).map((el) => (el as HTMLInputElement).value);
      expect(values).to.include.members(['VET-PROBE-1', 'NH-77']);
    });
    cy.wait(1000);
    dumpPage('licenses-settings');
    cy.screenshot('licenses-settings', { capture: 'viewport' });
  });
});
