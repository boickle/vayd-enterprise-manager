import type { AppointmentRequestSubmissionItem } from '../api/appointmentRequestSubmissions';

export function savedNotesValue(notes: string | null | undefined): string {
  return notes ?? '';
}

export function noteForPatch(value: string): string | null {
  const t = value.trim();
  return t === '' ? null : t;
}

export function initialNotesFromItem(item: AppointmentRequestSubmissionItem): string {
  return savedNotesValue(item.notes);
}

/** True when the draft differs from what is saved on the server row. */
export function isNoteDraftDirty(
  entryId: number,
  savedNotes: string | null | undefined,
  drafts: Record<number, string>,
): boolean {
  const saved = savedNotesValue(savedNotes);
  const draft = drafts[entryId] ?? saved;
  return noteForPatch(draft) !== noteForPatch(saved);
}

/**
 * After a list refresh, keep unsaved drafts and sync saved notes for everything else.
 */
export function mergeNoteDraftsAfterListRefresh(
  drafts: Record<number, string>,
  previousRows: AppointmentRequestSubmissionItem[],
  incomingRows: AppointmentRequestSubmissionItem[],
  isCompleted: (item: AppointmentRequestSubmissionItem) => boolean,
): Record<number, string> {
  const prevById = new Map(previousRows.map((r) => [r.id, r]));
  const incomingIds = new Set(incomingRows.map((r) => r.id));
  const next: Record<number, string> = {};

  for (const row of incomingRows) {
    if (!isCompleted(row)) continue;
    const prev = prevById.get(row.id);
    const baselineNotes = prev?.notes ?? row.notes;
    if (prev && isNoteDraftDirty(row.id, baselineNotes, drafts)) {
      next[row.id] = drafts[row.id] ?? savedNotesValue(baselineNotes);
      continue;
    }
    next[row.id] = initialNotesFromItem(row);
  }

  for (const [idStr, value] of Object.entries(drafts)) {
    const id = Number(idStr);
    if (!incomingIds.has(id)) continue;
    if (next[id] !== undefined) continue;
    next[id] = value;
  }

  return next;
}
