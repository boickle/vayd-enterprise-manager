/**
 * CL weekly seat assignments — GET/PUT /practice/:practiceId/cl-seat-assignments
 * Day overrides (day off / seat swap) — practice setting `cl.seatDayOverrides`
 */
import { http } from './http';
import {
  getPracticeSettings,
  updatePracticeSettings,
} from './practiceSettings';
import {
  CL_DEFAULT_SEAT_PAR,
  type ClSeat,
} from '../utils/clPoints';

export type ClSeatAssignmentRow = {
  id: number;
  practiceId: number;
  employeeId: number;
  weekStart: string;
  seat: ClSeat;
};

export type ClSeatAssignmentsResponse = {
  practiceId: number;
  weekStart?: string;
  fromWeekStart?: string;
  toWeekStart?: string;
  assignments: ClSeatAssignmentRow[];
};

export type ClSeatParSettings = Record<ClSeat, number>;

export const CL_SEAT_PAR_SETTING_KEY = 'cl.seatPar';

/**
 * Per-calendar-date seat override (like DPG schedule overrides, but for CL seats).
 * `seat: 'off'` = day off (excluded from par). Otherwise replaces the weekly seat for that date.
 */
export type ClSeatDayOverride = {
  employeeId: number;
  date: string; // YYYY-MM-DD
  seat: ClSeat | 'off';
  notes?: string | null;
};

export const CL_SEAT_DAY_OVERRIDES_SETTING_KEY = 'cl.seatDayOverrides';

/** Workdays used when prorating weekly seat par to a daily amount (Mon–Fri). */
export const CL_SEAT_WORKDAYS_PER_WEEK = 5;

/** Sunday on or before `isoDate` (local calendar). */
export function sundayWeekStartLocal(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - dt.getDay());
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export async function fetchClSeatAssignments(
  practiceId: number,
  weekStart: string
): Promise<ClSeatAssignmentsResponse> {
  const { data } = await http.get<ClSeatAssignmentsResponse>(
    `/practice/${practiceId}/cl-seat-assignments`,
    { params: { weekStart: sundayWeekStartLocal(weekStart) } }
  );
  return data;
}

export async function fetchClSeatAssignmentsRange(
  practiceId: number,
  fromWeekStart: string,
  toWeekStart: string
): Promise<ClSeatAssignmentsResponse> {
  const { data } = await http.get<ClSeatAssignmentsResponse>(
    `/practice/${practiceId}/cl-seat-assignments`,
    {
      params: {
        fromWeekStart: sundayWeekStartLocal(fromWeekStart),
        toWeekStart: sundayWeekStartLocal(toWeekStart),
      },
    }
  );
  return data;
}

export async function upsertClSeatAssignments(
  practiceId: number,
  body: {
    weekStart: string;
    assignments: { employeeId: number; seat: ClSeat | null }[];
  }
): Promise<ClSeatAssignmentsResponse> {
  const { data } = await http.put<ClSeatAssignmentsResponse>(
    `/practice/${practiceId}/cl-seat-assignments`,
    {
      weekStart: sundayWeekStartLocal(body.weekStart),
      assignments: body.assignments,
    }
  );
  return data;
}

function parseSeatPar(raw: unknown): ClSeatParSettings {
  const base = { ...CL_DEFAULT_SEAT_PAR };
  let obj: Partial<ClSeatParSettings> | null = null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    obj = raw as Partial<ClSeatParSettings>;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      obj = JSON.parse(raw) as Partial<ClSeatParSettings>;
    } catch {
      obj = null;
    }
  }
  if (!obj) return base;
  const num = (x: unknown, fallback: number) => {
    const n = Number(x);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    phones: num(obj.phones, base.phones),
    outreach: num(obj.outreach, base.outreach),
    email: num(obj.email, base.email),
  };
}

export async function fetchClSeatPar(practiceId: number): Promise<ClSeatParSettings> {
  const settings = await getPracticeSettings(practiceId);
  return parseSeatPar(
    (settings as Record<string, unknown>)[CL_SEAT_PAR_SETTING_KEY]
  );
}

