import { DateTime } from 'luxon';
import {
  isAppointmentCancelledOnPracticeCalendar,
  patchAppointment,
} from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { patientsForAppointment } from './schedulerAddPet';

/** Pets in the same household within this band of each other should stay time-aligned. */
export const HOUSEHOLD_TIME_ALIGN_BAND_MS = 2 * 60 * 60 * 1000;

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isVisibleAppt(a: Appointment): boolean {
  if (a.isDeleted === true) return false;
  if (a.isActive === false) return false;
  if (a.allDay) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return true;
}

function startMs(iso: string | null | undefined): number | null {
  if (!iso?.trim()) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function samePracticeDay(isoA: string, isoB: string, practiceTz: string): boolean {
  const a = DateTime.fromISO(isoA, { zone: 'utc' }).setZone(practiceTz);
  const b = DateTime.fromISO(isoB, { zone: 'utc' }).setZone(practiceTz);
  if (!a.isValid || !b.isValid) return false;
  return a.toISODate() === b.toISODate();
}

export function appointmentPatientLabel(a: Appointment): string {
  const pts = patientsForAppointment(a);
  if (pts.length > 0) {
    return pts
      .map((p) => pickStr(p.name) || `Pet ${p.id}`)
      .filter(Boolean)
      .join(', ');
  }
  return pickStr(a.description) || `Visit #${a.id}`;
}

/** True when start/end already match the target window (to the minute in practice TZ). */
export function appointmentTimesMatchWindow(
  a: Appointment,
  startIso: string,
  endIso: string,
  practiceTz: string
): boolean {
  const aStart = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const aEnd = DateTime.fromISO(a.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  const tStart = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  const tEnd = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(practiceTz);
  if (!aStart.isValid || !aEnd.isValid || !tStart.isValid || !tEnd.isValid) return false;
  return (
    aStart.toFormat('yyyy-MM-dd HH:mm') === tStart.toFormat('yyyy-MM-dd HH:mm') &&
    aEnd.toFormat('yyyy-MM-dd HH:mm') === tEnd.toFormat('yyyy-MM-dd HH:mm')
  );
}

/**
 * Same-client visits whose start is within ±band of `referenceStartIso`, on the same
 * practice calendar day as the reference (or absolute proximity within the band).
 */
export function findHouseholdVisitsInTimeBand(
  anchor: Appointment,
  allAppointments: readonly Appointment[],
  practiceTz: string,
  opts: {
    referenceStartIso: string;
    bandMs?: number;
  }
): Appointment[] {
  const clientId = anchor.client?.id;
  if (clientId == null) return [];

  const cid = String(clientId);
  const refMs = startMs(opts.referenceStartIso);
  if (refMs == null) return [];
  const band = opts.bandMs ?? HOUSEHOLD_TIME_ALIGN_BAND_MS;
  const anchorId = Number(anchor.id);

  return allAppointments.filter((a) => {
    if (!isVisibleAppt(a)) return false;
    if (Number(a.id) === anchorId) return false;
    if (a.client?.id == null || String(a.client.id) !== cid) return false;
    if (!a.appointmentStart?.trim()) return false;
    if (!samePracticeDay(a.appointmentStart, opts.referenceStartIso, practiceTz)) {
      // Still include if starts are within the band across midnight edge cases.
      const aMs = startMs(a.appointmentStart);
      if (aMs == null || Math.abs(aMs - refMs) > band) return false;
    } else {
      const aMs = startMs(a.appointmentStart);
      if (aMs == null || Math.abs(aMs - refMs) > band) return false;
    }
    return true;
  });
}

/** Household visits near the new slot that do not already match start/end. */
export function findHouseholdVisitsNeedingTimeAlign(
  anchor: Appointment,
  allAppointments: readonly Appointment[],
  practiceTz: string,
  newStartIso: string,
  newEndIso: string,
  bandMs = HOUSEHOLD_TIME_ALIGN_BAND_MS
): Appointment[] {
  // Consider both original and new start so moving away from a nearby sibling still offers align.
  const nearNew = findHouseholdVisitsInTimeBand(anchor, allAppointments, practiceTz, {
    referenceStartIso: newStartIso,
    bandMs,
  });
  const nearOld = findHouseholdVisitsInTimeBand(anchor, allAppointments, practiceTz, {
    referenceStartIso: anchor.appointmentStart,
    bandMs,
  });
  const byId = new Map<number, Appointment>();
  for (const a of [...nearOld, ...nearNew]) byId.set(Number(a.id), a);
  return [...byId.values()].filter(
    (a) => !appointmentTimesMatchWindow(a, newStartIso, newEndIso, practiceTz)
  );
}

/**
 * Co-visit “add another pet”: existing household pets in the ±2h band (including the anchor)
 * that do not already match the times being booked.
 */
export function findCoVisitHouseholdVisitsNeedingAlign(
  anchor: Appointment,
  allAppointments: readonly Appointment[],
  practiceTz: string,
  newStartIso: string,
  newEndIso: string,
  bandMs = HOUSEHOLD_TIME_ALIGN_BAND_MS
): Appointment[] {
  const others = findHouseholdVisitsNeedingTimeAlign(
    anchor,
    allAppointments,
    practiceTz,
    newStartIso,
    newEndIso,
    bandMs
  );
  const byId = new Map<number, Appointment>();
  for (const a of others) byId.set(Number(a.id), a);
  const anchorId = Number(anchor.id);
  if (Number.isFinite(anchorId) && anchorId > 0) {
    if (!appointmentTimesMatchWindow(anchor, newStartIso, newEndIso, practiceTz)) {
      byId.set(anchorId, anchor);
    }
  }
  return [...byId.values()];
}

/** Format a visit window for align-prompt copy (practice local). */
export function formatVisitWindowLabel(
  startIso: string,
  endIso: string,
  practiceTz: string
): string {
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  const end = DateTime.fromISO(endIso, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid || !end.isValid) return 'the new times';
  const day = start.toFormat('ccc LLL d');
  return `${day} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
}

/** PATCH sibling visits to the same scheduled start/end as the edited visit. */
export async function alignSiblingVisitScheduledTimes(opts: {
  siblings: readonly Appointment[];
  startIso: string;
  endIso: string;
  practiceId: number;
}): Promise<Appointment[]> {
  const updated: Appointment[] = [];
  for (const sibling of opts.siblings) {
    const id = Number(sibling.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    const row = await patchAppointment(
      id,
      {
        appointmentStart: opts.startIso,
        appointmentEnd: opts.endIso,
        /** Existing visit — skip manual-booking type permission gate. */
        bookedViaRouting: true,
      },
      { practiceId: opts.practiceId }
    );
    updated.push(row);
  }
  return updated;
}
