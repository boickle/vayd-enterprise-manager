// Find or create a Room Loader record for a scheduler appointment (context menu → details modal)
import { DateTime } from 'luxon';
import {
  createRoomLoaders,
  searchRoomLoaders,
  type Appointment,
  type RoomLoader,
} from '../api/roomLoader';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function roomLoaderIncludesAppointment(rl: RoomLoader, apptId: number): boolean {
  return (rl.appointments ?? []).some((a) => Number(a.id) === apptId);
}

export async function findRoomLoaderForAppointment(
  appt: Appointment,
  practiceTz: string
): Promise<RoomLoader | null> {
  const dt = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const apptDay = dt.isValid ? dt.toISODate() : null;
  if (!apptDay) return null;

  const rows = await searchRoomLoaders({
    practiceId: PRACTICE_ID,
    appointmentFrom: apptDay,
    appointmentTo: apptDay,
    activeOnly: true,
  });

  return (
    rows.find((r) => roomLoaderIncludesAppointment(r, Number(appt.id))) ??
    rows.find((r) => {
      const clientId = appt.client?.id;
      if (clientId == null) return false;
      const rlClientId = r.patients?.[0]?.clients?.[0]?.id ?? r.appointments?.[0]?.client?.id;
      return rlClientId != null && Number(rlClientId) === Number(clientId);
    }) ??
    null
  );
}

export async function resolveRoomLoaderIdForAppointment(
  appt: Appointment,
  practiceTz: string
): Promise<number | null> {
  const match = await findRoomLoaderForAppointment(appt, practiceTz);
  if (match?.id) return match.id;

  const patientIds = [
    appt.patient?.id,
    ...(appt as { patients?: { id?: number }[] }).patients?.map((p) => p.id) ?? [],
  ]
    .filter((id): id is number => id != null && Number.isFinite(Number(id)))
    .map((id) => Number(id));
  const uniquePatients = [...new Set(patientIds)];

  const body: {
    practice: { id: number };
    appointments: { id: number }[];
    patients?: { id: number }[];
  } = {
    practice: { id: PRACTICE_ID },
    appointments: [{ id: Number(appt.id) }],
  };
  if (uniquePatients.length) body.patients = uniquePatients.map((id) => ({ id }));

  const created = await createRoomLoaders(body);
  const rowsCreated = Array.isArray(created) ? created : [];
  return rowsCreated[0]?.id ?? null;
}
