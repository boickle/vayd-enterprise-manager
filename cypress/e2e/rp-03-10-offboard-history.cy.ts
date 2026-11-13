/// <reference types="cypress" />
import '../support/e2e';
import {
  addOrder,
  emrApi,
  emrSql,
  emrWorld,
  openEncounter,
  readyToSign,
  recordDoses,
  signChart,
  signInEmr,
} from '../support/emrCoreVisitWorld';

/**
 * RP-03-10 (written, not run): offboarding keeps history whole. docs/test-plans/roles-and-permissions.md
 * (vayd-api), owner spec RP-03 step 6.
 *
 * The seeded vet signs a SOAP with a rabies dose, then the practice manager offboards them (last day
 * yesterday, so it takes effect now). The signed record, the dose (vet name and license) and the visit's
 * provider still name the vet with the same license number. Reprinting the rabies certificate asks staff to
 * choose a current vet to sign, as it has since Sept 30 (owner decision (a), Nov 9, 2026).
 *
 * Seed: vayd-api test/scripts/emr-core-visit-seed.ts (see cypress/support/emrCoreVisitWorld.ts). This spec
 * deactivates the seeded vet, so run it alone, on a fresh seed, after the other EMR specs. Nothing reaches
 * Stripe or email.
 */
const yesterdayEastern = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(Date.now() - 864e5)
  );

describe('RP-03-10: history intact after Offboard', () => {
  // Tall window: the print dialog's notes sit below 720px.
  beforeEach(() => cy.viewport(1440, 2000));

  it("the vet's name and license stay on the record; a reprinted rabies certificate asks for a current vet", () => {
    const w = emrWorld();
    const { clientId, pets } = w.households.signoff;
    const [dog] = pets;
    const vet = w.employees.veterinarian;

    openEncounter(dog, clientId).then((enc) => {
      addOrder(enc.id, w.items.rabiesId, 'Rabies vaccine', 28);
      recordDoses(enc.id, 'R-0310');
      readyToSign(enc.id);
      signChart(enc.id);

      emrSql(`SELECT "licenseNumber" FROM employees WHERE id = ${vet}`).then((license) => {
        const before = `completed,${vet}`;
        emrSql(
          `SELECT status || ',' || coalesce("completedByEmployeeId"::text,'') FROM soap_encounters WHERE id = '${enc.id}'`
        ).should('eq', before);
        emrSql(
          `SELECT "veterinarianName" || '|' || coalesce("veterinarianLicense",'') FROM vaccination_logs WHERE "patientId" = ${dog.patientId} AND "isDeleted" = false ORDER BY id DESC LIMIT 1`
        ).then((doseBefore) => {
          // The practice manager offboards the vet; the last day is already over.
          emrApi('practice_manager', 'POST', `/employee-offboarding/${vet}`, {
            lastDay: yesterdayEastern(),
            taskToEmployeeId: w.employees.practice_manager,
          }).then((res: { completedAt: string | null }) => {
            expect(res.completedAt, 'offboarded now').to.be.a('string');
          });
          emrSql(`SELECT "isActive" FROM employees WHERE id = ${vet}`).should('eq', 'f');

          // History untouched.
          emrSql(
            `SELECT status || ',' || coalesce("completedByEmployeeId"::text,'') FROM soap_encounters WHERE id = '${enc.id}'`
          ).should('eq', before);
          emrSql(
            `SELECT "veterinarianName" || '|' || coalesce("veterinarianLicense",'') FROM vaccination_logs WHERE "patientId" = ${dog.patientId} AND "isDeleted" = false ORDER BY id DESC LIMIT 1`
          ).should('eq', doseBefore);
          emrSql(`SELECT "licenseNumber" FROM employees WHERE id = ${vet}`).should('eq', license);
          emrSql(
            `SELECT "primaryProviderId" FROM appointments WHERE id = ${dog.appointmentId}`
          ).should('eq', String(vet));

          // The manager opens the record and reprints the certificate.
          signInEmr('practice_manager', `/schedule/patients?patientId=${dog.patientId}`);
          cy.contains('button', 'Print document', { timeout: 40000 }).click();
          cy.contains('button', 'Rabies certificate').click();
          // Owner decision (a): a departed vet can't sign a new printing; staff choose a current vet.
          cy.contains('The veterinarian who administered this vaccine is no longer on staff')
            .scrollIntoView()
            .should('be.visible');
          cy.contains('label', 'Veterinarian')
            .find('select option')
            .should('not.contain.text', 'Emr veterinarian');
        });
      });
    });
  });
});
