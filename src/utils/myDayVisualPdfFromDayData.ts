/**
 * Build My Day — Visual PDF rows + stats from practice scheduler / My Week {@link DayData}
 * (same document shell as DoctorDayVisual; segment titles may differ slightly from the full visual layout).
 */
import { DateTime } from 'luxon';
import {
  blockDisplayLabel,
  isFlexBlockItem,
  previewRoutingAppointmentLabel,
  type DoctorDayAppt,
  type MiniZone,
} from '../api/appointments';
import { dayPoints, dayTotalDriveSeconds, type DayData, type WeekHousehold } from '../pages/MyWeek';
import {
  fixedTimeRouteEtaMeaningfullyAfterScheduledStart,
  shouldShowEtaWindowWarning,
} from './windowWarning';
import { practiceTimeZoneOrDefault } from './practiceTimezone';
import type {
  DoctorDayVisualPdfAppointmentPayload,
  DoctorDayVisualPdfDocumentProps,
  DoctorDayVisualPdfPatient,
  DoctorDayVisualPdfRow,
} from '../pages/DoctorDayVisualPdf';

const str = (o: unknown, k: string) =>
  typeof (o as Record<string, unknown>)?.[k] === 'string'
    ? ((o as Record<string, unknown>)[k] as string)
    : undefined;

function weekHouseholdIsClientFixedTime(h: WeekHousehold): boolean {
  const at = (h.primary as { appointmentType?: { name?: string; prettyName?: string } })?.appointmentType;
  const nestedName =
    at && typeof at === 'object'
      ? String(at.name ?? at.prettyName ?? '')
          .trim()
          .toLowerCase()
      : '';
  const flat = (str(h.primary, 'appointmentType') ?? str(h.primary, 'appointmentTypeName') ?? '')
    .trim()
    .toLowerCase();
  const typeLower = nestedName || flat;
  if (typeLower === 'fixed time' || typeLower.includes('fixed time')) return true;
  return (h.patients[0]?.type || '').toLowerCase() === 'fixed time';
}

function weekHouseholdUsesDoctorDayClockForLayout(
  h: WeekHousehold,
  slot: { eta?: string | null; etd?: string | null } | undefined,
  showByDriveTime: boolean
): boolean {
  if (!showByDriveTime) return true;
  const flexBlock = Boolean(h.isPersonalBlock && isFlexBlockItem(h.primary));
  if (h.isPersonalBlock && !flexBlock) return true;
  if (!weekHouseholdIsClientFixedTime(h)) return false;
  const eta = slot?.eta;
  const schedStart = h.startIso;
  if (!eta || !schedStart) return true;
  const etaDt = DateTime.fromISO(eta);
  const schedDt = DateTime.fromISO(schedStart);
  if (!etaDt.isValid || !schedDt.isValid) return true;
  if (fixedTimeRouteEtaMeaningfullyAfterScheduledStart(schedStart, eta)) return false;
  return true;
}

function eightThirtyIsoFor(date: string, practiceTz: string): string {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  return DateTime.fromISO(date, { zone: tz })
    .set({ hour: 8, minute: 30, second: 0, millisecond: 0 })
    .toISO()!;
}

function tenThirtyIsoFor(date: string, practiceTz: string): string {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  return DateTime.fromISO(date, { zone: tz })
    .set({ hour: 10, minute: 30, second: 0, millisecond: 0 })
    .toISO()!;
}

function workStartIsoFor(date: string, schedStartIso: string | null | undefined, practiceTz: string): string {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  if (schedStartIso && /^\d{2}:\d{2}(:\d{2})?$/.test(schedStartIso)) {
    const [hh, mm] = schedStartIso.split(':');
    return DateTime.fromISO(date, { zone: tz })
      .set({
        hour: Math.min(23, Number(hh) || 0),
        minute: Math.min(59, Number(mm) || 0),
        second: 0,
        millisecond: 0,
      })
      .toISO()!;
  }
  if (schedStartIso && DateTime.fromISO(schedStartIso).isValid) return schedStartIso;
  return eightThirtyIsoFor(date, practiceTz);
}

function adjustedWindowForStart(
  date: string,
  startIso: string,
  schedStartIso: string | null | undefined,
  practiceTz: string
): { winStartIso: string; winEndIso: string } {
  const start = DateTime.fromISO(startIso);
  const workStart = DateTime.fromISO(workStartIsoFor(date, schedStartIso, practiceTz));
  const eightThirty = DateTime.fromISO(eightThirtyIsoFor(date, practiceTz));
  const tenThirty = DateTime.fromISO(tenThirtyIsoFor(date, practiceTz));

  const symmetricEarly = start.minus({ hours: 1 });
  if (symmetricEarly < eightThirty && start <= tenThirty) {
    const ws = workStart > eightThirty ? workStart : eightThirty;
    const we = ws.plus({ hours: 2 });
    return { winStartIso: ws.toISO()!, winEndIso: we.toISO()! };
  }
  const ws = DateTime.max(workStart, start.minus({ hours: 1 }));
  const we = start.plus({ hours: 1 });
  return { winStartIso: ws.toISO()!, winEndIso: we.toISO()! };
}

