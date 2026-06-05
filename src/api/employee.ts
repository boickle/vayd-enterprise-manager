import { http } from './http';

export type Provider = {
  id: string | number;
  name: string;
  email: string;
  pimsId?: string | number; // PIMS ID for API calls
  /** When present (from `/employees/providers`), used with lastName for formal display. */
  firstName?: string | null;
  lastName?: string | null;
  designation?: string | null;
  title?: string | null;
  dailyRevenueGoal?: number | null;
  bonusRevenueGoal?: number | null;
  dailyPointGoal?: number | null;
  weeklyPointGoal?: number | null;
  /** Set when lat/lon or address filters `/employees/veterinarians` to the client's zone. */
  seeingClientsInClientZone?: boolean;
  acceptingNewPatientsInClientZone?: boolean;
};

type VeterinarianWeeklyScheduleZone = {
  acceptingNewPatients?: boolean;
  zone?: { id?: number; name?: string | null } | null;
  zoneName?: string | null;
};

type VeterinarianWeeklySchedule = {
  zones?: VeterinarianWeeklyScheduleZone[] | null;
};

/** Short zone code for doctor-select badges, e.g. `3E` from `Zone 3E (Lewiston)`. */
export function formatDoctorSelectZoneLabel(rawName: string | null | undefined): string | null {
  const raw = (rawName ?? '').trim();
  if (!raw) return null;
  const m = raw.match(/^zone\s+([A-Za-z0-9]+)/i);
  if (m?.[1]) return m[1];
  return raw;
}

function zoneNameFromVeterinarianScheduleZone(z: VeterinarianWeeklyScheduleZone): string | null {
  const name = z?.zone?.name ?? z?.zoneName ?? null;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/** Client zone label from `/employees/veterinarians` when filtered by location. */
export function extractClientZoneLabelFromVeterinarians(veterinarians: readonly unknown[]): string | null {
  for (const v of veterinarians) {
    const schedules = (v as { weeklySchedules?: VeterinarianWeeklySchedule[] | null })?.weeklySchedules;
    if (!Array.isArray(schedules)) continue;
    for (const schedule of schedules) {
      const zones = schedule?.zones;
      if (!Array.isArray(zones)) continue;
      for (const z of zones) {
        const label = formatDoctorSelectZoneLabel(zoneNameFromVeterinarianScheduleZone(z));
        if (label) return label;
      }
    }
  }
  return null;
}

export type FetchVeterinariansResult = {
  providers: Provider[];
  /** Short label for the client's zone at the appointment location, e.g. `3E`. */
  clientZoneLabel: string | null;
};

/** Zone flags from `/employees/veterinarians` when the request includes client location. */
export function deriveVeterinarianClientZoneFlags(v: {
  weeklySchedules?: VeterinarianWeeklySchedule[] | null;
}): { seeingClients: boolean; acceptingNewPatients: boolean } {
  const schedules = v?.weeklySchedules;
  if (!Array.isArray(schedules) || schedules.length === 0) {
    return { seeingClients: false, acceptingNewPatients: false };
  }

  let seeingClients = false;
  let acceptingNewPatients = false;
  for (const schedule of schedules) {
    const zones = schedule?.zones;
    if (!Array.isArray(zones) || zones.length === 0) continue;
    for (const zone of zones) {
      seeingClients = true;
      if (zone.acceptingNewPatients === true) {
        acceptingNewPatients = true;
      }
    }
  }
  return { seeingClients, acceptingNewPatients };
}

function buildProviderName(r: any): string {
  const parts: string[] = [];
  if (r.firstName) parts.push(r.firstName);
  if (r.middleInitial || r.middleName) {
    const middle = r.middleInitial || (r.middleName ? r.middleName.charAt(0).toUpperCase() : '');
    if (middle) parts.push(middle);
  }
  if (r.lastName) parts.push(r.lastName);
  
  if (parts.length > 0) {
    return parts.join(' ').trim();
  }
  
  return r.name || `Provider ${r.id ?? ''}`;
}

export async function fetchPrimaryProviders(): Promise<Provider[]> {
  const { data } = await http.get('/employees/providers');
  const rows: any[] = Array.isArray(data) ? data : (data?.items ?? []);

  return rows.map((r) => {
    const emp = r.employee && typeof r.employee === 'object' ? r.employee : {};
    const firstName = r.firstName ?? emp.firstName ?? null;
    const lastName = r.lastName ?? emp.lastName ?? null;
    const designation =
      r.designation ?? r.credentials ?? emp.designation ?? emp.credentials ?? null;
    const title = r.title ?? emp.title ?? null;
    return {
      id: r.id ?? r.pimsId ?? r.employeeId,
      pimsId: r.pimsId ?? r.employee?.pimsId ?? r.id ?? r.employeeId, // Preserve pimsId for API calls
      email: r?.email,
      name: buildProviderName(r),
      firstName,
      lastName,
      designation,
      title,
      dailyRevenueGoal: r?.dailyRevenueGoal ?? null,
      bonusRevenueGoal: r?.bonusRevenueGoal ?? null,
      dailyPointGoal: r?.dailyPointGoal ?? null,
      weeklyPointGoal: r?.weeklyPointGoal ?? null,
    };
  });
}

/**
 * Fetch veterinarians from /employees/veterinarians endpoint
 * This endpoint returns only veterinarians (D.V.M/V.M.D)
 * @param address Optional address to filter veterinarians by service area
 * @param lat Optional latitude to filter veterinarians by service area
 * @param lon Optional longitude to filter veterinarians by service area
 */
export async function fetchVeterinarians(
  address?: string,
  lat?: number,
  lon?: number
): Promise<FetchVeterinariansResult> {
  const params: Record<string, string | number> = {};
  const hasCoords = lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon);
  if (hasCoords) {
    params.lat = lat;
    params.lon = lon;
  } else if (address?.trim()) {
    params.address = address.trim();
  }
  const hasLocationFilter = hasCoords || Boolean(params.address);

  const { data } = await http.get('/employees/veterinarians', { params });
  const veterinarians: any[] = Array.isArray(data) ? data : [];
  const active = veterinarians.filter((v) => v.isActive !== false);
  const clientZoneLabel = hasLocationFilter
    ? extractClientZoneLabelFromVeterinarians(active)
    : null;

  const providers = active.map((v) => {
    const pimsId = v.pimsId ? String(v.pimsId) : null;
    const id = v.id ?? v.pimsId;
    const zoneFlags = hasLocationFilter ? deriveVeterinarianClientZoneFlags(v) : null;

    return {
      id: id,
      pimsId: pimsId || String(id), // Use pimsId if available, otherwise use id
      email: v?.email || '',
      name: buildProviderName(v),
      dailyRevenueGoal: v?.dailyRevenueGoal ?? null,
      bonusRevenueGoal: v?.bonusRevenueGoal ?? null,
      dailyPointGoal: v?.dailyPointGoal ?? null,
      weeklyPointGoal: v?.weeklyPointGoal ?? null,
      seeingClientsInClientZone: zoneFlags?.seeingClients,
      acceptingNewPatientsInClientZone: zoneFlags?.acceptingNewPatients,
    };
  });

  return { providers, clientZoneLabel };
}
