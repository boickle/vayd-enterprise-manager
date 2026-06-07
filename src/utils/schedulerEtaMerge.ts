/**
 * Merge /routing/eta response into My Week–compatible DayData (used by Scheduler + schedulerDriveEta).
 */
import { DateTime } from 'luxon';
import { blockDisplayLabel } from '../api/appointments';
import type { DayData } from '../pages/MyWeek';

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
      keyToSlot[k] = {
        eta,
        etd,
        windowStartIso: windowStartIso ?? undefined,
        windowEndIso: windowEndIso ?? undefined,
        ...(bufferAfterMinutes !== undefined ? { bufferAfterMinutes } : {}),
      };
      const bl = row?.blockLabel;
      if (bl != null && String(bl).trim() !== '') {
        for (const variant of keyVariantsForKeyString(k)) {
          blockLabelFromByIndex[variant] = String(bl).trim();
        }
      }
    }
  }

  let tl = day.households.map((h) => {
    const slot = h.key ? keyToSlot[h.key] : undefined;
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

  let driveSeconds: number[] | null = Array.isArray(result?.driveSeconds) ? result.driveSeconds : null;
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
    typeof result?.appointmentBufferMinutes === 'number' ? result.appointmentBufferMinutes : 5;

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
