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
  lat: number;
  lon: number;
  startIso?: string;

  // NEW: structured address fields
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;

  // NEW: expected arrival time
  expectedArrivalIso?: string;
};

export type DoctorDayResponse = {
  date?: string;
  startDepot?: Depot | null;
  endDepot?: Depot | null;
  appointments: DoctorDayAppt[];
};

export async function fetchDoctorDay(dateISO: string): Promise<DoctorDayResponse> {
  const { data } = await http.get('/appointments/doctor', {
    params: { date: dateISO },
  });

  const rows: any[] = data?.appointments ?? data ?? [];
  console.log(rows);
  const appointments: DoctorDayAppt[] = rows
    .map((a) => ({
      id: a?.id,
      clientName: a?.clientName ?? 'Client',
      clientPimsId: a?.clientPimsId,
      patientName: a?.patientName,
      patientPimsId: a?.patientPimsId,
      confirmStatusName: a?.confirmStatusName ?? undefined,
      lat: a?.lat,
      lon: a?.lon,
      startIso: a?.startIso ?? a?.appointmentStart ?? a?.scheduledStartIso,
      endIso: a?.endIso ?? a?.appointmentEnd ?? a?.scheduledEndIso,

      // new structured address fields
      address1: a?.address1 ?? undefined,
      city: a?.city ?? undefined,
      state: a?.state ?? undefined,
      zip: a?.zip ?? undefined,

      // new expected arrival field
      expectedArrivalIso: a?.expectedArrivalIso ?? undefined,
    }))
    .filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number');

  return {
    date: data?.date,
    startDepot: data?.startDepot ?? null,
    endDepot: data?.endDepot ?? null,
    appointments,
  };
}
