// src/api/clientPortal.ts
import { http } from './http';

/** ---------- Types ---------- **/
export type Vaccination = {
  id: number;
  vaccineName: string;
  dateVaccinated: string; // ISO date string
  nextVaccinationDate?: string | null; // ISO date string
  vaccineExpiration?: string | null; // ISO date string
  tagNumber?: string | null;
  lotNumber?: string | null;
  manufacturer?: string | null;
  veterinarianName?: string | null;
  veterinarianLicense?: string | null;
  practiceName?: string | null;
  status: string; // e.g., "up to date", "expired"
  isCurrent: boolean;
};

export type Pet = {
  /** External-facing identifier you already use in the UI (historically PIMS-first). */
  id: string; // prefer PIMS id when available
  /** Internal database id for the patient (used for wellness plan lookups). */
  dbId?: string;
  clientId?: string | number | null;
  name: string;
  species?: string;
  breed?: string;
  dob?: string; // ISO
  subscription?: { id?: string; name?: string; status: 'active' | 'pending' | 'canceled' };
  primaryProviderName?: string | null;
  /** Pet image URL (uploaded by user) */
  photoUrl?: string | null;
  /** Vaccinations for this pet */
  vaccinations?: Vaccination[];

  /** Optional: attached from /wellness-plans?patientId=<DB id> */
  wellnessPlans?: WellnessPlan[];
};

function normalizeProviderName(raw: any): string | undefined {
  // Check direct string fields first
  const direct =
    typeof raw?.primaryProviderName === 'string' ? raw.primaryProviderName :
    typeof raw?.providerName === 'string' ? raw.providerName :
    typeof raw?.primaryVetName === 'string' ? raw.primaryVetName :
    typeof raw?.doctorName === 'string' ? raw.doctorName :
    typeof raw?.vetName === 'string' ? raw.vetName :
    undefined;

  if (direct && direct.trim()) return direct.trim();

  // Check nested object structures
  const src =
    raw?.primaryProvider ?? 
    raw?.provider ?? 
    raw?.primaryVet ?? 
    raw?.primaryDoctor ?? 
    raw?.doctor ?? 
    raw?.vet ??
    raw?.assignedDoctor ??
    raw?.assignedProvider ??
    null;

  if (src) {
    // Try name fields
    const nameLike =
      typeof src?.name === 'string' ? src.name :
      typeof src?.fullName === 'string' ? src.fullName :
      typeof src?.displayName === 'string' ? src.displayName :
      typeof src?.full_name === 'string' ? src.full_name :
      typeof src?.display_name === 'string' ? src.display_name :
      undefined;
    if (nameLike && nameLike.trim()) return nameLike.trim();

    // Try constructing from first/last name
    const first =
      src?.firstName ?? 
      src?.first_name ?? 
      src?.givenName ?? 
      src?.given_name ?? 
      src?.first ??
      undefined;
    const last = 
      src?.lastName ?? 
      src?.last_name ?? 
      src?.familyName ?? 
      src?.family_name ?? 
      src?.last ??
      undefined;
    const combined = [first, last].filter(Boolean).join(' ').trim();
    if (combined) return combined;
  }

  return undefined;
}

export type ClientAppointment = {
  id: string;
  clientName?: string | null;
  clientPimsId?: string | null;
  clientId?: number | string | null;
  client?: {
    id?: number | string | null;
    lat?: number | null;
    lon?: number | null;
    address1?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
    clientZone?: { id: string | number; name: string | null } | null;
  } | null;
  clientAlert?: any;

  patientName?: string | null;
  patientPimsId?: string | null;

  confirmStatusName?: string | null;

  lat?: number | null;
  lon?: number | null;
  routingAvailable?: boolean;

  startIso: string;
  endIso?: string;
  appointmentType?: any;
  appointmentTypeName?: string | null;

  address1?: string | null;
  city?: string | null;
  state?: string | null;
  zip?: string | null;

  description?: string | null;
  statusName?: string | null;

  isAlternateStop?: boolean;
  alternateAddressText?: string | null;

  clientZone?: { id: string | number; name: string | null } | null;
  effectiveZone?: { id: string | number; name: string | null } | null;
};

/** ---------- Wellness plan types (aligned with your /wellness-plans controller) ---------- **/
export type WellnessBenefit = {
  id?: string;
  name?: string;
  description?: string | null;
  limit?: {
    unit: 'count' | 'currency' | 'percent';
    value: number;
    period?: 'month' | 'year' | 'lifetime';
  } | null;
};

