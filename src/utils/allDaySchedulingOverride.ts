import { DateTime } from 'luxon';
import {
  buildScheduleOverridePayload,
  createScheduleOverride,
  fetchScheduleOverrideByDate,
  updateScheduleOverride,
} from '../api/appointmentSettings';

/** Same start/end local time marks the day off for routing (see `scheduleOverrideIsOff`). */
export const ROUTING_DAY_OFF_OVERRIDE_LOCAL_TIME = '08:00';

export function datesFromInclusiveRange(startDate: string, endDateInclusive: string): string[] {
  let d = DateTime.fromISO(startDate).startOf('day');
  const end = DateTime.fromISO(endDateInclusive).startOf('day');
  if (!d.isValid || !end.isValid || end < d) return [];
  const out: string[] = [];
  while (d <= end) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

async function upsertRoutingDayOffOverride(employeeId: number, date: string): Promise<void> {
  const existing = await fetchScheduleOverrideByDate(employeeId, date);
  const payload = buildScheduleOverridePayload({
    workStartLocal: ROUTING_DAY_OFF_OVERRIDE_LOCAL_TIME,
    workEndLocal: ROUTING_DAY_OFF_OVERRIDE_LOCAL_TIME,
  });
  if (existing?.id) {
    await updateScheduleOverride(employeeId, existing.id, payload);
  } else {
    await createScheduleOverride(employeeId, { date, ...payload });
  }
}

/**
 * For each provider and each calendar day in range, upsert a schedule override that clears
 * routable shift time (08:00–08:00 → day off per `scheduleOverrideIsOff`).
 */
export async function applyAllDaySchedulingOverrides(input: {
  employeeIds: number[];
  startDate: string;
  endDateInclusive: string;
}): Promise<{
  applied: number;
  failed: Array<{ employeeId: number; date: string; error: string }>;
}> {
  const ids = [...new Set(input.employeeIds.filter((id) => Number.isFinite(id) && id > 0))];
  const dates = datesFromInclusiveRange(input.startDate, input.endDateInclusive);
  const failed: Array<{ employeeId: number; date: string; error: string }> = [];
  let applied = 0;

  await Promise.all(
    ids.flatMap((employeeId) =>
      dates.map(async (date) => {
        try {
          await upsertRoutingDayOffOverride(employeeId, date);
          applied += 1;
        } catch (err) {
          failed.push({
            employeeId,
            date,
            error: err instanceof Error ? err.message : 'Request failed',
          });
        }
      })
    )
  );

  return { applied, failed };
}
