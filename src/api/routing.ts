// src/api/routing.ts
import { http } from './http';

export type Depot = { lat: number; lon: number };

export type EtaHouseholdInput = {
  key?: string;
  lat: number;
  lon: number;
  startIso?: string | null;
  endIso?: string | null;
};

export type EtaRequest = {
  doctorId: string;
  date: string; // 'YYYY-MM-DD'
  households: EtaHouseholdInput[];
  startDepot?: Depot; // optional start depot
  endDepot?: Depot; // optional end depot  ← (fix comment)
  useTraffic?: boolean;
};

/** Per-stop row from ETA API; driveFromPrev is drive from previous stop (or depot) to this stop. */
export type EtaByIndexRow = {
  key?: string;
  etaIso?: string;
  etdIso?: string;
  driveFromPrevSec?: number;
  driveFromPrevMinutes?: number;
  bufferAfterMinutes?: number;
  positionInDay?: number;
  isPersonalBlock?: boolean;
  isBlock?: boolean;
  blockLabel?: string;
  [key: string]: unknown;
};

// ---- server response shape (now includes back-to-depot + etaByKey) ----
export type EtaResponse = {
  etaIso: string[];
  etdIso?: string[];
  keys?: (string | undefined)[];
  driveSeconds?: number[]; // [toFirst, ...between, back]
  backToDepotSec?: number | null;
  backToDepotIso?: string | null;
  etaByKey?: Record<string, string>; // optional (server-built)
  etaByLL6?: Record<string, string>;
  etaByLL5?: Record<string, string>;
  workStartIso?: string;
  /** Per-stop rows; driveFromPrevSec/driveFromPrevMinutes split drive before/after personal blocks. */
  byIndex?: EtaByIndexRow[];
  /** Minutes after ETD before next appointment can start (same location) or before drive starts (another stop). Default 5. */
  appointmentBufferMinutes?: number;
};

export type EtaResult = {
  etaIso: string[];
  keys?: (string | undefined)[];
  etaByKey: Record<string, string>;
  driveSeconds?: number[];
  backToDepotSec?: number | null;
  backToDepotIso?: string | null;
  workStartIso?: string;
  byIndex?: EtaByIndexRow[];
  /** Minutes after ETD before next appointment can start (same location) or before drive starts (another stop). Default 5. */
  appointmentBufferMinutes?: number;
};

export async function fetchEtas(payload: EtaRequest): Promise<EtaResult> {
  const res = await http.post('/routing/eta', { body: JSON.stringify(payload) });
  const data = (res && (res.data ?? res)) as EtaResponse;

  const etaIso = Array.isArray(data?.etaIso) ? data.etaIso : [];
  const keys = Array.isArray(data?.keys) ? data.keys : undefined;

  // Prefer server-provided etaByKey; otherwise build it from the payload order
  const etaByKey: Record<string, string> = data?.etaByKey ?? {};
  if (Object.keys(etaByKey).length === 0) {
    payload.households.forEach((h, idx) => {
      const iso = etaIso[idx];
      const k = h.key ?? keys?.[idx];
      if (k && iso) etaByKey[k] = iso;
    });
  }

  const byIndex = Array.isArray(data?.byIndex) ? data.byIndex : undefined;
  const backToDepotSec = data?.backToDepotSec ?? null;

  // Derive driveSeconds from byIndex when present so drive is split before/after personal blocks.
  // Backend may send correct byIndex[].driveFromPrevSec but wrong driveSeconds (e.g. 0 to block, 27min after).
  // When byIndex[0].driveFromPrevSec is 0 but API driveSeconds[0] > 0, keep driveSeconds[0] so "drive from depot" shows correctly (not a time-based fallback).
  let driveSeconds = data?.driveSeconds;
  if (byIndex && byIndex.length > 0) {
    const fromByIndex: number[] = byIndex.map((row: EtaByIndexRow) => {
      if (typeof row.driveFromPrevSec === 'number' && Number.isFinite(row.driveFromPrevSec)) {
        return Math.max(0, Math.round(row.driveFromPrevSec));
      }
      if (typeof row.driveFromPrevMinutes === 'number' && Number.isFinite(row.driveFromPrevMinutes)) {
        return Math.max(0, Math.round(row.driveFromPrevMinutes * 60));
      }
      return 0;
    });
    const hasAnyDrive = fromByIndex.some((s) => s > 0);
    if (hasAnyDrive) {
      const backSec = typeof backToDepotSec === 'number' && Number.isFinite(backToDepotSec) ? backToDepotSec : 0;
      let segments = [...fromByIndex, backSec];
      const apiFirst = Array.isArray(data?.driveSeconds) && data.driveSeconds.length > 0 ? data.driveSeconds[0] : 0;
      if (fromByIndex[0] <= 0 && typeof apiFirst === 'number' && apiFirst > 0) {
        segments = [apiFirst, ...segments.slice(1)];
      }
      driveSeconds = segments;
    }
  }

  return {
    etaIso,
    keys,
    etaByKey,
    driveSeconds,
    backToDepotSec,
    backToDepotIso: data?.backToDepotIso ?? null,
    workStartIso: data?.workStartIso,
    byIndex,
    appointmentBufferMinutes: data?.appointmentBufferMinutes ?? 5,
  };
}

