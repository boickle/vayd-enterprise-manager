const WEIGHT_CHANGED_PREFIX = 'WEIGHT CHANGED ON CONSENT';

export type ConsentWeightChange = {
  previousLbs: number | null;
  nextLbs: number;
};

export function parseConsentWeightChange(
  answers: Record<string, unknown> | null | undefined,
): ConsentWeightChange | null {
  const raw = answers?.weightChange;
  if (!raw || typeof raw !== 'object') return null;
  const row = raw as { previousLbs?: unknown; nextLbs?: unknown; changed?: unknown };
  if (row.changed === false) return null;
  const nextLbs = Number(row.nextLbs);
  if (!Number.isFinite(nextLbs) || nextLbs <= 0) return null;
  const prev = row.previousLbs == null || row.previousLbs === '' ? null : Number(row.previousLbs);
  return {
    previousLbs: prev != null && Number.isFinite(prev) ? prev : null,
    nextLbs,
  };
}

export function parseWeightChangedNote(
  raw: string | null | undefined,
): (ConsentWeightChange & { otherNotes: string }) | null {
  const text = String(raw ?? '');
  if (!text.toUpperCase().includes(WEIGHT_CHANGED_PREFIX)) return null;

  const lines = text.split(/\r?\n/);
  const other: string[] = [];
  let match: ConsentWeightChange | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.toUpperCase().startsWith(WEIGHT_CHANGED_PREFIX)) {
      if (trimmed) other.push(line);
      continue;
    }
    const parsed = trimmed.match(
      /:\s*(.+?)\s*(?:→|->)\s*([\d.]+)\s*lbs?/i,
    );
    if (!parsed) continue;
    const fromRaw = parsed[1].replace(/none on file/i, '').trim();
    const fromNum = Number(fromRaw.replace(/[^\d.]/g, ''));
    const nextLbs = Number(parsed[2]);
    if (!Number.isFinite(nextLbs) || nextLbs <= 0) continue;
    match = {
      previousLbs: Number.isFinite(fromNum) && fromNum > 0 ? fromNum : null,
      nextLbs,
    };
  }

  if (!match) return null;
  return { ...match, otherNotes: other.join('\n').trim() };
}

export function formatWeightLbs(lbs: number | null | undefined): string {
  if (lbs == null || !Number.isFinite(lbs)) return 'none on file';
  return `${lbs} lbs`;
}
