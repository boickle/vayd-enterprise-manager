import { patientIsActiveInHousehold } from './patientStatusDisplay';

/**
 * "File call with …" tasks (owner, Nov 13, 2026): the note starts blank, the Quo transcript is
 * one click away, and a short note can be saved or charted straight from the task list.
 */

export type CallNotePet = { id: number; name: string };

/** The Quo call a "File call with …" task was made for (its idempotency key), or null. */
export function fileCallTaskCallId(task: { idempotencyKey?: string | null }): string | null {
  const m = /^openphone-call:(.+)$/.exec(task.idempotencyKey?.trim() ?? '');
  return m ? m[1]! : null;
}

/** A "File call with …" task: made by the call follow-up sweep. */
export function isFileCallTask(task: {
  title?: string | null;
  source?: string | null;
  idempotencyKey?: string | null;
}): boolean {
  if (fileCallTaskCallId(task)) return true;
  return task.source === 'system' && /^File (the )?call with /i.test(task.title?.trim() ?? '');
}

/**
 * The household's active pets from a `/clients/:id` payload, so a call note can go on a pet's
 * chart even though the task only links the client.
 */
export function householdPetsFromClient(raw: unknown): CallNotePet[] {
  const rec = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
  const list = Array.isArray(rec?.patients) ? (rec!.patients as unknown[]) : [];
  const pets: CallNotePet[] = [];
  const seen = new Set<number>();
  for (const p of list) {
    if (!p || typeof p !== 'object') continue;
    const row = p as Record<string, unknown>;
    const id = Number(row.id);
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (!Number.isFinite(id) || id <= 0 || !name || seen.has(id)) continue;
    if (!patientIsActiveInHousehold(row)) continue;
    seen.add(id);
    pets.push({ id, name });
  }
  return pets.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The note saved on the task but not charted yet. One section at the end of the task body,
 * replaced on each Save, so saving twice never stacks two copies.
 */
export const CALL_NOTE_DRAFT_HEADING = 'Call note so far (not charted yet):';

export function readCallNoteDraft(body: string | null | undefined): string {
  const text = body ?? '';
  const at = text.lastIndexOf(CALL_NOTE_DRAFT_HEADING);
  if (at < 0) return '';
  return text.slice(at + CALL_NOTE_DRAFT_HEADING.length).trim();
}

export function writeCallNoteDraft(body: string | null | undefined, note: string): string {
  const text = body ?? '';
  const at = text.lastIndexOf(CALL_NOTE_DRAFT_HEADING);
  const before = (at < 0 ? text : text.slice(0, at)).trimEnd();
  const draft = note.trim();
  if (!draft) return before;
  return before
    ? `${before}\n\n${CALL_NOTE_DRAFT_HEADING}\n${draft}`
    : `${CALL_NOTE_DRAFT_HEADING}\n${draft}`;
}
