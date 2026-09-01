import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { DateTime } from 'luxon';
import {
  blockDisplayLabel,
  isBlockEntry,
  isFlexBlockItem,
} from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import {
  fetchEmployee,
  fetchScheduleOverrideByDate,
  normalizeScheduleOverrideLocalTime,
  scheduleOverrideIsOff,
} from '../api/appointmentSettings';
import {
  fetchEmployeeWorkdayActualByDate,
  upsertEmployeeWorkdayActual,
  type EmployeeWorkdayActual,
} from '../api/employeeWorkdayActuals';
import type { Appointment } from '../api/roomLoader';
import { DEFAULT_APPOINTMENT_BUFFER_MINUTES } from '../api/routing';
import {
  buildMyWeekDriveSegmentsFromLayout,
  computeMyWeekDayColumnLayout,
  timeStrToMinutesFromMidnight,
  type DayData,
  type WeekHousehold,
} from '../pages/MyWeek';
import { fetchSchedulerDriveContextForDate } from '../utils/schedulerDriveEta';
import { combineDateAndTimeToUtc, toTimeLocalValue } from '../utils/editVisitTimeFields';
import { evetPatientLink } from '../utils/evet';
import { useVisitHighlightsHoverPopover } from '../hooks/useVisitHighlightsHoverPopover';
import {
  buildTypeFillMap,
  colorsForAppointment,
} from '../utils/schedulerAppointmentColors';
import { patientsForAppointment } from '../utils/schedulerAddPet';
import type { SchedulerHoverDriveHint } from '../utils/schedulerHoverTypes';
import { pickStr } from '../utils/schedulerVisitDisplay';
import {
  formatIsoTimeShortInPracticeZone,
  practiceTimeZoneOrDefault,
} from '../utils/practiceTimezone';
import {
  projectScheduleProgressActualVisits,
  shiftIsoByLeaveDelay,
  type ProgressVisitActualInput,
} from '../utils/scheduleProgressActualProjection';
import {
  SchedulerAppointmentContextMenu,
  type SchedulerContextMenuAction,
} from '../pages/SchedulerContextMenu';
import '../pages/Scheduler.css';

const PPM = 1.1;
const SLOT_MINUTES = 15;
const GRID_EDGE_BUFFER_MIN = 30;
const DEFAULT_GRID_START = 6 * 60 + 30;
const DEFAULT_GRID_END = 18 * 60;
const DRIVE_FILL =
  'repeating-linear-gradient(135deg, #e2e8f0 0px, #e2e8f0 6px, #cbd5e1 6px, #cbd5e1 12px)';
const BUFFER_FILL = 'rgba(255, 255, 255, 0.35)';
const BUFFER_BORDER = '1px dashed #d1d5db';
const DEPOT_LINE_PX = 5;
const CONNECTOR_WIDTH_PX = 44;
/** Above `.scheduler-reconcile-backdrop` (10001) so Visit Highlights renders on top of the modal. */
const RECONCILE_VISIT_HOVER_Z_INDEX = 10100;

type EmployeeDayTimes = { start: string; end: string };

type VisitBlockLayout = { linkKey: string; top: number; height: number };

type Props = {
  open: boolean;
  onClose: () => void;
  date: string;
  employeeId: string;
  practiceTz: string;
  /** Cached drive-day from scheduler when available. */
  predictedDayData?: DayData | null;
  appointments: Appointment[];
  appointmentTypes: AppointmentType[];
  onWorkdaySaved?: (row: EmployeeWorkdayActual) => void;
  renderVisitHighlights: (
    appt: Appointment,
    driveHint: SchedulerHoverDriveHint | null
  ) => ReactNode;
};

function depotTimeToInputValue(timeStr: string | null | undefined): string {
  const raw = timeStr?.trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length >= 2) {
    const h = parts[0]!.padStart(2, '0');
    const m = parts[1]!.padStart(2, '0');
    return `${h}:${m}`;
  }
  return raw;
}

function depotTimeToIso(
  dateIso: string,
  timeStr: string | null | undefined,
  practiceTz: string
): string | null {
  const raw = timeStr?.trim();
  if (!raw) return null;
  const isoTime = raw.split(':').length === 2 ? `${raw}:00` : raw;
  const dt = DateTime.fromISO(`${dateIso}T${isoTime}`, {
    zone: practiceTimeZoneOrDefault(practiceTz),
  });
  return dt.isValid ? dt.toISO() : null;
}

function wallMinutesFromIso(iso: string, practiceTz: string): number | null {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTimeZoneOrDefault(practiceTz));
  if (!dt.isValid) return null;
  return dt.hour * 60 + dt.minute + dt.second / 60;
}

function visitTimeDeltaMinutes(
  actualIso: string,
  referenceIso: string,
  practiceTz: string
): number | null {
  const actual = DateTime.fromISO(actualIso, { zone: 'utc' }).setZone(practiceTimeZoneOrDefault(practiceTz));
  const reference = DateTime.fromISO(referenceIso, { zone: 'utc' }).setZone(
    practiceTimeZoneOrDefault(practiceTz)
  );
  if (!actual.isValid || !reference.isValid) return null;
  return Math.round(actual.diff(reference, 'minutes').minutes);
}

function formatVisitTimeDeltaLabel(deltaMinutes: number): string {
  const abs = Math.abs(deltaMinutes);
  const unit = abs === 1 ? 'min' : 'mins';
  if (deltaMinutes === 0) return 'on time';
  if (deltaMinutes < 0) return `${abs} ${unit} early`;
  return `${abs} ${unit} late`;
}

function ReconcileDeltaText({
  actualIso,
  referenceIso,
  practiceTz,
}: {
  actualIso: string | null | undefined;
  referenceIso: string | null | undefined;
  practiceTz: string;
}): ReactNode {
  if (!actualIso || !referenceIso) return null;
  const delta = visitTimeDeltaMinutes(actualIso, referenceIso, practiceTz);
  if (delta == null) return null;
  const tone = delta === 0 ? 'on-time' : delta < 0 ? 'early' : 'late';
  return (
    <span className={`scheduler-visit-time-delta scheduler-visit-time-delta--${tone}`}>
      {formatVisitTimeDeltaLabel(delta)}
    </span>
  );
}

function apptByIdMap(appointments: Appointment[]): Map<string, Appointment> {
  const m = new Map<string, Appointment>();
  for (const a of appointments) m.set(String(a.id), a);
  return m;
}

