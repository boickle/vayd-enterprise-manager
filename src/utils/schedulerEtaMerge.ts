/**
 * Merge /routing/eta response into My Week–compatible DayData (used by Scheduler + schedulerDriveEta).
 */
import { DateTime } from 'luxon';
import { blockDisplayLabel } from '../api/appointments';
import { DEFAULT_APPOINTMENT_BUFFER_MINUTES } from '../api/routing';
import type { DayData } from '../pages/MyWeek';
import { clampTimelineEtasToArrivalWindows } from './clampEtaToArrivalWindow';

function keyFor(lat: number, lon: number, d = 6) {
  const m = Math.pow(10, d);
  return `${Math.round(lat * m) / m},${Math.round(lon * m) / m}`;
}

function keyVariantsForKeyString(s: string): string[] {
  const suffix = s.includes(':') ? s.slice(s.indexOf(':')) : '';
  const base = suffix ? s.slice(0, s.indexOf(':')) : s;
  const parts = base.split(',');
  if (parts.length !== 2) return [s];
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);
  if (Number.isNaN(lat) || Number.isNaN(lon)) return [s];
  const k6 = keyFor(lat, lon, 6) + suffix;
  const k5 = keyFor(lat, lon, 5) + suffix;
  return [s, k6, k5].filter((x, i, arr) => arr.indexOf(x) === i);
}

/**
 * `/routing/eta` may omit calendar-only staff items (Note To Staff, etc.).
 * Stretch `driveSeconds` back onto the full household list (0 for omitted stops).
 */
export function expandEtaDriveSecondsToHouseholds(
  households: { key?: string }[],
  result: { driveSeconds?: number[] | null; byIndex?: { key?: string }[] | null } | null
): number[] | null {
  const ds = Array.isArray(result?.driveSeconds) ? result!.driveSeconds! : null;
  if (!ds) return null;
  const byIndex = Array.isArray(result?.byIndex) ? result!.byIndex! : [];
  if (byIndex.length === 0 || byIndex.length === households.length) return ds;

  const driveToByKey = new Map<string, number>();
  byIndex.forEach((row, i) => {
    if (row?.key == null) return;
    const v = ds[i];
    driveToByKey.set(String(row.key), typeof v === 'number' && Number.isFinite(v) ? v : 0);
  });

  const full = households.map((h) => {
    const k = h.key != null ? String(h.key) : '';
    if (k && driveToByKey.has(k)) return driveToByKey.get(k)!;
    return 0;
  });
  const returnLegIndex = byIndex.length;
  const returnLeg = ds.length > returnLegIndex ? ds[returnLegIndex] : undefined;
  if (typeof returnLeg === 'number' && Number.isFinite(returnLeg)) {
    full.push(returnLeg);
  }
  return full;
}

export type DayBundleIn = {
  date: string;
  timezone: string;
  /** Doctor-day / ETA households (scheduler or My Week shape). */
  households: any[];
  timeline: { eta?: string | null; etd?: string | null }[];
  startDepot: { lat: number; lon: number } | null;
  endDepot: { lat: number; lon: number } | null;
  /** From GET /appointments/doctor (top-level). */
  startDepotTown?: string | null;
  startDepotTime: string | null;
  endDepotTime: string | null;
};

