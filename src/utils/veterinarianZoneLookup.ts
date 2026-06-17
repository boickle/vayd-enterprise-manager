import {
  extractClientZoneLabelFromVeterinarians,
  formatDoctorSelectZoneLabel,
  type FetchVeterinariansResult,
  type Provider,
} from '../api/employee';
import { http } from '../api/http';
import { resolveZoneForVeterinarianLookup } from '../api/zoneLookup';

type VeterinarianWeeklyScheduleZone = {
  acceptingNewPatients?: boolean;
  zoneId?: number;
  zone?: { id?: number; name?: string | null } | null;
  zoneName?: string | null;
};

type VeterinarianWeeklySchedule = {
  zones?: VeterinarianWeeklyScheduleZone[] | null;
};

type RawVeterinarian = {
  id?: number | string;
  pimsId?: number | string | null;
  firstName?: string | null;
  lastName?: string | null;
  middleInitial?: string | null;
  middleName?: string | null;
  name?: string | null;
  email?: string | null;
  isActive?: boolean;
  dailyRevenueGoal?: number | null;
  bonusRevenueGoal?: number | null;
  dailyPointGoal?: number | null;
  weeklyPointGoal?: number | null;
  weeklySchedules?: VeterinarianWeeklySchedule[] | null;
};

const VETERINARIANS_LOOKUP_TIMEOUT_MS = 30_000;
const VETERINARIANS_CACHE_MS = 5 * 60 * 1000;

let veterinariansCache: { fetchedAt: number; rows: RawVeterinarian[] } | null = null;

function zoneIdFromScheduleZone(z: VeterinarianWeeklyScheduleZone): number | null {
  const raw = z.zone?.id ?? z.zoneId;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

export function deriveVeterinarianZoneFlagsForZoneId(
  vet: RawVeterinarian,
  zoneId: number
): { seeingClients: boolean; acceptingNewPatients: boolean } {
  const schedules = vet?.weeklySchedules;
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return { seeingClients: false, acceptingNewPatients: false };
  }

  let seeingClients = false;
  let acceptingNewPatients = false;
  for (const schedule of schedules) {
    const zones = schedule?.zones;
    if (!Array.isArray(zones) || zones.length === 0) continue;
    for (const zone of zones) {
      if (zoneIdFromScheduleZone(zone) !== zoneId) continue;
      seeingClients = true;
      if (zone.acceptingNewPatients === true) acceptingNewPatients = true;
    }
  }
  return { seeingClients, acceptingNewPatients };
}

function buildProviderName(v: RawVeterinarian): string {
  const parts: string[] = [];
  if (v.firstName) parts.push(v.firstName);
  if (v.middleInitial || v.middleName) {
    const middle = v.middleInitial || (v.middleName ? v.middleName.charAt(0).toUpperCase() : '');
    if (middle) parts.push(middle);
  }
  if (v.lastName) parts.push(v.lastName);
  if (parts.length > 0) return parts.join(' ').trim();
  return v.name?.trim() || `Provider ${v.id ?? ''}`;
}

function mapRawVeterinariansForZone(
  veterinarians: RawVeterinarian[],
  zoneId: number,
  zoneLabel: string | null
): FetchVeterinariansResult {
  const active = veterinarians.filter((v) => v.isActive !== false);
  const inZone = active.filter((v) => deriveVeterinarianZoneFlagsForZoneId(v, zoneId).seeingClients);

  const providers: Provider[] = inZone.map((v) => {
    const pimsId = v.pimsId ? String(v.pimsId) : null;
    const id = v.id ?? v.pimsId;
    const zoneFlags = deriveVeterinarianZoneFlagsForZoneId(v, zoneId);
    return {
      id: id!,
      pimsId: pimsId || String(id),
      email: v?.email || '',
      name: buildProviderName(v),
      dailyRevenueGoal: v?.dailyRevenueGoal ?? null,
      bonusRevenueGoal: v?.bonusRevenueGoal ?? null,
      dailyPointGoal: v?.dailyPointGoal ?? null,
      weeklyPointGoal: v?.weeklyPointGoal ?? null,
      seeingClientsInClientZone: zoneFlags.seeingClients,
      acceptingNewPatientsInClientZone: zoneFlags.acceptingNewPatients,
    };
  });

  return {
    providers,
    clientZoneLabel: zoneLabel ?? extractClientZoneLabelFromVeterinarians(inZone),
  };
}

function mapAllVeterinarians(veterinarians: RawVeterinarian[]): FetchVeterinariansResult {
  const active = veterinarians.filter((v) => v.isActive !== false);
  const providers: Provider[] = active.map((v) => {
    const pimsId = v.pimsId ? String(v.pimsId) : null;
    const id = v.id ?? v.pimsId;
    return {
      id: id!,
      pimsId: pimsId || String(id),
      email: v?.email || '',
      name: buildProviderName(v),
      dailyRevenueGoal: v?.dailyRevenueGoal ?? null,
      bonusRevenueGoal: v?.bonusRevenueGoal ?? null,
      dailyPointGoal: v?.dailyPointGoal ?? null,
      weeklyPointGoal: v?.weeklyPointGoal ?? null,
    };
  });
  return { providers, clientZoneLabel: null };
}

async function fetchVeterinariansByZoneId(zone: {
  id: number;
  name: string;
}): Promise<FetchVeterinariansResult> {
  const zoneLabel = formatDoctorSelectZoneLabel(zone.name);
  const raw = await fetchAllVeterinariansRaw();
  return mapRawVeterinariansForZone(raw, zone.id, zoneLabel);
}