function primaryApptId(h: WeekHousehold): string | null {
  const ids = h.sourceAppointmentIds;
  if (ids?.length) return String(ids[0]);
  const pid = h.primary?.id;
  return pid != null ? String(pid) : null;
}

function driveHouseholdAndSlotForAppointment(
  dayData: DayData,
  apptId: string | number
): { h: WeekHousehold; slot: DayData['timeline'][number] } | null {
  const apptKey = String(apptId);
  const households = dayData.households;
  for (let j = 0; j < households.length; j++) {
    const hx = households[j] as { sourceAppointmentIds?: (string | number)[] };
    const ids = hx.sourceAppointmentIds;
    if (!ids?.some((id) => String(id) === apptKey)) continue;
    const slot = dayData.timeline[j] ?? {};
    return { h: households[j], slot };
  }
  return null;
}

function driveHintFromHouseholdSlot(
  h: WeekHousehold,
  slot: DayData['timeline'][number] | undefined,
  practiceTz: string,
  showDrive: boolean
): SchedulerHoverDriveHint | null {
  if (!showDrive) return null;
  return {
    practiceTz,
    etaIso: slot?.eta ?? null,
    etdIso: slot?.etd ?? null,
    windowStartIso: slot?.windowStartIso ?? null,
    windowEndIso: slot?.windowEndIso ?? null,
    schedStartIso: h.startIso ?? null,
    schedEndIso: h.endIso ?? null,
    isPersonalBlock: Boolean(h.isPersonalBlock),
    isFixedTime: false,
    windowWarning: false,
  };
}

function householdLabel(h: WeekHousehold): string {
  if (h.isPersonalBlock) {
    return blockDisplayLabel({
      blockLabel: h.primary?.blockLabel,
      title: h.primary?.title ?? h.client,
    });
  }
  return h.client || 'Visit';
}

function isoToDepotTimeStr(iso: string, practiceTz: string): string {
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTimeZoneOrDefault(practiceTz));
  return dt.isValid ? dt.toFormat('HH:mm') : '';
}

/** Predicted column: routed return to depot (not scheduled shift end). */
function predictedBackToDepotEndDisplay(
  dayData: DayData,
  practiceTz: string,
  shiftEndTime: string
): { endTime: string; endLabel: string; endIso: string | null } {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const backIso = dayData.backToDepotIso?.trim();
  if (backIso) {
    const dt = DateTime.fromISO(backIso, { zone: 'utc' }).setZone(tz);
    if (dt.isValid) {
      return {
        endTime: dt.toFormat('HH:mm'),
        endLabel: 'Back to depot (expected)',
        endIso: backIso,
      };
    }
  }
  return {
    endTime: shiftEndTime,
    endLabel: 'Day end',
    endIso: depotTimeToIso(dayData.date, shiftEndTime, tz),
  };
}

function apiDayOfWeekFromDate(dateIso: string): number {
  return DateTime.fromISO(dateIso).weekday % 7;
}

async function resolveEmployeeDayTimes(
  employeeId: string,
  date: string,
  predicted: DayData | null
): Promise<EmployeeDayTimes> {
  let start = depotTimeToInputValue(predicted?.startDepotTime);
  let end = depotTimeToInputValue(predicted?.endDepotTime);
  if (start && end) return { start, end };

  const empIdNum = Number(employeeId);
  if (Number.isFinite(empIdNum)) {
    try {
      const override = await fetchScheduleOverrideByDate(empIdNum, date);
      if (override && !scheduleOverrideIsOff(override)) {
        start =
          start ||
          depotTimeToInputValue(normalizeScheduleOverrideLocalTime(override.workStartLocal));
        end =
          end || depotTimeToInputValue(normalizeScheduleOverrideLocalTime(override.workEndLocal));
      }
      if (start && end) return { start, end };

      const employee = await fetchEmployee(empIdNum);
      const dow = apiDayOfWeekFromDate(date);
      const weekly = employee.weeklySchedules?.find(
        (s) => s.dayOfWeek === dow && s.isWorkday !== false
      );
      if (weekly) {
        start =
          start || depotTimeToInputValue(normalizeScheduleOverrideLocalTime(weekly.workStartLocal));
        end = end || depotTimeToInputValue(normalizeScheduleOverrideLocalTime(weekly.workEndLocal));
      }
    } catch {
      /* keep partial depot times from doctor-day */
    }
  }

  return { start, end };
}

function enrichPredictedWithEmployeeDayTimes(
  predicted: DayData,
  employeeTimes: EmployeeDayTimes
): DayData {
  return {
    ...predicted,
    startDepotTime: predicted.startDepotTime?.trim() || employeeTimes.start || predicted.startDepotTime,
    endDepotTime: predicted.endDepotTime?.trim() || employeeTimes.end || predicted.endDepotTime,
  };
}

function computeVisitBlockLayouts(
  dayData: DayData,
  weekGrid: { gridStartMinutesFromMidnight: number; totalMinutes: number },
  dateIso: string,
  showDrive: boolean,
  bufferMin: number
): VisitBlockLayout[] {
  const layout = computeMyWeekDayColumnLayout(dayData, weekGrid, dateIso, showDrive, bufferMin);
  if (!layout) return [];
  const blocks: VisitBlockLayout[] = [];
  layout.displayHouseholds.forEach((h, idx) => {
    if (!h.startIso || !h.endIso) return;
    const topMin = layout.topMinByIdx[idx] ?? 0;
    const durMin = layout.durMinByIdx[idx] ?? 1;
    const driveOffsetMin = layout.driveOffsets[idx] ?? 0;
    const top = topMin * PPM + driveOffsetMin * PPM;
    const height = Math.max(18, durMin * PPM);
    blocks.push({
      linkKey: primaryApptId(h) ?? h.key,
      top,
      height,
    });
  });
  return blocks;
}

function reconcileConnectorPathD(width: number, y1: number, y2: number): string {
  const startX = 3;
  const endX = width - 3;
  const c1x = width * 0.38;
  const c2x = width * 0.62;
  return `M ${startX} ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${endX} ${y2}`;
}

