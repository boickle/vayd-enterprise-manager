import { DateTime } from 'luxon';
import {
  fetchAppointmentById,
  fetchAppointmentsRange,
  isAppointmentCancelledOnPracticeCalendar,
  localDayUtcRange,
} from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import type { Appointment } from '../api/roomLoader';
import { clientDisplayNameFromRequestData } from './appointmentRequestDisplay';
import {
  appointmentRequestBookedSummaryFromAppointment,
  type AppointmentRequestBookedApptSummary,
} from './appointmentRequestOnHold';
import { appointmentPracticeDateKey } from './editVisitTimeFields';
import { opsPointsForAppointment } from './forwardBookingListVisibility';
import { resolveHouseholdVisitAppointments } from './schedulerAddPet';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';

export type HouseholdHoldClumpIndex = Map<number, number[]>;

export function appointmentRequestHouseholdClumpIds(
  bookedApptId: number | null | undefined,
  clumpByBookedApptId: ReadonlyMap<number, number[]> | null | undefined,
): number[] {
  if (bookedApptId == null || !Number.isFinite(Number(bookedApptId))) return [];
  const anchorId = Number(bookedApptId);
  return clumpByBookedApptId?.get(anchorId) ?? [anchorId];
}

export function appointmentRequestHouseholdAnyOnHold(
  clumpApptIds: readonly number[],
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
): boolean {
  for (const id of clumpApptIds) {
    const summary = bookedApptMeta.get(id);
    if (summary != null && !summary.appointmentCancelled && summary.points <= 0) return true;
  }
  return false;
}

export function appointmentRequestHouseholdAnyOver24Hours(
  clumpApptIds: readonly number[],
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
): boolean {
  for (const id of clumpApptIds) {
    const summary = bookedApptMeta.get(id);
    if (summary == null || summary.appointmentCancelled || summary.points > 0) continue;
    const iso = summary.appointmentBookedAtIso?.trim();
    if (!iso) continue;
    const placed = DateTime.fromISO(iso, { zone: 'utc' });
    if (!placed.isValid) continue;
    if (DateTime.now().diff(placed, 'hours').hours >= 24) return true;
  }
  return false;
}

export type HouseholdHoldExitKind = 'booked' | 'removed' | 'updated';

/** Exit list only when every non-cancelled household hold is converted off hold. */
export function resolveHouseholdHoldExitKind(
  appointments: readonly Appointment[],
  typeCatalog: AppointmentTypeCatalog,
): HouseholdHoldExitKind {
  let anyOnHold = false;
  let anyActive = false;
  for (const appt of appointments) {
    if (isAppointmentCancelledOnPracticeCalendar(appt)) continue;
    anyActive = true;
    if (opsPointsForAppointment(appt, typeCatalog) <= 0) anyOnHold = true;
  }
  if (!anyActive) return 'removed';
  if (!anyOnHold) return 'booked';
  return 'updated';
}

function apptKey(a: Appointment): string {
  return String(a.id);
}

export async function buildAppointmentRequestHouseholdHoldIndex(args: {
  items: AppointmentRequestSubmissionItem[];
  typeCatalog: AppointmentTypeCatalog;
  practiceId: number;
  practiceTz: string;
  seedMeta?: Map<number, AppointmentRequestBookedApptSummary>;
}): Promise<{
  meta: Map<number, AppointmentRequestBookedApptSummary>;
  clumpByBookedApptId: HouseholdHoldClumpIndex;
}> {
  const { items, typeCatalog, practiceId, practiceTz, seedMeta } = args;
  const bookedItems = items.filter((r) => r.bookedAppointmentId != null);
  const uniqueBooked = [
    ...new Set(
      bookedItems
        .map((r) => Number(r.bookedAppointmentId))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];

  const meta = seedMeta ? new Map(seedMeta) : new Map<number, AppointmentRequestBookedApptSummary>();
  const clumpByBookedApptId: HouseholdHoldClumpIndex = new Map();

  if (uniqueBooked.length === 0) {
    return { meta, clumpByBookedApptId };
  }

  const anchorAppts = new Map<number, Appointment>();
  await Promise.all(
    uniqueBooked.map(async (id) => {
      const appt = await fetchAppointmentById(id, { practiceId });
      if (appt?.appointmentStart) anchorAppts.set(id, appt);
    }),
  );

  const dayKeys = new Set<string>();
  for (const appt of anchorAppts.values()) {
    const dk = appointmentPracticeDateKey(appt.appointmentStart, practiceTz);
    if (dk) dayKeys.add(dk);
  }

  const allApptsById = new Map<string, Appointment>();
  for (const appt of anchorAppts.values()) {
    allApptsById.set(apptKey(appt), appt);
  }

  await Promise.all(
    [...dayKeys].map(async (dateIso) => {
      const { start, end } = localDayUtcRange(dateIso, practiceTz);
      const range = await fetchAppointmentsRange({ practiceId, start, end });
      for (const row of range) {
        if (row?.id != null) allApptsById.set(apptKey(row), row);
      }
    }),
  );

  const allAppts = [...allApptsById.values()];

  for (const item of bookedItems) {
    const anchorId = Number(item.bookedAppointmentId);
    const anchor = anchorAppts.get(anchorId);
    if (!anchor) {
      clumpByBookedApptId.set(anchorId, [anchorId]);
      continue;
    }
    const clientLabel = clientDisplayNameFromRequestData(item.requestData ?? {});
    const clump = resolveHouseholdVisitAppointments(anchor, allAppts, practiceTz, {
      clientLabel,
    });
    const ids = clump
      .map((a) => Number(a.id))
      .filter((id) => Number.isFinite(id) && id > 0);
    clumpByBookedApptId.set(anchorId, ids.length > 0 ? ids : [anchorId]);
  }

  const metaIds = new Set<number>();
  for (const ids of clumpByBookedApptId.values()) {
    for (const id of ids) metaIds.add(id);
  }

  await Promise.all(
    [...metaIds].map(async (id) => {
      const fromRange = allApptsById.get(String(id));
      const appt = fromRange ?? (await fetchAppointmentById(id, { practiceId }));
      if (!appt?.appointmentStart) return;
      meta.set(
        id,
        appointmentRequestBookedSummaryFromAppointment(
          appt as Record<string, unknown> & { appointmentStart?: string | null },
          opsPointsForAppointment(appt as Parameters<typeof opsPointsForAppointment>[0], typeCatalog),
        ),
      );
    }),
  );

  return { meta, clumpByBookedApptId };
}
