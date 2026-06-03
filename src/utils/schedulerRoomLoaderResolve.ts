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

function findBestRoomLoaderForClump(
  rows: RoomLoader[],
  clumpAppointmentIds: number[]
): RoomLoader | null {
  if (clumpAppointmentIds.length === 0) return null;

  const clumpSet = new Set(clumpAppointmentIds);
  let best: RoomLoader | null = null;
  let bestScore = -1;

  for (const row of rows) {
    const rlApptIds = roomLoaderAppointmentIds(row);
    const overlap = rlApptIds.filter((id) => clumpSet.has(id)).length;
    if (overlap === 0) continue;

    const coversAll = overlap === clumpSet.size;
    const score = overlap * 100 + (coversAll ? 10_000 : 0);
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

  const dt = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const apptDay = dt.isValid ? dt.toISODate() : null;
  if (!apptDay) return null;

  const rows = await searchRoomLoaders({
    practiceId: PRACTICE_ID,
    appointmentFrom: apptDay,
    appointmentTo: apptDay,
    activeOnly: true,
  });

  return findBestRoomLoaderForClump(rows, clumpAppointmentIds);
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
