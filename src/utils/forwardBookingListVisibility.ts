import type { Appointment } from '../api/roomLoader';
import {
  fetchAppointmentById,
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
} from '../api/appointments';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { forwardBookingIsBookLater } from './forwardBookingBookLater';
import {
  forwardBookingHasLinkedVisit,
  forwardBookingLinkedAppointmentId,
} from './forwardBookingLinkedVisit';
import { linkedAppointmentBookedAtIso } from './forwardBookingOnHold';
import {
  buildAppointmentTypeCatalog,
  pointsFromAppointmentRows,
  pointsPerPatientForType,
  type AppointmentTypeCatalog,
} from './appointmentTypeSettings';
import { resolveSchedulerProviderFilterFromAppointment } from './schedulerFocusAppointment';
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
  /** Primary provider internal id on the booked appointment (for calendar focus). */
  providerInternalId?: string | null;
  /** When the linked calendar appointment was created / booked (ISO). */
  appointmentBookedAtIso?: string | null;
  /** True when the linked visit was cancelled / removed on the practice calendar. */
  appointmentCancelled?: boolean;
};

export async function buildBookedAppointmentMetaMap(
  entries: ForwardBookingEntry[],
  practiceId: number,
  catalog: AppointmentTypeCatalog,
  providers: ReadonlyArray<{ id: number | string; pimsId?: string | number | null | undefined }> = []
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
      const providerInternalId = appt
        ? resolveSchedulerProviderFilterFromAppointment(appt, providers) || null
        : null;
      const appointmentBookedAtIso = appt ? linkedAppointmentBookedAtIso(appt) : null;
      const appointmentCancelled = appt
        ? isAppointmentCancelledOnPracticeCalendar(appt)
        : false;
      map.set(id, { points, typeName, providerInternalId, appointmentBookedAtIso, appointmentCancelled });
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

/** Rows stay on the list; Booked / On Hold until staff marks follow-up complete. */
export function forwardBookingEntryVisibleOnList(_entry: ForwardBookingEntry): boolean {
  return true;
}

export type ForwardBookingListTab =
  | 'pending'
  | 'bookLater'
  | 'onHold'
  | 'booked'
  | 'complete'
  | 'removed';

export function forwardBookingLinkedAppointmentPoints(
  entry: ForwardBookingEntry,
  bookedApptMeta: Map<number, BookedAppointmentMeta> | null | undefined,
  catalog?: AppointmentTypeCatalog | null
): number | null {
  const apptId = forwardBookingLinkedAppointmentId(entry);
  if (apptId != null && bookedApptMeta != null && bookedApptMeta.has(apptId)) {
    return bookedApptMeta.get(apptId)!.points;
  }
  if (!forwardBookingHasLinkedVisit(entry) || !catalog) return null;
  const typeId = entry.appointmentTypeId;
  const typeName = entry.appointmentTypeName;
  if (typeId == null && !typeName?.trim()) return null;
  return pointsPerPatientForType(catalog, { typeId, typeName });
}

/** Linked calendar hold was cancelled — treat like a removed queue row for list tabs. */
export function forwardBookingLinkedAppointmentCancelled(
  entry: ForwardBookingEntry,
  bookedApptMeta: Map<number, BookedAppointmentMeta> | null | undefined,
): boolean {
  const apptId = forwardBookingLinkedAppointmentId(entry);
  if (apptId == null || bookedApptMeta == null || !bookedApptMeta.has(apptId)) {
    return false;
  }
  return bookedApptMeta.get(apptId)!.appointmentCancelled === true;
}

/** Forward booking treats linked visits with 0 ops points as on hold (tab + badge). */
export function forwardBookingLinkedVisitIsOnHold(
  entry: ForwardBookingEntry,
  bookedApptMeta: Map<number, BookedAppointmentMeta> | null | undefined,
  catalog?: AppointmentTypeCatalog | null
): boolean {
  if (!forwardBookingHasLinkedVisit(entry)) return false;
  if (forwardBookingLinkedAppointmentCancelled(entry, bookedApptMeta)) return false;
  const points = forwardBookingLinkedAppointmentPoints(entry, bookedApptMeta, catalog);
  return points != null && points <= 0;
}

/** Which filter tab a forward-booking row belongs on (0-point linked visits → On Hold). */
export function forwardBookingListTab(
  entry: ForwardBookingEntry,
  practiceTz: string,
  bookedApptMeta?: Map<number, BookedAppointmentMeta> | null,
  catalog?: AppointmentTypeCatalog | null
): ForwardBookingListTab {
  if (entry.status === 'removed') return 'removed';
  if (entry.status === 'complete') return 'complete';
  if (forwardBookingIsBookLater(entry, practiceTz)) return 'bookLater';
  if (forwardBookingHasLinkedVisit(entry)) {
    if (forwardBookingLinkedAppointmentCancelled(entry, bookedApptMeta)) {
      return 'removed';
    }
    const points = forwardBookingLinkedAppointmentPoints(entry, bookedApptMeta, catalog);
    if (points != null && points <= 0) return 'onHold';
    if (points != null && points > 0) return 'booked';
    // Linked visit — meta still loading; keep visible on Needs booking briefly.
    return 'pending';
  }
  return 'pending';
}
