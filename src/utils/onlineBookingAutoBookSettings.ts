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
  /**
   * Hours before the first bookable slot, keyed by appointment type id.
   * Missing types use `existingClientLeadTimeHours`.
   */
  leadTimeHoursByAppointmentTypeId: Record<string, number>;
};

export function defaultOnlineBookingAutoBookSettings(): OnlineBookingAutoBookSettings {
  return {
    singlePatientMinutes: 45,
    multiPetPerPetMinutes: 30,
    newClientLeadTimeHours: 24,
    existingClientLeadTimeHours: 0,
    leadTimeHoursByAppointmentTypeId: {},
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

/** Appointment-type id → hours. Invalid entries are dropped. */
export function parseLeadTimeHoursByAppointmentTypeId(
  value: unknown,
): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const id = Number(key);
    if (!Number.isInteger(id) || id <= 0) continue;
    if (raw == null || raw === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) continue;
    out[String(id)] = Math.round(n);
  }
  return out;
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
    leadTimeHoursByAppointmentTypeId: parseLeadTimeHoursByAppointmentTypeId(
      obj.leadTimeHoursByAppointmentTypeId,
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

/** Lead time for one type, or the existing-client default when that type has none. */
export function leadTimeHoursForAppointmentType(
  settings: OnlineBookingAutoBookSettings,
  appointmentTypeId: number | null | undefined,
): number {
  const id = Number(appointmentTypeId);
  if (Number.isFinite(id) && id > 0) {
    const override = settings.leadTimeHoursByAppointmentTypeId[String(id)];
    if (override != null) return override;
  }
  return settings.existingClientLeadTimeHours;
}

/**
 * Existing-client lead time for a visit. Uses each pet's appointment type, and
 * the longest of those when the visit includes more than one type.
 */
export function resolveExistingClientLeadTimeHours(
  settings: OnlineBookingAutoBookSettings,
  visitPets?: readonly { appointmentTypeId?: number }[],
): number {
  const pets = (visitPets ?? []).filter((pet) => {
    const id = Number(pet.appointmentTypeId);
    return Number.isFinite(id) && id > 0;
  });
  if (pets.length === 0) return settings.existingClientLeadTimeHours;
  return Math.max(
    ...pets.map((pet) =>
      leadTimeHoursForAppointmentType(settings, Number(pet.appointmentTypeId)),
    ),
  );
}

export function resolveOnlineBookingLeadTimeHours(
  settings: OnlineBookingAutoBookSettings,
  visitPets?: readonly RoutingVisitPetInput[],
  isNewPatientRequest?: boolean,
): number {
  const typeLead = resolveExistingClientLeadTimeHours(settings, visitPets);
  if (
    isNewClientOrNewPatientVisit(visitPets, isNewPatientRequest) ||
    visitNeedsCalmingLeadTime(visitPets)
  ) {
    return Math.max(settings.newClientLeadTimeHours, typeLead);
  }
  return typeLead;
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
