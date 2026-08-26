import { DateTime } from 'luxon';
import {
  fetchAppointmentById,
  fetchAppointmentsRange,
  isAppointmentCancelledOnPracticeCalendar,
} from '../api/appointments';
import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';
import type { Appointment } from '../api/roomLoader';
import { requestDataSelfScheduledSlot, clientDisplayNameFromRequestData } from './appointmentRequestDisplay';
import {
  appointmentRequestBookedSummaryFromAppointment,
  type AppointmentRequestBookedApptSummary,
} from './appointmentRequestOnHold';
import { appointmentPracticeDateKey } from './editVisitTimeFields';
import { opsPointsForAppointment } from './forwardBookingListVisibility';
import { resolveHouseholdVisitAppointments } from './schedulerAddPet';
import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

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

function apptKey(id: number | string): string {
  return String(id);
}

/** Range rows often omit type fields; ops points need id or name on the appointment type. */
function appointmentTypeCompleteForOpsPoints(appt: Appointment): boolean {
  const at = appt.appointmentType;
  if (at && typeof at === 'object') {
    const o = at as { id?: unknown; name?: unknown; prettyName?: unknown };
    if (o.id != null && Number.isFinite(Number(o.id))) return true;
    const name = String(o.name ?? o.prettyName ?? '').trim();
    if (name) return true;
  }
  const atRaw = at as unknown;
  if (typeof atRaw === 'string' && atRaw.trim()) return true;
  const raw = (appt as { appointmentTypeId?: number }).appointmentTypeId;
  return raw != null && Number.isFinite(Number(raw));
}

function shouldReplaceAppointmentInIndex(existing: Appointment, incoming: Appointment): boolean {
  const existingComplete = appointmentTypeCompleteForOpsPoints(existing);
  const incomingComplete = appointmentTypeCompleteForOpsPoints(incoming);
  if (!existingComplete && incomingComplete) return true;
  if (existingComplete && !incomingComplete) return false;
  return false;
}

/** Range rows are for household clump discovery only — never overwrite a by-id row. */
function putRangeAppointmentInIndex(apptsById: Map<string, Appointment>, row: Appointment): void {
  if (row?.id == null) return;
  const key = apptKey(row.id);
  if (!apptsById.has(key)) {
    apptsById.set(key, row);
    return;
  }
  const existing = apptsById.get(key)!;
  if (!appointmentTypeCompleteForOpsPoints(existing) && shouldReplaceAppointmentInIndex(existing, row)) {
    apptsById.set(key, row);
  }
}

/** By-id fetch is authoritative for hold points and visit metadata. */
function putAppointmentByIdInIndex(apptsById: Map<string, Appointment>, row: Appointment): void {
  if (row?.id == null) return;
  apptsById.set(apptKey(row.id), row);
}

function isCompletedSubmission(item: AppointmentRequestSubmissionItem): boolean {
  return item.kind == null || item.kind === 'submission';
}

function practiceMonthUtcRange(
  yearMonth: string,
  practiceTz: string,
): { start: string; end: string } {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const anchor = DateTime.fromISO(`${yearMonth}-01`, { zone: tz });
  return {
    start: anchor.startOf('month').startOf('day').toUTC().toISO()!,
    end: anchor.endOf('month').endOf('day').toUTC().toISO()!,
  };
}

function monthKeysForPracticeDays(dayKeys: Iterable<string>, practiceTz: string): string[] {
  const months = new Set<string>();
  const tz = practiceTimeZoneOrDefault(practiceTz);
  for (const dk of dayKeys) {
    const dt = DateTime.fromISO(dk, { zone: tz });
    if (dt.isValid) months.add(dt.toFormat('yyyy-MM'));
  }
  return [...months].sort();
}

async function loadPracticeMonthRanges(
  monthKeys: string[],
  practiceId: number,
  practiceTz: string,
  apptsById: Map<string, Appointment>,
  loadedMonths: Set<string>,
): Promise<void> {
  const pending = monthKeys.filter((ym) => !loadedMonths.has(ym));
  if (pending.length === 0) return;

  await Promise.all(
    pending.map(async (ym) => {
      loadedMonths.add(ym);
      const { start, end } = practiceMonthUtcRange(ym, practiceTz);
      const range = await fetchAppointmentsRange({ practiceId, start, end });
      for (const row of range) {
        putRangeAppointmentInIndex(apptsById, row);
      }
    }),
  );
}

function dayKeysFromBookedItems(
  bookedItems: AppointmentRequestSubmissionItem[],
  practiceTz: string,
): Set<string> {
  const dayKeys = new Set<string>();
  for (const item of bookedItems) {
    const slot = requestDataSelfScheduledSlot(item.requestData ?? {});
    if (!slot?.appointmentStart) continue;
    const dk = appointmentPracticeDateKey(slot.appointmentStart, practiceTz);
    if (dk) dayKeys.add(dk);
  }
  return dayKeys;
}

function registerAnchorDay(
  anchorAppts: Map<number, Appointment>,
  dayKeys: Set<string>,
  id: number,
  appt: Appointment,
  practiceTz: string,
): void {
  if (!appt.appointmentStart) return;
  anchorAppts.set(id, appt);
  const dk = appointmentPracticeDateKey(appt.appointmentStart, practiceTz);
  if (dk) dayKeys.add(dk);
}

async function fetchAppointmentByIdForHoldIndex(
  id: number,
  practiceId: number,
  apptsById: Map<string, Appointment>,
): Promise<Appointment | null> {
  const appt = await fetchAppointmentById(id, { practiceId });
  if (appt?.id != null) {
    putAppointmentByIdInIndex(apptsById, appt);
    return appt;
  }
  return apptsById.get(apptKey(id)) ?? null;
}

