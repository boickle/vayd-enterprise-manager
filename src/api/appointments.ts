// src/api/appointments.ts
import { http } from './http';

export type Depot = { lat: number; lon: number };

export type DoctorDayAppt = {
  id: number | string;
  clientName: string;
  clientPimsId?: string;
  patientName?: string;
  patientPimsId?: string;
  confirmStatusName?: string;

  // Coordinates optional to allow "no-location" appts
  lat?: number;
  lon?: number;

  startIso?: string;
  endIso?: string;
  appointmentType?: string;

  // Structured address fields
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;

  description?: string;
  statusName?: string;

  // Expected arrival from routing
  expectedArrivalIso?: string;

  // Routing flags
  routingAvailable?: boolean;
  isNoLocation?: boolean;
};

export type DoctorDayResponse = {
  date?: string;
  startDepot?: Depot | null;
  endDepot?: Depot | null;
  startDepotTime: any;
  endDepotTime: any;
  appointments: DoctorDayAppt[];
};

export async function fetchDoctorDay(
  dateISO: string,
  doctorId?: string
): Promise<DoctorDayResponse> {
  const params: Record<string, string> = { date: dateISO };
  if (doctorId && String(doctorId).trim() !== '') {
    params.doctorId = String(doctorId);
  }

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
