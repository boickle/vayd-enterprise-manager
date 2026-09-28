/**
 * Mixed-type household stops: when any pet is Calming / Pre-Meds, that type's
 * arrival window overrides siblings so the whole stop shares the ~1hr window
 * without changing each pet's appointment type (or calendar color).
 */
import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import {
  isAppointmentCancelledOnPracticeCalendar,
} from '../api/appointments';
import { effectiveWindowForScheduledStart } from './appointmentArrivalWindow';
import {
  carrierIsCalmingPremed,
  findCalmingPremedAppointmentType,
  type CalmingPremedTypeCarrier,
} from './appointmentTypeSettings';

export type ArrivalWindowIso = { startIso: string; endIso: string };

export type HouseholdClumpWindowItem = {
  appointmentType?: CalmingPremedTypeCarrier;
  effectiveWindow?: { startIso?: string; endIso?: string } | null;
  /** Scheduled start — used to recompute Pre-Meds ±N when effectiveWindow is missing. */
  scheduledStartIso?: string | null;
  scheduledEndIso?: string | null;
};

type CalmingPremedCatalog = ReadonlyArray<{
  id?: number;
  name?: string | null;
  prettyName?: string | null;
  isCalmingPremedType?: boolean | null;
  windowBeforeMinutes?: number | null;
  windowAfterMinutes?: number | null;
  isDeleted?: boolean | null;
}>;

function trimWindow(
  ew: { startIso?: string; endIso?: string } | null | undefined,
): ArrivalWindowIso | null {
  const startIso = ew?.startIso?.trim() || '';
  const endIso = ew?.endIso?.trim() || '';
  if (!startIso || !endIso) return null;
  return { startIso, endIso };
}

function unionWindows(windows: ArrivalWindowIso[]): ArrivalWindowIso | undefined {
  if (windows.length === 0) return undefined;
  let startIso = windows[0]!.startIso;
  let endIso = windows[0]!.endIso;
  for (let i = 1; i < windows.length; i++) {
    const w = windows[i]!;
    const w0 = DateTime.fromISO(startIso);
    const w1 = DateTime.fromISO(endIso);
    const n0 = DateTime.fromISO(w.startIso);
    const n1 = DateTime.fromISO(w.endIso);
    if (n0.isValid && (!w0.isValid || n0 < w0)) startIso = w.startIso;
    if (n1.isValid && (!w1.isValid || n1 > w1)) endIso = w.endIso;
  }
  return { startIso, endIso };
}

function premedWindowForItem(
  item: HouseholdClumpWindowItem,
  catalog: CalmingPremedCatalog | null | undefined,
  practiceTz: string | null | undefined,
): ArrivalWindowIso | null {
  const existing = trimWindow(item.effectiveWindow);
  if (existing) return existing;
  if (!practiceTz || !item.scheduledStartIso?.trim()) return null;
  const premed = findCalmingPremedAppointmentType(catalog);
  if (!premed) return null;
  return (
    effectiveWindowForScheduledStart(
      item.scheduledStartIso,
      {
        name: premed.name ?? undefined,
        prettyName: premed.prettyName,
        windowBeforeMinutes: premed.windowBeforeMinutes,
        windowAfterMinutes: premed.windowAfterMinutes,
      },
      practiceTz,
      {
        appointmentEndIso: item.scheduledEndIso ?? undefined,
      },
    ) ?? null
  );
}

/**
 * Resolve the arrival window for a multi-pet household clump.
 * When any pet is Calming / Pre-Meds, only that (recomputed) window is used —
 * non-premed siblings do not widen the stop back to ±60 / 2hr.
 */
