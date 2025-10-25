// src/api/clientPortal.ts
import { http } from './http';

/** ---------- Types ---------- **/
export type Pet = {
  /** External-facing identifier you already use in the UI (historically PIMS-first). */
  id: string; // prefer PIMS id when available
  /** Internal database id for the patient (used for wellness plan lookups). */
  dbId?: string;
  name: string;
  species?: string;
  breed?: string;
  dob?: string; // ISO
  subscription?: { id?: string; name?: string; status: 'active' | 'pending' | 'canceled' };

  /** Optional: attached from /wellness-plans?patientId=<DB id> */
  wellnessPlans?: WellnessPlan[];
};

export type ClientAppointment = {
  id: string;
  clientName?: string | null;
  clientPimsId?: string | null;
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
  return {
    id: String(p?.id ?? ''),
    name: p?.name ?? null,
    description: p?.description ?? null,
    patientId: p?.patient?.id ?? p?.patientId ?? null,
    practiceId: p?.practice?.id ?? p?.practiceId ?? null,
    status: p?.status ?? undefined,
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
      });
    } else {
      const cur = byKey.get(key)!;
      if (!cur._pimsId && pimsId) {
        cur._pimsId = pimsId;
        cur.id = pimsId;
      }
      if (a.patientName && a.patientName.trim()) cur.name = a.patientName.trim();
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

        return stripPrivate({
          ...p,
          species,
          breed,
          dob,
          dbId, // <- capture real DB id
        });
      } catch {
        return stripPrivate(p);
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
