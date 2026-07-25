import { DateTime } from 'luxon';
import { fetchDoctorMonth } from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import {
  monthsCoveringRange,
  summarizeAvgMinutesByAppointmentType,
  type AvgMinutesByTypeRow,
} from '../analytics/appointmentTypeTimeStats';
import { normalizeAppointmentType } from '../analytics/appointmentTypeTimeStats';

export const ROUTING_FALLBACK_SERVICE_MINUTES = 45;
const ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS = 5;

function parseEnvNonNegativeInt(raw: unknown, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

/** Extra minutes for the first new patient in a visit (default 15). */
export const ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES = parseEnvNonNegativeInt(
  import.meta.env.VITE_ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES ??
    import.meta.env.VITE_ROUTING_NEW_PATIENT_DURATION_BUFFER_MINUTES,
  15,
);

/** Extra minutes for each additional new patient beyond the first (default 10). */
export const ROUTING_ADDITIONAL_NEW_PATIENT_DURATION_BUFFER_MINUTES = parseEnvNonNegativeInt(
  import.meta.env.VITE_ROUTING_ADDITIONAL_NEW_PATIENT_DURATION_BUFFER_MINUTES,
  10,
);

/** @deprecated Use {@link ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES} */
export const ROUTING_NEW_PATIENT_CLIENT_DURATION_BUFFER_MINUTES =
  ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES;

/** Extra minutes when the visit has more than {@link ROUTING_HOUSEHOLD_PET_COUNT_THRESHOLD} pets (default 20). */
export const ROUTING_HOUSEHOLD_DURATION_BUFFER_MINUTES = parseEnvNonNegativeInt(
  import.meta.env.VITE_ROUTING_HOUSEHOLD_DURATION_BUFFER_MINUTES,
  20,
);

/** Household buffer applies when pet count exceeds this value (default 2 → 3+ pets). */
export const ROUTING_HOUSEHOLD_PET_COUNT_THRESHOLD = parseEnvNonNegativeInt(
  import.meta.env.VITE_ROUTING_HOUSEHOLD_PET_COUNT_THRESHOLD,
  2,
);

export type RoutingServiceMinutesBufferOptions = {
  /** Count of new-to-practice patients in this visit (drives tiered new-patient buffer). */
  newPatientCount?: number;
  numPets?: number;
};

export function newPatientDurationBufferMinutes(newPatientCount: number): number {
  const n = Math.floor(Number(newPatientCount));
  if (!Number.isFinite(n) || n < 1) return 0;
  return (
    ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES +
    (n - 1) * ROUTING_ADDITIONAL_NEW_PATIENT_DURATION_BUFFER_MINUTES
  );
}

export function applyRoutingServiceMinuteBuffers(
  baseMinutes: number,
  opts?: RoutingServiceMinutesBufferOptions,
): number {
  let mins = Math.max(1, Math.round(baseMinutes));
  mins += newPatientDurationBufferMinutes(opts?.newPatientCount ?? 0);
  return mins;
}

export function routingVisitNewPatientCount(input: {
  isNewPatientRequest?: boolean;
  selectedPetIds?: readonly string[];
  newClientPets?: readonly unknown[];
  existingClientNewPets?: readonly unknown[];
}): number {
  if (input.isNewPatientRequest) {
    return routingVisitPetCount(input);
  }
  const newClient = input.newClientPets?.length ?? 0;
  const existingNew = input.existingClientNewPets?.length ?? 0;
  return newClient + existingNew;
}

/** @deprecated Prefer {@link routingVisitNewPatientCount} > 0 */
export function routingVisitIncludesNewPatients(opts: {
  isNewPatientRequest?: boolean;
  existingClientNewPetCount?: number;
}): boolean {
  if (opts.isNewPatientRequest) return true;
  return (opts.existingClientNewPetCount ?? 0) > 0;
}

export function routingVisitPetCount(input: {
  selectedPetIds?: readonly string[];
  newClientPets?: readonly unknown[];
  existingClientNewPets?: readonly unknown[];
}): number {
  const selected = input.selectedPetIds?.length ?? 0;
  const newClient = input.newClientPets?.length ?? 0;
  const existingNew = input.existingClientNewPets?.length ?? 0;
  if (selected > 0) return selected + existingNew;
  return Math.max(1, newClient + existingNew);
}

export type RoutingVisitPetInput = {
  appointmentTypeId: number;
  isNewPatient?: boolean;
};

export function buildRoutingVisitPetsFromFormData(
  formData: {
    selectedPetIds?: readonly string[];
    newClientPets?: readonly { id?: string }[];
    existingClientNewPets?: readonly { id?: string }[];
    petSpecificData?: Record<string, { appointmentTypeId?: number } | undefined>;
  },
  opts: {
    isNewPatientRequest: boolean;
    primaryAppointmentTypeId?: number;
  },
): RoutingVisitPetInput[] {
  const selectedIds = Array.isArray(formData.selectedPetIds) ? formData.selectedPetIds : [];
  const newClientPetIds = Array.isArray(formData.newClientPets)
    ? formData.newClientPets.map((p) => p.id).filter(Boolean)
    : [];
  const existingNewPetIds = Array.isArray(formData.existingClientNewPets)
    ? formData.existingClientNewPets.map((p) => p.id).filter(Boolean)
    : [];

  const petIds = [
    ...selectedIds,
    ...(newClientPetIds as string[]),
    ...(existingNewPetIds as string[]),
  ];

  const newPetIdSet = new Set<string>([
    ...(Array.isArray(formData.newClientPets)
      ? formData.newClientPets.map((p) => String(p.id ?? '').trim()).filter(Boolean)
      : []),
    ...(Array.isArray(formData.existingClientNewPets)
      ? formData.existingClientNewPets.map((p) => String(p.id ?? '').trim()).filter(Boolean)
      : []),
  ]);

  const visitPets: RoutingVisitPetInput[] = [];
  for (const petId of petIds) {
    const typeId =
      formData.petSpecificData?.[petId]?.appointmentTypeId ??
      opts.primaryAppointmentTypeId;
    if (typeId == null || !Number.isFinite(typeId) || typeId <= 0) continue;
    visitPets.push({
      appointmentTypeId: typeId,
      isNewPatient: opts.isNewPatientRequest || newPetIdSet.has(petId),
    });
  }

  if (visitPets.length === 0 && opts.primaryAppointmentTypeId != null) {
    visitPets.push({
      appointmentTypeId: opts.primaryAppointmentTypeId,
      isNewPatient: opts.isNewPatientRequest,
    });
  }

  return visitPets;
}

/** Unique appointment type ids for all pets in the visit (mixed-type households). */
export function resolveVisitAppointmentTypeIdsFromFormData(
  formData: {
    selectedPetIds?: readonly string[];
    newClientPets?: readonly { id?: string }[];
    existingClientNewPets?: readonly { id?: string }[];
    petSpecificData?: Record<string, { appointmentTypeId?: number } | undefined>;
  },
): number[] {
  const selectedIds = Array.isArray(formData.selectedPetIds) ? formData.selectedPetIds : [];
  const newClientPetIds = Array.isArray(formData.newClientPets)
    ? formData.newClientPets.map((p) => p.id).filter(Boolean)
    : [];
  const existingNewPetIds = Array.isArray(formData.existingClientNewPets)
    ? formData.existingClientNewPets.map((p) => p.id).filter(Boolean)
    : [];
  const petIds = [
    ...selectedIds,
    ...(newClientPetIds as string[]),
    ...(existingNewPetIds as string[]),
  ];
  const ids = new Set<number>();
  for (const petId of petIds) {
    const typeId = formData.petSpecificData?.[petId]?.appointmentTypeId;
    if (typeId != null && Number.isFinite(typeId) && typeId > 0) ids.add(typeId);
  }
  return [...ids];
}

export function resolveVisitAppointmentTypeIdsFromVisitPets(
  visitPets: readonly RoutingVisitPetInput[],
): number[] {
  const ids = new Set<number>();
  for (const pet of visitPets) {
    if (Number.isFinite(pet.appointmentTypeId) && pet.appointmentTypeId > 0) {
      ids.add(pet.appointmentTypeId);
    }
  }
  return [...ids];
}

export type RoutingServiceMinutesEstimateSource = 'stats' | 'default' | 'fallback' | 'mixed';

export type RoutingServiceMinutesEstimate = {
  serviceMinutes: number;
  baseMinutes: number;
  source: RoutingServiceMinutesEstimateSource;
};

/** Sum per-pet base minutes; same-type groups use multipet-aware stats. */
export function estimateRoutingServiceMinutesForVisit(
  visitPets: RoutingVisitPetInput[],
  apptLengthsRows: AvgMinutesByTypeRow[],
  resolveTypeById: (appointmentTypeId: number) => RoutingServiceMinutesTypeSource | undefined,
  resolveTypeByKey: (key: string) => RoutingServiceMinutesTypeSource | undefined,
  bufferOptions?: RoutingServiceMinutesBufferOptions,
): RoutingServiceMinutesEstimate {
  const pets = visitPets.filter(
    (p) => Number.isFinite(p.appointmentTypeId) && p.appointmentTypeId > 0,
  );
  const numPets = Math.max(1, pets.length);
  const newPatientCount =
    bufferOptions?.newPatientCount ??
    pets.filter((p) => p.isNewPatient).length;

  const estimateSingleTypeBase = (
    typeKey: string,
    count: number,
  ): { minutes: number; source: RoutingServiceMinutesEstimateSource } => {
    const matched = resolveTypeByKey(typeKey);
    const row = resolveRoutingApptStatsRow(typeKey, apptLengthsRows, matched);
    let mins: number | null = null;
    let source: RoutingServiceMinutesEstimateSource = 'fallback';
    if (row && routingApptTypeStatsMeetMinInstances(row)) {
      mins = estimatedServiceMinutesFromStatsRow(row, count);
      if (mins != null && mins >= 1) source = 'stats';
    }
    if (mins == null || mins < 1) {
      mins = defaultDurationMinutesForRoutingTypeSelection(matched, count);
      if (mins != null && mins >= 1) source = 'default';
    }
    if (mins == null || mins < 1) {
      mins = ROUTING_FALLBACK_SERVICE_MINUTES;
      source = 'fallback';
    }
    return { minutes: mins, source };
  };

  if (pets.length === 0) {
    const total = applyRoutingServiceMinuteBuffers(ROUTING_FALLBACK_SERVICE_MINUTES, {
      ...bufferOptions,
      newPatientCount,
      numPets: 1,
    });
    return {
      serviceMinutes: total,
      baseMinutes: ROUTING_FALLBACK_SERVICE_MINUTES,
      source: 'fallback',
    };
  }

  const typeIds = pets.map((p) => p.appointmentTypeId);
  const allSameType = typeIds.every((id) => id === typeIds[0]);

  let baseMinutes = 0;
  let source: RoutingServiceMinutesEstimateSource = 'fallback';

  if (allSameType) {
    const type = resolveTypeById(typeIds[0]!);
    const typeKey = appointmentTypeNameForRoutingStats(type);
    const result = estimateSingleTypeBase(typeKey, pets.length);
    baseMinutes = result.minutes;
    source = result.source;
  } else {
    let usedStats = false;
    for (const pet of pets) {
      const type = resolveTypeById(pet.appointmentTypeId);
      const typeKey = appointmentTypeNameForRoutingStats(type);
      const result = estimateSingleTypeBase(typeKey, 1);
      baseMinutes += result.minutes;
      if (result.source === 'stats') usedStats = true;
    }
    source = usedStats ? 'stats' : 'mixed';
  }

  const serviceMinutes = applyRoutingServiceMinuteBuffers(baseMinutes, {
    ...bufferOptions,
    newPatientCount,
    numPets,
  });

  return { serviceMinutes, baseMinutes, source };
}

export type PerPetRoutingMinutesEstimate = {
  baseMinutes: number;
  newPatientBufferMinutes: number;
  totalMinutes: number;
  positionLabel: 'single pet' | 'multi-pet';
};

export type PerPetRoutingVisitEstimate = {
  perPet: PerPetRoutingMinutesEstimate[];
  baseMinutes: number;
  newPatientBufferMinutes: number;
  serviceMinutes: number;
};

/**
 * One pet's base minutes from doctor stats. Rate depends on the whole visit:
 * single-pet visits use the type's single-pet avg; multi-pet visits use each
 * pet's type multi-pet avg (fallback: single avg → type default → fallback).
 */
function estimatePerPetBaseMinutes(
  isMultiPetVisit: boolean,
  appointmentTypeId: number,
  apptLengthsRows: AvgMinutesByTypeRow[],
  resolveTypeById: (appointmentTypeId: number) => RoutingServiceMinutesTypeSource | undefined,
): number {
  const type = resolveTypeById(appointmentTypeId);
  const typeKey = appointmentTypeNameForRoutingStats(type);
  const row = resolveRoutingApptStatsRow(typeKey, apptLengthsRows, type);
  const fallbackSingle = (): number =>
    defaultDurationMinutesForRoutingTypeSelection(type, 1) ?? ROUTING_FALLBACK_SERVICE_MINUTES;

  if (!isMultiPetVisit) {
    if (row && routingApptTypeStatsMeetMinInstances(row) && row.avgMinutes > 0) {
      return Math.round(row.avgMinutes);
    }
    return fallbackSingle();
  }

  if (row && routingApptTypeStatsMeetMinInstances(row)) {
    const mp = row.multipetAvgMinutes;
    if (mp != null && mp > 0) return Math.round(mp);
    if (row.avgMinutes > 0) return Math.round(row.avgMinutes);
  }
  return fallbackSingle();
}

/**
 * Per-pet visit duration from doctor timing history. A single-pet visit uses the
 * type's single-pet average; a multi-pet visit prices every pet at its type's
 * multi-pet average, plus tiered new-patient buffers.
 */
export function estimatePerPetRoutingMinutesForVisit(
  visitPets: RoutingVisitPetInput[],
  apptLengthsRows: AvgMinutesByTypeRow[],
  resolveTypeById: (appointmentTypeId: number) => RoutingServiceMinutesTypeSource | undefined,
  resolveTypeByKey: (key: string) => RoutingServiceMinutesTypeSource | undefined,
): PerPetRoutingVisitEstimate {
  // Keep every input pet so per-pet output stays index-aligned with the caller's pet list
  // (pets with an unresolved type fall back to default minutes rather than being dropped).
  const pets = [...visitPets];

  if (pets.length === 0) {
    const buffer = 0;
    const fallback = ROUTING_FALLBACK_SERVICE_MINUTES;
    return {
      perPet: [],
      baseMinutes: fallback,
      newPatientBufferMinutes: buffer,
      serviceMinutes: fallback,
    };
  }

  const newPatientIndices = pets
    .map((pet, index) => (pet.isNewPatient ? index : -1))
    .filter((index) => index >= 0);
  const totalBuffer = newPatientDurationBufferMinutes(newPatientIndices.length);
  const bufferByIndex = new Array<number>(pets.length).fill(0);
  newPatientIndices.forEach((petIndex, newOrdinal) => {
    bufferByIndex[petIndex] =
      newOrdinal === 0
        ? ROUTING_FIRST_NEW_PATIENT_DURATION_BUFFER_MINUTES
        : ROUTING_ADDITIONAL_NEW_PATIENT_DURATION_BUFFER_MINUTES;
  });

  const isMultiPetVisit = pets.length > 1;
  const perPet: PerPetRoutingMinutesEstimate[] = pets.map((pet, index) => {
    const baseMinutes = estimatePerPetBaseMinutes(
      isMultiPetVisit,
      pet.appointmentTypeId,
      apptLengthsRows,
      resolveTypeById,
    );
    const newPatientBufferMinutes = bufferByIndex[index] ?? 0;
    return {
      baseMinutes,
      newPatientBufferMinutes,
      totalMinutes: baseMinutes + newPatientBufferMinutes,
      positionLabel: isMultiPetVisit ? 'multi-pet' : 'single pet',
    };
  });

  const baseMinutes = perPet.reduce((sum, row) => sum + row.baseMinutes, 0);
  return {
    perPet,
    baseMinutes,
    newPatientBufferMinutes: totalBuffer,
    serviceMinutes: baseMinutes + totalBuffer,
  };
}

export type RoutingServiceMinutesTypeSource = Pick<
  AppointmentType,
  'id' | 'name' | 'prettyName' | 'defaultDuration'
>;

function routingApptTypeStatsMeetMinInstances(
  row: AvgMinutesByTypeRow,
  minInstances = ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS,
): boolean {
  return row.count + row.multipetCount >= minInstances;
}

function estimatedServiceMinutesFromStatsRow(row: AvgMinutesByTypeRow, pets: number): number | null {
  const n = Math.floor(Number(pets));
  const petCount = Number.isFinite(n) && n >= 1 ? n : 1;
  const hasSingle = row.count > 0 && row.avgMinutes > 0;
  const mp = row.multipetAvgMinutes;
  const hasMp = mp != null && mp > 0;

  if (petCount === 1) {
    if (hasSingle) return Math.round(row.avgMinutes);
    if (hasMp) return Math.round(mp);
    return null;
  }
  if (hasMp) return Math.round(mp * petCount);
  if (hasSingle) return Math.round(row.avgMinutes * petCount);
  return null;
}

function resolveRoutingApptStatsRow(
  typeKey: string,
  apptLengthsRows: AvgMinutesByTypeRow[],
  matchedType?: RoutingServiceMinutesTypeSource,
): AvgMinutesByTypeRow | undefined {
  const key = typeKey.trim();
  if (!key) return undefined;
  const statsByNorm = new Map<string, AvgMinutesByTypeRow>();
  for (const row of apptLengthsRows) {
    const norm = normalizeAppointmentType(row.typeName);
    if (norm) statsByNorm.set(norm, row);
  }
  const norm = normalizeAppointmentType(key);
  const prettyNorm = matchedType?.prettyName
    ? normalizeAppointmentType(String(matchedType.prettyName))
    : '';
  return (
    statsByNorm.get(norm) ??
    (prettyNorm ? statsByNorm.get(prettyNorm) : undefined) ??
    apptLengthsRows.find((row) => {
      const rowNorm = normalizeAppointmentType(row.typeName);
      return rowNorm === norm || (prettyNorm !== '' && rowNorm === prettyNorm);
    })
  );
}

function defaultDurationMinutesForRoutingTypeSelection(
  matchedType: RoutingServiceMinutesTypeSource | undefined,
  pets: number,
): number | null {
  const dur = matchedType?.defaultDuration != null ? Number(matchedType.defaultDuration) : NaN;
  if (!Number.isFinite(dur) || dur <= 0) return null;
  const petCount = Math.max(1, Math.floor(pets) || 1);
  return Math.round(dur * petCount);
}

/** 30-day doctor stats (≥5 visits), then type default duration, then fallback minutes. */
export function estimateRoutingServiceMinutesForSelection(
  typeKey: string,
  pets: number,
  apptLengthsRows: AvgMinutesByTypeRow[],
  resolveType: (key: string) => RoutingServiceMinutesTypeSource | undefined,
  bufferOptions?: RoutingServiceMinutesBufferOptions,
): number {
  const key = typeKey.trim();
  if (!key) {
    return applyRoutingServiceMinuteBuffers(ROUTING_FALLBACK_SERVICE_MINUTES, {
      ...bufferOptions,
      numPets: bufferOptions?.numPets ?? pets,
    });
  }
  const matched = resolveType(key);
  const row = resolveRoutingApptStatsRow(key, apptLengthsRows, matched);
  let mins: number | null = null;
  if (row && routingApptTypeStatsMeetMinInstances(row)) {
    mins = estimatedServiceMinutesFromStatsRow(row, pets);
  }
  if (mins == null || mins < 1) {
    mins = defaultDurationMinutesForRoutingTypeSelection(matched, pets);
  }
  if (mins == null || mins < 1) {
    mins = ROUTING_FALLBACK_SERVICE_MINUTES;
  }
  return applyRoutingServiceMinuteBuffers(mins, {
    ...bufferOptions,
    numPets: bufferOptions?.numPets ?? pets,
  });
}

export function appointmentTypeNameForRoutingStats(
  type: RoutingServiceMinutesTypeSource | undefined,
): string {
  return String(type?.name ?? '').trim();
}

/** Load last-30-day doctor appointment length stats (same source as Routing workspace). */
export async function fetchDoctorApptLengthStats(doctorId: string): Promise<AvgMinutesByTypeRow[]> {
  const trimmed = doctorId.trim();
  if (!trimmed) return [];
  const end = DateTime.now().startOf('day');
  const start = end.minus({ days: 29 });
  const startStr = start.toISODate()!;
  const endStr = end.toISODate()!;
  const months = monthsCoveringRange(startStr, endStr);
  const responses = await Promise.all(
    months.map(({ year, month }) => fetchDoctorMonth(year, month, trimmed)),
  );
  const allDays = responses.flatMap((r) => r.days ?? []);
  return summarizeAvgMinutesByAppointmentType(allDays, startStr, endStr, trimmed);
}