function ReconcileConnectorLines({
  predictedBlocks,
  actualBlocks,
  heightPx,
}: {
  predictedBlocks: VisitBlockLayout[];
  actualBlocks: VisitBlockLayout[];
  heightPx: number;
}) {
  const actualByKey = new Map(actualBlocks.map((b) => [b.linkKey, b]));
  const lines = predictedBlocks
    .map((left, idx) => {
      const right = actualByKey.get(left.linkKey) ?? actualBlocks[idx];
      if (!right) return null;
      return {
        key: left.linkKey,
        y1: left.top + left.height / 2,
        y2: right.top + right.height / 2,
      };
    })
    .filter((x): x is { key: string; y1: number; y2: number } => x != null);

  if (lines.length === 0) return <div className="scheduler-reconcile-connector-spacer" aria-hidden />;

  const arrowId = 'scheduler-reconcile-arrow';

  return (
    <svg
      className="scheduler-reconcile-connectors"
      width={CONNECTOR_WIDTH_PX}
      height={heightPx}
      aria-hidden
    >
      <defs>
        <marker
          id={arrowId}
          markerWidth="7"
          markerHeight="7"
          refX="6"
          refY="3.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          <path
            className="scheduler-reconcile-connector-arrowhead"
            d="M0,0 L7,3.5 L0,7 Z"
          />
        </marker>
      </defs>
      {lines.map((line) => (
        <g key={line.key} className="scheduler-reconcile-connector-group">
          <circle
            className="scheduler-reconcile-connector-dot"
            cx={3}
            cy={line.y1}
            r={2.5}
          />
          <path
            className="scheduler-reconcile-connector-line"
            d={reconcileConnectorPathD(CONNECTOR_WIDTH_PX, line.y1, line.y2)}
            markerEnd={`url(#${arrowId})`}
          />
        </g>
      ))}
    </svg>
  );
}

/** Sort key for actual visit ordering: actual start (fallback end), missing times last. */
function actualVisitSortMillis(startIso: string | null, endIso: string | null): number {
  const iso = startIso ?? endIso;
  if (!iso) return Number.POSITIVE_INFINITY;
  const dt = DateTime.fromISO(iso, { zone: 'utc' });
  return dt.isValid ? dt.toMillis() : Number.POSITIVE_INFINITY;
}

function buildActualDayBundle(
  predicted: DayData,
  appointments: Appointment[],
  workday: EmployeeWorkdayActual | null,
  employeeTimes: EmployeeDayTimes
): { dayData: DayData; workdayStartIso: string | null; workdayEndIso: string | null } {
  const byId = apptByIdMap(appointments);
  const tz = practiceTimeZoneOrDefault(predicted.timezone);
  const rawHouseholds = predicted.households ?? [];
  const rawTimeline = predicted.timeline ?? [];
  const predictedDs = predicted.driveSeconds ?? null;

  // routingOrderIndices[displayPos] = raw household index. Invert so we can
  // look up each visit's predicted drive-in value by its raw household index.
  const order =
    predicted.routingOrderIndices && predicted.routingOrderIndices.length === rawHouseholds.length
      ? predicted.routingOrderIndices
      : null;
  const dsByRawIdx: (number | null)[] = new Array(rawHouseholds.length).fill(null);
  if (predictedDs) {
    for (let displayPos = 0; displayPos < rawHouseholds.length; displayPos++) {
      const rawIdx = order ? order[displayPos] : displayPos;
      if (rawIdx != null && rawIdx >= 0 && rawIdx < rawHouseholds.length) {
        dsByRawIdx[rawIdx] = predictedDs[displayPos] ?? null;
      }
    }
  }

  // Resolve recorded actuals vs predicted bounds per visit, then order by when
  // they actually happened (predicted start when not yet started).
  const built = rawHouseholds.map((h, rawIdx) => {
    const id = primaryApptId(h);
    const appt = id ? byId.get(id) : undefined;
    const predictedSlot = rawTimeline[rawIdx];
    const predictedStartIso =
      (predictedSlot?.eta?.trim() || null) ?? h.startIso ?? appt?.appointmentStart ?? null;
    const predictedEndIso =
      (predictedSlot?.etd?.trim() || null) ?? h.endIso ?? appt?.appointmentEnd ?? null;
    const actualStartIso = appt?.appointmentStartActual?.trim() || null;
    const actualEndIso = appt?.appointmentEndActual?.trim() || null;
    return {
      household: h,
      rawIdx,
      predictedStartIso,
      predictedEndIso,
      actualStartIso,
      actualEndIso,
      sortStartIso: actualStartIso ?? predictedStartIso,
      sortEndIso: actualEndIso ?? predictedEndIso,
    };
  });

  const sorted = built
    .map((b, stableIdx) => ({ ...b, stableIdx }))
    .sort((a, b) => {
      const at = actualVisitSortMillis(a.sortStartIso, a.sortEndIso);
      const bt = actualVisitSortMillis(b.sortStartIso, b.sortEndIso);
      if (at !== bt) return at - bt;
      return a.stableIdx - b.stableIdx;
    });

  const projectionInputs: ProgressVisitActualInput[] = sorted.map((b) => ({
    predictedStartIso: b.predictedStartIso,
    predictedEndIso: b.predictedEndIso,
    actualStartIso: b.actualStartIso,
    actualEndIso: b.actualEndIso,
  }));
  const { visits: projected, leaveDelayMs } =
    projectScheduleProgressActualVisits(projectionInputs);

  const households = sorted.map((b, i) => ({
    ...b.household,
    startIso: projected[i]?.startIso ?? b.predictedStartIso,
    endIso: projected[i]?.endIso ?? b.predictedEndIso,
  }));
  const timeline = sorted.map((b, i) => {
    const predictedSlot = rawTimeline[b.rawIdx];
    const startIso = projected[i]?.startIso ?? b.predictedStartIso;
    const endIso = projected[i]?.endIso ?? b.predictedEndIso;
    return {
      eta: startIso,
      etd: endIso,
      bufferAfterMinutes: predictedSlot?.bufferAfterMinutes,
      windowStartIso: predictedSlot?.windowStartIso,
      windowEndIso: predictedSlot?.windowEndIso,
    };
  });
  const driveSeconds = predictedDs ? sorted.map((b) => dsByRawIdx[b.rawIdx] ?? 0) : null;

  const plannedStartIso =
    depotTimeToIso(predicted.date, employeeTimes.start, tz) ??
    depotTimeToIso(predicted.date, predicted.startDepotTime, tz);
  const plannedEndIso =
    depotTimeToIso(predicted.date, employeeTimes.end, tz) ??
    depotTimeToIso(predicted.date, predicted.endDepotTime, tz);
  const workdayStartIso = workday?.workdayStartActual?.trim() || plannedStartIso;
  const workdayEndIso = workday?.workdayEndActual?.trim() || plannedEndIso;

  const backToDepotIso = shiftIsoByLeaveDelay(predicted.backToDepotIso, leaveDelayMs);

  return {
    workdayStartIso,
    workdayEndIso,
    dayData: {
      ...predicted,
      households,
      timeline,
      driveSeconds,
      // Visits are already ordered chronologically by actual time; don't re-apply
      // the predicted route order on top.
      routingOrderIndices: null,
      backToDepotSec: predicted.backToDepotSec ?? null,
      backToDepotIso,
      depotToFirstRoutableSec: predicted.depotToFirstRoutableSec ?? null,
      startDepotTime: workdayStartIso
        ? isoToDepotTimeStr(workdayStartIso, tz)
        : predicted.startDepotTime,
      endDepotTime: workdayEndIso ? isoToDepotTimeStr(workdayEndIso, tz) : predicted.endDepotTime,
    },
  };
}

