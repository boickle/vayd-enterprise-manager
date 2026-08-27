import type { OptimizeMove } from './scheduleOptimizeMoves';

export const SCHEDULE_OPTIMIZE_META_EVENT = 'vayd:schedule-optimize-meta-changed';

export type ScheduleOptimizeMoveMeta = {
  id: string;
  notes: string;
  hidden: boolean;
  hiddenAt?: string;
  updatedAt: string;
  doctorId?: string;
  doctorName?: string;
  /** Snapshot so Hidden still shows if this suggestion is not in the current search. */
  move?: OptimizeMove;
};

function storageKey(practiceId: number): string {
  return `vayd:schedule-optimize-meta:v1:${practiceId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function notify(): void {
  window.dispatchEvent(new Event(SCHEDULE_OPTIMIZE_META_EVENT));
}

function isMeta(v: unknown): v is ScheduleOptimizeMoveMeta {
  if (!v || typeof v !== 'object') return false;
  const row = v as Partial<ScheduleOptimizeMoveMeta>;
  return typeof row.id === 'string';
}

export function loadScheduleOptimizeMoveMeta(practiceId: number): ScheduleOptimizeMoveMeta[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(practiceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMeta);
  } catch {
    return [];
  }
}

function saveScheduleOptimizeMoveMeta(
  practiceId: number,
  items: ScheduleOptimizeMoveMeta[]
): void {
  localStorage.setItem(storageKey(practiceId), JSON.stringify(items));
  notify();
}

export function findScheduleOptimizeMoveMeta(
  practiceId: number,
  id: string
): ScheduleOptimizeMoveMeta | null {
  return loadScheduleOptimizeMoveMeta(practiceId).find((row) => row.id === id) ?? null;
}

function upsert(
  practiceId: number,
  id: string,
  patch: Partial<Omit<ScheduleOptimizeMoveMeta, 'id'>>
): ScheduleOptimizeMoveMeta {
  const list = loadScheduleOptimizeMoveMeta(practiceId);
  const stamp = nowIso();
  const existing = list.find((row) => row.id === id);
  const next: ScheduleOptimizeMoveMeta = {
    id,
    notes: '',
    hidden: false,
    ...existing,
    ...patch,
    updatedAt: stamp,
  };
  const empty = !next.notes.trim() && !next.hidden && !next.move;
  const without = list.filter((row) => row.id !== id);
  saveScheduleOptimizeMoveMeta(practiceId, empty ? without : [next, ...without]);
  return next;
}

export function updateScheduleOptimizeMoveNotes(
  practiceId: number,
  id: string,
  notes: string
): ScheduleOptimizeMoveMeta {
  return upsert(practiceId, id, { notes });
}

export function setScheduleOptimizeMoveHidden(args: {
  practiceId: number;
  move: OptimizeMove;
  doctorId: string;
  doctorName: string;
  hidden: boolean;
}): ScheduleOptimizeMoveMeta {
  const { practiceId, move, doctorId, doctorName, hidden } = args;
  return upsert(practiceId, move.id, {
    hidden,
    hiddenAt: hidden ? nowIso() : undefined,
    doctorId,
    doctorName,
    move,
  });
}

export function subscribeScheduleOptimizeMoveMeta(onChange: () => void): () => void {
  window.addEventListener(SCHEDULE_OPTIMIZE_META_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SCHEDULE_OPTIMIZE_META_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
