/** Convert API ISO datetime to `datetime-local` input value (local timezone). */
export function toDatetimeLocalValue(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Convert `datetime-local` value to ISO for API. Empty string → null (clear on PATCH). */
export function fromDatetimeLocalValue(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

export function validateTaskScheduleOrder(
  startAt: string | null,
  dueAt: string | null
): string | null {
  if (!startAt || !dueAt) return null;
  const start = new Date(startAt).getTime();
  const due = new Date(dueAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(due)) return null;
  if (start > due) return 'Start must be on or before the due date';
  return null;
}

export function formatTaskIso(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