function computeGridBounds(
  predicted: DayData,
  actual: DayData,
  practiceTz: string,
  workdayStartIso: string | null,
  workdayEndIso: string | null
): { gridStartMinutesFromMidnight: number; totalMinutes: number } {
  const buf = GRID_EDGE_BUFFER_MIN;
  let earliest: number | null = null;
  let latest: number | null = null;

  const considerIso = (iso: string | null | undefined) => {
    if (!iso) return;
    const m = wallMinutesFromIso(iso, practiceTz);
    if (m == null) return;
    earliest = earliest === null ? m : Math.min(earliest, m);
    latest = latest === null ? m : Math.max(latest, m);
  };

  for (const h of [...(predicted.households ?? []), ...(actual.households ?? [])]) {
    considerIso(h.startIso);
    considerIso(h.endIso);
  }
  for (const slot of predicted.timeline ?? []) {
    considerIso(slot.eta);
    considerIso(slot.etd);
  }
  for (const slot of actual.timeline ?? []) {
    considerIso(slot.eta);
    considerIso(slot.etd);
  }
  for (const t of [predicted.startDepotTime, predicted.endDepotTime]) {
    if (t?.trim()) {
      const m = timeStrToMinutesFromMidnight(t);
      earliest = earliest === null ? m : Math.min(earliest, m);
      latest = latest === null ? m : Math.max(latest, m);
    }
  }
  considerIso(predicted.backToDepotIso);

  considerIso(workdayStartIso);
  considerIso(workdayEndIso);

  const startFromData =
    earliest !== null
      ? Math.max(0, Math.floor(earliest / SLOT_MINUTES) * SLOT_MINUTES - buf)
      : Math.max(0, DEFAULT_GRID_START - buf);
  const endFromData =
    latest !== null
      ? Math.min(24 * 60, Math.ceil(latest / SLOT_MINUTES) * SLOT_MINUTES + buf)
      : DEFAULT_GRID_END;

  const start = Math.max(0, Math.floor(startFromData / SLOT_MINUTES) * SLOT_MINUTES);
  let end = Math.min(24 * 60, Math.ceil(endFromData / SLOT_MINUTES) * SLOT_MINUTES);
  if (end <= start) end = start + 60;

  return { gridStartMinutesFromMidnight: start, totalMinutes: end - start };
}

type VisitTiming = { startIso: string | null; endIso: string | null };

function predictedVisitTiming(
  h: WeekHousehold,
  slot: DayData['timeline'][number] | undefined,
  showDrive: boolean
): VisitTiming {
  if (showDrive && slot?.eta && slot?.etd) {
    return { startIso: slot.eta, endIso: slot.etd };
  }
  return { startIso: h.startIso, endIso: h.endIso };
}

function ReconcileDayBoundsFields({
  dayStartTime,
  dayEndTime,
  dayEndLabel = 'Day end',
  readOnly,
  onDayStartTimeChange,
  onDayEndTimeChange,
  practiceTz,
  predictedDayStartIso,
  predictedDayEndIso,
  dateIso,
}: {
  dayStartTime: string;
  dayEndTime: string;
  dayEndLabel?: string;
  readOnly: boolean;
  onDayStartTimeChange?: (value: string) => void;
  onDayEndTimeChange?: (value: string) => void;
  practiceTz: string;
  predictedDayStartIso?: string | null;
  predictedDayEndIso?: string | null;
  dateIso: string;
}) {
  const startIso =
    dayStartTime.trim() && dateIso
      ? combineDateAndTimeToUtc(dateIso, dayStartTime, practiceTz)
      : null;
  const endIso =
    dayEndTime.trim() && dateIso ? combineDateAndTimeToUtc(dateIso, dayEndTime, practiceTz) : null;

  return (
    <div className="scheduler-reconcile-day-bounds">
      <label className="scheduler-reconcile-time-field">
        <span>Day start</span>
        <input
          type="time"
          className="scheduler-reconcile-time-input"
          value={dayStartTime}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => onDayStartTimeChange?.(e.target.value)}
        />
        {!readOnly && predictedDayStartIso && startIso ? (
          <span className="scheduler-reconcile-time-delta">
            <ReconcileDeltaText
              actualIso={startIso}
              referenceIso={predictedDayStartIso}
              practiceTz={practiceTz}
            />
          </span>
        ) : null}
      </label>
      <label className="scheduler-reconcile-time-field">
        <span>{dayEndLabel}</span>
        <input
          type="time"
          className="scheduler-reconcile-time-input"
          value={dayEndTime}
          readOnly={readOnly}
          disabled={readOnly}
          onChange={(e) => onDayEndTimeChange?.(e.target.value)}
        />
        {!readOnly && predictedDayEndIso && endIso ? (
          <span className="scheduler-reconcile-time-delta">
            <ReconcileDeltaText
              actualIso={endIso}
              referenceIso={predictedDayEndIso}
              practiceTz={practiceTz}
            />
          </span>
        ) : null}
      </label>
    </div>
  );
}

