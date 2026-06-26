import { DateTime } from 'luxon';
import { isAppointmentCancelledOnPracticeCalendar } from '../api/appointments';
import {
  fetchClientAppointmentsStaff,
  fetchPatientAppointmentsStaff,
} from '../api/pimsAppointments';
import type { Appointment } from '../api/roomLoader';
import {
  isFormGeneratedPetId,
  requestDataPreferredPatientIds,
  requestDataRequestedStartIso,
} from './appointmentRequestDisplay';
import { resolveRequestDataClientIdStaff } from './resolveRequestDataClientId';

function linkableAppointment(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return Boolean(a.appointmentStart?.trim());
}

function mergeAppointmentsById(...lists: Appointment[][]): Appointment[] {
  const byId = new Map<number, Appointment>();
  for (const list of lists) {
    for (const a of list) {
      const id = Number(a.id);
      if (Number.isFinite(id) && id > 0) byId.set(id, a);
    }
  }
  return [...byId.values()];
}

export async function fetchAppointmentRequestLinkCandidates(args: {
  requestData: Record<string, unknown>;
  practiceId: number;
  practiceTz: string;
}): Promise<{ appointments: Appointment[]; clientResolved: boolean }> {
  const { requestData, practiceId, practiceTz } = args;

  const clientId = await resolveRequestDataClientIdStaff(requestData);
  const clientResolved = Boolean(clientId);

  const requestedStartIso = requestDataRequestedStartIso(requestData);
  const rangeStartDay = requestedStartIso
    ? DateTime.fromISO(requestedStartIso, { zone: 'utc' }).setZone(practiceTz).startOf('day')
    : DateTime.now().setZone(practiceTz).startOf('day');
  const rangeStart = rangeStartDay.isValid ? rangeStartDay.toUTC().toISO()! : new Date().toISOString();
  const rangeEnd = rangeStartDay.plus({ years: 1 }).toUTC().toISO()!;
  const rangeStartMs = Date.parse(rangeStart);

  const params = { practiceId, start: rangeStart, end: rangeEnd };
  const lists: Appointment[][] = [];

  if (clientId) {
    try {
      const rows = await fetchClientAppointmentsStaff(clientId, {
        ...params,
        activePatientsOnly: false,
      });
      lists.push(rows);
    } catch {
      /* patient-scoped fetch may still return rows */
    }
  }

  const patientIds = [
    ...new Set(
      requestDataPreferredPatientIds(requestData).filter((id) => !isFormGeneratedPetId(id)),
    ),
  ];
  await Promise.all(
    patientIds.map(async (patientId) => {
      try {
        const rows = await fetchPatientAppointmentsStaff(patientId, {
          ...params,
          includeInactivePatient: true,
        });
        lists.push(rows);
      } catch {
        /* ignore per-patient failures */
      }
    }),
  );

  const filtered = mergeAppointmentsById(...lists)
    .filter(linkableAppointment)
    .filter((a) => {
      const startMs = Date.parse(a.appointmentStart);
      return Number.isFinite(startMs) && startMs >= rangeStartMs;
    })
    .sort((a, b) => Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart));

  return { appointments: filtered, clientResolved };
}
