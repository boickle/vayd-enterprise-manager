import { http } from './http';
import { DateTime } from 'luxon';
import {
  ROUTING_OFFERABLE_MAX_SCORE,
  resolveOfferableMaxScoreFromApi,
} from '../utils/routingOfferableScore';

export {
  ROUTING_OFFERABLE_MAX_SCORE,
  isRoutingScoreOfferable,
  /** @deprecated Use {@link ROUTING_OFFERABLE_MAX_SCORE}. */
  SELF_SCHEDULE_MAX_ROUTING_SCORE,
  /** @deprecated Use {@link isRoutingScoreOfferable}. */
  isRoutingScoreEligibleForSelfSchedule,
} from '../utils/routingOfferableScore';

export type EmailCheckResult = {
  exists: boolean;
  hasAccount: boolean;
  practiceId: number;
};

export type PublicProvider = {
  id: string | number;
  name: string;
  email?: string;
  imageUrl?: string | null;
  employeeId?: number | null;
  /** VAYD-managed profile copy from GET /employees (when included on vet payloads). */
  bio?: string | null;
};

/** A confirmed self-scheduled appointment slot chosen by the client. */
export type SelfScheduledSlot = {
  /** Doctor/provider ID (pimsId or internal id). */
  doctorId: string | number;
  doctorName: string;
  /** ISO 8601 start datetime. */
  appointmentStart: string;
  /** Human-readable display string (e.g. "Monday, June 16 at 10:00 AM"). */
  display: string;
  /** Appointment duration in minutes. */
  serviceMinutes: number;
  /** Customer arrival window start (ISO). */
  windowStartIso?: string;
  /** Customer arrival window end (ISO). */
  windowEndIso?: string;
  /** Client-facing window copy (e.g. "We will come between 10:00 AM and 12:00 PM"). */
  windowDisplay?: string;
};

export type AvailabilityRequest = {
  practiceId: number;
  startDate: string; // YYYY-MM-DD
  numDays: number;
  /** Legacy — omit when visitPets + doctorId are sent; server computes duration. */
  serviceMinutes?: number;
  address: string;
  /** Pre-geocoded latitude — preferred over address for routing accuracy. */
  lat?: number;
  /** Pre-geocoded longitude — preferred over address for routing accuracy. */
  lon?: number;
  allowOtherDoctors?: boolean;
  doctorId?: string | number; // Optional: specific doctor
  /** Required for online booking validation on POST /public/appointments/availability */
  appointmentTypeId?: number;
  /** Per-pet types for server-side routing duration (preferred over serviceMinutes). */
  visitPets?: RoutingVisitPetInput[];
  /** Selected existing pets (DB patients.id) — member elevated offer tier when any is a member. */
  patientIds?: number[];
};

export type RoutingVisitPetInput = {
  appointmentTypeId: number;
  isNewPatient?: boolean;
};

export type RoutingServiceMinutesResponse = {
  serviceMinutes: number;
  baseMinutes: number;
  newPatientBufferMinutes: number;
  householdBufferMinutes: number;
  source: 'stats' | 'default' | 'fallback' | 'mixed';
};

/**
 * Resolve routing service minutes for a household visit (doctor stats + buffers).
 * POST /public/appointments/routing-service-minutes
 */
export async function fetchRoutingServiceMinutes(request: {
  practiceId: number;
  doctorId: string | number;
  visitPets: RoutingVisitPetInput[];
}): Promise<RoutingServiceMinutesResponse> {
  const { data } = await http.post('/public/appointments/routing-service-minutes', request);
  return data as RoutingServiceMinutesResponse;
}

export type AvailabilitySlot = {
  date: string; // YYYY-MM-DD
  time: string; // HH:mm
  iso: string; // ISO datetime string
  display?: string; // Formatted display string
  doctorId?: string | number;
  doctorName?: string;
};

export type AvailabilityResponse = {
  slots?: AvailabilitySlot[];
  winner?: AvailabilitySlot;
  alternates?: AvailabilitySlot[];
};