export async function updateClSeatPar(
  practiceId: number,
  seatPar: ClSeatParSettings
): Promise<ClSeatParSettings> {
  const cleaned = parseSeatPar(seatPar);
  const updated = await updatePracticeSettings(practiceId, {
    [CL_SEAT_PAR_SETTING_KEY]: cleaned,
  } as Parameters<typeof updatePracticeSettings>[1]);
  return parseSeatPar(
    (updated as Record<string, unknown>)[CL_SEAT_PAR_SETTING_KEY]
  );
}

function overrideKey(employeeId: number, date: string): string {
  return `${employeeId}|${date}`;
}

function parseSeatDayOverrides(raw: unknown): ClSeatDayOverride[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const out: ClSeatDayOverride[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Partial<ClSeatDayOverride>;
    const employeeId = Number(row.employeeId);
    const date = typeof row.date === 'string' ? row.date.trim() : '';
    const seat = row.seat;
    if (!Number.isFinite(employeeId) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (seat !== 'off' && seat !== 'phones' && seat !== 'outreach' && seat !== 'email') {
      continue;
    }
    const key = overrideKey(employeeId, date);
    if (seen.has(key)) continue;
    seen.add(key);
    const notes =
      typeof row.notes === 'string' && row.notes.trim() ? row.notes.trim() : null;
    out.push({ employeeId, date, seat, notes });
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || a.employeeId - b.employeeId);
  return out;
}

function readSeatDayOverridesFromSettings(
  settings: Record<string, unknown> | null | undefined
): ClSeatDayOverride[] {
  if (!settings || typeof settings !== 'object') return [];
  // PUT/GET may return a flat map or `{ settings: { ... } }`.
  const nested = settings.settings;
  const map =
    nested && typeof nested === 'object' && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : settings;
  return parseSeatDayOverrides(map[CL_SEAT_DAY_OVERRIDES_SETTING_KEY]);
}

export async function fetchClSeatDayOverrides(
  practiceId: number
): Promise<ClSeatDayOverride[]> {
  const settings = await getPracticeSettings(practiceId);
  return readSeatDayOverridesFromSettings(settings as Record<string, unknown>);
}

/**
 * Replace the full day-override list (caller merges adds/removes first).
 * Stored as a JSON string — practice settings only reliably persist string values
 * for non-cadence keys (arrays/objects are often dropped silently).
 */
export async function saveClSeatDayOverrides(
  practiceId: number,
  overrides: ClSeatDayOverride[]
): Promise<ClSeatDayOverride[]> {
  const cleaned = parseSeatDayOverrides(overrides);
  const payload = JSON.stringify(cleaned);
  await updatePracticeSettings(practiceId, {
    [CL_SEAT_DAY_OVERRIDES_SETTING_KEY]: payload,
  } as Parameters<typeof updatePracticeSettings>[1]);

  // Re-fetch: PUT responses are not always a full settings map.
  const verified = await fetchClSeatDayOverrides(practiceId);
  const expectedKeys = new Set(cleaned.map((o) => overrideKey(o.employeeId, o.date)));
  const actualKeys = new Set(verified.map((o) => overrideKey(o.employeeId, o.date)));
  const missing = [...expectedKeys].filter((k) => !actualKeys.has(k));
  if (missing.length > 0 || (cleaned.length > 0 && verified.length === 0)) {
    throw new Error(
      'Day overrides did not persist on the server. The practice settings API may be rejecting cl.seatDayOverrides — check network response or allowlist that key.'
    );
  }
  return verified;
}

/**
 * Upsert and/or remove overrides by employee+date, then persist the full list.
 * Pass `upsert` rows to set; pass `remove` keys to clear back to weekly default.
 */
export async function mergeClSeatDayOverrides(
  practiceId: number,
  opts: {
    upsert?: ClSeatDayOverride[];
    remove?: Array<{ employeeId: number; date: string }>;
  }
): Promise<ClSeatDayOverride[]> {
  const current = await fetchClSeatDayOverrides(practiceId);
  const map = new Map(current.map((o) => [overrideKey(o.employeeId, o.date), o]));
  for (const r of opts.remove ?? []) {
    map.delete(overrideKey(r.employeeId, r.date));
  }
  for (const u of opts.upsert ?? []) {
    const cleaned = parseSeatDayOverrides([u])[0];
    if (!cleaned) continue;
    map.set(overrideKey(cleaned.employeeId, cleaned.date), cleaned);
  }
  return saveClSeatDayOverrides(practiceId, [...map.values()]);
}

export function isClSeatWorkday(isoDate: string): boolean {
  const [y, m, d] = isoDate.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=Sun … 6=Sat
  return dow >= 1 && dow <= 5;
}

/** Each YYYY-MM-DD from start through end inclusive. */
export function eachIsoDateInclusive(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  const [ys, ms, ds] = startDate.split('-').map(Number);
  const [ye, me, de] = endDate.split('-').map(Number);
  const cur = new Date(ys, ms - 1, ds);
  const end = new Date(ye, me - 1, de);
  while (cur <= end) {
    const yy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    out.push(`${yy}-${mm}-${dd}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

export type ClSeatDayResolution = {
  /** Effective seat for scoring; null if day off or no weekly assignment. */
  seat: ClSeat | null;
  /** True when marked off via day override. */
  isOff: boolean;
  /** True when a day override changed seat or marked off. */
  hasOverride: boolean;
};

/**
 * Resolve seat for one calendar day: day override wins over weekly assignment.
 * Weekend days with no override resolve to null (do not count toward par).
 */
export function resolveClSeatForDate(opts: {
  date: string;
  weeklySeat: ClSeat | null | undefined;
  override: ClSeatDayOverride | null | undefined;
}): ClSeatDayResolution {
  const { date, weeklySeat, override } = opts;
  if (override) {
    if (override.seat === 'off') {
      return { seat: null, isOff: true, hasOverride: true };
    }
    return { seat: override.seat, isOff: false, hasOverride: true };
  }
  if (!isClSeatWorkday(date)) {
    return { seat: null, isOff: false, hasOverride: false };
  }
  return {
    seat: weeklySeat ?? null,
    isOff: false,
    hasOverride: false,
  };
}

/**
 * Prorated par for a date range: each Mon–Fri (or overridden weekend day) contributes
 * weeklyPar[seat] / 5; day-off contributes 0; seat swaps use the override seat's par.
 */
export function computeClSeatParForRange(opts: {
  startDate: string;
  endDate: string;
  weeklySeatByWeekStart: Map<string, ClSeat | null>;
  overridesByDate: Map<string, ClSeatDayOverride>;
  seatPar: ClSeatParSettings;
}): { par: number | null; primarySeat: ClSeat | null; overrideDayCount: number } {
  const daily = (seat: ClSeat) => opts.seatPar[seat] / CL_SEAT_WORKDAYS_PER_WEEK;
  let total = 0;
  let scoredDays = 0;
  let overrideDayCount = 0;
  const seatDays: Partial<Record<ClSeat, number>> = {};

  for (const date of eachIsoDateInclusive(opts.startDate, opts.endDate)) {
    const weekStart = sundayWeekStartLocal(date);
    const weekly = opts.weeklySeatByWeekStart.get(weekStart) ?? null;
    const override = opts.overridesByDate.get(date) ?? null;
    const resolved = resolveClSeatForDate({ date, weeklySeat: weekly, override });
    if (resolved.hasOverride) overrideDayCount += 1;
    if (!resolved.seat) continue;
    total += daily(resolved.seat);
    scoredDays += 1;
    seatDays[resolved.seat] = (seatDays[resolved.seat] ?? 0) + 1;
  }

  if (scoredDays === 0) {
    const firstWeek = sundayWeekStartLocal(opts.startDate);
    return {
      par: null,
      primarySeat: opts.weeklySeatByWeekStart.get(firstWeek) ?? null,
      overrideDayCount,
    };
  }

  let primarySeat: ClSeat | null = null;
  let best = -1;
  for (const seat of ['phones', 'outreach', 'email'] as ClSeat[]) {
    const n = seatDays[seat] ?? 0;
    if (n > best) {
      best = n;
      primarySeat = seat;
    }
  }

  return { par: total, primarySeat, overrideDayCount };
}
