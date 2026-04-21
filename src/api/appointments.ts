// src/api/appointments.ts
import { http } from './http';
import type { Appointment } from './roomLoader';

export type RangeAppointment = Appointment;

/**
 * GET /appointments/range — appointments overlapping [start, end] (ISO 8601, UTC).
 * Optional primaryProviderId scopes to one doctor; omit for entire practice.
 */
export async function fetchAppointmentsRange(params: {
  practiceId: number | string;
  start: string;
  end: string;
  primaryProviderId?: number | string;
}): Promise<Appointment[]> {
  const query: Record<string, string> = {
    practiceId: String(params.practiceId),
    start: params.start,
    end: params.end,
  };
  if (params.primaryProviderId != null && String(params.primaryProviderId).trim() !== '') {
    query.primaryProviderId = String(params.primaryProviderId);
  }
  const { data } = await http.get('/appointments/range', { params: query });
  return Array.isArray(data) ? data : (data?.items ?? []);
}

/** POST /appointments — Vayd-native appointment (pimsType VAYD on server) */
export type CreateAppointmentPayload = {
  practiceId: number;
  primaryProviderId: number;
  clientId: number;
  patientId: number;
  appointmentTypeId: number;
  appointmentStart: string;
  appointmentEnd: string;
  description?: string;
  instructions?: string;
  equipment?: string;
  medications?: string;
  treatmentId?: number;
  allDay?: boolean;
};

export async function createAppointment(body: CreateAppointmentPayload): Promise<Appointment> {
  const { data } = await http.post<Appointment>('/appointments', body);
  return data;
}

/** PATCH /appointments/:id — partial update (field names match Appointment / server contract). */
export async function patchAppointment(
  id: number | string,
  body: Record<string, unknown>
): Promise<Appointment> {
  const { data } = await http.patch<Appointment>(`/appointments/${encodeURIComponent(String(id))}`, body);
  return data;
}

/** DELETE /appointments/:id */
export async function deleteAppointment(id: number | string): Promise<void> {
  await http.delete(`/appointments/${encodeURIComponent(String(id))}`);
}

export type Depot = { lat: number; lon: number };

export type MiniZone = { id: number | string; name: string | null } | null;

export type DoctorDayAppt = {
  id: number | string;
  clientName: string;
  clientPimsId?: string;
  clientAlert?: string;
  patientName?: string;
  patientPimsId?: string;
  confirmStatusName?: string;

  lat?: number;
  lon?: number;

  startIso?: string;
  endIso?: string;
  appointmentType?: string;

  address1?: string;
  city?: string;
  state?: string;
  zip?: string;

  description?: string;
  visitReason?: string;
  statusName?: string;

  expectedArrivalIso?: string;
  routingAvailable?: boolean;
  isNoLocation?: boolean;

  // Block fields (doctor-day merged list + ETA byIndex)
  /** Doctor-day merged list: 'appointment' | 'block'. ETA byIndex may also set this. */
  type?: 'appointment' | 'block';
  /** Set on both doctor-day and ETA byIndex for blocks. */
  isBlock?: boolean;
  /** Legacy/alternative block flag; same meaning as type === 'block' / isBlock. */
  isPersonalBlock?: boolean;
  /** Prefer this for block label (e.g. "Block", "Personal block"); else title, else "Block". */
  blockLabel?: string;
  /** Title for blocks when blockLabel is not set. */
  title?: string;

  // Fixed time appointment (no flexible window)
  isFixed?: boolean;
  fixedTime?: boolean;
  isFlexible?: boolean;

  // Zones
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;

  /** Appointment window from backend (when available); use instead of frontend-calculated window */
  effectiveWindow?: { startIso: string; endIso: string };

  /** One-team / membership: client is an active member */
  isMember?: boolean;
  /** Display name of the membership tier/plan when `isMember` */
  membershipName?: string | null;
}

/** Item may be an appointment (doctor-day) or ETA byIndex row (has key). */
export function isBlockEntry(item: {
  type?: string;
  isBlock?: boolean;
  isPersonalBlock?: boolean;
  key?: string;
} | null | undefined): boolean {
  if (!item) return false;
  if (item.type === 'block') return true;
  if (item.isBlock === true) return true;
  if (item.isPersonalBlock === true) return true;
  if (typeof item.key === 'string' && item.key.startsWith('noloc:')) return true;
  return false;
}

/** True when the block is a "Flex Block" (routing stand-in; same treatment as personal block for drive logic). */
export function isFlexBlockItem(item: { blockLabel?: string; title?: string } | null | undefined): boolean {
  if (!item) return false;
  const label = (item.blockLabel ?? item.title ?? '').trim().toLowerCase();
  return label === 'flex block';
}

