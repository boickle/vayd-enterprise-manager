import { DateTime } from 'luxon';
import type { DayData } from '../pages/MyWeek';
import {
  clientFixedTimeUsesDoctorDayClockForDriveLayout,
  computeDriveTimeWindowWarning,
} from './windowWarning';

type HouseholdLike = DayData['households'][number];
type TimelineSlot = DayData['timeline'][number];

function strField(o: unknown, k: string): string | null {
  if (o == null || typeof o !== 'object') return null;
  const v = (o as Record<string, unknown>)[k];
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Client appointment (not personal block) with Fixed Time type. */
export function schedulerHouseholdIsClientFixedTime(h: HouseholdLike): boolean {
  if (h.isPersonalBlock) return false;
  const primary = h.primary as Record<string, unknown> | undefined;
  const at = primary?.appointmentType as { name?: string; prettyName?: string } | undefined;
  const nestedName =
    at && typeof at === 'object'
      ? String(at.name ?? at.prettyName ?? '')
          .trim()
          .toLowerCase()
      : '';
  const flat = (strField(primary, 'appointmentType') ?? strField(primary, 'appointmentTypeName') ?? '')
    .trim()
    .toLowerCase();
  const typeLower = nestedName || flat;
  if (typeLower === 'fixed time' || typeLower.includes('fixed time')) return true;
  return (h.patients?.[0]?.type || '').toLowerCase() === 'fixed time';
}

/** Non-flex personal blocks or client Fixed Time — matches My Week `weekHouseholdIsFixedTimeAppointment`. */
export function schedulerHouseholdIsFixedTimeAppointment(
  h: HouseholdLike,
  isFlexBlock: (primary: unknown) => boolean
): boolean {
  const flexBlock = Boolean(h.isPersonalBlock && isFlexBlock(h.primary));
  if (h.isPersonalBlock && !flexBlock) return true;
  return schedulerHouseholdIsClientFixedTime(h);
}

/**
 * When true, layout/hover use doctor-day booked times. Mirrors My Week `weekHouseholdUsesDoctorDayClockForLayout`.
 */
export function schedulerHouseholdUsesDoctorDayClockForLayout(
  h: HouseholdLike,
  slot: TimelineSlot | undefined,
  showByDriveTime: boolean,
  isFlexBlock: (primary: unknown) => boolean
): boolean {
  if (!showByDriveTime) return true;
  const flexBlock = Boolean(h.isPersonalBlock && isFlexBlock(h.primary));
  if (h.isPersonalBlock && !flexBlock) return true;
  if (!schedulerHouseholdIsClientFixedTime(h)) return false;
  const windowStartIso =
    (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowStartIso : null) ??
    (h as { windowStartIso?: string | null }).windowStartIso ??
    (h as { effectiveWindow?: { startIso?: string } }).effectiveWindow?.startIso ??
    null;
  const windowEndIso =
    (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowEndIso : null) ??
    (h as { windowEndIso?: string | null }).windowEndIso ??
    (h as { effectiveWindow?: { endIso?: string } }).effectiveWindow?.endIso ??
    null;
  return clientFixedTimeUsesDoctorDayClockForDriveLayout({
    schedStartIso: h.startIso,
    etaIso: slot?.eta,
    windowStartIso,
    windowEndIso,
  });
}

export function windowEndIsoForSchedulerWarning(
  h: HouseholdLike,
  slot: TimelineSlot | undefined
): string | null {
  return (
    (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowEndIso : null) ??
    (h as { windowEndIso?: string | null }).windowEndIso ??
    (h as { effectiveWindow?: { endIso?: string } }).effectiveWindow?.endIso ??
    null
  );
}

/** Same rules as My Week grid `windowWarning` flag. */
export function computeSchedulerTimelineWindowWarning(
  h: HouseholdLike,
  slot: TimelineSlot | undefined,
  showByDriveTime: boolean,
  isFlexBlock: (primary: unknown) => boolean
): boolean {
  if (!showByDriveTime || h.isPersonalBlock) return false;

  return computeDriveTimeWindowWarning({
    etaIso: slot?.eta ?? null,
    windowEndIso: windowEndIsoForSchedulerWarning(h, slot),
    isClientFixedTime: schedulerHouseholdIsClientFixedTime(h),
    scheduledStartIso: h.startIso,
  });
}

export function computeSchedulerWindowWarningForAppointment(
  dayData: DayData | null | undefined,
  apptId: string | number,
  showByDriveTime: boolean,
  isFlexBlock: (primary: unknown) => boolean,
  findRow: (
    day: DayData,
    id: string | number
  ) => { h: HouseholdLike; slot: TimelineSlot } | null
): boolean {
  if (!showByDriveTime || !dayData) return false;
  const row = findRow(dayData, apptId);
  if (!row) return false;
  return computeSchedulerTimelineWindowWarning(row.h, row.slot, showByDriveTime, isFlexBlock);
}
