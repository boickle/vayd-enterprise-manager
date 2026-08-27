import { fetchAppointmentById } from '../api/appointments';

export function optimizeClientId(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Doctor-day suggestions often have a client name but no internal id. Load it from the visit. */
export async function resolveScheduleOptimizeClientId(args: {
  clientId?: number | null;
  appointmentIds: readonly number[];
  practiceId: number;
}): Promise<number | null> {
  const existing = optimizeClientId(args.clientId);
  if (existing != null) return existing;
  for (const id of args.appointmentIds) {
    if (!Number.isFinite(id) || id <= 0) continue;
    try {
      const appt = await fetchAppointmentById(id, { practiceId: args.practiceId });
      const cid = optimizeClientId(appt?.client?.id);
      if (cid != null) return cid;
    } catch {
      /* try the next household visit */
    }
  }
  return null;
}

export function scheduleOptimizeCanAttemptText(row: {
  clientId?: number | null;
  appointmentIds?: readonly number[];
}): boolean {
  if (optimizeClientId(row.clientId) != null) return true;
  return (row.appointmentIds ?? []).some((id) => Number.isFinite(id) && id > 0);
}