/** Refresh hold summaries for specific calendar rows (websocket / incremental updates). */
export async function patchBookedApptMetaForAppointmentIds(args: {
  appointmentIds: readonly number[];
  practiceId: number;
  typeCatalog: AppointmentTypeCatalog;
}): Promise<Map<number, AppointmentRequestBookedApptSummary>> {
  const patches = new Map<number, AppointmentRequestBookedApptSummary>();
  const ids = [
    ...new Set(
      args.appointmentIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Number(id)),
    ),
  ];
  if (ids.length === 0) return patches;

  await Promise.all(
    ids.map(async (id) => {
      const appt = await fetchAppointmentById(id, { practiceId: args.practiceId });
      if (!appt?.appointmentStart) return;
      patches.set(
        id,
        appointmentRequestBookedSummaryFromAppointment(
          appt as Record<string, unknown> & { appointmentStart?: string | null },
          opsPointsForAppointment(appt as Parameters<typeof opsPointsForAppointment>[0], args.typeCatalog),
        ),
      );
    }),
  );

  return patches;
}

function calendarChangeAffectsAppointmentRequestHolds(
  changedApptIds: ReadonlySet<number>,
  rows: readonly AppointmentRequestSubmissionItem[],
  bookedApptMeta: ReadonlyMap<number, AppointmentRequestBookedApptSummary>,
): boolean {
  for (const id of changedApptIds) {
    if (bookedApptMeta.has(id)) return true;
  }
  for (const row of rows) {
    const anchorId = row.bookedAppointmentId;
    if (anchorId != null && changedApptIds.has(Number(anchorId))) return true;
  }
  return false;
}

export { calendarChangeAffectsAppointmentRequestHolds };

const HOLD_META_FETCH_CONCURRENCY = 8;

/** Reliable per-appointment hold metadata (same approach as forward booking). */
export async function buildAppointmentRequestBookedMetaByAppointmentIds(args: {
  appointmentIds: readonly number[];
  practiceId: number;
  typeCatalog: AppointmentTypeCatalog;
  seedMeta?: Map<number, AppointmentRequestBookedApptSummary>;
}): Promise<Map<number, AppointmentRequestBookedApptSummary>> {
  const meta = new Map<number, AppointmentRequestBookedApptSummary>();
  const ids = [
    ...new Set(
      args.appointmentIds.filter((id) => Number.isFinite(id) && id > 0).map((id) => Number(id)),
    ),
  ];
  if (ids.length === 0) {
    if (args.seedMeta) return new Map(args.seedMeta);
    return meta;
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < ids.length) {
      const id = ids[cursor++]!;
      const appt = await fetchAppointmentById(id, { practiceId: args.practiceId });
      if (!appt) continue;
      meta.set(
        id,
        appointmentRequestBookedSummaryFromAppointment(
          appt as Record<string, unknown> & { appointmentStart?: string | null },
          opsPointsForAppointment(appt as Parameters<typeof opsPointsForAppointment>[0], args.typeCatalog),
        ),
      );
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(HOLD_META_FETCH_CONCURRENCY, ids.length) }, () => worker()),
  );

  if (args.seedMeta) {
    for (const [id, summary] of args.seedMeta) {
      if (!meta.has(id)) meta.set(id, summary);
    }
  }

  return meta;
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
  const bookedItems = items.filter(
    (r) => isCompletedSubmission(r) && r.bookedAppointmentId != null,
  );
  const uniqueBooked = [
    ...new Set(
      bookedItems
        .map((r) => Number(r.bookedAppointmentId))
        .filter((id) => Number.isFinite(id) && id > 0),
    ),
  ];

  const clumpByBookedApptId: HouseholdHoldClumpIndex = new Map();

  if (uniqueBooked.length === 0) {
    return {
      meta: await buildAppointmentRequestBookedMetaByAppointmentIds({
        appointmentIds: [],
        practiceId,
        typeCatalog,
        seedMeta,
      }),
      clumpByBookedApptId,
    };
  }

  const apptsById = new Map<string, Appointment>();
  const anchorAppts = new Map<number, Appointment>();
  const dayKeys = dayKeysFromBookedItems(bookedItems, practiceTz);
  const loadedMonths = new Set<string>();

  await loadPracticeMonthRanges(
    monthKeysForPracticeDays(dayKeys, practiceTz),
    practiceId,
    practiceTz,
    apptsById,
    loadedMonths,
  );

  let anchorCursor = 0;
  async function anchorWorker(): Promise<void> {
    while (anchorCursor < uniqueBooked.length) {
      const id = uniqueBooked[anchorCursor++]!;
      const appt = await fetchAppointmentByIdForHoldIndex(id, practiceId, apptsById);
      if (appt?.appointmentStart) {
        registerAnchorDay(anchorAppts, dayKeys, id, appt, practiceTz);
      }
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(HOLD_META_FETCH_CONCURRENCY, uniqueBooked.length) },
      () => anchorWorker(),
    ),
  );

  await loadPracticeMonthRanges(
    monthKeysForPracticeDays(dayKeys, practiceTz),
    practiceId,
    practiceTz,
    apptsById,
    loadedMonths,
  );

  const allAppts = [...apptsById.values()];

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

  const meta = await buildAppointmentRequestBookedMetaByAppointmentIds({
    appointmentIds: [...metaIds],
    practiceId,
    typeCatalog,
    seedMeta,
  });

  return { meta, clumpByBookedApptId };
}