export type WellnessPlan = {
  id: string;
  name?: string | null;
  description?: string | null;
  patientId?: string | number | null;
  practiceId?: string | number | null;
  status?: 'active' | 'pending' | 'canceled' | 'expired';
  isActive?: boolean;
  monthlyPriceCents?: number | null;
  annualPriceCents?: number | null;

  // NEW:
  package?: { id?: string | number; name?: string | null };
  packageName?: string | null;

  benefits?: WellnessBenefit[] | any[] | null;
  [k: string]: any;
};

/* ----------------- internal normalizers ----------------- */
function normalizeWellnessPlan(p: any): WellnessPlan {
  const status: WellnessPlan['status'] =
    typeof p?.status === 'string' ? (p.status.toLowerCase() as WellnessPlan['status']) : undefined;

  const rawIsActive =
    p?.isActive ?? p?.active ?? p?.is_active ?? p?.Active ?? p?.isactive ?? undefined;

  const isActive =
    typeof rawIsActive === 'boolean'
      ? rawIsActive
      : typeof rawIsActive === 'string'
        ? ['true', '1', 'active'].includes(rawIsActive.toLowerCase())
        : typeof rawIsActive === 'number'
          ? rawIsActive === 1
          : status === 'active';

  return {
    id: String(p?.id ?? ''),
    name: p?.name ?? null,
    description: p?.description ?? null,
    patientId: p?.patient?.id ?? p?.patientId ?? null,
    practiceId: p?.practice?.id ?? p?.practiceId ?? null,
    status,
    isActive,
    monthlyPriceCents: p?.monthlyPriceCents ?? null,
    annualPriceCents: p?.annualPriceCents ?? null,
    // add these ↓↓↓
    package: p?.package ? { id: p.package.id, name: p.package.name ?? null } : undefined,
    packageName: p?.package?.name ?? null,
    benefits: Array.isArray(p?.benefits)
      ? p.benefits.map((b: any) => ({
          id: b?.id != null ? String(b.id) : (b?.code ?? undefined),
          name: b?.name,
          description: b?.description ?? null,
          limit: b?.limit ?? null,
        }))
      : (p?.benefits ?? null),
    ...p,
  };
}

/** ---------- Appointments for the logged-in client ----------
 * Controller: GET /appointments/client
 */
export async function fetchClientAppointments(): Promise<ClientAppointment[]> {
  const { data } = await http.get('/appointments/client');
  const rows: any[] = Array.isArray(data) ? data : (data?.appointments ?? data ?? []);

  return rows
    .map((a) => {
      // --- time ---
      const startIso =
        a?.startIso ?? (typeof a?.appointmentStart === 'string' ? a.appointmentStart : undefined);
      if (!startIso) return null;

      const endIso =
        a?.endIso ?? (typeof a?.appointmentEnd === 'string' ? a.appointmentEnd : undefined);

      // --- names/ids (prefer nested objects) ---
      const patientName = a?.patient?.name ?? a?.patientName ?? null;
      const patientPimsId = a?.patient?.pimsId ?? a?.patientPimsId ?? null;

      const clientName =
        a?.clientName ??
        (a?.client ? [a.client.firstName, a.client.lastName].filter(Boolean).join(' ') : null);
      const clientPimsId = a?.client?.pimsId ?? a?.clientPimsId ?? null;

      // --- location (pull from appointment first, then client) ---
      const lat =
        (typeof a?.lat === 'number' ? a.lat : undefined) ??
        (typeof a?.client?.lat === 'number' ? a.client.lat : undefined);
      const lon =
        (typeof a?.lon === 'number' ? a.lon : undefined) ??
        (typeof a?.client?.lon === 'number' ? a.client.lon : undefined);
      const routingAvailable =
        a?.routingAvailable ?? (typeof lat === 'number' && typeof lon === 'number');

      const address1 =
        a?.address1 ?? a?.address ?? a?.client?.address1 ?? a?.client?.address ?? null;
      const city = a?.city ?? a?.client?.city ?? null;
      const state = a?.state ?? a?.client?.state ?? null;
      const zip = a?.zip ?? a?.zipcode ?? a?.client?.zip ?? a?.client?.zipcode ?? null;

      // --- type & status (backend has these null; give a friendly default) ---
      const appointmentTypeName = a?.appointmentTypeName ?? a?.appointmentType?.name ?? null;
      const statusName = a?.statusName ?? a?.confirmStatusName ?? 'Scheduled';

      return {
        id: String(a?.id ?? ''),
        clientName,
        clientPimsId,
        clientAlert: a?.clientAlert ?? a?.client?.alerts ?? null,

        patientName,
        patientPimsId,
        confirmStatusName: a?.confirmStatusName ?? null,

        lat: typeof lat === 'number' ? lat : undefined,
        lon: typeof lon === 'number' ? lon : undefined,
        routingAvailable: !!routingAvailable,

        startIso: String(startIso),
        endIso: endIso ? String(endIso) : undefined,

        appointmentType: a?.appointmentType,
        appointmentTypeName,

        address1,
        city,
        state,
        zip: zip != null ? String(zip) : null,

        description: a?.description ?? null,
        statusName,

        isAlternateStop: a?.isAlternateStop ?? false,
        alternateAddressText: a?.alternateAddressText ?? null,

        clientZone: a?.client?.clientZone ?? a?.clientZone ?? null,
        effectiveZone: a?.effectiveZone ?? null,
      } as ClientAppointment;
    })
    .filter(Boolean) as ClientAppointment[];
}

