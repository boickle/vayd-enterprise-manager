/**
 * PRE-FIRST book: keep the new stop at the preview clock time and bump the former
 * first visit later (preview ETA / after new end) so My Day chronological order matches
 * the geographic route (avoids visit #2 + reverse geography / window warnings).
 */
import { DateTime } from 'luxon';
import {
  isAppointmentCancelledOnPracticeCalendar,
} from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { isFixedTimeTypeName } from './editVisitTimePreview';

export type PreFirstNeighborBumpTarget = {
  appointmentId: number;
  appointmentStart: string;
  appointmentEnd: string;
};

export type PreFirstBumpDriveSlot = {
  eta?: string | null;
  etd?: string | null;
  windowStartIso?: string | null;
  windowEndIso?: string | null;
};

/** Minimal day-data shape used to read preview ETA for the former-first stop. */
export type PreFirstBumpDayData = {
  households: { sourceAppointmentIds?: (string | number)[] }[];
  timeline: PreFirstBumpDriveSlot[];
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function isVisibleTimedAppt(a: Appointment): boolean {
  if (a.isDeleted === true) return false;
  if (a.isActive === false) return false;
  if (a.allDay) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  if (!a.appointmentStart?.trim() || !a.appointmentEnd?.trim()) return false;
  return true;
}

function appointmentTypeName(a: Appointment): string {
  return pickStr(a.appointmentType?.name) || pickStr(a.appointmentType?.prettyName) || '';
}

function samePracticeDay(isoA: string, isoB: string, practiceTz: string): boolean {
  const a = DateTime.fromISO(isoA, { zone: 'utc' }).setZone(practiceTz);
  const b = DateTime.fromISO(isoB, { zone: 'utc' }).setZone(practiceTz);
  if (!a.isValid || !b.isValid) return false;
  return a.toISODate() === b.toISODate();
}

function providerMatches(a: Appointment, providerId: string): boolean {
  const want = providerId.trim();
  if (!want) return false;
  const primary = a.primaryProvider?.id != null ? String(a.primaryProvider.id) : '';
  if (primary && primary === want) return true;
  const extras = a.additionalEmployees ?? [];
  return extras.some((e) => e?.id != null && String(e.id) === want);
}

/** Round up to the next 5-minute clock (practice-local wall time). */
export function roundUpDateTimeToNearest5Minutes(dt: DateTime): DateTime {
  if (!dt.isValid) return dt;
  const base = dt.set({ second: 0, millisecond: 0 });
  const rem = base.minute % 5;
  if (rem === 0 && dt.second === 0 && dt.millisecond === 0) return base;
  const add = rem === 0 ? 5 : 5 - rem;
  return base.plus({ minutes: add });
}

export function driveSlotForAppointmentId(
  dayData: PreFirstBumpDayData | null | undefined,
  appointmentId: number | string
): PreFirstBumpDriveSlot | null {
  if (!dayData) return null;
  const apptKey = String(appointmentId);
  const households = dayData.households ?? [];
  for (let j = 0; j < households.length; j++) {
    const ids = households[j]?.sourceAppointmentIds;
    if (!ids?.some((id) => String(id) === apptKey)) continue;
    return dayData.timeline[j] ?? null;
  }
  return null;
}

/**
 * Earliest timed visit on the provider-day (excluding ids), i.e. the stop that was
 * visit #1 before a PRE-FIRST book.
 */
export function findFormerFirstAppointmentForPreFirstBook(opts: {
  appointments: readonly Appointment[];
  providerId: string;
  dayIso: string;
  practiceTz: string;
  excludeAppointmentIds?: readonly number[];
}): Appointment | null {
  const exclude = new Set(
    (opts.excludeAppointmentIds ?? []).map((id) => Number(id)).filter((id) => Number.isFinite(id))
  );
  const dayRef = `${opts.dayIso}T12:00:00`;
  const candidates = opts.appointments
    .filter((a) => {
      if (!isVisibleTimedAppt(a)) return false;
      const id = Number(a.id);
      if (!Number.isFinite(id) || id <= 0 || exclude.has(id)) return false;
      if (!providerMatches(a, opts.providerId)) return false;
      if (!samePracticeDay(a.appointmentStart, dayRef, opts.practiceTz)) return false;
      if (isFixedTimeTypeName(appointmentTypeName(a))) return false;
      return true;
    })
    .sort(
      (a, b) =>
        Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart) ||
        Number(a.id) - Number(b.id)
    );
  return candidates[0] ?? null;
}

