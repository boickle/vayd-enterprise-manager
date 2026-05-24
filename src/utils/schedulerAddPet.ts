import { DateTime } from 'luxon';
import {
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
} from '../api/appointments';
import type { Appointment, Patient } from '../api/roomLoader';
import { extractPatientsFromClientPayload } from '../pages/SchedulerBookModal';
import { SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID } from './routingCalendarPreviewStorage';

type ClientPetRow = { id: number | string; name: string; isActive?: boolean; isDeleted?: boolean };

/** Support `patients[]` from API when present; otherwise single `patient`. */
export function patientsForAppointment(a: Appointment): Patient[] {
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) return multi;
  return a.patient ? [a.patient] : [];
}

/** Client visit with no linked patient (e.g. booked from routing without pets on file). */
export function appointmentHasNoPatient(a: Appointment): boolean {
  if (a.id === SCHEDULER_ROUTING_PREVIEW_SYNTHETIC_APPT_ID) return false;
  if (patientsForAppointment(a).length > 0) return false;
  if (isPracticeCalendarBlockAppointment(a)) return false;
  const typeLabel = [a.appointmentType?.prettyName, a.appointmentType?.name]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (typeLabel.includes('note to staff')) return false;
  const clientId =
    a.client?.id ?? (a as { clientId?: number | string | null }).clientId;
  return clientId != null && String(clientId).trim() !== '';
}

function isAppointmentVisible(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return true;
}

function isActiveClientPet(row: ClientPetRow): boolean {
  if (row.isDeleted === true) return false;
  if (row.isActive === false) return false;
  return true;
}

function appointmentInterval(a: Appointment): { start: number; end: number } | null {
  const s = DateTime.fromISO(a.appointmentStart, { zone: 'utc' });
  const e = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' });
  if (!s.isValid || !e.isValid) return null;
  return { start: s.toMillis(), end: e.toMillis() };
}

/** Overlap or back-to-back (touching) on the timeline — same “clump” as routing/household blocks. */
export function appointmentIntervalsClumped(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

function samePracticeDay(isoA: string, isoB: string, practiceTz: string): boolean {
  const a = DateTime.fromISO(isoA, { zone: 'utc' }).setZone(practiceTz);
  const b = DateTime.fromISO(isoB, { zone: 'utc' }).setZone(practiceTz);
  if (!a.isValid || !b.isValid) return false;
  return a.toISODate() === b.toISODate();
}

/**
 * All appointments in the anchor’s clump: same client, same day, connected by overlap or touching
 * (e.g. Sadie 10:15–10:40 and Tucker 10:40–11:10).
 */
export function appointmentsInClientVisitClump(
  anchor: Appointment,
  allAppointments: Appointment[],
  practiceTz: string
): Appointment[] {
  const clientId = anchor.client?.id;
  if (clientId == null) return [anchor];

  const cid = String(clientId);
  const candidates = allAppointments.filter((a) => {
    if (!isAppointmentVisible(a)) return false;
    if (a.allDay) return false;
    if (a.client?.id == null || String(a.client.id) !== cid) return false;
    return samePracticeDay(a.appointmentStart, anchor.appointmentStart, practiceTz);
  });

  const anchorInList = candidates.some((a) => a.id === anchor.id);
  const list = anchorInList ? candidates : [...candidates, anchor];

  const intervals = new Map<number, { start: number; end: number }>();
  for (const a of list) {
    const iv = appointmentInterval(a);
    if (iv) intervals.set(a.id, iv);
  }

  const anchorIv = intervals.get(anchor.id);
  if (!anchorIv) return [anchor];

  const cluster = new Set<number>([anchor.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of list) {
      if (cluster.has(a.id)) continue;
      const iv = intervals.get(a.id);
      if (!iv) continue;
      for (const cid2 of cluster) {
        const cIv = intervals.get(cid2);
        if (!cIv) continue;
        if (appointmentIntervalsClumped(iv.start, iv.end, cIv.start, cIv.end)) {
          cluster.add(a.id);
          grew = true;
          break;
        }
      }
    }
  }

  return list.filter((a) => cluster.has(a.id));
}

export function patientIdsInVisitClump(
  anchor: Appointment,
  allAppointments: Appointment[],
  practiceTz: string
): string[] {
  const out = new Set<string>();
  for (const a of appointmentsInClientVisitClump(anchor, allAppointments, practiceTz)) {
    for (const p of patientsForAppointment(a)) {
      if (p.id != null) out.add(String(p.id));
    }
  }
  return [...out];
}

export function excludePatientIdsForAddPet(
  anchorAppt: Appointment,
  allAppointments: Appointment[],
  practiceTz: string
): string[] {
  return patientIdsInVisitClump(anchorAppt, allAppointments, practiceTz);
}

/** Pets already in a timed visit overlapping this slot (same client) — omit from routing book picker. */
export function excludePatientIdsAtSlot(
  clientId: string,
  slotStartMs: number,
  slotEndMs: number,
  allAppointments: Appointment[]
): string[] {
  const cid = String(clientId);
  const out = new Set<string>();
  for (const a of allAppointments) {
    if (!isAppointmentVisible(a)) continue;
    if (a.allDay) continue;
    if (a.client?.id == null || String(a.client.id) !== cid) continue;
    const iv = appointmentInterval(a);
    if (!iv) continue;
    if (!appointmentIntervalsClumped(slotStartMs, slotEndMs, iv.start, iv.end)) continue;
    for (const p of patientsForAppointment(a)) {
      if (p.id != null) out.add(String(p.id));
    }
  }
  return [...out];
}

export function activeClientPetsFromPayload(payload: unknown): ClientPetRow[] {
  return extractPatientsFromClientPayload(payload).filter(isActiveClientPet);
}

export function hasAddPetChoices(clientPets: ClientPetRow[], excludePatientIds: string[]): boolean {
  const exclude = new Set(excludePatientIds.map(String));
  return clientPets.some((p) => !exclude.has(String(p.id)));
}

export function addPetMenuTitle(ready: boolean | null): string | undefined {
  if (ready === null) return 'Checking which pets can be added…';
  if (ready === false) {
    return 'Every pet for this client is already in this visit block on the schedule.';
  }
  return undefined;
}

export function appointmentSupportsAddPet(appt: Appointment): boolean {
  if (appt.allDay) return false;
  return appt.client?.id != null;
}