function alignHouseholdsAndTimeline(day: DayData): { households: WeekHousehold[]; timeline: DayData['timeline'] } {
  const ord = day.routingOrderIndices;
  const hs = day.households;
  const tl = day.timeline;
  if (Array.isArray(ord) && ord.length === hs.length) {
    return {
      households: ord.map((i) => hs[i]),
      timeline: ord.map((i) => tl[i] ?? {}),
    };
  }
  return { households: [...hs], timeline: [...tl] };
}

function householdStartEnd(h: WeekHousehold): { startIso: string | null; endIso: string | null } {
  if (h.isPersonalBlock && h.primary?.effectiveWindow?.startIso && h.primary?.effectiveWindow?.endIso) {
    return { startIso: h.primary.effectiveWindow.startIso, endIso: h.primary.effectiveWindow.endIso };
  }
  return { startIso: h.startIso ?? null, endIso: h.endIso ?? null };
}

function getApptTypeString(appt: DoctorDayAppt): string {
  const type1 = str(appt, 'appointmentType');
  const type2 = str(appt, 'appointmentTypeName');
  const type3 = str(appt, 'serviceName');
  const type4 = (appt as { appointmentType?: unknown }).appointmentType;
  const type5 = (appt as { appointmentTypeName?: unknown }).appointmentTypeName;
  const type6 = typeof type4 === 'object' && type4 && 'name' in (type4 as object)
    ? String((type4 as { name?: string }).name)
    : null;

  return (
    type1 ||
    type2 ||
    type3 ||
    (typeof type4 === 'string' ? type4 : null) ||
    (typeof type5 === 'string' ? type5 : null) ||
    type6 ||
    ''
  );
}

function toPdfPatients(h: WeekHousehold): DoctorDayVisualPdfPatient[] {
  return (h.patients ?? []).map((p) => ({
    name: p.name,
    type: p.type ?? undefined,
  }));
}

function buildStats(day: DayData, ordered: WeekHousehold[]): DoctorDayVisualPdfDocumentProps['stats'] {
  const points = dayPoints(ordered);
  const driveSec = dayTotalDriveSeconds(day);
  const driveMin = Math.max(0, Math.round(driveSec / 60));
  let householdSec = 0;
  for (const h of ordered) {
    if (h.isPersonalBlock) continue;
    const { startIso, endIso } = householdStartEnd(h);
    if (startIso && endIso) {
      const a = DateTime.fromISO(startIso);
      const b = DateTime.fromISO(endIso);
      if (a.isValid && b.isValid) householdSec += Math.max(0, b.diff(a, 'seconds').seconds);
    }
  }
  const householdMin = Math.max(0, Math.round(householdSec / 60));
  const ratioText = driveMin > 0 ? (householdMin / driveMin).toFixed(2) : '—';
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  let firstMs = 0;
  const fs = first ? householdStartEnd(first).startIso : null;
  if (fs) {
    const t = DateTime.fromISO(fs);
    if (t.isValid) firstMs = t.toMillis();
  }
  let lastMs = 0;
  const le = last ? householdStartEnd(last).endIso : null;
  if (le) {
    const t = DateTime.fromISO(le);
    if (t.isValid) lastMs = t.toMillis();
  }
  let shiftMin =
    firstMs && lastMs ? Math.max(0, Math.round((lastMs - firstMs) / 60000)) : Math.max(householdMin + driveMin, 1);
  let whiteMin = shiftMin - householdMin - driveMin;
  if (whiteMin < 0) {
    shiftMin = householdMin + driveMin;
    whiteMin = 0;
  }
  const whitePctText = shiftMin > 0 ? `${Math.round((whiteMin / shiftMin) * 100)}%` : '—';
  return {
    points,
    driveMin,
    householdMin,
    ratioText,
    whiteMin: Math.max(0, whiteMin),
    whitePctText,
    shiftMin,
    backToDepotIso: day.backToDepotIso ?? null,
  };
}

function fromDepotMinutes(day: DayData, N: number): number | null {
  const depot = day.depotToFirstRoutableSec;
  if (typeof depot === 'number' && Number.isFinite(depot) && depot > 0) {
    return Math.max(0, Math.round(depot / 60));
  }
  const ds = day.driveSeconds;
  if (Array.isArray(ds) && ds.length >= N + 1 && N > 0) {
    const sec = ds[0] ?? 0;
    if (sec > 0) return Math.max(0, Math.round(sec / 60));
  }
  return null;
}

