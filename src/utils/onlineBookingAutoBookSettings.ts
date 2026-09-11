/**
 * Practice settings for online auto-book duration and lead time.
 * Mirrors vayd-api `online-booking-auto-book-settings.util.ts`.
 */
import { DateTime } from 'luxon';
import { practiceTimeZoneOrDefault } from './practiceTimezone';
import type { RoutingVisitPetInput } from './routingServiceMinutes';

export const ONLINE_BOOKING_AUTO_BOOK_SETTINGS_KEY =
  'onlineBooking.autoBookSettings';

export type OnlineBookingAutoBookSettings = {
  singlePatientMinutes: number;
  multiPetPerPetMinutes: number;
  newClientLeadTimeHours: number;
  existingClientLeadTimeHours: number;
};

export function defaultOnlineBookingAutoBookSettings(): OnlineBookingAutoBookSettings {
  return {
    singlePatientMinutes: 45,
    multiPetPerPetMinutes: 30,
    newClientLeadTimeHours: 24,
    existingClientLeadTimeHours: 0,
  };
}

function parseNonNegativeMinutes(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.round(n);
}

function parseNonNegativeHours(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n);
}

export function parseOnlineBookingAutoBookSettings(
  raw: unknown,
): OnlineBookingAutoBookSettings {
  const defaults = defaultOnlineBookingAutoBookSettings();
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return defaults;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaults;
  }
  const obj = parsed as Record<string, unknown>;
  return {
    singlePatientMinutes: parseNonNegativeMinutes(
      obj.singlePatientMinutes,
      defaults.singlePatientMinutes,
    ),
    multiPetPerPetMinutes: parseNonNegativeMinutes(
      obj.multiPetPerPetMinutes,
      defaults.multiPetPerPetMinutes,
    ),
    newClientLeadTimeHours: parseNonNegativeHours(
      obj.newClientLeadTimeHours,
      defaults.newClientLeadTimeHours,
    ),
    existingClientLeadTimeHours: parseNonNegativeHours(
      obj.existingClientLeadTimeHours,
      defaults.existingClientLeadTimeHours,
    ),
  };
}

export function serializeOnlineBookingAutoBookSettings(
  settings: OnlineBookingAutoBookSettings,
): string {
  return JSON.stringify(settings);
}

export function isNewClientOrNewPatientVisit(
  visitPets?: readonly RoutingVisitPetInput[],
  isNewPatientRequest?: boolean,
): boolean {
  if (isNewPatientRequest) return true;
  if (!visitPets?.length) return true;
  return visitPets.some((pet) => pet.isNewPatient === true);
}

export function resolveOnlineBookingLeadTimeHours(
  settings: OnlineBookingAutoBookSettings,
  visitPets?: readonly RoutingVisitPetInput[],
  isNewPatientRequest?: boolean,
): number {
  return isNewClientOrNewPatientVisit(visitPets, isNewPatientRequest)
    ? settings.newClientLeadTimeHours
    : settings.existingClientLeadTimeHours;
}

export function computeEarliestOnlineBookingDateTime(
  leadTimeHours: number,
  practiceTz?: string,
  now: DateTime = DateTime.now(),
): DateTime {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const hours = Math.max(0, Math.round(leadTimeHours));
  return now.setZone(tz).plus({ hours });
}

/** Bump YYYY-MM-DD start when it falls before the lead-time floor calendar day. */
export function bumpStartDateForLeadTime(
  startDate: string,
  leadTimeHours: number,
  practiceTz?: string,
  now: DateTime = DateTime.now(),
): string {
  const earliest = computeEarliestOnlineBookingDateTime(
    leadTimeHours,
    practiceTz,
    now,
  );
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const startCal = startDate.slice(0, 10);
  const earliestCal = earliest.setZone(tz).toISODate();
  if (!earliestCal || startCal >= earliestCal) return startDate;
  return earliestCal;
}

export function filterCandidatesAfterLeadTime<
  T extends { suggestedStartIso?: string | null; iso?: string | null },
>(
  candidates: readonly T[],
  earliest: DateTime,
): T[] {
  const earliestMs = earliest.toMillis();
  return candidates.filter((candidate) => {
    const iso = candidate.suggestedStartIso ?? candidate.iso;
    if (!iso?.trim()) return false;
    const dt = DateTime.fromISO(iso);
    if (!dt.isValid) return false;
    return dt.toMillis() >= earliestMs;
  });
}