/** Label for a block entry: blockLabel ?? title ?? 'Personal Block'. Never use client/patient name for blocks. */
export function blockDisplayLabel(item: { blockLabel?: string; title?: string } | null | undefined): string {
  if (!item) return 'Personal Block';
  let label = (item.blockLabel ?? item.title ?? '').trim();
  if (!label) return 'Personal Block';
  if (label.toLowerCase() === 'client') return 'Personal Block';
  if (label.toLowerCase() === 'flex block') return 'Flex Block';
  // ETA/routing may prefix with duplicated tokens (e.g. "BLOCK BLOCK Greg …"); keep one BLOCK + rest.
  label = label.replace(/^block(?:\s+block)+(?=\s|$)/i, 'BLOCK').trim();
  // Backend sometimes sends repeated tokens only (e.g. "BLOCK BLOCK"); show once.
  const parts = label.split(/\s+/).filter(Boolean);
  if (parts.length > 1) {
    const low0 = parts[0].toLowerCase();
    if (parts.every((p) => p.toLowerCase() === low0)) {
      if (low0 === 'block') return 'BLOCK';
      return parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
    }
  }
  return label;
}

export type DoctorDayResponse = {
  date?: string;
  startDepot?: Depot | null;
  endDepot?: Depot | null;
  startDepotTime: any;
  endDepotTime: any;
  appointments: DoctorDayAppt[];
};

const toMiniZone = (z: any): MiniZone => {
  if (!z) return null;
  if (typeof z === 'object') {
    const id = z.id ?? z.zoneId ?? z.clientZoneId;
    const name = z.name ?? z.zoneName ?? z.clientZoneName ?? null;
    return id != null ? { id, name } : null;
  }
  return { id: z, name: null };
};

/** From full zone name like "Zone 3E (Home)" or "2E:" return short label "3E" / "2E" only. */
function shortZoneLabel(fullName: string | null | undefined): string | null {
  const s = fullName?.trim();
  if (!s) return null;
  // Strip "Zone " prefix and any trailing " (Something)" to get e.g. "3E"
  let out = s.replace(/^Zone\s+/i, '').trim();
  out = out.replace(/\s*\([^)]*\)\s*$/, '').trim();
  // Strip trailing colon if backend sends e.g. "2E:"
  out = out.replace(/:+$/, '').trim();
  return out || s.replace(/:+$/, '').trim();
}

/** Display client name with zone or city in parentheses when available, e.g. "Martha Fogler (3E)" or "Martha Fogler (Boston)". Zone shows short label only (e.g. "3E"), not "Zone 3E (Home)". */
export function clientDisplayName(a: {
  clientName?: string | null;
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;
  city?: string | null;
} | null): string {
  const name = (a?.clientName ?? 'Client').trim();
  if (!name) return 'Client';
  const fullZoneName =
    (a?.effectiveZone?.name ?? a?.clientZone?.name)?.trim() ||
    (a as any)?.zoneName?.trim();
  const zoneLabel = fullZoneName ? shortZoneLabel(fullZoneName) : null;
  const city = (a?.city ?? (a as any)?.city)?.trim();
  const suffix = zoneLabel || city;
  return suffix ? `${name} (${suffix})` : name;
}

export async function fetchDoctorDay(
  dateISO: string,
  doctorId?: string
): Promise<DoctorDayResponse> {
  const params: Record<string, string> = { date: dateISO };
  if (doctorId && String(doctorId).trim() !== '') params.doctorId = String(doctorId);

  // inside fetchDoctorDay(...)

  const { data } = await http.get('/appointments/doctor', { params });

  // --- map normal appointments (existing code) ---
  const rows: any[] = data?.appointments ?? data ?? [];
  const appointments: DoctorDayAppt[] = rows.map((a) => {
    const lat = typeof a?.lat === 'number' ? a.lat : undefined;
    const lon = typeof a?.lon === 'number' ? a.lon : undefined;

    const backendNoLoc =
      Boolean(a?.isNoLocation ?? a?.noLocation ?? a?.unroutable) || a?.routingAvailable === false;
    return {
      id: a?.id,
      clientName: a?.clientName ?? 'Client',
      clientPimsId: a?.clientPimsId,
      clientAlert: a?.clientAlert,
      patientName: a?.patientName,
      alerts: a?.alerts,
      patientPimsId: a?.patientPimsId,
      confirmStatusName: a?.confirmStatusName ?? undefined,
      appointmentType: a?.appointmentType?.name ?? a?.appointmentType ?? undefined,

      lat,
      lon,

      startIso: a?.startIso ?? a?.appointmentStart ?? a?.scheduledStartIso,
      endIso: a?.endIso ?? a?.appointmentEnd ?? a?.scheduledEndIso,

      address1: a?.address1 ?? undefined,
      city: a?.city ?? undefined,
      state: a?.state ?? undefined,
      zip: a?.zip ?? undefined,

      description: a?.description,
      visitReason: a?.visitReason,
      statusName: a?.statusName,

      expectedArrivalIso: a?.expectedArrivalIso ?? undefined,
      routingAvailable: a?.routingAvailable,
      isNoLocation: backendNoLoc || !(typeof lat === 'number' && typeof lon === 'number'),

      // Fixed time fields
      isFixed: a?.isFixed ?? undefined,
      fixedTime: a?.fixedTime ?? undefined,
      isFlexible: a?.isFlexible ?? undefined,

      clientZone: toMiniZone(a?.clientZone),
      effectiveZone: toMiniZone(a?.effectiveZone),

      effectiveWindow:
        a?.effectiveWindow?.startIso && a?.effectiveWindow?.endIso
          ? { startIso: a.effectiveWindow.startIso, endIso: a.effectiveWindow.endIso }
          : undefined,

      ...(() => {
        const pat = a?.patient;
        const isMember = a?.isMember === true || pat?.isMember === true;
        const rawMem = a?.membershipName ?? pat?.membershipName;
        let membershipName: string | undefined;
        if (typeof rawMem === 'string' && rawMem.trim() !== '') membershipName = rawMem.trim();
        else if (rawMem != null && String(rawMem).trim() !== '') membershipName = String(rawMem).trim();
        return { isMember, membershipName };
      })(),
    };
  });

  // --- Map personal blocks from the server (doctor-day merged visit order) ---
  const blockRows: any[] = Array.isArray(data?.personalBlocks) ? data.personalBlocks : [];
  const blockAppts: DoctorDayAppt[] = blockRows.map((b) => ({
    id: b?.id ?? `block-${String(b?.startIso || b?.appointmentStart || '')}`,
    clientName: b?.title ?? 'Block',
    appointmentType: b?.blockLabel ?? b?.title ?? 'Block',
    description: b?.description,
    // never routable, no coordinates:
    routingAvailable: false,
    isNoLocation: true,
    startIso: b?.startIso ?? b?.appointmentStart ?? undefined,
    endIso: b?.endIso ?? b?.appointmentEnd ?? undefined,
    type: 'block',
    isBlock: true,
    isPersonalBlock: true,
    blockLabel: b?.blockLabel ?? b?.title,
    title: b?.title,
  }));

  // Combine & let the page sort by start time as usual
  const combined: DoctorDayAppt[] = [...appointments, ...blockAppts];

  return {
    date: data?.date,
    startDepot: data?.startDepot ?? null,
    endDepot: data?.endDepot ?? null,
    startDepotTime: data?.startDepotTime,
    endDepotTime: data?.endDepotTime,
    appointments: combined,
  };
}