export function resolveClumpArrivalWindowWithCalmingPremedOverride(
  items: readonly HouseholdClumpWindowItem[],
  opts?: {
    catalog?: CalmingPremedCatalog | null;
    practiceTz?: string | null;
  },
): { effectiveWindow?: ArrivalWindowIso; pinnedByCalmingPremed: boolean } {
  const catalog = opts?.catalog;
  const practiceTz = opts?.practiceTz;

  const premedItems = items.filter((item) =>
    carrierIsCalmingPremed(item.appointmentType, catalog),
  );
  if (premedItems.length > 0) {
    const premedWindows: ArrivalWindowIso[] = [];
    for (const item of premedItems) {
      const win = premedWindowForItem(item, catalog, practiceTz);
      if (win) premedWindows.push(win);
    }
    return {
      effectiveWindow: unionWindows(premedWindows),
      pinnedByCalmingPremed: true,
    };
  }

  const allWindows: ArrivalWindowIso[] = [];
  for (const item of items) {
    const win = trimWindow(item.effectiveWindow);
    if (win) allWindows.push(win);
  }
  return {
    effectiveWindow: unionWindows(allWindows),
    pinnedByCalmingPremed: false,
  };
}

function appointmentClientId(a: Appointment): number | null {
  const raw = a.client?.id;
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function appointmentIntervalMs(
  a: Appointment,
): { start: number; end: number } | null {
  const start = Date.parse(a.appointmentStart);
  const end = Date.parse(a.appointmentEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return { start, end };
}

function intervalsClumped(
  a: { start: number; end: number },
  b: { start: number; end: number },
): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function isVisibleTimedAppt(a: Appointment): boolean {
  if (a.isDeleted === true) return false;
  if (a.isActive === false) return false;
  if (a.allDay) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  return true;
}

/**
 * Stamp Pre-Meds arrival windows onto same-client overlapping siblings so
 * schedule cards / details keep each pet's type color but share the ~1hr window.
 */
export function applyCalmingPremedHouseholdArrivalWindowOverrides(
  appointments: readonly Appointment[],
  opts?: {
    practiceTz?: string | null;
    catalog?: CalmingPremedCatalog | null;
  },
): Appointment[] {
  if (appointments.length <= 1) return [...appointments];

  const catalog = opts?.catalog;
  const practiceTz = opts?.practiceTz;
  const overrideById = new Map<number, ArrivalWindowIso>();

  const byClient = new Map<number, Appointment[]>();
  for (const a of appointments) {
    if (!isVisibleTimedAppt(a)) continue;
    const clientId = appointmentClientId(a);
    if (clientId == null) continue;
    if (!byClient.has(clientId)) byClient.set(clientId, []);
    byClient.get(clientId)!.push(a);
  }

  for (const group of byClient.values()) {
    if (group.length <= 1) continue;

    const intervals = group.map((a) => appointmentIntervalMs(a));
    const n = group.length;
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = intervals[i];
        const b = intervals[j];
        if (!a || !b) {
          if (!a && !b) {
            adj[i].push(j);
            adj[j].push(i);
          }
          continue;
        }
        if (intervalsClumped(a, b)) {
          adj[i].push(j);
          adj[j].push(i);
        }
      }
    }

    const visited = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      if (visited[i]) continue;
      const stack = [i];
      visited[i] = true;
      const clumpIdx: number[] = [];
      while (stack.length) {
        const u = stack.pop()!;
        clumpIdx.push(u);
        for (const v of adj[u]!) {
          if (!visited[v]) {
            visited[v] = true;
            stack.push(v);
          }
        }
      }
      if (clumpIdx.length <= 1) continue;

      const clump = clumpIdx.map((idx) => group[idx]!);
      const resolved = resolveClumpArrivalWindowWithCalmingPremedOverride(
        clump.map((a) => ({
          appointmentType: a.appointmentType,
          effectiveWindow: a.effectiveWindow,
          scheduledStartIso: a.appointmentStart,
          scheduledEndIso: a.appointmentEnd,
        })),
        { catalog, practiceTz },
      );
      if (!resolved.pinnedByCalmingPremed || !resolved.effectiveWindow) continue;
      for (const a of clump) {
        overrideById.set(a.id, resolved.effectiveWindow);
      }
    }
  }

  if (overrideById.size === 0) return [...appointments];

  return appointments.map((a) => {
    const win = overrideById.get(a.id);
    if (!win) return a;
    const cur = trimWindow(a.effectiveWindow);
    if (cur && cur.startIso === win.startIso && cur.endIso === win.endIso) return a;
    return { ...a, effectiveWindow: win };
  });
}
