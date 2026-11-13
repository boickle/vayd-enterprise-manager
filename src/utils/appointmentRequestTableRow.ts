/**
 * Display helpers for the compact Appointments table (one line per request or hold).
 * Pure functions so the row text is easy to test.
 */
import { DateTime } from 'luxon';

type PersonName = { id?: number; firstName?: string | null; lastName?: string | null };

function pickStr(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Town the visit is in (the request's visit address). */
export function requestDataTown(requestData: Record<string, unknown>): string | null {
  const addr = requestData.physicalAddress;
  if (!addr || typeof addr !== 'object') return null;
  return pickStr((addr as Record<string, unknown>).city);
}

/** "Durham · Zone 3": town plus service zone when known. */
export function appointmentLocationLabel(
  town: string | null | undefined,
  zoneName: string | null | undefined
): string | null {
  const t = town?.trim() || null;
  const z = zoneName?.trim() || null;
  if (t && z) return `${t} · ${z}`;
  return t ?? z;
}

/**
 * Short staff label for tight columns: first name, plus last initial when another
 * person in `everyone` shares the first name.
 */
export function staffShortName(
  person: PersonName | null | undefined,
  everyone: readonly PersonName[] = []
): string {
  if (!person) return '';
  const first = person.firstName?.trim() ?? '';
  const last = person.lastName?.trim() ?? '';
  if (!first) return last;
  const clash = everyone.some(
    (p) => p.id !== person.id && (p.firstName?.trim() ?? '').toLowerCase() === first.toLowerCase()
  );
  return clash && last ? `${first} ${last.charAt(0)}.` : first;
}

/** Initials for the "11/20/26 BQ" booked-by stamp. */
export function staffInitials(person: PersonName | null | undefined): string {
  if (!person) return '';
  const f = person.firstName?.trim().charAt(0) ?? '';
  const l = person.lastName?.trim().charAt(0) ?? '';
  return `${f}${l}`.toUpperCase();
}

export type BookingStatusTone = 'none' | 'hold' | 'auto' | 'booked' | 'not-booked';

export type BookingStatusPill = {
  tone: BookingStatusTone;
  label: string;
  /** Second line: visit date, or the not-booked reason. */
  detail: string | null;
};

/** Booking Status column. A hold is never "Booked" — it stays on the list until a real visit. */
export function appointmentRequestBookingPill(args: {
  status: 'new' | 'contacted' | 'booked' | 'dismissed';
  isOnHold: boolean;
  isBooked: boolean;
  needsStaffConfirmation: boolean;
  visitDateLabel?: string | null;
  notBookedReason?: string | null;
}): BookingStatusPill {
  if (args.status === 'dismissed') {
    return {
      tone: 'not-booked',
      label: 'Not Booked',
      detail: args.notBookedReason?.trim() || null,
    };
  }
  if (args.isOnHold) {
    return { tone: 'hold', label: 'On Hold', detail: args.visitDateLabel ?? null };
  }
  if (args.needsStaffConfirmation) {
    return { tone: 'auto', label: 'Auto-Booked', detail: args.visitDateLabel ?? null };
  }
  if (args.isBooked) {
    return { tone: 'booked', label: 'Booked', detail: args.visitDateLabel ?? null };
  }
  return { tone: 'none', label: 'Not booked yet', detail: null };
}

export type CommunicationTone = 'none' | 'contacted' | 'replied' | 'complete';

export type CommunicationStatus = 'not_contacted' | 'contacted' | 'owner_replied' | 'complete';

export const COMMUNICATION_OPTIONS: ReadonlyArray<{ value: CommunicationStatus; label: string }> = [
  { value: 'not_contacted', label: 'Not contacted' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'owner_replied', label: 'Owner replied' },
  { value: 'complete', label: 'Communication complete' },
];

/** Communication step, from the request's own field (older rows: from the triage status). */
export function requestCommunicationStatus(item: {
  status?: 'new' | 'contacted' | 'booked' | 'dismissed' | null;
  communicationStatus?: CommunicationStatus | null;
}): CommunicationStatus {
  if (item.communicationStatus) return item.communicationStatus;
  const status = item.status ?? 'new';
  if (status === 'new') return 'not_contacted';
  if (status === 'contacted') return 'contacted';
  return 'complete';
}

/** Communication Status column. */
export function appointmentRequestCommunicationPill(
  communication: CommunicationStatus
): { tone: CommunicationTone; label: string } {
  const label = COMMUNICATION_OPTIONS.find((o) => o.value === communication)?.label ?? 'Not contacted';
  const tone: CommunicationTone =
    communication === 'complete'
      ? 'complete'
      : communication === 'owner_replied'
        ? 'replied'
        : communication === 'contacted'
          ? 'contacted'
          : 'none';
  return { tone, label };
}

export type RecordsSummaryLike = {
  state: 'none' | 'not_needed' | 'waiting' | 'requested' | 'received' | 'done' | 'complete';
  finished: boolean;
  total: number;
  pending: number;
  toSummarize: number;
};

export type RecordsTone = 'none' | 'open' | 'complete';

/** Records column: what is still to do with records for this request. */
export function appointmentRequestRecordsPill(records: RecordsSummaryLike | null | undefined): {
  tone: RecordsTone;
  label: string;
  detail: string | null;
} {
  if (!records) return { tone: 'none', label: 'No records', detail: null };
  switch (records.state) {
    case 'requested': {
      const inCount = records.total - records.pending;
      return {
        tone: 'open',
        label: 'Requested',
        detail: records.total > 1 ? `${inCount} of ${records.total} in` : 'Waiting on hospital',
      };
    }
    case 'received':
      return {
        tone: 'open',
        label: 'Received',
        detail: 'Summarize in chart',
      };
    case 'waiting':
      return { tone: 'open', label: 'Waiting on client', detail: null };
    case 'done':
      return { tone: 'complete', label: 'Records complete', detail: 'In chart' };
    case 'complete':
      return { tone: 'complete', label: 'Records complete', detail: null };
    case 'not_needed':
      return { tone: 'none', label: 'Not needed', detail: null };
    default:
      return { tone: 'none', label: 'No records', detail: null };
  }
}

/**
 * Communication complete and records done: a booked request may leave the list.
 * (Booking is checked separately: a hold never counts as booked.)
 */
export function requestWorkIsFinished(item: {
  status?: 'new' | 'contacted' | 'booked' | 'dismissed' | null;
  communicationStatus?: CommunicationStatus | null;
  records?: { finished: boolean } | null;
}): boolean {
  return requestCommunicationStatus(item) === 'complete' && (item.records?.finished ?? true);
}

/** "12/1/26 AM": visit date plus morning/afternoon, in the practice time zone. */
export function visitDateShortLabel(
  iso: string | null | undefined,
  practiceTz: string
): string | null {
  if (!iso?.trim()) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return null;
  return `${dt.toFormat('M/d/yy')} ${dt.hour < 12 ? 'AM' : 'PM'}`;
}

/** "11/10/2026": request received date in the practice time zone. */
export function receivedDateLabel(iso: string | null | undefined, practiceTz: string): string {
  if (!iso?.trim()) return '—';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  return dt.isValid ? dt.toFormat('MM/dd/yyyy') : '—';
}

export const QUIET_REQUEST_DAYS = 10;

/**
 * An open request nobody has touched in 10 days: last staff activity (status, notes, contact)
 * or, if none, when it came in.
 */
export function requestIsQuiet(
  item: { status?: string | null; submittedAt: string; followUpAt?: string | null },
  nowMs: number = Date.now(),
  days: number = QUIET_REQUEST_DAYS
): boolean {
  const status = item.status ?? 'new';
  if (status !== 'new' && status !== 'contacted') return false;
  const last = Math.max(
    new Date(item.submittedAt).getTime() || 0,
    item.followUpAt ? new Date(item.followUpAt).getTime() || 0 : 0
  );
  return last > 0 && nowMs - last > days * 24 * 60 * 60 * 1000;
}

/** "Seen 11/9/26", "Visit 12/1/26", "Hold 12/1/26" for a visit since the request. */
export function visitSinceLabel(
  visit: { start: string; isHold: boolean; past: boolean },
  practiceTz: string
): string {
  const dt = DateTime.fromISO(visit.start, { zone: 'utc' }).setZone(practiceTz);
  const date = dt.isValid ? dt.toFormat('M/d/yy') : '';
  if (visit.isHold) return `Hold ${date}`.trim();
  return `${visit.past ? 'Seen' : 'Visit'} ${date}`.trim();
}

/** Liaison filter on the Appointments list: everyone, mine, unassigned, or one person. */
export type LiaisonFilter = 'all' | 'mine' | 'unassigned' | number;

export function matchesLiaisonFilter(
  item: { liaisonEmployeeId?: number | null },
  filter: LiaisonFilter,
  myEmployeeId: number | null,
): boolean {
  const owner = item.liaisonEmployeeId ?? null;
  if (filter === 'all') return true;
  if (filter === 'unassigned') return owner == null;
  if (filter === 'mine') return myEmployeeId != null && owner === myEmployeeId;
  return owner === filter;
}

/** Stored value ("all", "mine", "unassigned", or an employee id) back to a filter. */
export function parseLiaisonFilter(raw: string | null | undefined): LiaisonFilter {
  if (raw === 'mine' || raw === 'unassigned') return raw;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 'all';
}

/** "2:14 PM" for a reply today, "Nov 9" before that (practice time zone). */
export function replyTimeLabel(
  iso: string | null | undefined,
  practiceTz: string,
  now: Date = new Date()
): string {
  if (!iso?.trim()) return '';
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return '';
  const today = DateTime.fromJSDate(now).setZone(practiceTz);
  return dt.hasSame(today, 'day') ? dt.toFormat('h:mm a') : dt.toFormat('LLL d');
}

/**
 * The client-type cell on an Appointments line (owner, Nov 12, 2026): NEW CLIENT, or NEW PATIENT
 * when an existing client is bringing a pet that isn't in Scout yet, else Existing.
 */
export function appointmentRequestClientTypeBadge(
  clientType: 'new' | 'existing' | 'unknown',
  pets: ReadonlyArray<{ isNew: boolean }>
): 'new_client' | 'new_patient' | 'existing' | null {
  if (clientType === 'new') return 'new_client';
  if (clientType === 'existing') return pets.some((p) => p.isNew) ? 'new_patient' : 'existing';
  return null;
}