/** ---------- Pets for the logged-in client ----------
 * Preferred: GET /patients/client/mine (new controller route)
 * Fallback: derive distinct pets from /appointments/client and enrich via /patients/pims/:id
 *
 * IMPORTANT: we now capture BOTH the external id (kept in `id`) and the REAL DB id in `dbId`.
 */
export async function fetchClientPets(): Promise<Pet[]> {
  // 1) Try the first-class endpoint.
  try {
    const { data } = await http.get('/patients/client/mine');
    const arr: any[] = Array.isArray(data) ? data : (data?.rows ?? data ?? []);

    if (Array.isArray(arr) && arr.length) {
      return arr.map((p: any) => ({
        // keep historical behavior for UI/display compatibility
        id: String(p?.pimsId ?? p?.id ?? ''),
        // always retain the internal DB id explicitly for backend lookups
        dbId: p?.id != null ? String(p.id) : undefined,
        clientId:
          p?.clientId ?? p?.client?.id ?? p?.ownerId ?? p?.owner?.id ?? null,
        name: String(p?.name ?? 'Pet'),
        species: p?.species ?? p?.speciesName ?? undefined,
        breed: p?.breed ?? p?.breedName ?? undefined,
        dob:
          p?.dob ?? p?.dateOfBirth ?? (typeof p?.birthDate === 'string' ? p.birthDate : undefined),
        subscription: p?.subscription
          ? {
              id: p.subscription.id,
              name: p.subscription.name ?? 'Subscription',
              status: (p.subscription.status as 'active' | 'pending' | 'canceled') ?? 'active',
            }
          : undefined,
        primaryProviderName: normalizeProviderName(p) ?? null,
        photoUrl: p?.photoUrl ?? p?.imageUrl ?? p?.image_url ?? null,
        vaccinations: Array.isArray(p?.vaccinations) ? p.vaccinations.map((v: any) => ({
          id: v?.id ?? 0,
          vaccineName: v?.vaccineName ?? '',
          dateVaccinated: v?.dateVaccinated ?? '',
          nextVaccinationDate: v?.nextVaccinationDate ?? null,
          vaccineExpiration: v?.vaccineExpiration ?? null,
          tagNumber: v?.tagNumber ?? null,
          lotNumber: v?.lotNumber ?? null,
          manufacturer: v?.manufacturer ?? null,
          veterinarianName: v?.veterinarianName ?? null,
          veterinarianLicense: v?.veterinarianLicense ?? null,
          practiceName: v?.practiceName ?? null,
          status: v?.status ?? '',
          isCurrent: v?.isCurrent ?? false,
        })) : undefined,
      })) as Pet[];
    }
  } catch {
    // fall through to fallback
  }

  // 2) Fallback: derive from appointments + optional enrichment via patients/pims/:id
  const appts = await fetchClientAppointments();

  // Collect by PIMS id (preferred) or fallback by normalized name
  const byKey = new Map<string, Pet & { _pimsId?: string }>();
  for (const a of appts) {
    const pimsId = a.patientPimsId ? String(a.patientPimsId) : undefined;
    const nameKey =
      a.patientName && a.patientName.trim()
        ? `name:${a.patientName.trim().toLowerCase()}`
        : undefined;

    const key = pimsId ? `pims:${pimsId}` : nameKey;
    if (!key) continue;

    if (!byKey.has(key)) {
      byKey.set(key, {
        id: pimsId ?? key,
        name: a.patientName ?? 'Pet',
        _pimsId: pimsId,
        primaryProviderName: normalizeProviderName(a) ?? null,
        clientId: a.client?.id ?? a.clientId ?? a.clientPimsId ?? null,
      });
    } else {
      const cur = byKey.get(key)!;
      if (!cur._pimsId && pimsId) {
        cur._pimsId = pimsId;
        cur.id = pimsId;
      }
      if (a.patientName && a.patientName.trim()) cur.name = a.patientName.trim();
      const appointProvider = normalizeProviderName(a);
      if (!cur.primaryProviderName && appointProvider) {
        cur.primaryProviderName = appointProvider;
      }
       const appointClientId = a.client?.id ?? a.clientId ?? a.clientPimsId ?? null;
       if (!cur.clientId && appointClientId != null) {
         cur.clientId = appointClientId;
       }
    }
  }

  const basePets = Array.from(byKey.values());

  // Enrich via /patients/pims/:id where available, and capture internal DB id
  const enriched = await Promise.all(
    basePets.map(async (p) => {
      if (!p._pimsId) return stripPrivate(p);
      try {
        const { data } = await http.get(`/patients/pims/${encodeURIComponent(p._pimsId)}`);
        const species = data?.species ?? data?.speciesName ?? data?.patientSpecies ?? undefined;
        const breed = data?.breed ?? data?.breedName ?? data?.patientBreed ?? undefined;
        const dob =
          data?.dob ??
          data?.dateOfBirth ??
          (typeof data?.birthDate === 'string' ? data.birthDate : undefined);
        const dbId = data?.id != null ? String(data.id) : undefined;
        const clientId = data?.client?.id ?? data?.clientId ?? data?.ownerId ?? null;

        return stripPrivate({
          ...p,
          species,
          breed,
          dob,
          dbId, // <- capture real DB id
          clientId: clientId ?? p.clientId ?? null,
          primaryProviderName: normalizeProviderName(data) ?? normalizeProviderName(p) ?? null,
          photoUrl: data?.photoUrl ?? data?.imageUrl ?? data?.image_url ?? p.photoUrl ?? null,
        });
      } catch {
        return stripPrivate({
          ...p,
          clientId: p.clientId ?? null,
        });
      }
    })
  );

  return enriched;
}