/* =========================
   Doctor Month API (NEW)
   ========================= */

export type DoctorMonthAppt = {
  id: number | string;
  startIso: string;
  endIso: string;
  title?: string;
  serviceMinutes?: number;
  /** Required for points calculation (per patient: 1 standard, 0.5 tech, 2 euthanasia). Backend should include in month response. */
  appointmentType?: string;

  /** Client id for multi-pet detection (same client + same time = one block, divide time by N). */
  clientId?: number | string | null;
  clientPimsId?: string | null;

  // Zones per appointment (same semantics as day API)
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;
};

export type DoctorMonthBlock = {
  id: number | string;
  startIso: string;
  endIso: string;
  title?: string;
};

export type DoctorMonthDay = {
  date: string; // YYYY-MM-DD
  timezone: string;
  workStartLocal?: string;
  workEndLocal?: string;
  appts: DoctorMonthAppt[];
  blocks: DoctorMonthBlock[];
  // driveSeconds?: number; // if you add later
};

export type DoctorMonthResponse = {
  doctorId: string;
  year: number;
  month: number; // 1-12
  timezone: string;
  days: DoctorMonthDay[];
};

export async function fetchDoctorMonth(
  year: number,
  month: number, // 1-12
  doctorId?: string
): Promise<DoctorMonthResponse> {
  const params: Record<string, string | number> = { year, month };
  if (doctorId && String(doctorId).trim() !== '') params.doctorId = String(doctorId);

  const { data } = await http.get('/appointments/doctor/month', { params });

  // Map zones and appointmentType (for VSD points); gracefully handle servers that don’t send zone fields
  const days: DoctorMonthDay[] = (data?.days ?? []).map((d: any) => ({
    date: d?.date,
    timezone: d?.timezone,
    workStartLocal: d?.workStartLocal,
    workEndLocal: d?.workEndLocal,
    appts: (d?.appts ?? []).map((a: any) => ({
      id: a?.id,
      startIso: a?.startIso,
      endIso: a?.endIso,
      title: a?.title,
      serviceMinutes: a?.serviceMinutes,
      appointmentType: a?.appointmentType?.name ?? a?.appointmentType ?? undefined,
      clientId: a?.clientId ?? a?.client?.id ?? undefined,
      clientPimsId: a?.clientPimsId ?? a?.client?.pimsId ?? undefined,
      clientZone: toMiniZone(a?.clientZone),
      effectiveZone: toMiniZone(a?.effectiveZone),
    })),
    blocks: (d?.blocks ?? []).map((b: any) => ({
      id: b?.id,
      startIso: b?.startIso,
      endIso: b?.endIso,
      title: b?.title,
    })),
  }));

  return {
    doctorId: String(data?.doctorId ?? doctorId ?? ''),
    year: Number(data?.year ?? year),
    month: Number(data?.month ?? month),
    timezone: data?.timezone ?? days[0]?.timezone ?? 'America/New_York',
    days,
  };
}
