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

/** Calming meds, muzzle, or extra handling use the new-patient lead time. */
export function visitNeedsCalmingLeadTime(
  visitPets?: readonly {
    needsCalmingMedications?: boolean;
    needsSpecialHandling?: boolean;
  }[],
): boolean {
  return !!visitPets?.some(
    (pet) => pet.needsCalmingMedications === true || pet.needsSpecialHandling === true,
  );
}

export function resolveOnlineBookingLeadTimeHours(
  settings: OnlineBookingAutoBookSettings,
  visitPets?: readonly RoutingVisitPetInput[],
  isNewPatientRequest?: boolean,
): number {
  return isNewClientOrNewPatientVisit(visitPets, isNewPatientRequest) ||
    visitNeedsCalmingLeadTime(visitPets)
    ? settings.newClientLeadTimeHours
    : settings.existingClientLeadTimeHours;
}

/**
 * Urgent and Soon limit the online calendar to that timeframe.
 * Other how-soon answers keep the open-ended search.
 */
export function onlineBookingHowSoonSearchEnd(
  howSoon: string | undefined,
  practiceTz?: string,
  now: DateTime = DateTime.now(),
): { endDate: string; endMillis: number } | null {
  const raw = howSoon?.trim();
  if (!raw) return null;
  const n = raw.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  const zoned = now.setZone(practiceTimeZoneOrDefault(practiceTz));
  if (n.includes('emergent') || n.includes('emergency')) {
    const end = zoned.plus({ hours: 24 });
    const endDate = end.toISODate();
    if (!endDate) return null;
    return { endDate, endMillis: end.toMillis() };
  }
  if (n.includes('urgent')) {
    const end = zoned.plus({ hours: 48 });
    const endDate = end.toISODate();
    if (!endDate) return null;
    return { endDate, endMillis: end.toMillis() };
  }
  if (n.startsWith('soon') || n.includes('this week') || n.includes('next few days')) {
    const end = zoned.endOf('week');
    const endDate = end.toISODate();
    if (!endDate) return null;
    return { endDate, endMillis: end.toMillis() };
  }
  return null;
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
