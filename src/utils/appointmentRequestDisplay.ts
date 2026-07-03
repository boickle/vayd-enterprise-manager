/** Helpers for reading persisted public appointment request form payloads. */

import { DateTime } from 'luxon';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function clientDisplayNameFromRequestData(requestData: Record<string, unknown>): string {
  const fn = (requestData.fullName as { first?: string; last?: string }) ?? {};
  const parts = [pickStr(fn.first), pickStr(fn.last)].filter(Boolean);
  return parts.length ? parts.join(' ') : pickStr(requestData.email) ?? 'Unknown';
}

export function requestDataPhone(requestData: Record<string, unknown>): string | null {
  return pickStr(requestData.phoneNumber) ?? pickStr(requestData.bestPhoneNumber) ?? pickStr(requestData.phoneNumbers);
}

/** Best-effort email from a persisted request payload. */
export function requestDataEmail(requestData: Record<string, unknown>): string | null {
  return (
    pickStr(requestData.email) ??
    pickStr(requestData.userEmail) ??
    pickStr(requestData.contactEmail)
  );
}

export function requestDataCanText(requestData: Record<string, unknown>): 'Yes' | 'No' | null {
  const v = pickStr(requestData.canWeText);
  if (v === 'Yes' || v === 'No') return v;
  return null;
}

function pickYesNo(v: unknown): 'Yes' | 'No' | null {
  const s = pickStr(v);
  if (s === 'Yes' || s === 'No') return s;
  return null;
}

/** Existing client — veterinary care at another hospital since our last visit. */
export function requestDataHadVetCareElsewhere(
  requestData: Record<string, unknown>,
): 'Yes' | 'No' | null {
  return pickYesNo(requestData.hadVetCareElsewhere);
}

/** Client consent to request records from other hospitals (existing clients). */
export function requestDataMayWeAskForRecords(
  requestData: Record<string, unknown>,
): 'Yes' | 'No' | null {
  return pickYesNo(requestData.mayWeAskForRecords);
}

/** Prior vet practices the client listed (new clients, or existing-client flow). */
export function requestDataPreviousVeterinaryPractices(
  requestData: Record<string, unknown>,
): string | null {
  return (
    pickStr(requestData.previousVeterinaryPractices) ??
    pickStr(requestData.previousVeterinaryPracticesExisting)
  );
}

/** Other hospitals visited since last visit (existing clients). */
export function requestDataPreviousVeterinaryHospitals(
  requestData: Record<string, unknown>,
): string | null {
  return pickStr(requestData.previousVeterinaryHospitals);
}

export function requestDataOkayToContactPreviousVets(
  requestData: Record<string, unknown>,
): 'Yes' | 'No' | null {
  return (
    pickYesNo(requestData.okayToContactPreviousVets) ??
    pickYesNo(requestData.okayToContactPreviousVetsExisting)
  );
}

export function requestDataClientType(
  requestData: Record<string, unknown>
): 'new' | 'existing' | 'unknown' {
  const ct = requestData.clientType;
  if (ct === 'new' || ct === 'existing') return ct;
  const formFlow = requestData.formFlow;
  if (formFlow && typeof formFlow === 'object') {
    const startedAsExisting = (formFlow as Record<string, unknown>).startedAsExistingClient;
    if (startedAsExisting === true) return 'existing';
    if (startedAsExisting === false) return 'new';
  }
  return 'unknown';
}

type PetLike = { name?: unknown; isSelected?: unknown; new?: unknown };

function petNameFromRecord(p: unknown): string | null {
  if (!p || typeof p !== 'object') return null;
  return pickStr((p as PetLike).name);
}