export function mergeEtaFetchIntoDayData(day: DayBundleIn, result: any): DayData {
  const valid = (s?: string | null) => !!(s && DateTime.fromISO(s).isValid);

  const keyToSlot: Record<
    string,
    {
      eta: string | null;
      etd: string | null;
      windowStartIso?: string | null;
      windowEndIso?: string | null;
      bufferAfterMinutes?: number;
    }
  > = {};
  const blockLabelFromByIndex: Record<string, string> = {};
  if (Array.isArray(result?.byIndex)) {
    for (const row of result.byIndex as {
      key?: string;
      etaIso?: string;
      etdIso?: string;
      windowStartIso?: string;
      windowEndIso?: string;
      blockLabel?: string;
      bufferAfterMinutes?: number;
    }[]) {
      const k = row?.key;
      if (k == null) continue;
      const eta = valid(row?.etaIso) ? row.etaIso! : null;
      const etd = valid(row?.etdIso) ? row.etdIso! : null;
      const windowStartIso = valid(row?.windowStartIso) ? row.windowStartIso! : null;
      const windowEndIso = valid(row?.windowEndIso) ? row.windowEndIso! : null;
      const bufferAfterMinutes =
        typeof row.bufferAfterMinutes === 'number' && Number.isFinite(row.bufferAfterMinutes)
          ? row.bufferAfterMinutes
          : undefined;
      const entry = {
        eta,
        etd,
        windowStartIso: windowStartIso ?? undefined,
        windowEndIso: windowEndIso ?? undefined,
        ...(bufferAfterMinutes !== undefined ? { bufferAfterMinutes } : {}),
      };
      for (const variant of keyVariantsForKeyString(k)) {
        keyToSlot[variant] = entry;
      }
      const bl = row?.blockLabel;
      if (bl != null && String(bl).trim() !== '') {
        for (const variant of keyVariantsForKeyString(k)) {
          blockLabelFromByIndex[variant] = String(bl).trim();
        }
      }
    }
  }

  let tl = day.households.map((h) => {
    let slot = h.key ? keyToSlot[h.key] : undefined;
    if (!slot && h.key) {
      for (const variant of keyVariantsForKeyString(h.key)) {
        const found = keyToSlot[variant];
        if (found) {
          slot = found;
          break;
        }
      }
    }
    if (
      !slot &&
      Number.isFinite(h.lat) &&
      Number.isFinite(h.lon) &&
      Math.abs(h.lat) > 1e-6 &&
      Math.abs(h.lon) > 1e-6
    ) {
      for (const d of [6, 5] as const) {
        const found = keyToSlot[keyFor(h.lat as number, h.lon as number, d)];
        if (found) {
          slot = found;
          break;
        }
      }
    }
    let eta = slot?.eta ?? null;
    let etd = slot?.etd ?? null;
    if (!eta && h?.startIso) eta = h.startIso;
    if (!etd && eta && h?.endIso) {
      const dur = h.startIso && h.endIso
        ? DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso)).as('minutes')
        : 60;
      etd = DateTime.fromISO(eta!).plus({ minutes: dur }).toISO();
    }
    return {
      eta: eta ?? undefined,
      etd: etd ?? undefined,
      windowStartIso: slot?.windowStartIso ?? undefined,
      windowEndIso: slot?.windowEndIso ?? undefined,
      ...(typeof slot?.bufferAfterMinutes === 'number' ? { bufferAfterMinutes: slot.bufferAfterMinutes } : {}),
    };
  });

  let driveSeconds: number[] | null = expandEtaDriveSecondsToHouseholds(day.households, result);
  let depotToFirstRoutableSec: number | null = null;
  if (Array.isArray(result?.byIndex)) {
    const firstRoutableRow = result.byIndex.find(
      (r: any) =>
        (r?.driveFromPrevSec ?? r?.driveFromPrevMinutes ?? 0) > 0 &&
        r?.key != null &&
        !String(r.key).startsWith('noloc:')
    );
    const row = firstRoutableRow ?? result.byIndex[0];
    if (row != null) {
      const sec = (row as any).driveFromPrevSec;
      const min = (row as any).driveFromPrevMinutes;
      depotToFirstRoutableSec =
        typeof sec === 'number' ? sec : typeof min === 'number' ? min * 60 : null;
    }
  }
  const firstH = day.households[0];
  const firstIsBlock = (firstH as any)?.isPersonalBlock === true || firstH?.isNoLocation === true;
  if (firstIsBlock && Array.isArray(result?.byIndex) && result.byIndex.length > 0 && driveSeconds && driveSeconds.length > 0) {
    const by0 = result.byIndex[0] as { driveFromPrevSec?: number; driveFromPrevMinutes?: number };
    const depotToBlockSec =
      typeof by0.driveFromPrevSec === 'number'
        ? by0.driveFromPrevSec
        : typeof by0.driveFromPrevMinutes === 'number'
          ? by0.driveFromPrevMinutes * 60
          : 0;
    const apiSentFirst = driveSeconds[0] != null;
    if (depotToBlockSec > 0 && !apiSentFirst) {
      driveSeconds = [depotToBlockSec, ...driveSeconds.slice(1)];
    }
  }

  const backToDepotSec = typeof result?.backToDepotSec === 'number' ? result.backToDepotSec : null;
  const backToDepotIso = result?.backToDepotIso ?? null;
  const appointmentBufferMinutes =
    typeof result?.appointmentBufferMinutes === 'number'
      ? result.appointmentBufferMinutes
      : DEFAULT_APPOINTMENT_BUFFER_MINUTES;

  const N = day.households.length;
  let routingOrderIndices: number[];
  if (Array.isArray(result?.byIndex) && result.byIndex.length === N) {
    const keyToPositionInDay: Record<string, number> = {};
    result.byIndex.forEach((row: { key?: string; positionInDay?: number }, i: number) => {
      const pos = typeof row.positionInDay === 'number' ? row.positionInDay : i + 1;
      if (row.key != null) {
        for (const variant of keyVariantsForKeyString(row.key)) {
          keyToPositionInDay[variant] = pos;
        }
      }
    });
    const getPositionInDay = (householdIndex: number): number => {
      const h = day.households[householdIndex];
      const pos = keyToPositionInDay[h.key];
      if (pos != null) return pos;
      if (Number.isFinite(h.lat) && Number.isFinite(h.lon)) {
        const k5 = keyFor(h.lat as number, h.lon as number, 5);
        if (keyToPositionInDay[k5] != null) return keyToPositionInDay[k5];
      }
      return 999;
    };
    routingOrderIndices = Array.from({ length: N }, (_, i) => i).sort(
      (a, b) => getPositionInDay(a) - getPositionInDay(b)
    );
  } else {
    routingOrderIndices = Array.from({ length: N }, (_, i) => i).sort((a, b) => {
      const anchorA = tl[a]?.eta ?? tl[a]?.etd ?? day.households[a]?.startIso ?? '';
      const anchorB = tl[b]?.eta ?? tl[b]?.etd ?? day.households[b]?.startIso ?? '';
      return anchorA.localeCompare(anchorB);
    });
  }

  for (let p = 1; p < routingOrderIndices.length; p++) {
    const currIdx = routingOrderIndices[p];
    const prevIdx = routingOrderIndices[p - 1];
    const h = day.households[currIdx];
    if (!h?.isPersonalBlock) continue;
    const curSlot = tl[currIdx];
    const prevSlot = tl[prevIdx];
    if (!curSlot?.eta || !prevSlot?.etd) continue;
    const etaDt = DateTime.fromISO(curSlot.eta);
    const prevEtdDt = DateTime.fromISO(prevSlot.etd);
    if (!etaDt.isValid || !prevEtdDt.isValid || etaDt >= prevEtdDt) continue;
    const durMin = Math.max(
      1,
      curSlot.etd
        ? Math.round(DateTime.fromISO(curSlot.etd).diff(etaDt, 'minutes').minutes)
        : h.startIso && h.endIso
          ? Math.round(DateTime.fromISO(h.endIso).diff(DateTime.fromISO(h.startIso), 'minutes').minutes)
          : 60
    );
    const newEta = prevEtdDt;
    const newEtd = newEta.plus({ minutes: durMin });
    tl[currIdx] = {
      ...curSlot,
      eta: newEta.toISO()!,
      etd: newEtd.toISO()!,
    };
  }

  clampTimelineEtasToArrivalWindows({
    households: day.households,
    timeline: tl,
    routingOrderIndices,
    practiceTz: day.timezone || 'America/New_York',
  });

  const mergedHouseholds = day.households.map((h) => {
    if (!h.isPersonalBlock || !h.primary) return h;
    const fromPrimary = String((h.primary as any).blockLabel ?? '').trim();
    let fromEta: string | undefined;
    for (const v of keyVariantsForKeyString(h.key)) {
      const x = blockLabelFromByIndex[v];
      if (x) {
        fromEta = x;
        break;
      }
    }
    const primary = {
      ...h.primary,
      blockLabel: fromPrimary || fromEta || (h.primary as any).blockLabel,
    };
    const client = blockDisplayLabel(primary);
    if ((h.primary as any).blockLabel === primary.blockLabel && h.client === client) return h;
    return { ...h, primary, client };
  });

  return {
    date: day.date,
    timezone: day.timezone,
    households: mergedHouseholds as unknown as DayData['households'],
    timeline: tl,
    startDepot: day.startDepot,
    endDepot: day.endDepot,
    startDepotTown: day.startDepotTown?.trim() || null,
    startDepotTime: day.startDepotTime,
    endDepotTime: day.endDepotTime,
    driveSeconds: driveSeconds ?? undefined,
    depotToFirstRoutableSec: depotToFirstRoutableSec ?? undefined,
    backToDepotSec: backToDepotSec ?? undefined,
    backToDepotIso: backToDepotIso ?? undefined,
    appointmentBufferMinutes,
    routingOrderIndices,
  };
}