/**
 * Check if an email exists and if it has an account
 * GET /public/appointments/check-email?email=user@example.com&practiceId=1
 */
export async function checkEmail(email: string, practiceId: number = 1): Promise<EmailCheckResult> {
  const { data } = await http.get('/public/appointments/check-email', {
    params: { email: email.trim().toLowerCase(), practiceId },
  });
  return data;
}

/**
 * Get list of available providers/doctors
 * GET /public/appointments/providers?practiceId=1
 */
export async function fetchPublicProviders(practiceId: number = 1): Promise<PublicProvider[]> {
  const { data } = await http.get('/public/appointments/providers', {
    params: { practiceId },
  });
  const rows: any[] = Array.isArray(data) ? data : (data?.items ?? data?.providers ?? []);
  
  return rows.map((r) => ({
    id: r.id ?? r.pimsId ?? r.employeeId,
    name: r.name ?? (`${r.firstName || ''} ${r.lastName || ''}`.trim() || `Provider ${r.id ?? ''}`),
    email: r?.email,
  }));
}

/**
 * Get list of available veterinarians (public endpoint)
 * GET /public/appointments/veterinarians?practiceId=1&address=...&lat=...&lon=...
 * @param practiceId Practice ID
 * @param address Optional address to filter veterinarians by service area
 * @param lat Optional latitude to filter veterinarians by service area
 * @param lon Optional longitude to filter veterinarians by service area
 */
export async function fetchPublicVeterinarians(
  practiceId: number = 1, 
  address?: string, 
  lat?: number, 
  lon?: number,
  /** When true, filter out vets that are not accepting new patients in the client's zone.
   *  Pass false for existing/returning clients — the new-patient restriction does not apply. */
  onlyAcceptingNew: boolean = false,
): Promise<PublicProvider[]> {
  const params: any = { practiceId };
  if (lat != null && lon != null && Number.isFinite(lat) && Number.isFinite(lon)) {
    params.lat = lat;
    params.lon = lon;
  } else if (address) {
    params.address = address;
  }
  
  const { data } = await http.get('/public/appointments/veterinarians', { params });
  const veterinarians: any[] = Array.isArray(data) ? data : (data?.items ?? data?.veterinarians ?? []);
  
  // For existing/returning clients the new-patient restriction does not apply — skip the filter.
  // For new clients, only include vets where the zone returned by the backend (already filtered
  // to the client's location) is accepting new patients. We require at least one zone to
  // explicitly accept new patients; vets with no zone data are included for backwards compat.
  const filteredVeterinarians = onlyAcceptingNew
    ? veterinarians.filter((v) => {
        if (!v.weeklySchedules || !Array.isArray(v.weeklySchedules)) {
          return true; // no zone data — include (backwards compat)
        }
        // Keep the vet only if at least one returned zone has acceptingNewPatients !== false
        return v.weeklySchedules.some((schedule: any) => {
          if (!schedule.zones || !Array.isArray(schedule.zones)) {
            return true; // schedule with no zone data — allow
          }
          return schedule.zones.some((zone: any) => zone.acceptingNewPatients !== false);
        });
      })
    : veterinarians;
  
  return filteredVeterinarians.map((v) => {
    const id = v.id ?? v.pimsId ?? v.employeeId;
    
    // Build name from title, firstName, lastName, and designation
    const nameParts: string[] = [];
    if (v.title) nameParts.push(v.title);
    if (v.firstName) nameParts.push(v.firstName);
    if (v.lastName) nameParts.push(v.lastName);
    if (v.designation) nameParts.push(v.designation);
    
    const name = nameParts.length > 0 
      ? nameParts.join(' ')
      : (`${v.firstName || ''} ${v.lastName || ''}`.trim() || `Veterinarian ${id ?? ''}`);
    
    return {
      id: id,
      name: name,
      email: v?.email,
      imageUrl: v?.imageUrl ?? null,
      employeeId: typeof id === 'number' ? id : (v.employeeId ?? null),
      bio: typeof v?.bio === 'string' && v.bio.trim() ? v.bio.trim() : null,
    };
  });
}

