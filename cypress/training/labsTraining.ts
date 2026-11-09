/// <reference types="cypress" />
/**
 * Shared setup for the Labs training videos (docs/training/scripts/labs/). TEST stack only: the
 * scheduling world with demo names, plus setup/labs-demo.sql (lab forms, catalog labs, Maple's eVet 4Dx).
 */
import { resetSeededHouseholdsInDb, schedulingWorld } from '../support/schedulingWorld';

type Role = 'cl' | 'technician' | 'manager' | 'doctorA' | 'doctorB';

/** Like schedulingApi, with a 60 s timeout (booking a visit runs routing and can take a while). */
export function labsApi<T = any>(
  role: Role,
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  path: string,
  body?: unknown,
  failOnStatusCode = true
): Cypress.Chainable<Cypress.Response<T>> {
  const w = schedulingWorld();
  return cy.request({
    method,
    url: `${Cypress.env('API_URL')}${path}`,
    headers: { Authorization: w.auth[role].Authorization },
    body: body as Cypress.RequestBody,
    failOnStatusCode,
    timeout: 60000,
  }) as Cypress.Chainable<Cypress.Response<T>>;
}
const schedulingApi = labsApi;

export const asList = (body: any): any[] => (Array.isArray(body) ? body : (body?.items ?? body?.data ?? []));

export function labsDb(): string {
  const db = String(Cypress.env('SCH_DB'));
  expect(db, 'CYPRESS_SCH_DB must be a vayd_api_test* database').to.match(/^vayd_api_test[A-Za-z0-9_]*$/);
  return db;
}

/** Resets the households, loads the Labs demo data and clears earlier takes' labs on the given pets. */
export function labsSetup(petIds: number[]) {
  const w = schedulingWorld();
  resetSeededHouseholdsInDb();
  cy.exec(`psql -q -d ${labsDb()} -v maple=${w.households.A.activePetIds[0]} -f cypress/training/setup/labs-demo.sql`);
  const ids = petIds.join(',');
  cy.exec(
    `psql -q -d ${labsDb()} -c "UPDATE in_house_lab_results SET \\"isDeleted\\"=true WHERE \\"patientId\\" IN (${ids}) AND \\"isDeleted\\"=false"`
  );
}

/** A catalog lab from labs-demo.sql by its pimsId suffix (glucose, 4dx, dip, fecal, cbc, ua). */
export function labId(key: string): Cypress.Chainable<number> {
  return cy
    .exec(`psql -qAt -d ${labsDb()} -c "SELECT id FROM labs WHERE \\"pimsId\\"='labs-train-${key}'"`)
    .then((r) => Number(r.stdout.trim()));
}

/** Today's visit for one pet with Dr. Avery Lane, and its SOAP; yields the appointment id. */
export function visitToday(o: { household: 'A' | 'B'; petId: number; startsMinutesAgo?: number; reason: string }) {
  const w = schedulingWorld();
  const mins = o.startsMinutesAgo ?? 60;
  const start = new Date(Math.floor((Date.now() - mins * 60_000) / (15 * 60_000)) * 15 * 60_000);
  const clientId = o.household === 'A' ? w.households.A.clientId : w.households.B.clientId;
  return schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
    practiceId: w.practiceId,
    primaryProviderId: w.doctors.A,
    clientId,
    patientId: o.petId,
    appointmentTypeId: w.types.medical,
    appointmentStart: start.toISOString(),
    appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
    description: o.reason,
    bookedViaRouting: true,
  }).then((res) => {
    const apptId = res.body.id;
    return schedulingApi<{ id: string }>('doctorA', 'POST', '/soap-encounters', {
      practiceId: w.practiceId,
      appointmentId: apptId,
      patientId: o.petId,
      clientId,
      mode: 'comprehensive',
    }).then((enc) =>
      schedulingApi('doctorA', 'PATCH', `/soap-encounters/${enc.body.id}`, {
        practiceId: w.practiceId,
        subjective: { history: o.reason },
      }).then(() => ({ apptId, encounterId: enc.body.id, clientId }))
    );
  });
}

export const soapPath = (apptId: number, petId: number, clientId: number) =>
  `/schedule/soap/${apptId}/${petId}?clientId=${clientId}`;
