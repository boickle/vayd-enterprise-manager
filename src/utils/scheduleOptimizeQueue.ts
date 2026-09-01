import type { OptimizeMove, OptimizeMoveScope } from './scheduleOptimizeMoves';
import {
  findScheduleOptimizeMoveMeta,
  loadScheduleOptimizeMoveMeta,
  setScheduleOptimizeMoveHidden,
  updateScheduleOptimizeMoveNotes,
} from './scheduleOptimizeMoveMeta';
import {
  hasScheduleOptimizeSavingsForQueueItem,
  recordScheduleOptimizeSavings,
} from './scheduleOptimizeSavings';

export const SCHEDULE_OPTIMIZE_QUEUE_EVENT = 'vayd:schedule-optimize-queue-changed';

export type ScheduleOptimizeQueueStatus = 'queued' | 'moved';

export type ScheduleOptimizeQueueOutcome = 'rescheduled' | 'alternative';

export type ScheduleOptimizeQueueItem = {
  id: string;
  status: ScheduleOptimizeQueueStatus;
  notes: string;
  createdAt: string;
  updatedAt: string;
  movedAt?: string;
  textedAt?: string;
  /** How the queued suggestion was resolved on the calendar. */
  outcome?: ScheduleOptimizeQueueOutcome;
  /** New visit(s) booked via Add alternative — original `appointmentIds` stay on the item. */
  alternativeAppointmentIds?: number[];
  /** Staff who added the alternative; credited when the original visit is later removed. */
  pendingSavingsStaff?: { name: string; key: string };
  practiceId: number;
  doctorId: string;
  doctorName: string;
  client: string;
  clientId: number | null;
  clientPhone: string | null;
  petNames: string[];
  appointmentType?: string | null;
  appointmentDescription?: string | null;
  roomLoaderStatus?: string;
  roomLoaderStatusColor?: string;
  fromDate: string;
  toDate: string;
  fromTimeLabel: string;
  toTimeLabel: string;
  fromWindowLabel?: string | null;
  toWindowLabel?: string | null;
  insertionIndex?: number;
  windowWarningsBefore?: number;
  windowWarningsAfter?: number;
  appointmentIds: number[];
  originalStartIso: string;
  newStartIso: string;
  newEndIso: string;
  driveDeltaMin: number;
  ppdhBefore: number | null;
  ppdhAfter: number | null;
  reason: string;
  scope?: OptimizeMoveScope;
};