export type MonthAvailabilityCandidate = {
  date: string; // YYYY-MM-DD
  /** Exact ISO from availability API — use for form submit without reformatting */
  suggestedStartIso: string;
  /** Normalized ISO for calendar/time matching fallback */
  iso: string;
  display: string;
  doctorId?: string | number;
  doctorName?: string;
  windowStartIso?: string;
  windowEndIso?: string;
};

/**
 * Fetch all available slots for a doctor over a date range (for month calendar view).
 * Unlike fetchAvailability, this does not cap at 3 results.
 * POST /public/appointments/availability
 */
export async function fetchPublicMonthAvailability(request: AvailabilityRequest): Promise<MonthAvailabilityCandidate[]> {
  const { data } = await http.post('/public/appointments/availability', request);

  const rawCandidates: any[] = [];

  if (data?.candidates && Array.isArray(data.candidates)) {
    rawCandidates.push(...data.candidates);
  } else if (data?.slots && Array.isArray(data.slots)) {
    rawCandidates.push(...data.slots);
  } else {
    if (data?.winner) rawCandidates.push(data.winner);
    if (Array.isArray(data?.alternates)) rawCandidates.push(...data.alternates);
  }

  const maxScore = resolveOfferableMaxScoreFromApi(data ?? {});

  const results: MonthAvailabilityCandidate[] = [];
  for (const c of rawCandidates) {
    const score = c.score;
    if (score != null) {
      const n = Number(score);
      if (!Number.isFinite(n) || n > maxScore) continue;
    }

    const dt = c.suggestedStartIso
      ? DateTime.fromISO(c.suggestedStartIso)
      : c.iso
      ? DateTime.fromISO(c.iso)
      : null;
    if (!dt || !dt.isValid) continue;

    const suggestedStartIso =
      typeof c.suggestedStartIso === 'string' && c.suggestedStartIso.trim()
        ? c.suggestedStartIso.trim()
        : typeof c.iso === 'string' && c.iso.trim()
          ? c.iso.trim()
          : (dt.toISO() as string);

    const arrivalWindow = c.arrivalWindow ?? c.effectiveWindow;
    const windowStartIso =
      typeof arrivalWindow?.windowStartIso === 'string'
        ? arrivalWindow.windowStartIso.trim()
        : typeof arrivalWindow?.startIso === 'string'
          ? arrivalWindow.startIso.trim()
          : undefined;
    const windowEndIso =
      typeof arrivalWindow?.windowEndIso === 'string'
        ? arrivalWindow.windowEndIso.trim()
        : typeof arrivalWindow?.endIso === 'string'
          ? arrivalWindow.endIso.trim()
          : undefined;

    results.push({
      date: dt.toISODate() as string,
      suggestedStartIso,
      iso: dt.toISO() as string,
      display: dt.toFormat("cccc, LLLL d 'at' h:mm a"),
      doctorId: c.doctorId,
      doctorName: c.doctorName,
      windowStartIso,
      windowEndIso,
    });
  }
  return results;
}

/**
 * Get available appointment slots
 * POST /public/appointments/availability
 * 
 * Response format:
 * {
 *   "candidates": [...],
 *   "status": "OK"
 * }
 */
