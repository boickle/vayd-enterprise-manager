import {
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
} from '../api/appointments';
import type { UnscheduledReminder } from '../api/careOutreach';
import type { Appointment } from '../api/roomLoader';
import {
  appointmentMatchesPatientId,
  fetchClientAppointmentsStaff,
  fetchPatientAppointmentsStaff,
} from '../api/pimsAppointments';
import { DateTime } from 'luxon';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

const CLIENT_FETCH_CONCURRENCY = 6;

/** Appointments that start on/after the practice-local start of the asOf day (includes rest of today). */
function isScheduledCountableAppointment(
  a: Appointment,
  dayStartMs: number,
): boolean {
  if (a.isDeleted === true || a.isActive === false) return false;
  if (a.allDay) return false;
  if (isPracticeCalendarBlockAppointment(a)) return false;
  if ((a as { isPersonalBlock?: boolean }).isPersonalBlock === true) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  const startMs = Date.parse(a.appointmentStart ?? '');
  return Number.isFinite(startMs) && startMs >= dayStartMs;
}

function practiceDayStartMs(asOfIso: string, practiceTz?: string): number {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const dt = DateTime.fromISO(asOfIso, { setZone: true });
  const instant = dt.isValid ? dt : DateTime.now();
  return instant.setZone(tz).startOf('day').toUTC().toMillis();
}

export function patientIdFromCareOutreachReminder(r: UnscheduledReminder): number | null {
  const id = r.patient?.id;
  if (id == null || !Number.isFinite(Number(id)) || Number(id) <= 0) return null;
  return Number(id);
}

export function clientIdFromCareOutreachReminder(r: UnscheduledReminder): string | null {
  const p = r.patient;
  if (!p) return null;
  const clients = p.clients;
  if (Array.isArray(clients)) {
    for (const c of clients) {
      if (c?.id != null && Number.isFinite(Number(c.id)) && Number(c.id) > 0) {
        return String(Number(c.id));
      }
    }
  }
  if (p.client?.id != null && Number.isFinite(Number(p.client.id)) && Number(p.client.id) > 0) {
    return String(Number(p.client.id));
  }
  return null;
}

function markPatientsWithScheduledAppointments(
  appts: readonly Appointment[],
  patientIds: ReadonlySet<number>,
  dayStartMs: number,
  blocked: Set<number>,
): void {
  for (const patientId of patientIds) {
    const pid = String(patientId);
    const hasScheduled = appts.some(
      (a) =>
        isScheduledCountableAppointment(a, dayStartMs) &&
        appointmentMatchesPatientId(a, pid),
    );
    if (hasScheduled) blocked.add(patientId);
  }
}

/**
 * Patient ids with a non-canceled visit starting today or later (any provider).
 * Used to hide individual pets from care outreach while leaving other household pets visible.
 */
export async function loadCareOutreachPatientIdsWithFutureAppointments(
  reminders: readonly UnscheduledReminder[],
  practiceId: number,
  opts?: { asOf?: string; practiceTz?: string },
): Promise<Set<number>> {
  const asOfIso = opts?.asOf?.trim() || new Date().toISOString();
  const dayStartMs = practiceDayStartMs(asOfIso, opts?.practiceTz);
  if (!Number.isFinite(dayStartMs)) return new Set();
  const startIso = new Date(dayStartMs).toISOString();

  const rangeEnd = new Date(asOfIso);
  rangeEnd.setUTCFullYear(rangeEnd.getUTCFullYear() + 2);
  const endIso = rangeEnd.toISOString();

  const patientsByClient = new Map<string, Set<number>>();
  const patientsWithoutClient: number[] = [];

  for (const r of reminders) {
    const patientId = patientIdFromCareOutreachReminder(r);
    if (patientId == null) continue;
    const clientId = clientIdFromCareOutreachReminder(r);
    if (!clientId) {
      patientsWithoutClient.push(patientId);
      continue;
    }
    let set = patientsByClient.get(clientId);
    if (!set) {
      set = new Set();
      patientsByClient.set(clientId, set);
    }
    set.add(patientId);
  }

  const blocked = new Set<number>();
  const clientIds = [...patientsByClient.keys()];

  for (let i = 0; i < clientIds.length; i += CLIENT_FETCH_CONCURRENCY) {
    const chunk = clientIds.slice(i, i + CLIENT_FETCH_CONCURRENCY);
    await Promise.all(
      chunk.map(async (clientId) => {
        const patientIds = patientsByClient.get(clientId);
        if (!patientIds || patientIds.size === 0) return;
        try {
          const appts = await fetchClientAppointmentsStaff(clientId, {
            practiceId,
            start: startIso,
            end: endIso,
            activePatientsOnly: false,
          });
          markPatientsWithScheduledAppointments(appts, patientIds, dayStartMs, blocked);
        } catch (err) {
          console.warn('[care-outreach] future appointment check failed for client', clientId, err);
        }
      }),
    );
  }

  const orphanIds = [...new Set(patientsWithoutClient)].filter((id) => !blocked.has(id));
  for (let i = 0; i < orphanIds.length; i += CLIENT_FETCH_CONCURRENCY) {
    const chunk = orphanIds.slice(i, i + CLIENT_FETCH_CONCURRENCY);
    await Promise.all(
      chunk.map(async (patientId) => {
        try {
          const appts = await fetchPatientAppointmentsStaff(patientId, {
            practiceId,
            start: startIso,
            end: endIso,
          });
          markPatientsWithScheduledAppointments(
            appts,
            new Set([patientId]),
            dayStartMs,
            blocked,
          );
        } catch (err) {
          console.warn('[care-outreach] future appointment check failed for patient', patientId, err);
        }
      }),
    );
  }

  return blocked;
}

export function filterCareOutreachRemindersWithoutFutureAppointments(
  reminders: readonly UnscheduledReminder[],
  blockedPatientIds: ReadonlySet<number>,
): UnscheduledReminder[] {
  if (blockedPatientIds.size === 0) return [...reminders];
  return reminders.filter((r) => {
    const pid = patientIdFromCareOutreachReminder(r);
    if (pid == null) return true;
    return !blockedPatientIds.has(pid);
  });
}