function stripPrivate(p: Pet & { _pimsId?: string }): Pet {
  const { _pimsId, ...rest } = p;
  return rest;
}

/** ---------- Enroll a pet in a subscription plan (kept as-is) ---------- */
export async function enrollPetInPlan(
  petId: string,
  body?: { planId?: string }
): Promise<Pet['subscription']> {
  const { data } = await http.post(
    `/client/pets/${encodeURIComponent(petId)}/subscription`,
    body ?? {}
  );
  return {
    id: data?.id,
    name: data?.name ?? 'Subscription',
    status: (data?.status as any) ?? 'active',
  };
}

/* =========================================================================
   WELLNESS PLANS — Use existing /wellness-plans controller
   NOTE: patientId MUST be the **internal DB id** now.
   ========================================================================= */

/** Plans for a specific patient (expects INTERNAL DB id). */
export async function fetchWellnessPlansForPatient(patientDbId: string): Promise<WellnessPlan[]> {
  const { data } = await http.get('/wellness-plans', {
    params: { patientId: patientDbId },
  });
  const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? data ?? []);
  return rows.map(normalizeWellnessPlan);
}

/** Plans for a practice (catalog/browse). */
export async function fetchWellnessPlansForPractice(practiceId: string): Promise<WellnessPlan[]> {
  const { data } = await http.get('/wellness-plans', {
    params: { practiceId },
  });
  const rows: any[] = Array.isArray(data) ? data : (data?.rows ?? data ?? []);
  return rows.map(normalizeWellnessPlan);
}

export type PracticeInfo = {
  name?: string;
  address?: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  chatHoursOfOperation?: any;
};