async function resolveLookupAddress(args: {
  address: string;
  lat?: number;
  lon?: number;
}): Promise<string> {
  const trimmed = args.address.trim();
  if (trimmed) return trimmed;

  const hasCoords =
    args.lat != null &&
    args.lon != null &&
    Number.isFinite(args.lat) &&
    Number.isFinite(args.lon);
  if (!hasCoords) return '';

  try {
    const { reverseGeocode } = await import('../api/geo');
    return (await reverseGeocode(args.lat!, args.lon!)).trim();
  } catch {
    return '';
  }
}
async function fetchAllVeterinariansRaw(): Promise<RawVeterinarian[]> {
  const now = Date.now();
  if (veterinariansCache && now - veterinariansCache.fetchedAt < VETERINARIANS_CACHE_MS) {
    return veterinariansCache.rows;
  }
  const { data } = await http.get<unknown>('/employees/veterinarians', {
    timeout: VETERINARIANS_LOOKUP_TIMEOUT_MS,
  });
  const rows = Array.isArray(data) ? (data as RawVeterinarian[]) : [];
  veterinariansCache = { fetchedAt: now, rows };
  return rows;
}

function veterinarianMatchesDoctorPimsId(v: RawVeterinarian, pimsId: string): boolean {
  const target = pimsId.trim();
  if (!target) return false;
  if (v.pimsId != null && String(v.pimsId) === target) return true;
  if (v.id != null && String(v.id) === target) return true;
  return false;
}

/** Whether the doctor has Assign Zone (seeing clients) for `zoneId`. `null` when unknown. */
export async function isDoctorAssignedToClientZone(
  doctorPimsId: string,
  zoneId: number
): Promise<boolean | null> {
  const target = doctorPimsId.trim();
  if (!target || !Number.isFinite(zoneId) || zoneId <= 0) return null;

  const veterinarians = await fetchAllVeterinariansRaw();
  const vet = veterinarians.find((v) => veterinarianMatchesDoctorPimsId(v, target));
  if (!vet) return null;
  return deriveVeterinarianZoneFlagsForZoneId(vet, zoneId).seeingClients;
}

export type RoutingDoctorZoneCheckResult = {
  zoneLabel: string | null;
  outOfZoneDoctorPimsIds: string[];
};

/**
 * Doctors selected for routing who lack Assign Zone (seeing clients) for the address zone.
 * Skips the check when the zone cannot be resolved.
 */
export async function findDoctorsNotAssignedToClientZone(args: {
  address: string;
  lat?: number;
  lon?: number;
  doctorPimsIds: string[];
  /** When already resolved for the address (e.g. routing form zone badge). */
  zoneId?: number;
  zoneLabel?: string | null;
}): Promise<RoutingDoctorZoneCheckResult> {
  const doctorPimsIds = [...new Set(args.doctorPimsIds.map((id) => id.trim()).filter(Boolean))];
  if (doctorPimsIds.length === 0) {
    return { zoneLabel: null, outOfZoneDoctorPimsIds: [] };
  }

  let zoneId: number | null = null;
  let zoneLabel: string | null = args.zoneLabel?.trim() || null;

  if (args.zoneId != null && Number.isFinite(args.zoneId) && args.zoneId > 0) {
    zoneId = args.zoneId;
  } else {
    const lookupAddress = await resolveLookupAddress(args);
    if (!lookupAddress) {
      return { zoneLabel: null, outOfZoneDoctorPimsIds: [] };
    }

    const resolved = await resolveZoneForVeterinarianLookup(lookupAddress);
    if (!resolved) {
      return { zoneLabel: null, outOfZoneDoctorPimsIds: [] };
    }

    zoneId = resolved.zone.id;
    zoneLabel = formatDoctorSelectZoneLabel(resolved.zone.name);
  }
  const veterinarians = await fetchAllVeterinariansRaw();
  const outOfZoneDoctorPimsIds: string[] = [];

  for (const pimsId of doctorPimsIds) {
    const vet = veterinarians.find((v) => veterinarianMatchesDoctorPimsId(v, pimsId));
    if (!vet) continue;
    const flags = deriveVeterinarianZoneFlagsForZoneId(vet, zoneId);
    if (!flags.seeingClients) outOfZoneDoctorPimsIds.push(pimsId);
  }

  return { zoneLabel, outOfZoneDoctorPimsIds };
}

export type VeterinariansForDoctorSelectResult = FetchVeterinariansResult & {
  usedNearestZone: boolean;
};

/**
 * Load veterinarians for routing's multi-doctor picker.
 * Resolves the client's zone (or nearest zone when out of area), then filters locally.
 * Avoids the slow `/employees/veterinarians?lat=&lon=` path for out-of-area addresses.
 */
export async function fetchVeterinariansForDoctorSelect(args: {
  address: string;
  lat?: number;
  lon?: number;
}): Promise<VeterinariansForDoctorSelectResult> {
  const lookupAddress = await resolveLookupAddress(args);

  if (lookupAddress) {
    const resolved = await resolveZoneForVeterinarianLookup(lookupAddress);
    if (resolved) {
      const result = await fetchVeterinariansByZoneId(resolved.zone);
      return { ...result, usedNearestZone: resolved.usedNearestZone };
    }
    const raw = await fetchAllVeterinariansRaw();
    return { ...mapAllVeterinarians(raw), usedNearestZone: false };
  }

  const raw = await fetchAllVeterinariansRaw();
  return { ...mapAllVeterinarians(raw), usedNearestZone: false };
}
