import type { Appointment } from '../api/roomLoader';
import { fetchAppointmentById, isPracticeCalendarBlockAppointment } from '../api/appointments';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { forwardBookingLinkedAppointmentId } from './forwardBookingLinkedVisit';
import {
  buildAppointmentTypeCatalog,
  pointsFromAppointmentRows,
  type AppointmentTypeCatalog,
} from './appointmentTypeSettings';
import type { AppointmentType } from '../api/appointmentSettings';

function appointmentTypeName(appt: Appointment): string | null {
  const at = appt.appointmentType;
  if (!at) return null;
  const s = String(at.name ?? at.prettyName ?? '').trim();
  return s || null;
}

function appointmentTypeId(appt: Appointment): number | undefined {
  const at = appt.appointmentType;
  if (at && typeof at === 'object' && at.id != null && Number.isFinite(Number(at.id))) {
    return Number(at.id);
  }
  const raw = (appt as { appointmentTypeId?: number }).appointmentTypeId;
  if (raw != null && Number.isFinite(Number(raw))) return Number(raw);
  return undefined;
}

/** Ops points for a single booked appointment (same rules as My Day / VSD). */
export function opsPointsForAppointment(
  appt: Appointment,
  catalog: AppointmentTypeCatalog
): number {
  if (isPracticeCalendarBlockAppointment(appt)) return 0;
  return pointsFromAppointmentRows(
    [
      {
        appointmentType: appointmentTypeName(appt),
        appointmentTypeId: appointmentTypeId(appt),
        isPersonalBlock: false,
      },
    ],
    catalog
  );
}

export function buildAppointmentTypeCatalogFromTypes(types: AppointmentType[]): AppointmentTypeCatalog {
  return buildAppointmentTypeCatalog(Array.isArray(types) ? types : []);
}

export type BookedAppointmentMeta = {
  points: number;
  typeName: string | null;
};

export async function buildBookedAppointmentMetaMap(
  entries: ForwardBookingEntry[],
  practiceId: number,
  catalog: AppointmentTypeCatalog
): Promise<Map<number, BookedAppointmentMeta>> {
  const ids = [
    ...new Set(
      entries
        .map((e) => forwardBookingLinkedAppointmentId(e))
        .filter((id): id is number => id != null)
    ),
  ];
  const map = new Map<number, BookedAppointmentMeta>();
  await Promise.all(
    ids.map(async (id) => {
      const appt = await fetchAppointmentById(id, { practiceId });
      const points = appt ? opsPointsForAppointment(appt, catalog) : 0;
      const typeName = appt ? appointmentTypeName(appt) : null;
      map.set(id, { points, typeName });
    })
  );
  return map;
}

export async function buildBookedAppointmentPointsMap(
  entries: ForwardBookingEntry[],
  practiceId: number,
  catalog: AppointmentTypeCatalog
): Promise<Map<number, number>> {
  const meta = await buildBookedAppointmentMetaMap(entries, practiceId, catalog);
  const map = new Map<number, number>();
  for (const [id, { points }] of meta) {
    map.set(id, points);
  }
  return map;
}

/** Rows stay on the list; Booked tab until staff marks follow-up complete. */
export function forwardBookingEntryVisibleOnList(_entry: ForwardBookingEntry): boolean {
  return true;
}