function ReconcileTimeColumn({
  weekGrid,
  practiceTz,
  align,
}: {
  weekGrid: { gridStartMinutesFromMidnight: number; totalMinutes: number };
  practiceTz: string;
  align: 'left' | 'right';
}) {
  const gridHeightPx = weekGrid.totalMinutes * PPM;
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const labels = useMemo(() => {
    const out: { min: number; label: string; major: boolean }[] = [];
    const endMin = weekGrid.gridStartMinutesFromMidnight + weekGrid.totalMinutes;
    for (let m = weekGrid.gridStartMinutesFromMidnight; m < endMin; m += SLOT_MINUTES) {
      const h = Math.floor(m / 60);
      const mm = m % 60;
      const dt = DateTime.fromObject({ hour: h, minute: mm }, { zone: tz });
      out.push({
        min: m,
        label: mm === 0 ? dt.toFormat('h:mm a') : '',
        major: mm === 0,
      });
    }
    return out;
  }, [weekGrid.gridStartMinutesFromMidnight, weekGrid.totalMinutes, tz]);

  return (
    <div
      className={`scheduler-reconcile-time-col scheduler-reconcile-time-col--${align}`}
      aria-hidden
    >
      <div className="scheduler-reconcile-time-col-inner" style={{ height: gridHeightPx }}>
        {labels.map(({ min, label, major }) => (
          <div
            key={min}
            className={`scheduler-reconcile-time-slot${major ? ' scheduler-reconcile-time-slot--major' : ''}`}
            style={{
              top: (min - weekGrid.gridStartMinutesFromMidnight) * PPM,
              height: SLOT_MINUTES * PPM,
            }}
          >
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ReconcileDayGrid({
  dayData,
  weekGrid,
  dateIso,
  practiceTz,
  showDrive,
  showVisitDelta,
  predictedTimingByKey,
  shiftDepotStartTime,
  shiftDepotEndTime,
  apptById,
  appointmentTypes,
  typeFillMap,
  onVisitMouseEnter,
  onVisitMouseMove,
  onVisitMouseLeave,
  onVisitContextMenu,
}: {
  dayData: DayData;
  weekGrid: { gridStartMinutesFromMidnight: number; totalMinutes: number };
  dateIso: string;
  practiceTz: string;
  showDrive: boolean;
  showVisitDelta?: boolean;
  /** Predicted arrive/leave per visit, keyed by link key so it survives actual-column reordering. */
  predictedTimingByKey?: Map<string, VisitTiming>;
  /** Scheduled appointment-day bounds (shift depot leave / return), not ETA or saved actuals. */
  shiftDepotStartTime: string;
  shiftDepotEndTime: string;
  apptById: Map<string, Appointment>;
  appointmentTypes: AppointmentType[];
  typeFillMap: Map<number, string>;
  onVisitMouseEnter: (appt: Appointment, ev: MouseEvent<HTMLElement>) => void;
  onVisitMouseMove: (appt: Appointment, ev: MouseEvent<HTMLElement>) => void;
  onVisitMouseLeave: (apptId: string | number) => void;
  onVisitContextMenu: (appt: Appointment, ev: MouseEvent<HTMLElement>) => void;
}) {
  const bufferMin = dayData.appointmentBufferMinutes ?? DEFAULT_APPOINTMENT_BUFFER_MINUTES;
  const layout = computeMyWeekDayColumnLayout(
    dayData,
    weekGrid,
    dateIso,
    showDrive,
    bufferMin
  );
  const gridHeightPx = weekGrid.totalMinutes * PPM;
  const driveSegs =
    showDrive && layout
      ? buildMyWeekDriveSegmentsFromLayout(layout, dayData, weekGrid, dateIso)
      : [];

  const depotStartTop = shiftDepotStartTime.trim()
    ? Math.max(
        0,
        (timeStrToMinutesFromMidnight(shiftDepotStartTime) -
          weekGrid.gridStartMinutesFromMidnight) *
          PPM
      )
    : null;
  const depotEndTop = shiftDepotEndTime.trim()
    ? Math.max(
        0,
        (timeStrToMinutesFromMidnight(shiftDepotEndTime) - weekGrid.gridStartMinutesFromMidnight) *
          PPM
      )
    : null;

  return (
    <div className="scheduler-reconcile-day-grid" style={{ height: gridHeightPx }}>
      {Array.from({ length: Math.ceil(weekGrid.totalMinutes / 60) + 1 }, (_, i) => {
        const min = weekGrid.gridStartMinutesFromMidnight + i * 60;
        const top = (min - weekGrid.gridStartMinutesFromMidnight) * PPM;
        return (
          <div
            key={`hour-${i}`}
            className="scheduler-reconcile-grid-line"
            style={{ top }}
            aria-hidden
          />
        );
      })}
      {depotStartTop != null ? (
        <div
          className="scheduler-day-depot-line"
          style={{ top: depotStartTop - Math.floor(DEPOT_LINE_PX / 2) }}
          title={`Leave depot (${shiftDepotStartTime})`}
          aria-hidden
        />
      ) : null}
      {depotEndTop != null ? (
        <div
          className="scheduler-day-depot-line"
          style={{ top: depotEndTop - Math.floor(DEPOT_LINE_PX / 2) }}
          title={`Return to depot (${shiftDepotEndTime})`}
          aria-hidden
        />
      ) : null}
      {driveSegs.map((seg, i) => (
        <div
          key={`drive-${i}`}
          className="scheduler-reconcile-drive-segment"
          style={{
            top: seg.top,
            height: seg.height,
            background: seg.kind === 'buffer' ? BUFFER_FILL : DRIVE_FILL,
            border: seg.kind === 'buffer' ? BUFFER_BORDER : undefined,
          }}
          title={seg.title}
        />
      ))}
      {layout
        ? layout.displayHouseholds.map((h, idx) => {
            const startIso = h.startIso;
            const endIso = h.endIso;
            if (!startIso || !endIso) return null;
            const topMin = layout.topMinByIdx[idx] ?? 0;
            const durMin = layout.durMinByIdx[idx] ?? 1;
            const driveOffsetMin = layout.driveOffsets[idx] ?? 0;
            const top = topMin * PPM + driveOffsetMin * PPM;
            const height = Math.max(18, durMin * PPM);
            const slot = layout.displayTimeline[idx];
            const linkKey = primaryApptId(h) ?? h.key;
            const predicted = predictedTimingByKey?.get(linkKey);
            const timing = showDrive ? predictedVisitTiming(h, slot, true) : { startIso, endIso };
            const displayStart = timing.startIso ?? startIso;
            const displayEnd = timing.endIso ?? endIso;
            const actualArriveIso = slot?.eta ?? startIso;
            const actualLeaveIso = slot?.etd ?? endIso;
            const timeLabel = `${formatIsoTimeShortInPracticeZone(displayStart, practiceTz)} – ${formatIsoTimeShortInPracticeZone(displayEnd, practiceTz)}`;
            const blockItem = h.primary;
            const isBlock = isBlockEntry(blockItem);
            const flexBlock = Boolean(h.isPersonalBlock && isFlexBlockItem(blockItem));
            const appt = linkKey ? apptById.get(linkKey) : undefined;
            const apptColors =
              appt && !isBlock
                ? colorsForAppointment(appt, appointmentTypes, typeFillMap)
                : null;

            return (
              <div
                key={h.key}
                data-reconcile-link-key={linkKey}
                className={[
                  'scheduler-reconcile-visit',
                  'scheduler-event',
                  isBlock ? 'scheduler-reconcile-visit--block' : '',
                  flexBlock ? 'scheduler-reconcile-visit--flex' : '',
                  appt ? 'scheduler-reconcile-visit--interactive' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  top,
                  height,
                  ...(apptColors
                    ? { background: apptColors.fill, color: apptColors.text, borderColor: apptColors.fill }
                    : {}),
                }}
                role={appt ? 'button' : undefined}
                tabIndex={appt ? 0 : undefined}
                onMouseEnter={appt ? (ev) => onVisitMouseEnter(appt, ev) : undefined}
                onMouseMove={appt ? (ev) => onVisitMouseMove(appt, ev) : undefined}
                onMouseLeave={appt ? () => onVisitMouseLeave(appt.id) : undefined}
                onContextMenu={
                  appt && !isBlock
                    ? (ev) => {
                        ev.preventDefault();
                        ev.stopPropagation();
                        onVisitContextMenu(appt, ev);
                      }
                    : undefined
                }
              >
                <div className="scheduler-reconcile-visit-time">{timeLabel}</div>
                <div className="scheduler-reconcile-visit-label">{householdLabel(h)}</div>
                {showVisitDelta && predicted ? (
                  <div className="scheduler-reconcile-visit-delta">
                    {predicted.startIso ? (
                      <span>
                        Arrive:{' '}
                        <ReconcileDeltaText
                          actualIso={actualArriveIso}
                          referenceIso={predicted.startIso}
                          practiceTz={practiceTz}
                        />
                      </span>
                    ) : null}
                    {predicted.endIso ? (
                      <span>
                        Leave:{' '}
                        <ReconcileDeltaText
                          actualIso={actualLeaveIso}
                          referenceIso={predicted.endIso}
                          practiceTz={practiceTz}
                        />
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })
        : null}
    </div>
  );
}

function ReconcileColumnHeader({
  title,
  dayStartTime,
  dayEndTime,
  dayEndLabel,
  readOnly,
  onDayStartTimeChange,
  onDayEndTimeChange,
  practiceTz,
  predictedDayStartIso,
  predictedDayEndIso,
  dateIso,
  saveAction,
}: {
  title: string;
  dayStartTime: string;
  dayEndTime: string;
  dayEndLabel?: string;
  readOnly: boolean;
  onDayStartTimeChange?: (value: string) => void;
  onDayEndTimeChange?: (value: string) => void;
  practiceTz: string;
  predictedDayStartIso?: string | null;
  predictedDayEndIso?: string | null;
  dateIso: string;
  saveAction?: {
    saving: boolean;
    onSave: () => void;
    saveError?: string | null;
    saveSuccess?: string | null;
  };
}) {
  return (
    <div className="scheduler-reconcile-column-header">
      <h3 className="scheduler-reconcile-column-title">{title}</h3>
      <ReconcileDayBoundsFields
        dayStartTime={dayStartTime}
        dayEndTime={dayEndTime}
        dayEndLabel={dayEndLabel}
        readOnly={readOnly}
        onDayStartTimeChange={onDayStartTimeChange}
        onDayEndTimeChange={onDayEndTimeChange}
        practiceTz={practiceTz}
        predictedDayStartIso={predictedDayStartIso}
        predictedDayEndIso={predictedDayEndIso}
        dateIso={dateIso}
      />
      {saveAction ? (
        <div className="scheduler-reconcile-column-save">
          {saveAction.saveError ? (
            <p className="scheduler-reconcile-error" role="alert">
              {saveAction.saveError}
            </p>
          ) : null}
          {saveAction.saveSuccess ? (
            <p className="scheduler-reconcile-success">{saveAction.saveSuccess}</p>
          ) : null}
          <button
            type="button"
            className="scheduler-day-header-btn scheduler-reconcile-save-btn"
            disabled={saveAction.saving}
            onClick={saveAction.onSave}
          >
            {saveAction.saving ? 'Saving…' : 'Save day times'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function SchedulerReconcileModal({
  open,
  onClose,
  date,
  employeeId,
  practiceTz,
  predictedDayData,
  appointments,
  appointmentTypes,
  onWorkdaySaved,
  renderVisitHighlights,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predicted, setPredicted] = useState<DayData | null>(predictedDayData ?? null);
  const [workday, setWorkday] = useState<EmployeeWorkdayActual | null>(null);
  const [actualDayStartTime, setActualDayStartTime] = useState('');
  const [actualDayEndTime, setActualDayEndTime] = useState('');
  const [savingWorkday, setSavingWorkday] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);
  const [employeeDayTimes, setEmployeeDayTimes] = useState<EmployeeDayTimes>({ start: '', end: '' });
  const [contextMenu, setContextMenu] = useState<{
    appt: Appointment;
    x: number;
    y: number;
  } | null>(null);

  const typeFillMap = useMemo(() => buildTypeFillMap(appointmentTypes), [appointmentTypes]);
  const apptById = useMemo(() => apptByIdMap(appointments), [appointments]);

  const resolveDriveHint = useCallback(
    (appt: Appointment, dayData: DayData | null, tz: string, showDriveCol: boolean) => {
      if (!dayData || !showDriveCol) return null;
      const row = driveHouseholdAndSlotForAppointment(dayData, appt.id);
      if (!row) return null;
      return driveHintFromHouseholdSlot(row.h, row.slot, tz, true);
    },
    []
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setLoading(true);
    setPredicted(predictedDayData ?? null);
    setWorkday(null);

    (async () => {
      try {
        const [workdayRow, driveResult] = await Promise.all([
          fetchEmployeeWorkdayActualByDate(employeeId, date),
          predictedDayData
            ? Promise.resolve(null)
            : fetchSchedulerDriveContextForDate(date, employeeId),
        ]);
        if (cancelled) return;
        setWorkday(workdayRow);
        let predictedRow: DayData | null = null;
        if (predictedDayData) {
          predictedRow = predictedDayData;
        } else if (driveResult?.dayData) {
          predictedRow = driveResult.dayData;
        }
        const employeeTimes = await resolveEmployeeDayTimes(employeeId, date, predictedRow);
        if (cancelled) return;
        setEmployeeDayTimes(employeeTimes);
        if (predictedRow) {
          setPredicted(enrichPredictedWithEmployeeDayTimes(predictedRow, employeeTimes));
        } else {
          setPredicted(null);
        }
      } catch (e: unknown) {
        if (cancelled) return;
        const msg =
          e && typeof e === 'object' && 'message' in e
            ? String((e as Error).message)
            : 'Failed to load reconcile data';
        setError(msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, date, employeeId, predictedDayData]);

  const predictedTz = practiceTimeZoneOrDefault(predicted?.timezone ?? practiceTz);

  useEffect(() => {
    if (!open || !predicted) {
      setActualDayStartTime('');
      setActualDayEndTime('');
      return;
    }
    const recordedStart = workday?.workdayStartActual?.trim()
      ? toTimeLocalValue(workday.workdayStartActual, predictedTz)
      : '';
    const recordedEnd = workday?.workdayEndActual?.trim()
      ? toTimeLocalValue(workday.workdayEndActual, predictedTz)
      : '';
    setActualDayStartTime(recordedStart);
    setActualDayEndTime(recordedEnd);
  }, [open, predicted, workday, predictedTz]);

  const actualBundle = useMemo(() => {
    if (!predicted) return null;
    const bundle = buildActualDayBundle(predicted, appointments, workday, employeeDayTimes);
    const savedStartIso = workday?.workdayStartActual?.trim() || null;
    const savedEndIso = workday?.workdayEndActual?.trim() || null;
    const startIso = actualDayStartTime.trim()
      ? combineDateAndTimeToUtc(date, actualDayStartTime, predictedTz)
      : savedStartIso;
    const endIso = actualDayEndTime.trim()
      ? combineDateAndTimeToUtc(date, actualDayEndTime, predictedTz)
      : savedEndIso;
    return {
      ...bundle,
      workdayStartIso: startIso,
      workdayEndIso: endIso,
      dayData: {
        ...bundle.dayData,
        startDepotTime: startIso ? isoToDepotTimeStr(startIso, predictedTz) : null,
        endDepotTime: endIso ? isoToDepotTimeStr(endIso, predictedTz) : null,
      },
    };
  }, [
    predicted,
    appointments,
    workday,
    employeeDayTimes,
    actualDayStartTime,
    actualDayEndTime,
    date,
    predictedTz,
  ]);

  const actualDay = actualBundle?.dayData ?? null;
  const workdayStartIso = actualBundle?.workdayStartIso ?? null;
  const workdayEndIso = actualBundle?.workdayEndIso ?? null;

  const visitHover = useVisitHighlightsHoverPopover({
    enabled: open,
    zIndex: RECONCILE_VISIT_HOVER_Z_INDEX,
    renderContent: (appt) =>
      renderVisitHighlights(
        appt,
        resolveDriveHint(appt, predicted, predictedTz, true) ??
          resolveDriveHint(appt, actualDay, predictedTz, true)
      ),
  });

  const handleVisitContextMenu = useCallback(
    (appt: Appointment, ev: MouseEvent<HTMLElement>) => {
      visitHover.onContextMenuOpen();
      setContextMenu({ appt, x: ev.clientX, y: ev.clientY });
    },
    [visitHover]
  );

  const handleContextMenuAction = useCallback(
    (action: SchedulerContextMenuAction) => {
      setContextMenu(null);
      if (action.kind !== 'viewChart' || !contextMenu) return;
      const patients = patientsForAppointment(contextMenu.appt);
      const pid = pickStr(patients[0]?.pimsId);
      if (!pid) return;
      window.open(evetPatientLink(pid), '_blank', 'noopener,noreferrer');
    },
    [contextMenu]
  );

  const weekGrid = useMemo(() => {
    if (!predicted || !actualDay) {
      return { gridStartMinutesFromMidnight: DEFAULT_GRID_START, totalMinutes: DEFAULT_GRID_END - DEFAULT_GRID_START };
    }
    return computeGridBounds(predicted, actualDay, practiceTz, workdayStartIso, workdayEndIso);
  }, [predicted, actualDay, practiceTz, workdayStartIso, workdayEndIso]);

  const predictedTimingByKey = useMemo((): Map<string, VisitTiming> => {
    const map = new Map<string, VisitTiming>();
    if (!predicted) return map;
    const layout = computeMyWeekDayColumnLayout(
      predicted,
      weekGrid,
      date,
      true,
      predicted.appointmentBufferMinutes ?? DEFAULT_APPOINTMENT_BUFFER_MINUTES
    );
    if (!layout) return map;
    layout.displayHouseholds.forEach((h, idx) => {
      const key = primaryApptId(h) ?? h.key;
      map.set(key, predictedVisitTiming(h, layout.displayTimeline[idx], true));
    });
    return map;
  }, [predicted, weekGrid, date]);

  const predictedDayStartTime =
    employeeDayTimes.start || depotTimeToInputValue(predicted?.startDepotTime);
  const predictedShiftEndTime =
    employeeDayTimes.end || depotTimeToInputValue(predicted?.endDepotTime);
  const predictedDepotEnd = useMemo(() => {
    if (!predicted) {
      return { endTime: '', endLabel: 'Day end' as const, endIso: null as string | null };
    }
    return predictedBackToDepotEndDisplay(predicted, predictedTz, predictedShiftEndTime);
  }, [predicted, predictedTz, predictedShiftEndTime]);

  const plannedDayStartIso = predicted
    ? depotTimeToIso(date, employeeDayTimes.start, predictedTz) ??
      depotTimeToIso(date, predicted.startDepotTime, practiceTimeZoneOrDefault(predicted.timezone))
    : null;
  const plannedDayEndIso = predicted
    ? predictedDepotEnd.endIso ??
      depotTimeToIso(date, employeeDayTimes.end, predictedTz) ??
      depotTimeToIso(date, predicted.endDepotTime, practiceTimeZoneOrDefault(predicted.timezone))
    : null;

  const gridHeightPx = weekGrid.totalMinutes * PPM;
  const bufferMin = predicted?.appointmentBufferMinutes ?? DEFAULT_APPOINTMENT_BUFFER_MINUTES;

  const predictedBlocks = useMemo(() => {
    if (!predicted) return [];
    return computeVisitBlockLayouts(predicted, weekGrid, date, true, bufferMin);
  }, [predicted, weekGrid, date, bufferMin]);

  const actualBlocks = useMemo(() => {
    if (!actualDay) return [];
    return computeVisitBlockLayouts(actualDay, weekGrid, date, true, bufferMin);
  }, [actualDay, weekGrid, date, bufferMin]);

  const handleSaveWorkdayTimes = async () => {
    if (!predicted) return;
    setSaveError(null);
    setSaveSuccess(null);
    const startIso = actualDayStartTime.trim()
      ? combineDateAndTimeToUtc(date, actualDayStartTime, predictedTz)
      : null;
    const endIso = actualDayEndTime.trim()
      ? combineDateAndTimeToUtc(date, actualDayEndTime, predictedTz)
      : null;
    if (!startIso) {
      setSaveError('Enter a valid day start time.');
      return;
    }
    if (endIso && DateTime.fromISO(endIso) <= DateTime.fromISO(startIso)) {
      setSaveError('Day end must be after day start.');
      return;
    }
    setSavingWorkday(true);
    try {
      const updated = await upsertEmployeeWorkdayActual(employeeId, {
        date,
        workdayStartActual: startIso,
        workdayEndActual: endIso,
      });
      setWorkday(updated);
      onWorkdaySaved?.(updated);
      setSaveSuccess('Day times saved.');
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const m = ax?.response?.data?.message;
      if (Array.isArray(m)) setSaveError(m.join(', '));
      else if (typeof m === 'string' && m.trim()) setSaveError(m);
      else if (ax?.message) setSaveError(ax.message);
      else setSaveError('Could not save day times.');
    } finally {
      setSavingWorkday(false);
    }
  };

  if (!open) return null;

  const dateLabel = DateTime.fromISO(date).toFormat('cccc, MMMM d, yyyy');

  return createPortal(
    <div
      className="scheduler-modal-backdrop scheduler-reconcile-backdrop"
      role="presentation"
      onMouseDown={onClose}
    >
      <div
        className="scheduler-modal scheduler-reconcile-modal"
        role="dialog"
        aria-modal
        aria-labelledby="scheduler-reconcile-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Schedule progress</p>
            <h2 id="scheduler-reconcile-title" className="scheduler-modal-title-h">
              {dateLabel}
            </h2>
            <p className="scheduler-modal-subtitle">
              Predicted route with drive times vs. recorded day and visit times
            </p>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-reconcile-body">
          {loading ? (
            <p className="scheduler-reconcile-status">Loading…</p>
          ) : error ? (
            <p className="scheduler-reconcile-error" role="alert">
              {error}
            </p>
          ) : !predicted || !actualDay ? (
            <p className="scheduler-reconcile-status">No schedule data for this day.</p>
          ) : (
            <div className="scheduler-reconcile-board">
              <div className="scheduler-reconcile-board-headers">
                <div className="scheduler-reconcile-time-col-spacer" aria-hidden />
                <ReconcileColumnHeader
                  title="Predicted (drive times)"
                  dayStartTime={predictedDayStartTime}
                  dayEndTime={predictedDepotEnd.endTime}
                  dayEndLabel={predictedDepotEnd.endLabel}
                  readOnly
                  practiceTz={practiceTimeZoneOrDefault(predicted.timezone)}
                  dateIso={date}
                />
                <div className="scheduler-reconcile-connector-spacer" aria-hidden />
                <ReconcileColumnHeader
                  title="Actual"
                  dayStartTime={actualDayStartTime}
                  dayEndTime={actualDayEndTime}
                  readOnly={false}
                  onDayStartTimeChange={setActualDayStartTime}
                  onDayEndTimeChange={setActualDayEndTime}
                  practiceTz={practiceTimeZoneOrDefault(predicted.timezone)}
                  predictedDayStartIso={plannedDayStartIso}
                  predictedDayEndIso={plannedDayEndIso}
                  dateIso={date}
                  saveAction={{
                    saving: savingWorkday,
                    onSave: () => void handleSaveWorkdayTimes(),
                    saveError,
                    saveSuccess,
                  }}
                />
                <div className="scheduler-reconcile-time-col-spacer" aria-hidden />
              </div>
              <div className="scheduler-reconcile-board-scroll">
                <div className="scheduler-reconcile-board-timeline">
                  <ReconcileTimeColumn
                    weekGrid={weekGrid}
                    practiceTz={practiceTimeZoneOrDefault(predicted.timezone)}
                    align="right"
                  />
                  <div className="scheduler-reconcile-column scheduler-reconcile-column--grid">
                    <ReconcileDayGrid
                      dayData={predicted}
                      weekGrid={weekGrid}
                      dateIso={date}
                      practiceTz={practiceTimeZoneOrDefault(predicted.timezone)}
                      showDrive
                      shiftDepotStartTime={predictedDayStartTime}
                      shiftDepotEndTime={predictedShiftEndTime}
                      apptById={apptById}
                      appointmentTypes={appointmentTypes}
                      typeFillMap={typeFillMap}
                      onVisitMouseEnter={visitHover.onMouseEnter}
                      onVisitMouseMove={visitHover.onMouseMove}
                      onVisitMouseLeave={visitHover.onMouseLeave}
                      onVisitContextMenu={handleVisitContextMenu}
                    />
                  </div>
                  <ReconcileConnectorLines
                    predictedBlocks={predictedBlocks}
                    actualBlocks={actualBlocks}
                    heightPx={gridHeightPx}
                  />
                  <div className="scheduler-reconcile-column scheduler-reconcile-column--grid">
                    <ReconcileDayGrid
                      dayData={actualDay}
                      weekGrid={weekGrid}
                      dateIso={date}
                      practiceTz={practiceTimeZoneOrDefault(predicted.timezone)}
                      showDrive
                      showVisitDelta
                      predictedTimingByKey={predictedTimingByKey}
                      shiftDepotStartTime={predictedDayStartTime}
                      shiftDepotEndTime={predictedShiftEndTime}
                      apptById={apptById}
                      appointmentTypes={appointmentTypes}
                      typeFillMap={typeFillMap}
                      onVisitMouseEnter={visitHover.onMouseEnter}
                      onVisitMouseMove={visitHover.onMouseMove}
                      onVisitMouseLeave={visitHover.onMouseLeave}
                      onVisitContextMenu={handleVisitContextMenu}
                    />
                  </div>
                  <ReconcileTimeColumn
                    weekGrid={weekGrid}
                    practiceTz={practiceTimeZoneOrDefault(predicted.timezone)}
                    align="left"
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
      {visitHover.portal}
      {contextMenu ? (
        <SchedulerAppointmentContextMenu
          appt={contextMenu.appt}
          client={contextMenu.appt.client ?? undefined}
          anchorPoint={{ x: contextMenu.x, y: contextMenu.y }}
          onClose={() => setContextMenu(null)}
          onAction={handleContextMenuAction}
          patientChartOnly
          roomLoaderMenuLabel=""
        />
      ) : null}
    </div>,
    document.body
  );
}
