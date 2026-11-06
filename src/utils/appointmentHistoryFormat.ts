import { DateTime } from 'luxon';
import type { AppointmentChangeEntry, AppointmentFieldChange } from '../api/appointments';

/** A History line ready to show: "Date & time: Tue 9/23 11:55 AM–12:40 PM → Wed 9/24 …". */
export type HistoryLine = { label: string; from: string | null; to: string | null; long?: boolean };

const LONG_FIELDS = new Set([
  'description',
  'instructions',
  'equipment',
  'medications',
  'alternateAddress',
]);

function when(iso: string | null, tz: string): DateTime | null {
  if (!iso) return null;
  const d = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  return d.isValid ? d : null;
}

/** "Tue 9/23 11:55 AM–12:40 PM" (end on another day gets its own date). */
export function formatVisitWindow(
  startIso: string | null,
  endIso: string | null,
  tz: string
): string | null {
  const s = when(startIso, tz);
  const e = when(endIso, tz);
  if (!s && !e) return null;
  if (!s) return `ends ${e!.toFormat('ccc M/d h:mm a')}`;
  const start = s.toFormat('ccc M/d h:mm a');
  if (!e) return start;
  return e.hasSame(s, 'day')
    ? `${start}–${e.toFormat('h:mm a')}`
    : `${start} – ${e.toFormat('ccc M/d h:mm a')}`;
}

/**
 * Turns an entry's field changes into lines. Start and End become one "Date & time" line, named
 * "Date" or "Time" when only that part moved, so a reschedule reads at a glance.
 */
export function historyLines(changes: AppointmentFieldChange[], tz: string): HistoryLine[] {
  const start = changes.find((c) => c.field === 'appointmentStart');
  const end = changes.find((c) => c.field === 'appointmentEnd');
  const lines: HistoryLine[] = [];
  if (start) {
    const a = when(start.from, tz);
    const b = when(start.to, tz);
    let label = 'Date & time';
    if (a && b && a.hasSame(b, 'day')) label = 'Time';
    else if (a && b && a.toFormat('h:mm a') === b.toFormat('h:mm a')) label = 'Date';
    lines.push({
      label,
      from: formatVisitWindow(start.from, end?.from ?? null, tz),
      to: formatVisitWindow(start.to, end?.to ?? null, tz),
    });
  } else if (end) {
    // Same start, different length.
    const fmt = (iso: string | null) => when(iso, tz)?.toFormat('ccc M/d h:mm a') ?? null;
    lines.push({ label: 'End time', from: fmt(end.from), to: fmt(end.to) });
  }
  for (const c of changes) {
    if (c.field === 'appointmentStart' || c.field === 'appointmentEnd') continue;
    lines.push({ label: c.label, from: c.from, to: c.to, long: LONG_FIELDS.has(c.field) });
  }
  return lines;
}

export function historyHeadline(entry: AppointmentChangeEntry): string {
  const who = entry.actorName?.trim() || 'Someone';
  if (entry.action === 'created') return `Booked by ${who}`;
  if (entry.action === 'deleted') return `Deleted by ${who}`;
  return `Changed by ${who}`;
}

export function historyWhen(iso: string, tz: string): string {
  const d = DateTime.fromISO(iso, { zone: 'utc' }).setZone(tz);
  return d.isValid ? d.toFormat('MMM d, yyyy · h:mm a') : iso;
}

const STAFF_NOTE_AUDIT_LINE =
  /^(?:Booked on .+ by .+|Edited .+ by .+ on .+|Rescheduled by .+|Linked to .+ by .+|Moved due to optimization by .+)$/;

/** The old "Edited appt time by taylor on 08/20/2026" lines in staff notes, in order. */
export function staffNoteAuditLines(instructions: string | null | undefined): string[] {
  return (instructions ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => STAFF_NOTE_AUDIT_LINE.test(l));
}
