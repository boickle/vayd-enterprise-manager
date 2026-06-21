import { DateTime } from 'luxon';
import { fetchDoctorMonth } from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import {
  monthsCoveringRange,
  summarizeAvgMinutesByAppointmentType,
  type AvgMinutesByTypeRow,
} from '../analytics/appointmentTypeTimeStats';
import { normalizeAppointmentType } from '../analytics/appointmentTypeTimeStats';

export const ROUTING_FALLBACK_SERVICE_MINUTES = 45;
const ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS = 5;

export type RoutingServiceMinutesTypeSource = Pick<
  AppointmentType,
  'id' | 'name' | 'prettyName' | 'defaultDuration'
>;

function routingApptTypeStatsMeetMinInstances(
  row: AvgMinutesByTypeRow,
  minInstances = ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS,
): boolean {
  return row.count + row.multipetCount >= minInstances;
}

function estimatedServiceMinutesFromStatsRow(row: AvgMinutesByTypeRow, pets: number): number | null {
  const n = Math.floor(Number(pets));
  const petCount = Number.isFinite(n) && n >= 1 ? n : 1;
  const hasSingle = row.count > 0 && row.avgMinutes > 0;
  const mp = row.multipetAvgMinutes;
  const hasMp = mp != null && mp > 0;

  if (petCount === 1) {
    if (hasSingle) return Math.round(row.avgMinutes);
    if (hasMp) return Math.round(mp);
    return null;
  }
  if (hasMp) return Math.round(mp * petCount);
  if (hasSingle) return Math.round(row.avgMinutes * petCount);
  return null;
}

function resolveRoutingApptStatsRow(
  typeKey: string,
  apptLengthsRows: AvgMinutesByTypeRow[],
  matchedType?: RoutingServiceMinutesTypeSource,
): AvgMinutesByTypeRow | undefined {
  const key = typeKey.trim();
  if (!key) return undefined;
  const statsByNorm = new Map<string, AvgMinutesByTypeRow>();
  for (const row of apptLengthsRows) {
    const norm = normalizeAppointmentType(row.typeName);
    if (norm) statsByNorm.set(norm, row);
  }
  const norm = normalizeAppointmentType(key);
  const prettyNorm = matchedType?.prettyName
    ? normalizeAppointmentType(String(matchedType.prettyName))
    : '';
  return (
    statsByNorm.get(norm) ??
    (prettyNorm ? statsByNorm.get(prettyNorm) : undefined) ??
    apptLengthsRows.find((row) => {
      const rowNorm = normalizeAppointmentType(row.typeName);
      return rowNorm === norm || (prettyNorm !== '' && rowNorm === prettyNorm);
    })
  );
}

function defaultDurationMinutesForRoutingTypeSelection(
  matchedType: RoutingServiceMinutesTypeSource | undefined,
  pets: number,
): number | null {
  const dur = matchedType?.defaultDuration != null ? Number(matchedType.defaultDuration) : NaN;
  if (!Number.isFinite(dur) || dur <= 0) return null;
  const petCount = Math.max(1, Math.floor(pets) || 1);
  return Math.round(dur * petCount);
}

/** 30-day doctor stats (≥5 visits), then type default duration, then fallback minutes. */
export function estimateRoutingServiceMinutesForSelection(
  typeKey: string,
  pets: number,
  apptLengthsRows: AvgMinutesByTypeRow[],
  resolveType: (key: string) => RoutingServiceMinutesTypeSource | undefined,
): number {
  const key = typeKey.trim();
  if (!key) return ROUTING_FALLBACK_SERVICE_MINUTES;
  const matched = resolveType(key);
  const row = resolveRoutingApptStatsRow(key, apptLengthsRows, matched);
  let mins: number | null = null;
  if (row && routingApptTypeStatsMeetMinInstances(row)) {
    mins = estimatedServiceMinutesFromStatsRow(row, pets);
  }
  if (mins == null || mins < 1) {
    mins = defaultDurationMinutesForRoutingTypeSelection(matched, pets);
  }
  if (mins == null || mins < 1) {
    mins = ROUTING_FALLBACK_SERVICE_MINUTES;
  }
  return mins;
}

export function appointmentTypeNameForRoutingStats(
  type: RoutingServiceMinutesTypeSource | undefined,
): string {
  return String(type?.name ?? '').trim();
}

/** Load last-30-day doctor appointment length stats (same source as Routing workspace). */
export async function fetchDoctorApptLengthStats(doctorId: string): Promise<AvgMinutesByTypeRow[]> {
  const trimmed = doctorId.trim();
  if (!trimmed) return [];
  const end = DateTime.now().startOf('day');
  const start = end.minus({ days: 29 });
  const startStr = start.toISODate()!;
  const endStr = end.toISODate()!;
  const months = monthsCoveringRange(startStr, endStr);
  const responses = await Promise.all(
    months.map(({ year, month }) => fetchDoctorMonth(year, month, trimmed)),
  );
  const allDays = responses.flatMap((r) => r.days ?? []);
  return summarizeAvgMinutesByAppointmentType(allDays, startStr, endStr, trimmed);
}