export async function fetchAvailability(request: AvailabilityRequest): Promise<AvailabilityResponse> {
  const { data } = await http.post('/public/appointments/availability', request);
  
  // Handle new format with candidates array
  if (data?.candidates && Array.isArray(data.candidates)) {
    // Convert candidates to slots format
    const slots: AvailabilitySlot[] = data.candidates.slice(0, 3).map((candidate: any) => {
      const candidateDt = candidate.suggestedStartIso 
        ? DateTime.fromISO(candidate.suggestedStartIso)
        : null;
      
      return {
        date: candidate.date || (candidateDt?.toISODate() || ''),
        time: candidateDt?.toFormat('HH:mm') || undefined,
        iso: candidate.suggestedStartIso || candidateDt?.toISO() || undefined,
        display: candidateDt 
          ? `${candidateDt.toFormat('EEE, MMM d')} at ${candidateDt.toFormat('h:mm a')}`
          : undefined,
        doctorId: candidate.doctorId,
        doctorName: candidate.doctorName,
      };
    });
    
    return {
      slots: slots,
      winner: slots[0] || undefined,
      alternates: slots.slice(1, 3) || [],
    };
  }
  
  // Normalize response - could be in different formats
  if (data?.slots && Array.isArray(data.slots)) {
    return {
      slots: data.slots,
      winner: data.winner,
      alternates: data.alternates,
    };
  }
  
  // If response has winner/alternates structure (like routing v2)
  if (data?.winner || Array.isArray(data?.alternates)) {
    const slots: AvailabilitySlot[] = [];
    if (data.winner) slots.push(data.winner);
    if (Array.isArray(data.alternates)) {
      slots.push(...data.alternates);
    }
    return {
      slots: slots.slice(0, 3), // Limit to 3
      winner: data.winner,
      alternates: data.alternates?.slice(0, 2) || [],
    };
  }
  
  // Fallback: return empty
  return { slots: [], alternates: [] };
}

export type AppointmentType = {
  id: number;
  isActive: boolean;
  isDeleted: boolean;
  pimsId: string;
  pimsType: string;
  name: string;
  prettyName: string;
  isBoardingType: boolean;
  hasExtraInstructions: boolean;
  defaultDuration: number;
  defaultStartTime: string;
  showInApptRequestForm: boolean;
  newPatientAllowed: boolean;
  formListOrder?: number | null;
  windowBeforeMinutes?: number | null;
  windowAfterMinutes?: number | null;
  isCalmingPremedType?: boolean;
  practice?: {
    id: number;
    isActive: boolean;
    isDeleted: boolean;
    pimsId: string;
    pimsType: string;
    name: string;
  };
};

/**
 * Get list of appointment types
 * GET /public/appointment-types?practiceId=1&showInApptRequestForm=true
 * @param practiceId Practice ID
 * @param showInApptRequestForm Filter to only show types that appear in appointment request form
 * @param newPatientAllowed Filter to only show types that allow new patients
 * @param isAuthenticated Whether the request is from an authenticated user (uses different endpoint)
 */
export async function fetchAppointmentTypes(
  practiceId: number = 1,
  showInApptRequestForm: boolean = true,
  newPatientAllowed?: boolean,
  isAuthenticated: boolean = false
): Promise<AppointmentType[]> {
  const endpoint = isAuthenticated ? '/appointment-types' : '/public/appointment-types';
  const params: any = { practiceId };
  
  if (showInApptRequestForm) {
    params.showInApptRequestForm = true;
  }
  
  if (newPatientAllowed !== undefined) {
    params.newPatientAllowed = newPatientAllowed;
  }
  
  const { data } = await http.get(endpoint, { params });
  const appointmentTypes: any[] = Array.isArray(data) ? data : (data?.items ?? data?.appointmentTypes ?? []);
  
  return appointmentTypes.map((type) => ({
    id: type.id,
    isActive: type.isActive,
    isDeleted: type.isDeleted,
    pimsId: type.pimsId,
    pimsType: type.pimsType,
    name: type.name,
    prettyName: type.prettyName || type.name,
    isBoardingType: type.isBoardingType || false,
    hasExtraInstructions: type.hasExtraInstructions || false,
    defaultDuration: type.defaultDuration,
    defaultStartTime: type.defaultStartTime,
    showInApptRequestForm: type.showInApptRequestForm || false,
    newPatientAllowed: type.newPatientAllowed || false,
    formListOrder: type.formListOrder ?? null,
    windowBeforeMinutes: type.windowBeforeMinutes ?? type.window_before_minutes ?? null,
    windowAfterMinutes: type.windowAfterMinutes ?? type.window_after_minutes ?? null,
    isCalmingPremedType:
      type.isCalmingPremedType === true ||
      type.is_calming_premed_type === true,
    practice: type.practice,
  }));
}

