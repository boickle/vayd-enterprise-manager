// src/api/appointments.ts
import { http } from './http';

export type Depot = { lat: number; lon: number };

export type MiniZone = { id: number | string; name: string | null } | null;

export type DoctorDayAppt = {
  id: number | string;
  clientName: string;
  clientPimsId?: string;
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
  statusName?: string;

  expectedArrivalIso?: string;
  routingAvailable?: boolean;
  isNoLocation?: boolean;

  // Zones
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;
};

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

export async function fetchDoctorDay(
  dateISO: string,
  doctorId?: string
): Promise<DoctorDayResponse> {
  const params: Record<string, string> = { date: dateISO };
  if (doctorId && String(doctorId).trim() !== '') params.doctorId = String(doctorId);

  const { data } = await http.get('/appointments/doctor', { params });

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
      patientName: a?.patientName,
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
      statusName: a?.statusName,

      expectedArrivalIso: a?.expectedArrivalIso ?? undefined,
      routingAvailable: a?.routingAvailable,
      isNoLocation: backendNoLoc || !(typeof lat === 'number' && typeof lon === 'number'),

      clientZone: toMiniZone(a?.clientZone),
      effectiveZone: toMiniZone(a?.effectiveZone),
    };
  });

  return {
    date: data?.date,
    startDepot: data?.startDepot ?? null,
    endDepot: data?.endDepot ?? null,
    startDepotTime: data?.startDepotTime,
    endDepotTime: data?.endDepotTime,
    appointments,
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

  // Map zones for each appt; gracefully handle servers that don’t send zone fields
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