// ---- Fill Day API ----
export type FillDayRequest = {
  doctorId: string;
  targetDate: string; // YYYY-MM-DD
  useTraffic?: boolean;
  ignoreEmergencyBlocks?: boolean;
  returnToDepot?: 'required' | 'optional' | 'afterHoursOk' | string | null;
  tailOvertimeMinutes?: number | string | null;
};

export type FillDayReminder = {
  id: number;
  description: string;
  dueDate?: string;
};

export type FillDayAddress = {
  address1: string;
  address2?: string;
  address3?: string;
  city: string;
  state: string;
  zipcode: string;
  fullAddress: string;
  lat?: number; // Optional coordinates for routing - prevents virtual appointment from borrowing coordinates
  lon?: number; // Optional coordinates for routing - prevents virtual appointment from borrowing coordinates
};

export type FillDayPatient = {
  id: number;
  name: string;
  color?: string;
  weight?: string;
  dob?: string;
  breed?: string;
  species?: string;
  alerts?: string | null;
  reminders?: FillDayReminder[]; // Reminders nested directly in patient object
  lastSeenDate?: string;
  lastSeenAppointmentType?: string;
  [key: string]: any; // Allow other patient fields
};

export type FillDayCandidate = {
  // Multiple patients/reminders (arrays)
  patients?: FillDayPatient[];
  patientIds: number[];
  patientNames: string[];
  petCount: number;
  reminderIds: number[];
  reminderDescriptions: string[];
  reminders: FillDayReminder[];
  // Primary patient/reminder (for backward compatibility)
  patientId: number;
  patientName: string;
  reminderId: number;
  reminderDescription: string;
  // Client info
  clientId: number;
  clientName: string;
  client?: {
    lat?: number;
    lon?: number;
    alerts?: string | null;
    [key: string]: any; // Allow other client fields
  };
  address: FillDayAddress;
  // Scheduling info
  proposedStartIso: string;
  proposedStartSec: number;
  arrivalWindow: {
    start: string;
    end: string;
  };
  addedDriveSeconds: number;
  addedDriveMinutes: number;
  requiredDuration: number;
  finalScore: number;
  holeIndex: number;
  myDayPreviewLink: string;
  /** Minutes after ETD before next appointment can start (same location) or before drive starts (another stop). Default 5. */
  appointmentBufferMinutes?: number;
};

export type FillDayStats = {
  holesFound: number;
  candidatesEvaluated: number;
  shortlistSize: number;
  finalResults: number;
};

export type FillDayResponse = {
  date: string;
  doctorId: string;
  candidates: FillDayCandidate[];
  stats: FillDayStats;
  message?: string;
};

export async function fetchFillDayCandidates(payload: FillDayRequest): Promise<FillDayResponse> {
  const { data } = await http.post('/routing/fill-day', payload);
  return data as FillDayResponse;
}
