/** Helpers for reading persisted public appointment request form payloads. */

import { DateTime } from 'luxon';

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

export function requestDataCanText(requestData: Record<string, unknown>): 'Yes' | 'No' | null {
  const v = pickStr(requestData.canWeText);
  if (v === 'Yes' || v === 'No') return v;
  return null;
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

export function requestDataHowSoon(requestData: Record<string, unknown>): string | null {
  return (
    pickStr(requestData.howSoon) ??
    pickStr(requestData.urgency) ??
    pickStr(requestData.needsUrgentScheduling)
  );
}

export function requestDataPreferredDoctor(requestData: Record<string, unknown>): string | null {
  return pickStr(requestData.preferredDoctor) ?? pickStr(requestData.preferredDoctorExisting);
}

export type RequestDataSelfScheduledSlot = {
  doctorName: string | null;
  appointmentStart: string | null;
  windowStartIso: string | null;
  windowEndIso: string | null;
  windowDisplay: string | null;
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
    windowDisplay: pickStr(s.windowDisplay),
  };
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