function driveLegAfterHousehold(day: DayData, displayIdx: number, N: number): number {
  const ds = day.driveSeconds;
  if (!Array.isArray(ds) || ds.length === 0 || displayIdx >= N - 1) return 0;
  if (ds.length === N + 1) {
    const sec = ds[displayIdx + 1] ?? 0;
    return Math.max(0, Math.round(sec / 60));
  }
  if (ds.length === N) {
    const sec = ds[displayIdx + 1] ?? 0;
    return Math.max(0, Math.round(sec / 60));
  }
  if (ds.length === N - 1) {
    const sec = ds[displayIdx] ?? 0;
    return Math.max(0, Math.round(sec / 60));
  }
  return 0;
}

function lastNonBlockIndex(ordered: WeekHousehold[]): number {
  for (let i = ordered.length - 1; i >= 0; i--) {
    if (!ordered[i]?.isPersonalBlock) return i;
  }
  return -1;
}

function buildAppointmentPayload(
  h: WeekHousehold,
  slot: DayData['timeline'][number],
  idx: number,
  ordered: WeekHousehold[],
  showByDriveTime: boolean,
  dateIso: string,
  practiceTimeZone: string,
  backToDepotIso: string | null
): DoctorDayVisualPdfAppointmentPayload | null {
  const { startIso: s0, endIso: e0 } = householdStartEnd(h);
  const doctorDayClock = weekHouseholdUsesDoctorDayClockForLayout(h, slot, showByDriveTime);
  const etaIso = slot?.eta ?? null;
  const etdIso = slot?.etd ?? null;
  const useDriveTime = showByDriveTime && !doctorDayClock && (etaIso ?? etdIso);
  let resolvedStartIso = s0;
  let resolvedEndIso = e0;
  if (useDriveTime && etaIso) {
    resolvedStartIso = etaIso;
    if (etdIso) resolvedEndIso = etdIso;
    else if (s0 && e0) {
      const dur = DateTime.fromISO(e0).diff(DateTime.fromISO(s0), 'minutes').minutes;
      resolvedEndIso = DateTime.fromISO(etaIso).plus({ minutes: Math.max(1, Math.round(dur)) }).toISO()!;
    }
  }
  if (!resolvedStartIso || !resolvedEndIso) return null;
  const schedStart = DateTime.fromISO(resolvedStartIso);
  const schedEnd = DateTime.fromISO(resolvedEndIso);
  if (!schedStart.isValid || !schedEnd.isValid) return null;
  const durMin = Math.max(1, Math.round(schedEnd.diff(schedStart, 'minutes').minutes));

  const primaryTypeLower = getApptTypeString(h.primary).toLowerCase();
  const firstPatientType = (h.patients[0]?.type || '').toLowerCase();
  const flexBlock = Boolean(h.isPersonalBlock && isFlexBlockItem(h.primary));
  const isFixedTime =
    (h.isPersonalBlock && !flexBlock) ||
    primaryTypeLower === 'fixed time' ||
    firstPatientType === 'fixed time';

  const ew = h.effectiveWindow ?? h.primary?.effectiveWindow;
  const { winStartIso, winEndIso } = isFixedTime
    ? { winStartIso: resolvedStartIso, winEndIso: resolvedEndIso }
    : slot?.windowStartIso && slot?.windowEndIso
      ? { winStartIso: slot.windowStartIso, winEndIso: slot.windowEndIso }
      : ew?.startIso && ew?.endIso
        ? { winStartIso: ew.startIso, winEndIso: ew.endIso }
        : adjustedWindowForStart(dateIso, h.startIso ?? resolvedStartIso, undefined, practiceTimeZone);

  const clientFixedRoutePushedPastSchedule =
    showByDriveTime && weekHouseholdIsClientFixedTime(h) && !doctorDayClock;
  const windowWarning =
    showByDriveTime &&
    !h.isPersonalBlock &&
    ((useDriveTime && !isFixedTime && shouldShowEtaWindowWarning(etaIso, winEndIso)) ||
      clientFixedRoutePushedPastSchedule);

  const blockTitleText = h.isPersonalBlock
    ? blockDisplayLabel(h.primary)
    : h.isPreview
      ? previewRoutingAppointmentLabel({
          clientName: h.client,
          clientZone: (h.primary as { clientZone?: MiniZone | null }).clientZone ?? null,
          effectiveZone: (h.primary as { effectiveZone?: MiniZone | null }).effectiveZone ?? null,
          city: str(h.primary, 'city') ?? null,
        })
      : h.client;

  const lastIdx = lastNonBlockIndex(ordered);
  const showBackToDepotInBlock = Boolean(backToDepotIso && idx === lastIdx && lastIdx >= 0);

  return {
    key: h.key,
    client: blockTitleText,
    address: h.address,
    durMin,
    etaIso:
      showByDriveTime && doctorDayClock
        ? resolvedStartIso
        : showByDriveTime
          ? (etaIso ?? null)
          : null,
    etdIso:
      showByDriveTime && doctorDayClock
        ? resolvedEndIso
        : showByDriveTime
          ? (etdIso ?? null)
          : null,
    sIso: h.startIso!,
    eIso: h.endIso!,
    patients: toPdfPatients(h),
    clientAlert: str(h.primary, 'clientAlert') ?? undefined,
    isFixedTime,
    isPersonalBlock: !!h.isPersonalBlock,
    isNoLocation: !!h.isNoLocation,
    isPreview: !!h.isPreview,
    flexBlock,
    effectiveWindow: h.primary?.effectiveWindow,
    windowFromByIndex:
      slot?.windowStartIso && slot?.windowEndIso
        ? { winStartIso: slot.windowStartIso, winEndIso: slot.windowEndIso }
        : undefined,
    resolvedWinStartIso: winStartIso,
    resolvedWinEndIso: winEndIso,
    windowWarning,
    showBackToDepotInBlock,
    backToDepotIso: showBackToDepotInBlock ? backToDepotIso : undefined,
  };
}