/** Fetch practice information */
export async function fetchPracticeInfo(): Promise<PracticeInfo | null> {
  try {
    const { data } = await http.get('/practice/info');
    return data || null;
  } catch {
    return null;
  }
}

/** Fetch a single wellness plan by id. */
export async function fetchWellnessPlanById(id: string): Promise<WellnessPlan | null> {
  const { data } = await http.get(`/wellness-plans/${encodeURIComponent(id)}`);
  if (!data) return null;
  return normalizeWellnessPlan(data);
}

/** Convenience: fetch client pets and attach their wellness plans using the INTERNAL DB id. */
export async function fetchClientPetsWithWellness(): Promise<Pet[]> {
  const pets = await fetchClientPets();

  const out = await Promise.all(
    pets.map(async (p) => {
      try {
        // IMPORTANT: use dbId (internal DB id). If absent, skip to avoid passing PIMS id.
        if (!p.dbId) return p;
        const plans = await fetchWellnessPlansForPatient(p.dbId);
        return { ...p, wellnessPlans: plans };
      } catch {
        return p;
      }
    })
  );

  return out;
}

// api/clientPortal.ts
export type ClientReminder = {
  id: number | string;
  clientId?: number | string;
  clientName?: string;
  patientId?: number | string;
  patientName?: string;
  kind?: string;
  description?: string;
  dueIso?: string; // full ISO like 2025-10-18T13:57:00.000Z
  dueDate?: string; // optional date-only (YYYY-MM-DD) if you ever send that
  statusName?: string; // pending | queued | sent | completed | etc.
  lastNotifiedIso?: string;
  completedIso?: string;
};

// ✅ Do NOT append "T00:00:00". Keep server ISO as-is.
export function mapClientReminder(r: any): ClientReminder {
  const patient = r?.patient;
  const client = r?.client;

  const dueIso =
    r?.dueIso ??
    r?.dueDate ?? // server sends full ISO in dueDate (per your JSON)
    null;

  return {
    id: r?.id,
    clientId: r?.clientId ?? client?.id ?? undefined,
    clientName:
      r?.clientName ??
      (client ? `${client.firstName ?? ''} ${client.lastName ?? ''}`.trim() : undefined),
    patientId: r?.patientId ?? patient?.id ?? undefined,
    patientName: r?.patientName ?? patient?.name ?? undefined,
    kind: r?.kind ?? r?.reminderType ?? r?.type,
    description: r?.description ?? r?.text,
    dueIso: typeof dueIso === 'string' ? dueIso : undefined,
    // leave dueDate undefined unless you truly have a YYYY-MM-DD string
    statusName: r?.statusName ?? (r?.isSatisfied ? 'completed' : 'pending'),
    lastNotifiedIso: r?.lastNotifiedIso ?? undefined,
    completedIso:
      r?.completedIso ?? (r?.isSatisfied ? (r?.updated ?? r?.externalUpdated) : undefined),
  };
}

// Example fetch using the mapper + sort by due date
export async function fetchClientReminders(): Promise<ClientReminder[]> {
  const resp = await http.get('/reminders/client'); // your endpoint
  const list = Array.isArray(resp.data) ? resp.data.map(mapClientReminder) : [];
  return list.sort((a, b) => {
    const ta = a.dueIso ? Date.parse(a.dueIso) : Number.POSITIVE_INFINITY;
    const tb = b.dueIso ? Date.parse(b.dueIso) : Number.POSITIVE_INFINITY;
    return ta - tb;
  });
}

// Message types
export type Message = {
  id: string;
  content: string;
  from: string;
  to: string | string[]; // Can be a string or array of strings
  direction: 'incoming' | 'outgoing';
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type ClientMessagesResponse = {
  clientId: number;
  phoneNumber: string;
  totalMessages: number;
  messages: Message[];
};

export async function fetchClientMessages(clientId: number | string): Promise<ClientMessagesResponse> {
  const { data } = await http.get(`/messages/client/${encodeURIComponent(clientId)}`);
  return data;
}

/** ---------- Get current client information ----------
 * Fetches the logged-in client's information by ID
 * Endpoint: GET /clients/:id
 */
export async function fetchClientInfo(clientId: string | number): Promise<any | null> {
  try {
    const { data } = await http.get(`/clients/${encodeURIComponent(clientId)}`);
    return data;
  } catch (err) {
    console.warn('Failed to fetch client info:', err);
    return null;
  }
}