/** Comma-separated pet names from request payload. */
export function requestDataPetSummary(requestData: Record<string, unknown>): string {
  const names: string[] = [];

  const pets = requestData.pets;
  if (Array.isArray(pets)) {
    for (const p of pets) {
      const n = petNameFromRecord(p);
      if (n) names.push(n);
    }
  }

  if (names.length === 0) {
    const allPets = requestData.allPets;
    if (Array.isArray(allPets)) {
      for (const p of allPets) {
        if (p && typeof p === 'object' && (p as PetLike).isSelected === false) continue;
        const n = petNameFromRecord(p);
        if (n) names.push(n);
      }
    }
  }

  if (names.length === 0) {
    for (const key of ['newClientPets', 'existingClientNewPets'] as const) {
      const arr = requestData[key];
      if (!Array.isArray(arr)) continue;
      for (const p of arr) {
        const n = petNameFromRecord(p);
        if (n) names.push(n);
      }
    }
  }

  if (names.length === 0) {
    const text = pickStr(requestData.petInfoText) ?? pickStr(requestData.whatPets) ?? pickStr(requestData.petInfo);
    if (text) return text;
  }

  return names.length ? names.join(', ') : '—';
}

/** Comma-separated primary providers for pets in the request (chart vet, not preferred doctor). */
export function requestDataPrimaryProviderSummary(requestData: Record<string, unknown>): string | null {
  const names = new Set<string>();

  const addFromPet = (p: unknown) => {
    if (!p || typeof p !== 'object') return;
    const pet = p as Record<string, unknown>;
    const name =
      pickStr(pet.primaryProviderName) ??
      (() => {
        const pp = pet.primaryProvider;
        if (!pp || typeof pp !== 'object') return null;
        const o = pp as Record<string, unknown>;
        const parts = [pickStr(o.title), pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean);
        return parts.length ? parts.join(' ') : pickStr(o.name) ?? pickStr(o.fullName);
      })();
    if (name) names.add(name);
  };

  const pets = requestData.pets;
  if (Array.isArray(pets)) {
    for (const p of pets) addFromPet(p);
  }
  if (names.size === 0) {
    const allPets = requestData.allPets;
    if (Array.isArray(allPets)) {
      for (const p of allPets) {
        if (p && typeof p === 'object' && (p as { isSelected?: unknown }).isSelected === false) continue;
        addFromPet(p);
      }
    }
  }

  if (names.size === 0) return null;
  return [...names].join(', ');
}

