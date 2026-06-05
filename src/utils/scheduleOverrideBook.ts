import {
  buildScheduleOverridePayload,
  buildScheduleOverrideDayOffPayload,
  createScheduleOverride,
  fetchEmployee,
  fetchScheduleOverrideByDate,
  formatScheduleOverrideApiError,
  updateScheduleOverride,
  scheduleOverrideIsOff,
} from '../api/appointmentSettings';
import { datesFromInclusiveRange } from './allDaySchedulingOverride';

export type ScheduleOverrideDraft = {
  workStartLocal: string;
  workEndLocal: string;
  startDepotLat?: number;
  startDepotLon?: number;
  endDepotLat?: number;
  endDepotLon?: number;
};

const emptyDraft = (dateStr: string): ScheduleOverrideDraft => ({
  workStartLocal: '',
  workEndLocal: '',
});

export type BookScheduleOverrideDefaults = {
  /** All-day vacation / OOO — default routing day off. */
  allDay: boolean;
  /** Practice-local HH:mm from the booked slot (in-day appointments). */
  slotStartLocal?: string;
  slotEndLocal?: string;
};

function weeklyDepotDefaults(
  employee: Awaited<ReturnType<typeof fetchEmployee>>,
  dateStr: string
): Pick<
  ScheduleOverrideDraft,
  'startDepotLat' | 'startDepotLon' | 'endDepotLat' | 'endDepotLon'
> {
  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const defaultSchedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
  return {
    startDepotLat: defaultSchedule?.startDepotLat ?? undefined,
    startDepotLon: defaultSchedule?.startDepotLon ?? undefined,
    endDepotLat: defaultSchedule?.endDepotLat ?? undefined,
    endDepotLon: defaultSchedule?.endDepotLon ?? undefined,
  };
}

/**
 * Defaults for manual/routing book when the type allows schedule override.
 * Does not copy an existing per-day override — uses the booked window (or day off for all-day).
 */
export async function loadScheduleOverrideDraftForBook(
  employeeId: number,
  dateStr: string,
  defaults: BookScheduleOverrideDefaults
): Promise<{ draft: ScheduleOverrideDraft; dayOff: boolean }> {
  if (!Number.isFinite(employeeId) || employeeId <= 0 || !dateStr.trim()) {
    return { draft: emptyDraft(dateStr), dayOff: false };
  }

  const employee = await fetchEmployee(employeeId);
  const depots = weeklyDepotDefaults(employee, dateStr);

  if (defaults.allDay) {
    const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
    const defaultSchedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);
    return {
      draft: {
        workStartLocal: defaultSchedule?.workStartLocal ?? '',
        workEndLocal: defaultSchedule?.workEndLocal ?? '',
        ...depots,
      },
      dayOff: false,
    };
  }

  const start = defaults.slotStartLocal?.trim() ?? '';
  const end = defaults.slotEndLocal?.trim() ?? '';
  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const defaultSchedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);

  return {
    draft: {
      workStartLocal: start || defaultSchedule?.workStartLocal || '',
      workEndLocal: end || defaultSchedule?.workEndLocal || '',
      ...depots,
    },
    dayOff: false,
  };
}

/** Load existing override or weekly defaults (settings override modal). */
export async function loadScheduleOverrideDraftForDate(
  employeeId: number,
  dateStr: string
): Promise<{ draft: ScheduleOverrideDraft; dayOff: boolean }> {
  if (!Number.isFinite(employeeId) || employeeId <= 0 || !dateStr.trim()) {
    return { draft: emptyDraft(dateStr), dayOff: false };
  }

  const [existing, employee] = await Promise.all([
    fetchScheduleOverrideByDate(employeeId, dateStr).catch(() => null),
    fetchEmployee(employeeId),
  ]);

  const depots = weeklyDepotDefaults(employee, dateStr);

  if (existing) {
    const draft: ScheduleOverrideDraft = {
      workStartLocal: existing.workStartLocal ?? '',
      workEndLocal: existing.workEndLocal ?? '',
      startDepotLat: existing.startDepotLat ?? depots.startDepotLat,
      startDepotLon: existing.startDepotLon ?? depots.startDepotLon,
      endDepotLat: existing.endDepotLat ?? depots.endDepotLat,
      endDepotLon: existing.endDepotLon ?? depots.endDepotLon,
    };
    return { draft, dayOff: scheduleOverrideIsOff(existing) };
  }

  const dayOfWeek = new Date(`${dateStr}T12:00:00`).getDay();
  const defaultSchedule = employee.weeklySchedules?.find((s) => s.dayOfWeek === dayOfWeek);

  return {
    draft: {
      workStartLocal: defaultSchedule?.workStartLocal ?? '',
      workEndLocal: defaultSchedule?.workEndLocal ?? '',
      ...depots,
    },
    dayOff: false,
  };
}

async function upsertOverrideForDate(
  employeeId: number,
  date: string,
  payload: ReturnType<typeof buildScheduleOverridePayload>
): Promise<void> {
  const existing = await fetchScheduleOverrideByDate(employeeId, date).catch(() => null);
  if (existing?.id) {
    await updateScheduleOverride(employeeId, existing.id, payload);
  } else {
    await createScheduleOverride(employeeId, { date, ...payload });
  }
}

/** Apply the user's override to each date in range for each listed employee. */
export async function applyScheduleOverridesForBook(input: {
  employeeIds: number[];
  startDate: string;
  endDateInclusive: string;
  draft: ScheduleOverrideDraft;
  dayOff: boolean;
  /** Book modal: update shift times only; leave depot override unset. */
  timesOnly?: boolean;
}): Promise<{
  applied: number;
  failed: Array<{ employeeId: number; date: string; error: string }>;
}> {
  const ids = [...new Set(input.employeeIds.filter((id) => Number.isFinite(id) && id > 0))];
  const dates = datesFromInclusiveRange(input.startDate, input.endDateInclusive);
  const built = buildScheduleOverridePayload(input.draft);
  const payload = input.dayOff
    ? buildScheduleOverrideDayOffPayload()
    : input.timesOnly
      ? { workStartLocal: built.workStartLocal, workEndLocal: built.workEndLocal }
      : built;

  const failed: Array<{ employeeId: number; date: string; error: string }> = [];
  let applied = 0;

  await Promise.all(
    ids.flatMap((employeeId) =>
      dates.map(async (date) => {
        try {
          await upsertOverrideForDate(employeeId, date, payload);
          applied += 1;
        } catch (err) {
          failed.push({
            employeeId,
            date,
            error: formatScheduleOverrideApiError(err),
          });
        }
      })
    )
  );

  return { applied, failed };
}
