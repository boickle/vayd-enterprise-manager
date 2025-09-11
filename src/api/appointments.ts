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
    }))
    .filter((r) => typeof r.lat === 'number' && typeof r.lon === 'number');

  return {
    date: data?.date,
    startDepot: data?.startDepot ?? null,
    endDepot: data?.endDepot ?? null,
    appointments,
  };
}
