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
   * Existing-client hours before the first bookable slot, keyed by appointment type id.
   * Missing types use `existingClientLeadTimeHours`.
   */
  leadTimeHoursByAppointmentTypeId: Record<string, number>;
  /**
   * New-client hours before the first bookable slot, keyed by appointment type id.
   * Missing types use `newClientLeadTimeHours`.
   */
  newClientLeadTimeHoursByAppointmentTypeId: Record<string, number>;
};

export function defaultOnlineBookingAutoBookSettings(): OnlineBookingAutoBookSettings {
  return {
    singlePatientMinutes: 45,
    multiPetPerPetMinutes: 30,
    newClientLeadTimeHours: 24,
    existingClientLeadTimeHours: 0,
    leadTimeHoursByAppointmentTypeId: {},
    newClientLeadTimeHoursByAppointmentTypeId: {},
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
    newClientLeadTimeHoursByAppointmentTypeId: parseLeadTimeHoursByAppointmentTypeId(
      obj.newClientLeadTimeHoursByAppointmentTypeId,
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

function leadHoursForType(
  byType: Record<string, number>,
  fallbackHours: number,
  appointmentTypeId: number | null | undefined,
): number {
  const id = Number(appointmentTypeId);
  if (Number.isFinite(id) && id > 0) {
    const override = byType[String(id)];
    if (override != null) return override;
  }
  return fallbackHours;
}

/**
 * Longest lead time among the visit's appointment types.
 * Types with no entry use `fallbackHours`.
 */
function resolveVisitLeadTimeHours(
  byType: Record<string, number>,
  fallbackHours: number,
  visitPets?: readonly { appointmentTypeId?: number }[],
): number {
  const pets = (visitPets ?? []).filter((pet) => {
    const id = Number(pet.appointmentTypeId);
    return Number.isFinite(id) && id > 0;
  });
  if (pets.length === 0) return fallbackHours;
  return Math.max(
    ...pets.map((pet) =>
      leadHoursForType(byType, fallbackHours, Number(pet.appointmentTypeId)),
    ),
  );
}

/** Existing-client lead time for one type, or the existing-client default when unset. */
export function leadTimeHoursForAppointmentType(
  settings: OnlineBookingAutoBookSettings,
  appointmentTypeId: number | null | undefined,
): number {
  return leadHoursForType(
    settings.leadTimeHoursByAppointmentTypeId,
    settings.existingClientLeadTimeHours,
    appointmentTypeId,
  );
}

/**
 * Existing-client lead time for a visit. Uses each pet's appointment type, and
 * the longest of those when the visit includes more than one type.
 */
export function resolveExistingClientLeadTimeHours(
  settings: OnlineBookingAutoBookSettings,
  visitPets?: readonly { appointmentTypeId?: number }[],
): number {
  return resolveVisitLeadTimeHours(
    settings.leadTimeHoursByAppointmentTypeId,
    settings.existingClientLeadTimeHours,
    visitPets,
  );
}

/**
 * New-client lead time for a visit. Uses each pet's appointment type, and
 * the longest of those when the visit includes more than one type.
 */
export function resolveNewClientLeadTimeHours(
  settings: OnlineBookingAutoBookSettings,
  visitPets?: readonly { appointmentTypeId?: number }[],
): number {
  return resolveVisitLeadTimeHours(
    settings.newClientLeadTimeHoursByAppointmentTypeId,
    settings.newClientLeadTimeHours,
    visitPets,
  );
}

export function resolveOnlineBookingLeadTimeHours(
  settings: OnlineBookingAutoBookSettings,
  visitPets?: readonly RoutingVisitPetInput[],
  isNewPatientRequest?: boolean,
  options?: { clientUploadedRecords?: boolean },
): number {
  const uploadedRecords = options?.clientUploadedRecords === true;
  if (
    visitNeedsCalmingLeadTime(visitPets) ||
    (!uploadedRecords &&
      isNewClientOrNewPatientVisit(visitPets, isNewPatientRequest))
  ) {
    return resolveNewClientLeadTimeHours(settings, visitPets);
  }
  return resolveExistingClientLeadTimeHours(settings, visitPets);
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