function storageKey(practiceId: number): string {
  return `vayd:schedule-optimize-queue:v1:${practiceId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function notify(): void {
  window.dispatchEvent(new Event(SCHEDULE_OPTIMIZE_QUEUE_EVENT));
}

function isItem(v: unknown): v is ScheduleOptimizeQueueItem {
  if (!v || typeof v !== 'object') return false;
  const row = v as Partial<ScheduleOptimizeQueueItem>;
  return typeof row.id === 'string' && Array.isArray(row.appointmentIds);
}

export function loadScheduleOptimizeQueue(practiceId: number): ScheduleOptimizeQueueItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(storageKey(practiceId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isItem);
  } catch {
    return [];
  }
}

function saveScheduleOptimizeQueue(practiceId: number, items: ScheduleOptimizeQueueItem[]): void {
  localStorage.setItem(storageKey(practiceId), JSON.stringify(items));
  notify();
}

export function countQueuedScheduleOptimizeItems(practiceId: number): number {
  return loadScheduleOptimizeQueue(practiceId).filter((row) => row.status === 'queued').length;
}

export function findScheduleOptimizeQueueItem(
  practiceId: number,
  id: string
): ScheduleOptimizeQueueItem | null {
  return loadScheduleOptimizeQueue(practiceId).find((row) => row.id === id) ?? null;
}

export function findScheduleOptimizeQueueItemForAppointments(
  practiceId: number,
  appointmentIds: number[]
): ScheduleOptimizeQueueItem | null {
  const idSet = new Set(
    (appointmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0)
  );
  if (idSet.size === 0) return null;
  return (
    loadScheduleOptimizeQueue(practiceId).find((row) =>
      row.appointmentIds.some((id) => idSet.has(id))
    ) ?? null
  );
}

export function queueItemFromMove(args: {
  move: OptimizeMove;
  practiceId: number;
  doctorId: string;
  doctorName: string;
}): Omit<
  ScheduleOptimizeQueueItem,
  'status' | 'notes' | 'createdAt' | 'updatedAt' | 'movedAt' | 'textedAt' | 'outcome'
> {
  const { move, practiceId, doctorId, doctorName } = args;
  return {
    id: move.id,
    practiceId,
    doctorId,
    doctorName,
    client: move.client,
    clientId: move.clientId,
    clientPhone: move.clientPhone,
    petNames: move.petNames,
    appointmentType: move.appointmentType,
    appointmentDescription: move.appointmentDescription,
    roomLoaderStatus: move.roomLoaderStatus,
    roomLoaderStatusColor: move.roomLoaderStatusColor,
    fromDate: move.fromDate,
    toDate: move.toDate,
    fromTimeLabel: move.fromTimeLabel,
    toTimeLabel: move.toTimeLabel,
    fromWindowLabel: move.fromWindowLabel,
    toWindowLabel: move.toWindowLabel,
    insertionIndex: move.insertionIndex,
    windowWarningsBefore: move.windowWarningsBefore,
    windowWarningsAfter: move.windowWarningsAfter,
    appointmentIds: move.appointmentIds,
    originalStartIso: move.originalStartIso,
    newStartIso: move.newStartIso,
    newEndIso: move.newEndIso,
    driveDeltaMin: move.driveDeltaMin,
    ppdhBefore: move.ppdhBefore,
    ppdhAfter: move.ppdhAfter,
    reason: move.reason,
    scope: move.scope,
  };
}

export function queueItemToOptimizeMove(row: ScheduleOptimizeQueueItem): OptimizeMove {
  return {
    id: row.id,
    scope: row.scope ?? (row.fromDate === row.toDate ? 'day' : 'week'),
    client: row.client,
    clientId: row.clientId,
    clientPhone: row.clientPhone,
    petNames: row.petNames,
    appointmentType: row.appointmentType ?? null,
    appointmentDescription: row.appointmentDescription ?? null,
    roomLoaderStatus: row.roomLoaderStatus ?? 'Not sent',
    roomLoaderStatusColor: row.roomLoaderStatusColor ?? '#dc2626',
    fromDate: row.fromDate,
    toDate: row.toDate,
    fromTimeLabel: row.fromTimeLabel,
    toTimeLabel: row.toTimeLabel,
    fromWindowLabel: row.fromWindowLabel ?? null,
    toWindowLabel: row.toWindowLabel ?? null,
    appointmentIds: row.appointmentIds,
    originalStartIso: row.originalStartIso,
    newStartIso: row.newStartIso,
    newEndIso: row.newEndIso,
    insertionIndex: row.insertionIndex ?? 0,
    windowWarningsBefore: row.windowWarningsBefore ?? 0,
    windowWarningsAfter: row.windowWarningsAfter ?? 0,
    driveDeltaMin: row.driveDeltaMin,
    ppdhBefore: row.ppdhBefore,
    ppdhAfter: row.ppdhAfter,
    reason: row.reason,
  };
}

export function addScheduleOptimizeToQueue(args: {
  move: OptimizeMove;
  practiceId: number;
  doctorId: string;
  doctorName: string;
}): ScheduleOptimizeQueueItem {
  const list = loadScheduleOptimizeQueue(args.practiceId);
  const existing = list.find((row) => row.id === args.move.id);
  const base = queueItemFromMove(args);
  const stamp = nowIso();
  const metaNotes = findScheduleOptimizeMoveMeta(args.practiceId, args.move.id)?.notes ?? '';
  if (existing) {
    if (existing.status === 'moved') return existing;
    const next: ScheduleOptimizeQueueItem = {
      ...existing,
      ...base,
      status: 'queued',
      notes: existing.notes.trim() ? existing.notes : metaNotes,
      createdAt: existing.createdAt,
      updatedAt: stamp,
      textedAt: existing.textedAt,
    };
    saveScheduleOptimizeQueue(
      args.practiceId,
      list.map((row) => (row.id === next.id ? next : row))
    );
    return next;
  }
  const created: ScheduleOptimizeQueueItem = {
    ...base,
    status: 'queued',
    notes: metaNotes,
    createdAt: stamp,
    updatedAt: stamp,
  };
  saveScheduleOptimizeQueue(args.practiceId, [created, ...list]);
  return created;
}

export function markScheduleOptimizeQueueTexted(practiceId: number, id: string): void {
  const list = loadScheduleOptimizeQueue(practiceId);
  const stamp = nowIso();
  saveScheduleOptimizeQueue(
    practiceId,
    list.map((row) => (row.id === id ? { ...row, textedAt: stamp, updatedAt: stamp } : row))
  );
}

export function patchScheduleOptimizeQueueItem(
  practiceId: number,
  id: string,
  patch: Partial<Pick<ScheduleOptimizeQueueItem, 'clientId' | 'clientPhone'>>
): ScheduleOptimizeQueueItem | null {
  const list = loadScheduleOptimizeQueue(practiceId);
  const existing = list.find((row) => row.id === id);
  if (!existing) return null;
  const next: ScheduleOptimizeQueueItem = { ...existing, ...patch, updatedAt: nowIso() };
  saveScheduleOptimizeQueue(
    practiceId,
    list.map((row) => (row.id === next.id ? next : row))
  );
  return next;
}

function appendQueueNote(existing: string, line: string): string {
  const text = line.trim();
  if (!text) return existing;
  const current = existing.trim();
  if (!current) return text;
  const lines = current.split('\n').map((row) => row.trim());
  if (lines.includes(text)) return current;
  return `${current}\n${text}`;
}

export function formatScheduleOptimizeQueueActionNote(args: {
  kind: 'rescheduled' | 'alternative' | 'hold' | 'original_removed';
  whenLabel?: string | null;
}): string {
  const when = args.whenLabel?.trim() ?? '';
  if (args.kind === 'hold') return 'Converted to hold after adding an alternative.';
  if (args.kind === 'original_removed') {
    return 'Original visit removed after the alternative was booked.';
  }
  if (args.kind === 'alternative') {
    return when
      ? `Alternative added for ${when}. Original visit kept.`
      : 'Alternative added. Original visit kept.';
  }
  return when ? `Rescheduled on the calendar to ${when}.` : 'Rescheduled on the calendar.';
}

function uniquePositiveIds(ids: number[] | undefined): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  for (const raw of ids ?? []) {
    const id = Number(raw);
    if (!Number.isFinite(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function mergeAppointmentIds(current: number[] | undefined, extra: number[] | undefined): number[] {
  return uniquePositiveIds([...(current ?? []), ...(extra ?? [])]);
}

export function resolveScheduleOptimizeQueueItems(
  practiceId: number,
  args: {
    queueItemId?: string | null;
    appointmentIds?: number[];
    outcome: ScheduleOptimizeQueueOutcome;
    note?: string;
    appointmentType?: string | null;
    /** Append to items already on Moved (hold conversion after add-alternative). */
    allowAlreadyMoved?: boolean;
    savingsStaff?: { name: string; key: string };
    /** New appointment id(s) created by Add alternative. */
    alternativeAppointmentIds?: number[];
  }
): ScheduleOptimizeQueueItem[] {
  const list = loadScheduleOptimizeQueue(practiceId);
  if (list.length === 0) return [];
  const idSet = new Set(
    (args.appointmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0)
  );
  const queueId = args.queueItemId?.trim() || null;
  if (!queueId && idSet.size === 0) return [];
  const note = args.note?.trim() ?? '';
  const typeName = args.appointmentType?.trim() || null;
  const allowAlreadyMoved = args.allowAlreadyMoved === true;
  const altIds = uniquePositiveIds(args.alternativeAppointmentIds);
  const stamp = nowIso();
  const matched: ScheduleOptimizeQueueItem[] = [];
  const next = list.map((row) => {
    const matchesId = queueId != null && row.id === queueId;
    const matchesAppt =
      row.appointmentIds.some((id) => idSet.has(id)) ||
      (row.alternativeAppointmentIds ?? []).some((id) => idSet.has(id));
    if (!matchesId && !matchesAppt) return row;
    if (row.status === 'moved' && !allowAlreadyMoved) return row;
    const updated: ScheduleOptimizeQueueItem = {
      ...row,
      notes: note ? appendQueueNote(row.notes, note) : row.notes,
      updatedAt: stamp,
      ...(typeName ? { appointmentType: typeName } : {}),
    };
    if (altIds.length > 0) {
      updated.alternativeAppointmentIds = mergeAppointmentIds(
        row.alternativeAppointmentIds,
        altIds
      );
    }
    if (args.outcome === 'alternative' && args.savingsStaff && !updated.pendingSavingsStaff) {
      updated.pendingSavingsStaff = args.savingsStaff;
    }
    if (row.status !== 'moved') {
      updated.status = 'moved';
      updated.outcome = args.outcome;
      updated.movedAt = stamp;
      if (args.outcome === 'rescheduled' && args.savingsStaff) {
        recordScheduleOptimizeSavings({
          practiceId,
          staffName: args.savingsStaff.name,
          staffKey: args.savingsStaff.key,
          driveDeltaMin: row.driveDeltaMin,
          client: row.client,
          doctorName: row.doctorName,
          appointmentIds: row.appointmentIds,
          queueItemId: row.id,
          at: stamp,
        });
      } else if (args.outcome === 'alternative' && args.savingsStaff) {
        updated.pendingSavingsStaff = args.savingsStaff;
      }
    } else if (!updated.outcome) {
      updated.outcome = args.outcome;
    }
    matched.push(updated);
    return updated;
  });
  if (matched.length === 0) return [];
  saveScheduleOptimizeQueue(practiceId, next);
  return matched;
}

/**
 * After Add alternative, credit drive-time savings when the original visit is removed
 * and the alternative is still on the schedule.
 */
export function creditScheduleOptimizeSavingsWhenOriginalRemoved(
  practiceId: number,
  appointmentIds: number[],
  fallbackStaff?: { name: string; key: string }
): ScheduleOptimizeQueueItem[] {
  const removed = new Set(uniquePositiveIds(appointmentIds));
  if (removed.size === 0) return [];
  const list = loadScheduleOptimizeQueue(practiceId);
  if (list.length === 0) return [];
  const stamp = nowIso();
  const note = formatScheduleOptimizeQueueActionNote({ kind: 'original_removed' });
  const matched: ScheduleOptimizeQueueItem[] = [];
  const next = list.map((row) => {
    if (row.outcome !== 'alternative') return row;
    if (hasScheduleOptimizeSavingsForQueueItem(practiceId, row.id)) return row;
    const removedOriginal = row.appointmentIds.some((id) => removed.has(id));
    if (!removedOriginal) return row;
    const alts = uniquePositiveIds(row.alternativeAppointmentIds);
    const removedEveryAlternative =
      alts.length > 0 && alts.every((id) => removed.has(id));
    if (removedEveryAlternative) return row;
    const staff = row.pendingSavingsStaff ?? fallbackStaff;
    if (!staff) return row;
    recordScheduleOptimizeSavings({
      practiceId,
      staffName: staff.name,
      staffKey: staff.key,
      driveDeltaMin: row.driveDeltaMin,
      client: row.client,
      doctorName: row.doctorName,
      appointmentIds: row.appointmentIds,
      queueItemId: row.id,
      at: stamp,
    });
    const updated: ScheduleOptimizeQueueItem = {
      ...row,
      notes: appendQueueNote(row.notes, note),
      updatedAt: stamp,
    };
    matched.push(updated);
    return updated;
  });
  if (matched.length === 0) return [];
  saveScheduleOptimizeQueue(practiceId, next);
  return matched;
}

export function markScheduleOptimizeQueueMoved(
  practiceId: number,
  id: string,
  extras?: {
    outcome?: ScheduleOptimizeQueueOutcome;
    note?: string;
  }
): void {
  resolveScheduleOptimizeQueueItems(practiceId, {
    queueItemId: id,
    outcome: extras?.outcome ?? 'rescheduled',
    note: extras?.note,
  });
}

export function updateScheduleOptimizeQueueNotes(
  practiceId: number,
  id: string,
  notes: string
): void {
  const list = loadScheduleOptimizeQueue(practiceId);
  const stamp = nowIso();
  const hasItem = list.some((row) => row.id === id);
  if (hasItem) {
    saveScheduleOptimizeQueue(
      practiceId,
      list.map((row) => (row.id === id ? { ...row, notes, updatedAt: stamp } : row))
    );
  }
  updateScheduleOptimizeMoveNotes(practiceId, id, notes);
}

export function dismissScheduleOptimizeQueueItem(practiceId: number, id: string): void {
  const list = loadScheduleOptimizeQueue(practiceId);
  const current = list.find((row) => row.id === id);
  if (!current || current.status === 'moved') return;
  saveScheduleOptimizeQueue(
    practiceId,
    list.filter((row) => row.id !== id)
  );
}

/** Staff notes from Optimize / the CL list for these visits. */
export function scheduleOptimizeNotesForAppointmentIds(
  practiceId: number,
  appointmentIds: number[]
): string {
  const idSet = new Set(
    (appointmentIds ?? []).filter((id) => Number.isFinite(id) && id > 0)
  );
  if (idSet.size === 0) return '';
  const chunks: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    const t = text.trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    chunks.push(t);
  };
  for (const row of loadScheduleOptimizeQueue(practiceId)) {
    if (row.appointmentIds.some((id) => idSet.has(id))) push(row.notes);
  }
  for (const row of loadScheduleOptimizeMoveMeta(practiceId)) {
    const ids = row.move?.appointmentIds ?? [];
    if (ids.some((id) => idSet.has(id))) push(row.notes);
  }
  return chunks.join('\n');
}

export function mergeOptimizeNotesIntoStaffInstructions(
  existing: string | null | undefined,
  optimizeNotes: string
): string {
  const block = optimizeNotes.trim();
  const cur = (existing ?? '').trim();
  if (!block) return cur;
  if (cur.includes(block)) return cur;
  return cur ? `${cur}\n${block}` : block;
}

/** Hide a suggestion in Optimize and take it off the CL queued list. Recover from Hidden. */
export function hideScheduleOptimizeSuggestion(args: {
  practiceId: number;
  move: OptimizeMove;
  doctorId: string;
  doctorName: string;
}): void {
  setScheduleOptimizeMoveHidden({ ...args, hidden: true });
  dismissScheduleOptimizeQueueItem(args.practiceId, args.move.id);
}

export function subscribeScheduleOptimizeQueue(onChange: () => void): () => void {
  window.addEventListener(SCHEDULE_OPTIMIZE_QUEUE_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(SCHEDULE_OPTIMIZE_QUEUE_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}