/**
 * Compute PATCH times for the former-first neighbor after a PRE-FIRST create.
 * Prefer preview chain ETA; otherwise place just after the new visit ends.
 * Never moves the neighbor earlier; clamps into the arrival window when known.
 */
export function resolvePreFirstNeighborBumpTarget(opts: {
  insertionIndex: number;
  suggestedStartIso: string;
  suggestedEndIso: string;
  practiceTz: string;
  providerId: string;
  appointments: readonly Appointment[];
  formerFirstDriveSlot?: PreFirstBumpDriveSlot | null;
  excludeAppointmentIds?: readonly number[];
}): PreFirstNeighborBumpTarget | null {
  if (!Number.isFinite(opts.insertionIndex) || Math.floor(opts.insertionIndex) !== 0) {
    return null;
  }

  const suggestedStart = DateTime.fromISO(opts.suggestedStartIso, { zone: 'utc' }).setZone(
    opts.practiceTz
  );
  const suggestedEnd = DateTime.fromISO(opts.suggestedEndIso, { zone: 'utc' }).setZone(
    opts.practiceTz
  );
  if (!suggestedStart.isValid || !suggestedEnd.isValid) return null;

  const dayIso = suggestedStart.toISODate();
  if (!dayIso) return null;

  const former = findFormerFirstAppointmentForPreFirstBook({
    appointments: opts.appointments,
    providerId: opts.providerId,
    dayIso,
    practiceTz: opts.practiceTz,
    excludeAppointmentIds: opts.excludeAppointmentIds,
  });
  if (!former) return null;

  const currentStart = DateTime.fromISO(former.appointmentStart, { zone: 'utc' }).setZone(
    opts.practiceTz
  );
  const currentEnd = DateTime.fromISO(former.appointmentEnd, { zone: 'utc' }).setZone(
    opts.practiceTz
  );
  if (!currentStart.isValid || !currentEnd.isValid) return null;

  const durationMs = Math.max(60_000, currentEnd.toMillis() - currentStart.toMillis());

  let targetStart = currentStart;
  const slot = opts.formerFirstDriveSlot;

  const previewEta = pickStr(slot?.eta);
  if (previewEta) {
    const etaDt = DateTime.fromISO(previewEta, { zone: 'utc' }).setZone(opts.practiceTz);
    if (etaDt.isValid && etaDt > targetStart) {
      targetStart = etaDt;
    }
  }

  // Clock order: neighbor must start after the new PRE-FIRST visit.
  const minAfterNew = roundUpDateTimeToNearest5Minutes(suggestedEnd);
  if (targetStart <= suggestedStart || targetStart < minAfterNew) {
    targetStart = minAfterNew;
  }
  if (targetStart <= suggestedStart) {
    targetStart = roundUpDateTimeToNearest5Minutes(suggestedStart.plus({ minutes: 5 }));
  }

  const winStartIso = pickStr(slot?.windowStartIso);
  const winEndIso = pickStr(slot?.windowEndIso);
  if (winStartIso) {
    const winStart = DateTime.fromISO(winStartIso, { zone: 'utc' }).setZone(opts.practiceTz);
    if (winStart.isValid && targetStart < winStart) targetStart = winStart;
  }
  if (winEndIso) {
    const winEnd = DateTime.fromISO(winEndIso, { zone: 'utc' }).setZone(opts.practiceTz);
    if (winEnd.isValid) {
      const latestStart = winEnd.minus({ milliseconds: durationMs });
      if (latestStart.isValid && targetStart > latestStart) {
        targetStart = latestStart;
      }
    }
  }

  targetStart = roundUpDateTimeToNearest5Minutes(targetStart);

  // After window clamp, still require a later clock than today — otherwise skip.
  if (targetStart <= currentStart) return null;
  // If clamp put us back at/before the new visit, we cannot safely bump.
  if (targetStart <= suggestedStart) return null;

  const targetEnd = targetStart.plus({ milliseconds: durationMs });
  const startIso = targetStart.toUTC().toISO();
  const endIso = targetEnd.toUTC().toISO();
  if (!startIso || !endIso) return null;

  return {
    appointmentId: Number(former.id),
    appointmentStart: startIso,
    appointmentEnd: endIso,
  };
}