export type BuildMyDayVisualPdfFromDayDataArgs = {
  day: DayData;
  showByDriveTime: boolean;
  practiceTimeZone: string;
  dateIso: string;
};

export function buildMyDayVisualPdfExportPayloadFromDayData(
  args: BuildMyDayVisualPdfFromDayDataArgs
): {
  stats: DoctorDayVisualPdfDocumentProps['stats'];
  rows: DoctorDayVisualPdfRow[];
} {
  const { day, showByDriveTime, practiceTimeZone, dateIso } = args;
  const { households: ordered, timeline } = alignHouseholdsAndTimeline(day);
  const stats = buildStats(day, ordered);
  const N = ordered.length;
  const rows: DoctorDayVisualPdfRow[] = [];
  const apptBufDefault = day.appointmentBufferMinutes ?? 5;

  const fdMin = fromDepotMinutes(day, N);
  if (fdMin != null && fdMin > 0) {
    rows.push({
      rowType: 'segment',
      segment: { kind: 'fromDepot', title: `Drive from depot: ${fdMin} min`, mins: fdMin },
    });
  }

  for (let idx = 0; idx < N; idx++) {
    const h = ordered[idx];
    const slot = timeline[idx] ?? {};
    const payload = buildAppointmentPayload(
      h,
      slot,
      idx,
      ordered,
      showByDriveTime,
      dateIso,
      practiceTimeZone,
      stats.backToDepotIso
    );
    if (payload) rows.push({ rowType: 'appointment', payload });

    if (idx < N - 1) {
      const bufRaw = slot?.bufferAfterMinutes;
      const bufMin =
        typeof bufRaw === 'number' && Number.isFinite(bufRaw)
          ? Math.max(0, bufRaw)
          : Math.max(0, apptBufDefault);
      if (bufMin > 0) {
        rows.push({
          rowType: 'segment',
          segment: {
            kind: 'buffer',
            title: `Buffer after visit: ${Math.max(1, Math.round(bufMin))} min`,
            mins: Math.max(1, Math.round(bufMin)),
          },
        });
      }
      const dm = driveLegAfterHousehold(day, idx, N);
      if (dm > 0) {
        rows.push({
          rowType: 'segment',
          segment: {
            kind: 'drive',
            title: `Drive to next stop: ${dm} min`,
            mins: dm,
          },
        });
      }
    }
  }

  const lastAddr = lastNonBlockIndex(ordered);
  if (lastAddr >= 0) {
    const backSec = day.backToDepotSec;
    const backMin =
      typeof backSec === 'number' && Number.isFinite(backSec) && backSec > 0
        ? Math.max(0, Math.round(backSec / 60))
        : 0;
    if (backMin > 0) {
      const lastSlot = timeline[lastAddr] ?? {};
      const bufRaw = lastSlot?.bufferAfterMinutes;
      const bufMinLast =
        typeof bufRaw === 'number' && Number.isFinite(bufRaw)
          ? Math.max(0, bufRaw)
          : Math.max(0, apptBufDefault);
      if (bufMinLast > 0) {
        rows.push({
          rowType: 'segment',
          segment: {
            kind: 'buffer',
            title: `Buffer before return: ${Math.max(1, Math.round(bufMinLast))} min`,
            mins: Math.max(1, Math.round(bufMinLast)),
          },
        });
      }
      rows.push({
        rowType: 'segment',
        segment: {
          kind: 'drive',
          title: `Return to depot: ${backMin} min`,
          mins: backMin,
        },
      });
    }
  }

  return { stats, rows };
}
