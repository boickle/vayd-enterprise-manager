// Find or create a Room Loader record for a scheduler appointment (context menu → details modal)
import { DateTime } from 'luxon';
import {
  createRoomLoaders,
  searchRoomLoaders,
  upsertRoomLoaders,
  type Appointment,
  type RoomLoader,
} from '../api/roomLoader';
import {
  appointmentsInClientVisitClump,
  patientsForAppointment,
} from './schedulerAddPet';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function roomLoaderAppointmentIds(rl: RoomLoader): number[] {
  return (rl.appointments ?? [])
    .map((a) => Number(a.id))
    .filter((id) => Number.isFinite(id));
}

function roomLoaderPatientIds(rl: RoomLoader): number[] {
  const ids = new Set<number>();
  for (const p of rl.patients ?? []) {
    if (p.id != null && Number.isFinite(Number(p.id))) ids.add(Number(p.id));
  }
  for (const a of rl.appointments ?? []) {
    if (a.patient?.id != null && Number.isFinite(Number(a.patient.id))) {
      ids.add(Number(a.patient.id));
    }
  }
  return [...ids];
}

function resolveVisitClump(
  appt: Appointment,
  allAppointments: Appointment[] | undefined,
  practiceTz: string
): Appointment[] {
  if (!allAppointments?.length) return [appt];
  const clump = appointmentsInClientVisitClump(appt, allAppointments, practiceTz);
  return clump.length > 0 ? clump : [appt];
}

function collectClumpAppointmentIds(clump: Appointment[]): number[] {
  return [...new Set(clump.map((a) => Number(a.id)).filter((id) => Number.isFinite(id)))];
}

function collectClumpPatientIds(clump: Appointment[]): number[] {
  const ids = new Set<number>();
  for (const a of clump) {
    for (const p of patientsForAppointment(a)) {
      if (p.id != null && Number.isFinite(Number(p.id))) ids.add(Number(p.id));
    }
  }
  return [...ids];
}

function sentStatusRank(sentStatus: string | null | undefined): number {
  const s = (sentStatus ?? '').trim().toLowerCase().replace(/\s+/g, '_');
  if (s === 'completed' || s === 'complete') return 3;
  if (s === 'sent' || s.startsWith('sent_')) return 2;
  if (s && s !== 'not_sent') return 1;
  return 0;
}

/**
 * Prefer appointment-id overlap; fall back to same-day patient overlap so a
 * doctor-to-doctor move (new appointment id / stale RL links) still honors the
 * filled-out room loader instead of creating a blank not_sent one.
 */
function findBestRoomLoaderForClump(
  rows: RoomLoader[],
  clumpAppointmentIds: number[],
  clumpPatientIds: number[] = []
): RoomLoader | null {
  if (clumpAppointmentIds.length === 0 && clumpPatientIds.length === 0) return null;

  const clumpApptSet = new Set(clumpAppointmentIds);
  const clumpPatientSet = new Set(clumpPatientIds);
  let best: RoomLoader | null = null;
  let bestScore = -1;

  for (const row of rows) {
    const rlApptIds = roomLoaderAppointmentIds(row);
    const rlPatientIds = roomLoaderPatientIds(row);
    const apptOverlap = rlApptIds.filter((id) => clumpApptSet.has(id)).length;
    const patientOverlap = rlPatientIds.filter((id) => clumpPatientSet.has(id)).length;
    if (apptOverlap === 0 && patientOverlap === 0) continue;

    const coversAllAppts =
      clumpApptSet.size > 0 && apptOverlap === clumpApptSet.size;
    const coversAllPatients =
      clumpPatientSet.size > 0 && patientOverlap === clumpPatientSet.size;
    const score =
      // Prefer filled-out loaders over blank not_sent rows that may have been
      // auto-linked to a re-keyed appointment after a doctor move.
      sentStatusRank(row.sentStatus) * 1_000_000 +
      apptOverlap * 100_000 +
      (coversAllAppts ? 50_000 : 0) +
      patientOverlap * 1_000 +
      (coversAllPatients ? 500 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = row;
    }
  }

  return best;
}

export async function findRoomLoaderForAppointment(
  appt: Appointment,
  practiceTz: string,
  allAppointments?: Appointment[]
): Promise<RoomLoader | null> {
  const clump = resolveVisitClump(appt, allAppointments, practiceTz);
  const clumpAppointmentIds = collectClumpAppointmentIds(clump);
  const clumpPatientIds = collectClumpPatientIds(clump);

  const dt = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const apptDay = dt.isValid ? dt.toISODate() : null;
  if (!apptDay) return null;

  const rows = await searchRoomLoaders({
    practiceId: PRACTICE_ID,
    appointmentFrom: apptDay,
    appointmentTo: apptDay,
    activeOnly: true,
  });

  return findBestRoomLoaderForClump(rows, clumpAppointmentIds, clumpPatientIds);
}

async function mergeClumpIntoRoomLoader(
  existing: RoomLoader,
  clumpAppointmentIds: number[],
  clumpPatientIds: number[]
): Promise<number> {
  const mergedApptIds = new Set([...roomLoaderAppointmentIds(existing), ...clumpAppointmentIds]);
  const mergedPatientIds = new Set([...roomLoaderPatientIds(existing), ...clumpPatientIds]);

  const existingApptIds = new Set(roomLoaderAppointmentIds(existing));
  const existingPatientIds = new Set(roomLoaderPatientIds(existing));
  const needsMerge =
    clumpAppointmentIds.some((id) => !existingApptIds.has(id)) ||
    clumpPatientIds.some((id) => !existingPatientIds.has(id));

  if (!needsMerge) return existing.id;

  try {
    const updated = await upsertRoomLoaders({
      id: existing.id,
      practice: { id: PRACTICE_ID },
      appointments: [...mergedApptIds].map((id) => ({ id })),
      patients: [...mergedPatientIds].map((id) => ({ id })),
    });
    return updated[0]?.id ?? existing.id;
  } catch {
    return existing.id;
  }
}

export async function resolveRoomLoaderIdForAppointment(
  appt: Appointment,
  practiceTz: string,
  allAppointments?: Appointment[]
): Promise<number | null> {
  const clump = resolveVisitClump(appt, allAppointments, practiceTz);
  const clumpAppointmentIds = collectClumpAppointmentIds(clump);
  const clumpPatientIds = collectClumpPatientIds(clump);

  const match = await findRoomLoaderForAppointment(appt, practiceTz, allAppointments);
  if (match?.id) {
    return mergeClumpIntoRoomLoader(match, clumpAppointmentIds, clumpPatientIds);
  }

  const body: {
    practice: { id: number };
    appointments: { id: number }[];
    patients?: { id: number }[];
  } = {
    practice: { id: PRACTICE_ID },
    appointments: clumpAppointmentIds.map((id) => ({ id })),
  };
  if (clumpPatientIds.length) {
    body.patients = clumpPatientIds.map((id) => ({ id }));
  }

  const created = await createRoomLoaders(body);
  const rowsCreated = Array.isArray(created) ? created : [];
  return rowsCreated[0]?.id ?? null;
}
