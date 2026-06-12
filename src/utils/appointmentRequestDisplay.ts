/** Helpers for reading persisted public appointment request form payloads. */

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
