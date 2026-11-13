/// <reference types="cypress" />
/**
 * Setup helpers for the appointment deposit videos (INV-18, INV-19). TEST stack only. Runs before startClock().
 */
import { schedulingApi, schedulingWorld } from '../support/schedulingWorld';
import { sql } from './invKit';

const TZ = 'America/New_York';
export const ymdNy = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);

/** The next weekday after today, 10:00 am Eastern (as a UTC Date; Eastern is UTC-5 in November). */
export function nextWeekdayTen(): Date {
  const d = new Date();
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while ([0, 6].includes(new Date(`${ymdNy(d)}T12:00:00Z`).getUTCDay()));
  return new Date(`${ymdNy(d)}T15:00:00Z`);
}

/** Tom Chen back to "no deposit": flag off, no deposit bills, no credit left over from an earlier take. */
export function resetChenDeposits() {
  const w = schedulingWorld();
  const c = w.households.B.clientId;
  sql(`UPDATE clients SET "depositRequired"=false, "depositRequiredNote"=NULL, "depositRequiredByName"=NULL, "depositRequiredAt"=NULL, "doNotSms"=false, "smsOptOut"=false WHERE id=${c}`);
  sql(`UPDATE visit_invoices SET "isDeleted"=true WHERE "clientId"=${c} AND "isDeleted"=false`);
  // Pay-link texts an earlier take sent (they show in the client's message history).
  sql(`DELETE FROM client_communication_logs WHERE "communicationMessageLogId" IN (SELECT id FROM communication_message_logs WHERE "communicationTypeLabel"='Pay link text')`);
  sql(`DELETE FROM communication_message_logs WHERE "communicationTypeLabel"='Pay link text'`);
}

/** Marks Tom Chen "Deposit required" (as Robin Hale did in INV-19). */
export function flagChen(note = 'Two unpaid visits') {
  const w = schedulingWorld();
  sql(`UPDATE clients SET "depositRequired"=true, "depositRequiredNote"='${note}', "depositRequiredByName"='Robin Hale', "depositRequiredAt"=now() WHERE id=${w.households.B.clientId}`);
}

/** A wellness visit for Biscuit on the next weekday at 10 am. Yields the appointment id. */
export function bookBiscuit(start = nextWeekdayTen()) {
  const w = schedulingWorld();
  return schedulingApi<{ id: number }>('cl', 'POST', '/appointments', {
    practiceId: w.practiceId,
    primaryProviderId: w.doctors.A,
    clientId: w.households.B.clientId,
    patientId: w.households.B.petId,
    appointmentTypeId: w.types.medical,
    appointmentStart: start.toISOString(),
    appointmentEnd: new Date(start.getTime() + 60 * 60_000).toISOString(),
    description: 'Wellness exam',
    bookedViaRouting: true,
  }).then((res) => res.body.id);
}
