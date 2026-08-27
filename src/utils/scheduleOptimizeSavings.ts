export const SCHEDULE_OPTIMIZE_SAVINGS_EVENT = 'vayd:schedule-optimize-savings-changed';

export type ScheduleOptimizeSavingsEvent = {
  id: string;
  practiceId: number;
  at: string;
  staffName: string;
  staffKey: string;
  driveDeltaMin: number;
  client: string;
  doctorName: string;
  appointmentIds: number[];
  queueItemId: string;
};

export type ScheduleOptimizeSavingsStaffRow = {
  staffKey: string;
  staffName: string;
  moveCount: number;
  savedMin: number;
};

export type ScheduleOptimizeSavingsSummary = {
  moveCount: number;
  savedMin: number;
  byStaff: ScheduleOptimizeSavingsStaffRow[];
};

function storageKey(practiceId: number): string {
  return `vayd:schedule-optimize-savings:v1:${practiceId}`;
}

function notify(): void {
  window.dispatchEvent(new Event(SCHEDULE_OPTIMIZE_SAVINGS_EVENT));
}

function isEvent(v: unknown): v is ScheduleOptimizeSavingsEvent {
  if (!v || typeof v !== 'object') return false;
  const row = v as Partial<ScheduleOptimizeSavingsEvent>;
  return typeof row.id === 'string' && typeof row.staffKey === 'string';
}

export function loadScheduleOptimizeSavings(practiceId: number): ScheduleOptimizeSavingsEvent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(practiceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEvent);
  } catch {
    return [];
  }
}

function saveScheduleOptimizeSavings(
  practiceId: number,
  items: ScheduleOptimizeSavingsEvent[]
): void {
  localStorage.setItem(storageKey(practiceId), JSON.stringify(items.slice(0, 500)));
  notify();
}

export function recordScheduleOptimizeSavings(
  row: Omit<ScheduleOptimizeSavingsEvent, 'id' | 'at'> & { id?: string; at?: string }
): ScheduleOptimizeSavingsEvent {
  const event: ScheduleOptimizeSavingsEvent = {
    ...row,
    id: row.id?.trim() || `${row.queueItemId}:${row.at ?? ''}:${Date.now()}`,
    at: row.at?.trim() || new Date().toISOString(),
  };
  const list = loadScheduleOptimizeSavings(row.practiceId);
  const already = list.find(
    (existing) =>
      existing.queueItemId === event.queueItemId || existing.id === event.id
  );
  if (already) return already;
  saveScheduleOptimizeSavings(row.practiceId, [event, ...list]);
  return event;
}

export function hasScheduleOptimizeSavingsForQueueItem(
  practiceId: number,
  queueItemId: string
): boolean {
  const id = queueItemId.trim();
  if (!id) return false;
  return loadScheduleOptimizeSavings(practiceId).some((row) => row.queueItemId === id);
}

export function driveMinutesSaved(deltaMin: number): number {
  if (!Number.isFinite(deltaMin) || deltaMin >= 0) return 0;
  return Math.abs(Math.round(deltaMin));
}

export function formatHoursMinutes(totalMin: number): string {
  const min = Math.max(0, Math.round(totalMin));
  const hours = Math.floor(min / 60);
  const minutes = min % 60;
  if (hours <= 0) return `${minutes} min`;
  if (minutes === 0) return hours === 1 ? '1 hr' : `${hours} hr`;
  return `${hours} hr ${minutes} min`;
}

export function scheduleOptimizeSavingsStaff(args: {
  staffName: string;
  staffKey?: string | null;
}): { name: string; key: string } {
  const name = args.staffName.trim() || 'Staff';
  const key = (args.staffKey ?? '').trim().toLowerCase() || name.toLowerCase();
  return { name, key };
}

export function localDateFromIso(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type ScheduleOptimizeSavingsDayRow = {
  date: string;
  savedMin: number;
  moveCount: number;
  cumulativeSavedMin: number;
};

export function aggregateScheduleOptimizeSavingsByDay(
  events: readonly ScheduleOptimizeSavingsEvent[],
  dates: string[],
  staffKey?: string | null
): ScheduleOptimizeSavingsDayRow[] {
  const dateSet = new Set(dates);
  const byDate = new Map(dates.map((date) => [date, { savedMin: 0, moveCount: 0 }]));
  const key = staffKey?.trim().toLowerCase() || '';
  for (const row of events) {
    if (key && row.staffKey.trim().toLowerCase() !== key) continue;
    const date = localDateFromIso(row.at);
    if (!date || !dateSet.has(date)) continue;
    const cur = byDate.get(date);
    if (!cur) continue;
    cur.savedMin += driveMinutesSaved(row.driveDeltaMin);
    cur.moveCount += 1;
  }
  let cumulativeSavedMin = 0;
  return dates.map((date) => {
    const v = byDate.get(date) ?? { savedMin: 0, moveCount: 0 };
    cumulativeSavedMin += v.savedMin;
    return {
      date,
      savedMin: v.savedMin,
      moveCount: v.moveCount,
      cumulativeSavedMin,
    };
  });
}

export function summarizeScheduleOptimizeSavings(
  events: readonly ScheduleOptimizeSavingsEvent[],
  fromIso?: string | null,
  toIso?: string | null,
  staffKey?: string | null
): ScheduleOptimizeSavingsSummary {
  const fromMs = fromIso ? Date.parse(fromIso) : Number.NaN;
  const toMs = toIso ? Date.parse(toIso) : Number.NaN;
  const key = staffKey?.trim().toLowerCase() || '';
  const inRange = events.filter((row) => {
    const t = Date.parse(row.at);
    if (!Number.isFinite(t)) return false;
    if (Number.isFinite(fromMs) && t < fromMs) return false;
    if (Number.isFinite(toMs) && t > toMs) return false;
    if (key && row.staffKey.trim().toLowerCase() !== key) return false;
    return true;
  });
  const byKey = new Map<string, ScheduleOptimizeSavingsStaffRow>();
  let savedMin = 0;
  for (const row of inRange) {
    const saved = driveMinutesSaved(row.driveDeltaMin);
    savedMin += saved;
    const staffKeyNorm =
      row.staffKey.trim().toLowerCase() || row.staffName.trim().toLowerCase() || 'staff';
    const current = byKey.get(staffKeyNorm) ?? {
      staffKey: staffKeyNorm,
      staffName: row.staffName.trim() || 'Staff',
      moveCount: 0,
      savedMin: 0,
    };
    current.moveCount += 1;
    current.savedMin += saved;
    if (row.staffName.trim()) current.staffName = row.staffName.trim();
    byKey.set(staffKeyNorm, current);
  }
  const byStaff = [...byKey.values()].sort((a, b) => {
    if (b.savedMin !== a.savedMin) return b.savedMin - a.savedMin;
    return a.staffName.localeCompare(b.staffName);
  });
  return { moveCount: inRange.length, savedMin, byStaff };
}

export function subscribeScheduleOptimizeSavings(onChange: () => void): () => void {
  window.addEventListener(SCHEDULE_OPTIMIZE_SAVINGS_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SCHEDULE_OPTIMIZE_SAVINGS_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