export function formatRequestDataAddress(requestData: Record<string, unknown>): string | null {
  const addr = requestData.physicalAddress;
  if (!addr || typeof addr !== 'object') return null;
  const a = addr as Record<string, unknown>;
  const parts = [
    pickStr(a.line1),
    pickStr(a.line2),
    [pickStr(a.city), pickStr(a.state)].filter(Boolean).join(', '),
    pickStr(a.zip),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** Comma-separated home address for staff client / by-address search (not display formatting). */
export function requestDataPhysicalAddressForSearch(
  requestData: Record<string, unknown>,
): string | null {
  const addr = requestData.physicalAddress;
  if (!addr || typeof addr !== 'object') return null;
  const a = addr as Record<string, unknown>;
  const parts = [
    pickStr(a.line1),
    pickStr(a.line2),
    [pickStr(a.city), pickStr(a.state)].filter(Boolean).join(', '),
    pickStr(a.zip),
  ].filter(Boolean);
  if (parts.length >= 2) return parts.join(', ');
  return parts[0] ?? null;
}

/** Existing client chose a different visit location (answered "No" to home-address question). */
export function requestDataUsesAlternateVisitAddress(
  requestData: Record<string, unknown>,
): boolean {
  if (requestData.addressChanged === true) return true;
  return pickStr(requestData.isThisTheAddressWhereWeWillCome) === 'No';
}

export function requestDataHowSoon(requestData: Record<string, unknown>): string | null {
  return (
    pickStr(requestData.howSoon) ??
    pickStr(requestData.urgency) ??
    pickStr(requestData.needsUrgentScheduling)
  );
}

export type RequestDataHowSoonUrgency = 'emergent' | 'urgent';

/** Emergent / urgent classification from how-soon selection (or legacy urgent flag). */
export function requestDataHowSoonUrgency(
  requestData: Record<string, unknown>,
): RequestDataHowSoonUrgency | null {
  const howSoon =
    pickStr(requestData.howSoon) ??
    pickStr(requestData.urgency);

  if (howSoon) {
    const normalized = howSoon.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    if (normalized.includes('emergent') || normalized.includes('emergency')) return 'emergent';
    if (normalized.includes('urgent')) return 'urgent';
  }

  if (pickStr(requestData.needsUrgentScheduling) === 'Yes') return 'urgent';

  return null;
}

/** Day offset from today for routing end date, based on appointment-request urgency. */
export function appointmentRequestHowSoonEndOffsetDays(howSoon: string | null | undefined): number {
  const raw = howSoon?.trim();
  if (!raw) return 14;
  const n = raw.toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ');
  if (n.includes('emergent') || n.includes('emergency')) return 2;
  if (n.includes('urgent') || raw === 'Yes') return 3;
  if (n.startsWith('soon') || n.includes('this week') || n.includes('next few days')) return 10;
  if (n.includes('flexible') || n.includes('routine') || n.includes('not sure')) return 14;
  return 14;
}

/** Routing search window for an appointment request: today through today + offset (practice TZ). */
export function appointmentRequestRoutingSearchDateRange(
  howSoon: string | null | undefined,
  practiceTz?: string,
): { startDate: string; endDate: string } {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const today = DateTime.now().setZone(tz).startOf('day');
  const endOffsetDays = appointmentRequestHowSoonEndOffsetDays(howSoon);
  return {
    startDate: today.toFormat('yyyy-MM-dd'),
    endDate: today.plus({ days: endOffsetDays }).toFormat('yyyy-MM-dd'),
  };
}

export function requestDataPreferredDoctor(requestData: Record<string, unknown>): string | null {
  return pickStr(requestData.preferredDoctor) ?? pickStr(requestData.preferredDoctorExisting);
}

export function requestDataAppointmentTypeLabel(
  requestData: Record<string, unknown>,
): string | null {
  return pickStr(requestData.appointmentType);
}

export type RequestDataAppointmentTypeForRouting = {
  label: string | null;
  typeId: number | null;
};

/** Appointment type from request payload — prettyName/label + id when saved per pet. */
export function requestDataAppointmentTypeForRouting(
  requestData: Record<string, unknown>,
): RequestDataAppointmentTypeForRouting {
  const psd = requestData.petSpecificData;
  if (psd && typeof psd === 'object') {
    for (const v of Object.values(psd as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const row = v as Record<string, unknown>;
      const label =
        pickStr(row.needsToday) ??
        pickStr(row.appointmentTypeName) ??
        pickStr(row.appointmentType);
      const rawId = row.appointmentTypeId;
      const typeId =
        rawId != null && Number.isFinite(Number(rawId)) && Number(rawId) > 0
          ? Number(rawId)
          : null;
      if (label || typeId != null) {
        return { label, typeId };
      }
    }
  }

  return {
    label: requestDataAppointmentTypeLabel(requestData),
    typeId: null,
  };
}

export type RequestDataSelfScheduledSlot = {
  doctorName: string | null;
  appointmentStart: string | null;
  windowStartIso: string | null;
  windowEndIso: string | null;
  windowDisplay: string | null;
  display?: string | null;
};

/** The reserved slot (doctor + arrival window) persisted from an online-booking submission. */
export function requestDataSelfScheduledSlot(
  requestData: Record<string, unknown>
): RequestDataSelfScheduledSlot | null {
  const raw = requestData.selfScheduledSlot;
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  const appointmentStart = pickStr(s.appointmentStart);
  if (!appointmentStart) return null;
  return {
    doctorName: pickStr(s.doctorName),
    appointmentStart,
    windowStartIso: pickStr(s.windowStartIso),
    windowEndIso: pickStr(s.windowEndIso),
    windowDisplay: pickStr(s.windowDisplay) ?? pickStr(s.display),
    display: pickStr(s.display),
  };
}

/** Gmail notification copy for auto-booked selectedDateTimePreferences.display */
export function formatAutobookDateTimePreferenceDisplay(args: {
  doctorName?: string | null;
  appointmentStart: string;
  windowDisplay?: string | null;
  display?: string | null;
  practiceTz?: string;
}): string {
  const tz = practiceTimeZoneOrDefault(args.practiceTz);
  const doctor = args.doctorName?.trim();
  const window = args.windowDisplay?.trim();
  const slotDisplay = args.display?.trim();

  const start = DateTime.fromISO(args.appointmentStart, { zone: 'utc' }).setZone(tz);
  const dateLabel = start.isValid ? start.toFormat('EEEE, MMMM d, yyyy') : null;

  let timing: string;
  if (window && dateLabel) {
    timing = `${dateLabel} — ${window}`;
  } else if (window) {
    timing = window;
  } else if (slotDisplay) {
    timing = slotDisplay;
  } else if (dateLabel && start.isValid) {
    timing = start.toFormat('EEEE, MMMM d, yyyy · h:mm a');
  } else {
    timing = args.appointmentStart;
  }

  return [doctor, timing].filter(Boolean).join(' — ');
}

/** Add visit date to legacy preference lines that only show doctor + arrival window. */
export function enrichDateTimePreferenceDisplay(
  display: string,
  dateTimeIso: string | null | undefined,
  practiceTz?: string,
): string {
  const dt = dateTimeIso?.trim();
  if (!dt || !display.includes('We will come')) return display;
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const parsed = DateTime.fromISO(dt, { zone: 'utc' }).setZone(tz);
  if (!parsed.isValid) return display;
  const dateLabel = parsed.toFormat('EEEE, MMMM d, yyyy');
  if (display.includes(dateLabel)) return display;
  const sep = ' — ';
  const parts = display.split(sep);
  if (parts.length >= 2 && parts[parts.length - 1].includes('We will come')) {
    const prefix = parts.slice(0, -1).join(sep);
    return `${prefix}${sep}${dateLabel}${sep}${parts[parts.length - 1]}`;
  }
  return `${dateLabel} — ${display}`;
}

/** Best-effort client id from a persisted request payload. */
export function requestDataClientId(requestData: Record<string, unknown>): string | null {
  const direct = pickStr(requestData.clientId) ?? pickStr(requestData.client_id);
  if (direct) return direct;

  const resolved = resolveClientPatientFromRequestData(requestData);
  if (resolved?.clientId) return resolved.clientId;

  for (const key of ['pets', 'allPets'] as const) {
    const arr = requestData[key];
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (!p || typeof p !== 'object') continue;
      const row = p as Record<string, unknown>;
      const cid = pickStr(row.clientId) ?? pickStr(row.client_id);
      if (cid) return cid;
    }
  }

  const loggedInId =
    pickStr(requestData.userId) ?? pickStr(requestData.loggedInClientId);
  if (loggedInId) return loggedInId;

  return null;
}

/** PIMS id for eVet client deep link when stored on the submission payload. */
export function requestDataClientPimsId(requestData: Record<string, unknown>): string | null {
  const direct = pickStr(requestData.clientPimsId) ?? pickStr(requestData.pimsId);
  if (direct) return direct;

  const client = requestData.client;
  if (client && typeof client === 'object') {
    const pimsId = pickStr((client as Record<string, unknown>).pimsId);
    if (pimsId) return pimsId;
  }

  return null;
}

/** PIMS patient id for eVet deep link (`pet.id` from client portal submissions). */
export function isFormGeneratedPetId(id: string | null | undefined): boolean {
  if (!id) return false;
  const s = id.trim();
  return /^new-pet-/i.test(s) || /^existing-new-pet-/i.test(s);
}

export function looksLikeEvetPimsId(id: string | null | undefined): boolean {
  if (!id) return false;
  return /^\d+$/.test(id.trim());
}

/** Pet on the request form that is not yet linked to an eVet patient record. */
export function requestPetIsUnlinkedInEvet(pet: Record<string, unknown>): boolean {
  const explicit =
    pickStr(pet.pimsId) ?? pickStr(pet.patientPimsId) ?? pickStr(pet.patient_pims_id);
  if (explicit && looksLikeEvetPimsId(explicit)) return false;
  if (pet.new === true) return true;
  const id = pickStr(pet.id);
  if (id && isFormGeneratedPetId(id)) return true;
  if (id && looksLikeEvetPimsId(id)) return false;
  return true;
}

export function patientPimsIdFromRequestPet(pet: Record<string, unknown>): string | null {
  const explicit =
    pickStr(pet.pimsId) ?? pickStr(pet.patientPimsId) ?? pickStr(pet.patient_pims_id);
  if (explicit && looksLikeEvetPimsId(explicit)) return explicit;

  if (requestPetIsUnlinkedInEvet(pet)) return null;

  const id = pickStr(pet.id);
  if (id && looksLikeEvetPimsId(id)) return id;
  return null;
}

/** Internal patient id for in-app chart modal — only when a real record exists. */
export function requestPetChartPatientId(pet: Record<string, unknown>): string | null {
  const dbId = pickStr(pet.dbId);
  if (dbId) return dbId;
  if (requestPetIsUnlinkedInEvet(pet)) return null;
  const id = pickStr(pet.id);
  if (id && looksLikeEvetPimsId(id)) return id;
  return null;
}

export function resolveClientPimsIdForRequest(
  requestData: Record<string, unknown>,
  fetchedByInternalId: ReadonlyMap<string, string>,
): string | null {
  const direct = requestDataClientPimsId(requestData);
  if (direct && looksLikeEvetPimsId(direct)) return direct;

  if (requestDataClientType(requestData) !== 'existing') return null;
  const internal = requestDataClientId(requestData);
  if (!internal) return null;
  const resolved = fetchedByInternalId.get(internal) ?? internal;
  return looksLikeEvetPimsId(resolved) ? resolved : null;
}

/** Resolve client PIMS ids for existing-client requests missing `clientPimsId` on payload. */
export async function fetchClientPimsIdLookup(
  requestDataList: Record<string, unknown>[],
): Promise<Map<string, string>> {
  const lookup = new Map<string, string>();
  const toFetch = new Set<string>();

  for (const rd of requestDataList) {
    if (requestDataClientType(rd) !== 'existing') continue;
    if (requestDataClientPimsId(rd)) continue;
    const id = requestDataClientId(rd);
    if (id) toFetch.add(id);
  }

  await Promise.all(
    [...toFetch].map(async (id) => {
      try {
        const raw = (await fetchClientByIdStaff(id)) as Record<string, unknown>;
        lookup.set(id, pickStr(raw.pimsId) ?? id);
      } catch {
        lookup.set(id, id);
      }
    }),
  );

  return lookup;
}

/** Earliest requested appointment instant from self-schedule or time preferences. */
export function requestDataRequestedStartIso(requestData: Record<string, unknown>): string | null {
  const slot = requestDataSelfScheduledSlot(requestData);
  if (slot?.appointmentStart) return slot.appointmentStart;

  const prefs = requestData.selectedDateTimePreferences;
  if (Array.isArray(prefs) && prefs.length > 0) {
    const sorted = [...prefs].sort((a, b) => {
      const pa = Number((a as { preference?: unknown })?.preference) || 999;
      const pb = Number((b as { preference?: unknown })?.preference) || 999;
      return pa - pb;
    });
    for (const pref of sorted) {
      if (!pref || typeof pref !== 'object') continue;
      const dt = pickStr((pref as Record<string, unknown>).dateTime);
      if (dt && DateTime.fromISO(dt).isValid) return dt;
    }
  }

  return pickStr(requestData.submittedAt);
}

/** Last name from a doctor label like "Dr. Heather Crispell D.V.M." → "Crispell". */
export function doctorLastNameFromLabel(label: string | null | undefined): string | null {
  const cleaned = pickStr(label);
  if (!cleaned) return null;
  const withoutPrefix = cleaned.replace(/^dr\.?\s*/i, '').trim();
  const withoutCreds = withoutPrefix
    .replace(/,?\s*(d\.?v\.?m\.?|v\.?m\.?d\.?|d\.?a\.?b\.?v\.?p\.?|ms|m\.?s\.?|phd|ph\.?d\.?)\b\.?/gi, '')
    .replace(/[.,]+$/g, '')
    .trim();
  const parts = withoutCreds.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : null;
}

export function requestDataAnythingElse(requestData: Record<string, unknown>): string | null {
  return (
    pickStr(requestData.anythingElse) ??
    pickStr(requestData.visitDetails) ??
    pickStr(requestData.schedulingNotes)
  );
}

export function isEuthanasiaRequestData(requestData: Record<string, unknown>): boolean {
  const chunks: string[] = [];
  const top = requestData.appointmentType;
  if (typeof top === 'string') chunks.push(top);
  const psd = requestData.petSpecificData;
  if (psd && typeof psd === 'object') {
    for (const v of Object.values(psd as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const o = v as Record<string, unknown>;
      for (const key of ['needsToday', 'appointmentTypeName'] as const) {
        const s = o[key];
        if (typeof s === 'string') chunks.push(s);
      }
    }
  }
  const hay = chunks.join(' ').toLowerCase();
  return (
    hay.includes('euthanasia') ||
    hay.includes('end-of-life') ||
    hay.includes('end of life')
  );
}

export type ResolvedRequestClientPatient = {
  clientId: string;
  patientId: string;
  preferredPatientIds?: string[];
};

function preferredPatientIdsFromPetList(pets: unknown[]): string[] {
  return pets
    .map((p) => {
      if (!p || typeof p !== 'object') return null;
      const row = p as Record<string, unknown>;
      const pid = row.dbId ?? row.id;
      return pid != null ? String(pid) : null;
    })
    .filter((id): id is string => Boolean(id));
}

/** Patient ids from the pets the client selected on the request form. */
export function requestDataPreferredPatientIds(requestData: Record<string, unknown>): string[] {
  const resolved = resolveClientPatientFromRequestData(requestData);
  if (resolved?.preferredPatientIds?.length) return resolved.preferredPatientIds;

  const pets = requestData.pets;
  if (Array.isArray(pets) && pets.length > 0) {
    return preferredPatientIdsFromPetList(pets);
  }

  const allPets = requestData.allPets;
  if (Array.isArray(allPets)) {
    const selected = allPets.filter(
      (p) => p && typeof p === 'object' && (p as PetLike).isSelected !== false
    );
    if (selected.length > 0) return preferredPatientIdsFromPetList(selected);
  }

  return [];
}

/** Best-effort client + patient ids for routing prefill (existing clients with known pets). */
export function resolveClientPatientFromRequestData(
  requestData: Record<string, unknown>
): ResolvedRequestClientPatient | null {
  const pets = requestData.pets;
  if (Array.isArray(pets) && pets.length > 0) {
    const first = pets[0] as Record<string, unknown>;
    const clientId = first.clientId ?? first.client_id;
    const patientId = first.dbId ?? first.id;
    if (clientId != null && patientId != null) {
      return {
        clientId: String(clientId),
        patientId: String(patientId),
        preferredPatientIds: pets
          .map((p) => {
            const row = p as Record<string, unknown>;
            const pid = row.dbId ?? row.id;
            return pid != null ? String(pid) : null;
          })
          .filter((id): id is string => Boolean(id)),
      };
    }
  }

  const allPets = requestData.allPets;
  if (Array.isArray(allPets)) {
    const selected = allPets.filter(
      (p) => p && typeof p === 'object' && (p as PetLike).isSelected !== false
    ) as Record<string, unknown>[];
    if (selected.length > 0) {
      const clientId = selected[0].clientId ?? selected[0].client_id;
      const patientId = selected[0].dbId ?? selected[0].id;
      if (clientId != null && patientId != null) {
        return {
          clientId: String(clientId),
          patientId: String(patientId),
          preferredPatientIds: selected
            .map((row) => {
              const pid = row.dbId ?? row.id;
              return pid != null ? String(pid) : null;
            })
            .filter((id): id is string => Boolean(id)),
        };
      }
    }
  }

  return null;
}

export function requestDataServiceMinutes(requestData: Record<string, unknown>): number | null {
  const raw = requestData.serviceMinutes;
  if (raw != null && Number.isFinite(Number(raw))) {
    return Math.max(15, Math.round(Number(raw)));
  }
  return null;
}
