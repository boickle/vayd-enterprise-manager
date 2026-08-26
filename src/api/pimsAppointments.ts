import { http } from './http';
import type { Appointment } from './roomLoader';

/**
 * Staff PIMS appointment history — scoped endpoints (not GET /appointments/range).
 *
 * Backend contract (implement both):
 *
 * - GET /patients/:patientId/appointments
 *   Query: practiceId (number, optional if implied by auth), start, end (ISO 8601 UTC).
 *   Optional: includeInactivePatient=true — when the patient record is inactive but history should still return.
 *   Response: Appointment[] | { appointments: Appointment[] } | { items: Appointment[] }
 *
 * - GET /clients/:clientId/appointments
 *   Query: practiceId, start, end (ISO 8601 UTC).
 *   Optional: activePatientsOnly=true (default) — only appointments whose patient is active;
 *     false — include appointments for inactive patients/pets as well.
 *   Response: same shapes as above.
 */

export function defaultPimsAppointmentHistoryRangeUtc(): { start: string; end: string } {
  const end = new Date();
  end.setUTCFullYear(end.getUTCFullYear() + 1);
  const start = new Date();
  start.setUTCFullYear(start.getUTCFullYear() - 8);
  return { start: start.toISOString(), end: end.toISOString() };
}

function extractAppointmentsArray(data: unknown): Appointment[] {
  if (Array.isArray(data)) return data as Appointment[];
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    const a = d.appointments ?? d.items ?? d.rows;
    if (Array.isArray(a)) return a as Appointment[];
  }
  return [];
}

export type PimsScopedAppointmentsParams = {
  practiceId: number;
  /** Defaults to {@link defaultPimsAppointmentHistoryRangeUtc}. */
  start?: string;
  end?: string;
};

/** GET /patients/:patientId/appointments */
export async function fetchPatientAppointmentsStaff(
  patientId: string | number,
  params: PimsScopedAppointmentsParams & { includeInactivePatient?: boolean }
): Promise<Appointment[]> {
  const { start, end } =
    params.start && params.end
      ? { start: params.start, end: params.end }
      : defaultPimsAppointmentHistoryRangeUtc();
  const query: Record<string, string | number | boolean> = {
    practiceId: params.practiceId,
    start,
    end,
  };
  if (params.includeInactivePatient === true) {
    query.includeInactivePatient = true;
  }
  const { data } = await http.get<unknown>(
    `/patients/${encodeURIComponent(String(patientId))}/appointments`,
    { params: query }
  );
  return extractAppointmentsArray(data);
}

/** GET /clients/:clientId/appointments */
export async function fetchClientAppointmentsStaff(
  clientId: string | number,
  params: PimsScopedAppointmentsParams & { activePatientsOnly?: boolean }
): Promise<Appointment[]> {
  const { start, end } =
    params.start && params.end
      ? { start: params.start, end: params.end }
      : defaultPimsAppointmentHistoryRangeUtc();
  const query: Record<string, string | number | boolean> = {
    practiceId: params.practiceId,
    start,
    end,
  };
  if (params.activePatientsOnly === false) {
    query.activePatientsOnly = false;
  } else {
    query.activePatientsOnly = true;
  }
  const { data } = await http.get<unknown>(
    `/clients/${encodeURIComponent(String(clientId))}/appointments`,
    { params: query }
  );
  return extractAppointmentsArray(data);
}

export function patientIdFromAppointment(a: Appointment): string | null {
  if (a.patient?.id != null && Number.isFinite(Number(a.patient.id))) return String(a.patient.id);
  const r = a as Record<string, unknown>;
  const v = r.patientId;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

export function clientIdFromAppointment(a: Appointment): string | null {
  if (a.client?.id != null && Number.isFinite(Number(a.client.id))) return String(a.client.id);
  const r = a as Record<string, unknown>;
  const v = r.clientId;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v === 'string' && v.trim()) return v.trim();
  return null;
}

/** True when the patient row should be treated as active for appointment filtering. */
export function isPatientRowActiveForListing(p: Record<string, unknown>): boolean {
  if (p.isDeleted === true) return false;
  if (p.isActive === false) return false;
  if (p.active === false) return false;
  return true;
}

export function appointmentMatchesPatientId(a: Appointment, patientId: string): boolean {
  const want = String(patientId);
  const multi = (a as { patients?: { id?: unknown }[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) {
    return multi.some((p) => p != null && String(p.id) === want);
  }
  const pid = patientIdFromAppointment(a);
  return pid != null && String(pid) === want;
}

export function appointmentMatchesClientId(a: Appointment, clientId: string): boolean {
  const cid = clientIdFromAppointment(a);
  return cid != null && String(cid) === String(clientId);
}

export function patientActiveForClientAppointment(
  appt: Appointment,
  clientPatients: Record<string, unknown>[]
): boolean {
  const pid = patientIdFromAppointment(appt);
  if (!pid) return true;
  const row = clientPatients.find((p) => p.id != null && String(p.id) === pid);
  if (!row) return true;
  return isPatientRowActiveForListing(row);
}
