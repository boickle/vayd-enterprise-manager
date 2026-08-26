import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import type { ForwardBookingEntry } from '../api/forwardBooking';
import { forwardBookingLinkedAppointmentId } from './forwardBookingLinkedVisit';
import type { BookedAppointmentMeta } from './forwardBookingListVisibility';

/** When the linked hold/booked calendar appointment was created (best available from GET /appointments/:id). */
export function linkedAppointmentBookedAtIso(
  appt: Pick<
    Appointment,
    'created' | 'bookedDate' | 'externalCreated' | 'externallyCreated' | 'updated'
  > &
    Record<string, unknown>
): string | null {
  const candidates: unknown[] = [
    appt.created,
    appt.externalCreated,
    appt.bookedDate,
    appt.updated,
    appt.createdAt,
    appt.created_at,
    appt.dateCreated,
    appt.date_created,
  ];
  for (const raw of candidates) {
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
  }
  return null;
}

function patientSortName(entry: ForwardBookingEntry): string {
  const name = entry.patient?.name?.trim();
  if (name) return name;
  return `Patient #${entry.patientId}`;
}

/** Hold slot start (UTC ISO) for sorting the On Hold list. Missing → sort last. */
export function forwardBookingHoldAppointmentStartMillis(entry: ForwardBookingEntry): number {
  const iso = entry.bookedAppointmentStart?.trim();
  if (!iso) return Number.MAX_SAFE_INTEGER;
  const ms = DateTime.fromISO(iso, { zone: 'utc' }).toMillis();
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

export function sortForwardBookingOnHoldListEntries(
  entries: ForwardBookingEntry[],
  clientName: (entry: ForwardBookingEntry) => string
): ForwardBookingEntry[] {
  return [...entries].sort((a, b) => {
    const ta = forwardBookingHoldAppointmentStartMillis(a);
    const tb = forwardBookingHoldAppointmentStartMillis(b);
    if (ta !== tb) return ta - tb;
    const nameCmp = clientName(a).localeCompare(clientName(b), undefined, { sensitivity: 'base' });
    if (nameCmp !== 0) return nameCmp;
    return patientSortName(a).localeCompare(patientSortName(b), undefined, { sensitivity: 'base' });
  });
}

/** When the hold was placed on the calendar — from linked appointment metadata when available. */
export function forwardBookingOnHoldSinceIso(
  entry: ForwardBookingEntry,
  bookedApptMeta?: Map<number, BookedAppointmentMeta> | null
): string | null {
  const fromEntry = entry.linkedVisitBookedAtIso?.trim();
  if (fromEntry) return fromEntry;
  const apptId = forwardBookingLinkedAppointmentId(entry);
  if (apptId != null && bookedApptMeta?.has(apptId)) {
    const fromAppt = bookedApptMeta.get(apptId)?.appointmentBookedAtIso;
    if (fromAppt?.trim()) return fromAppt.trim();
  }
  return entry.updatedAt?.trim() || entry.createdAt?.trim() || null;
}

export function forwardBookingOnHoldOver24Hours(
  entry: ForwardBookingEntry,
  bookedApptMeta?: Map<number, BookedAppointmentMeta> | null,
  now: DateTime = DateTime.now()
): boolean {
  const iso = forwardBookingOnHoldSinceIso(entry, bookedApptMeta);
  if (!iso) return false;
  const placed = DateTime.fromISO(iso, { zone: 'utc' });
  if (!placed.isValid) return false;
  return now.diff(placed, 'hours').hours >= 24;
}

export function forwardBookingOnHoldOver24ChipColors(): { background: string; color: string } {
  return { background: '#fecaca', color: '#991b1b' };
}

export function formatForwardBookingOnHoldBookedAt(
  iso: string | null | undefined,
  practiceTz: string
): string | null {
  if (!iso?.trim()) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return null;
  return dt.toFormat('EEE, MMM d, yyyy · h:mm a');
}

/** Human-readable duration since hold was placed, e.g. "26 hours" (caller adds "ago"). */
export function formatForwardBookingOnHoldElapsedSince(
  iso: string | null | undefined,
  now: DateTime = DateTime.now()
): string | null {
  if (!iso?.trim()) return null;
  const placed = DateTime.fromISO(iso, { zone: 'utc' });
  if (!placed.isValid) return null;
  const diffMs = now.toMillis() - placed.toMillis();
  if (diffMs < 60_000) return 'just now';
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    if (remHours > 0) {
      return `${days} day${days === 1 ? '' : 's'} ${remHours} hour${remHours === 1 ? '' : 's'}`;
    }
    return `${days} day${days === 1 ? '' : 's'}`;
  }
  if (hours >= 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const mins = Math.max(1, Math.floor(diffMs / 60_000));
  return `${mins} minute${mins === 1 ? '' : 's'}`;
}
