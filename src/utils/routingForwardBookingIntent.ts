/**
 * Forward booking list → Routing prefill (same sessionStorage + event pattern as reschedule intent).
 */
import {
  removeForwardBooking,
  type ForwardBookingEntry,
  type ForwardBookingIntervalUnit,
} from '../api/forwardBooking';
import { resolveForwardBookingIntervalFromEntry } from './forwardBookingFromAppointment';
import { clearRoutingCalendarPreview } from './routingCalendarPreviewStorage';
import { ROUTING_DISMISS_FORWARD_BOOKING_EVENT } from './routingUiSnapshot';

export const ROUTING_FORWARD_BOOKING_INTENT_STORAGE_KEY = 'vayd:routing-forward-booking-intent-v1';
export const ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT =
  'vayd:routing-forward-booking-intent-updated';

export type RoutingForwardBookingScope = 'selected_pet' | 'household_same_target';

export type ForwardBookingHouseholdEntry = {
  forwardBookingId: number;
  trackingToken: string;
  patientId: string;
  patientName?: string;
  appointmentTypeId?: number;
  appointmentTypeName?: string;
  targetDueDate?: string | null;
};

export type RoutingForwardBookingIntentV1 = {
  v: 1;
  appliedToRoutingForm?: boolean;
  forwardBookingId: number;
  trackingToken: string;
  clientId: string;
  patientId: string;
  appointmentTypeId?: number;
  appointmentTypeName?: string;
  primaryProviderInternalId?: string;
  primaryDoctorPimsId?: string;
  primaryDoctorDisplayName?: string;
  clientDisplayLabel?: string;
  serviceMinutes: number;
  address?: string;
  lat?: number | null;
  lon?: number | null;
  clientAlerts?: string | null;
  description?: string | null;
  instructions?: string | null;
  bookingNotes?: string | null;
  /** Staff working note on the forward booking row (`note`). */
  staffNote?: string | null;
  /** Live reminder outreach notes when entering routing from a list. */
  reminderOutreachNotes?: string | null;
  intervalAmount: number;
  intervalUnit: ForwardBookingIntervalUnit;
  /** Legacy echo only — do not use for due-date math. */
  monthsOut?: number;
  targetDueDate?: string | null;
  sourceAppointmentId?: number | null;
  /** Source visit start (ISO) — shown on routing as “Original visit”. */
  sourceAppointmentStart?: string | null;
  /** Anchor pet name for routing context display. */
  patientName?: string | null;
  /** Same-client rows with the same target due date (forward booking list group book). */
  householdEntries?: ForwardBookingHouseholdEntry[];
  /** Required when `householdEntries` has more than one row. */
  householdScope?: RoutingForwardBookingScope;
  /** When true, successful book navigates back to the forward booking list. */
  returnToListAfterBook?: boolean;
  /**
   * True only while staff entered routing from Forward booking → Book.
   * Prevents stale sessionStorage from hijacking unrelated routing books.
   */
  workspaceActive?: boolean;
  /** When set, return-to-list SMS uses the care outreach template after hold book. */
  origin?: 'care_outreach' | 'schedule_loader' | 'waitlist';
  /** Pet names for care outreach SMS (household book from care outreach list). */
  careOutreachPetNames?: string[];
  /** When true, care outreach SMS after hold book uses past-due wording. */
  careOutreachAnyPastDue?: boolean;
  /** When true, schedule loader post-book SMS uses past-due care outreach wording. */
  scheduleLoaderAnyPastDue?: boolean;
  /** Care outreach list row key — for return animation after hold book. */
  careOutreachClientKey?: string;
  careOutreachClientDisplayName?: string | null;
  careOutreachClientId?: number | null;
  careOutreachClientPhone?: string | null;
  careOutreachClientFirstName?: string | null;
  /**
   * Optional slot-search window when entering routing from a list (e.g. care outreach Route).
   * Routing applies these to the form; POST /routing uses startDate, endDate, and derived numDays.
   */
  routingSearch?: {
    startDate: string;
    endDate: string;
    numDays?: number;
  };
  /** When set, Routing pre-selects reserve handling (e.g. schedule loader Ignore Reserve Blocks → use reserve). */
  reserveOption?: 'reserve-only' | 'reserve-overflow' | null;
  /** Return navigation when dismissing calendar preview from schedule loader → routing. */
  scheduleLoaderReturn?: {
    clientId: number;
    returnHref: string;
  };
  /** Waitlist entry that routing was started from. */
  waitlistEntryId?: number;
  waitlistReturn?: {
    entryId: number;
    clientId: number;
    returnHref: string;
  };
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function readRoutingForwardBookingIntent(): RoutingForwardBookingIntentV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ROUTING_FORWARD_BOOKING_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as RoutingForwardBookingIntentV1;
    if (
      o?.v !== 1 ||
      typeof o.forwardBookingId !== 'number' ||
      !o.trackingToken?.trim() ||
      !o.clientId ||
      !o.patientId
    ) {
      return null;
    }
    // Booking always picks Calculate Time from the type picker — not the source visit type stored on the row.
    const { appointmentTypeId: _omitId, appointmentTypeName: _omitName, householdEntries, ...rest } = o;
    const intent: RoutingForwardBookingIntentV1 = {
      ...rest,
      ...(householdEntries?.length
        ? {
            householdEntries: householdEntries.map(
              ({ appointmentTypeId: _id, appointmentTypeName: _name, ...row }) => row
            ),
          }
        : {}),
    };
    return intent;
  } catch {
    return null;
  }
}

export function forwardBookingIntentIsActive(): boolean {
  return readRoutingForwardBookingIntent() != null;
}

/** Forward booking workspace mode (list → Book), not merely a stale stored intent row. */
export function forwardBookingWorkspaceIsActive(): boolean {
  return readRoutingForwardBookingIntent()?.workspaceActive === true;
}

export function writeRoutingForwardBookingIntent(
  next: Omit<RoutingForwardBookingIntentV1, 'v' | 'appliedToRoutingForm'>
): void {
  if (typeof sessionStorage === 'undefined') return;
  const stored: RoutingForwardBookingIntentV1 = {
    v: 1,
    appliedToRoutingForm: false,
    ...next,
  };
  try {
    sessionStorage.setItem(ROUTING_FORWARD_BOOKING_INTENT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT));
  }
}

export function markForwardBookingIntentAppliedToRoutingForm(): void {
  const cur = readRoutingForwardBookingIntent();
  if (!cur) return;
  try {
    sessionStorage.setItem(
      ROUTING_FORWARD_BOOKING_INTENT_STORAGE_KEY,
      JSON.stringify({ ...cur, appliedToRoutingForm: true })
    );
  } catch {
    /* ignore */
  }
}

export function clearRoutingForwardBookingIntent(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_FORWARD_BOOKING_INTENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT));
  }
}

/** Exit forward-booking mode (routing form + calendar workspace). */
export function dismissRoutingForwardBookingWorkspace(): void {
  clearRoutingForwardBookingIntent();
  clearRoutingCalendarPreview();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_DISMISS_FORWARD_BOOKING_EVENT));
  }
}

export function forwardBookingIdsFromRoutingIntent(
  intent: RoutingForwardBookingIntentV1
): number[] {
  const ids = new Set<number>();
  if (Number.isFinite(intent.forwardBookingId) && intent.forwardBookingId > 0) {
    ids.add(intent.forwardBookingId);
  }
  for (const row of intent.householdEntries ?? []) {
    if (Number.isFinite(row.forwardBookingId) && row.forwardBookingId > 0) {
      ids.add(row.forwardBookingId);
    }
  }
  return [...ids];
}

/**
 * Care outreach / schedule loader create forward-booking rows when Route starts.
 * Remove them when staff exits routing without booking so the client returns to the list.
 */
export async function abandonListOriginatedForwardBookingWorkspace(
  intent: RoutingForwardBookingIntentV1,
  practiceId: number
): Promise<void> {
  if (
    intent.origin !== 'care_outreach' &&
    intent.origin !== 'schedule_loader' &&
    intent.origin !== 'waitlist'
  ) {
    return;
  }
  const ids = forwardBookingIdsFromRoutingIntent(intent);
  await Promise.all(
    ids.map((id) =>
      removeForwardBooking(id, practiceId).catch((err) => {
        console.warn('[routing] could not remove abandoned forward booking', id, err);
      })
    )
  );
}

export function forwardBookingRequiresScopeChoice(
  intent: RoutingForwardBookingIntentV1 | null
): boolean {
  return (intent?.householdEntries?.length ?? 0) > 1;
}

export function writeRoutingForwardBookingScope(scope: RoutingForwardBookingScope): void {
  const cur = readRoutingForwardBookingIntent();
  if (!cur) return;
  try {
    sessionStorage.setItem(
      ROUTING_FORWARD_BOOKING_INTENT_STORAGE_KEY,
      JSON.stringify({ ...cur, householdScope: scope })
    );
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT));
  }
}

/** Pet count for routing Calculate Time when a forward-booking scope is selected. */
export function forwardBookingScopePetCount(
  scope: RoutingForwardBookingScope | '' | undefined,
  intent: Pick<RoutingForwardBookingIntentV1, 'householdEntries'> | null | undefined
): number {
  if (scope === 'household_same_target') {
    const n = intent?.householdEntries?.length ?? 0;
    return n > 0 ? n : 1;
  }
  return 1;
}

export function forwardBookingScopeTargets(intent: RoutingForwardBookingIntentV1): {
  entries: ForwardBookingHouseholdEntry[];
  patientId: string;
} {
  const all = intent.householdEntries ?? [];
  const anchor =
    all.find((e) => e.forwardBookingId === intent.forwardBookingId) ??
    all.find((e) => e.patientId === intent.patientId) ??
    all[0];
  if (intent.householdScope !== 'household_same_target' || all.length <= 1) {
    const one = anchor ?? {
      forwardBookingId: intent.forwardBookingId,
      trackingToken: intent.trackingToken,
      patientId: intent.patientId,
    };
    return { entries: [one], patientId: one.patientId };
  }
  return {
    entries: all,
    patientId: anchor?.patientId ?? intent.patientId,
  };
}

function householdEntryFromForwardBookingRow(entry: ForwardBookingEntry): ForwardBookingHouseholdEntry | null {
  if (!entry?.id || !entry.trackingToken?.trim() || entry.patientId == null) return null;
  return {
    forwardBookingId: entry.id,
    trackingToken: entry.trackingToken.trim(),
    patientId: String(entry.patientId),
    patientName: pickStr(entry.patient?.name) ?? undefined,
    targetDueDate: entry.targetDueDate ?? null,
  };
}

export function buildRoutingForwardBookingIntentFromEntry(
  entry: ForwardBookingEntry
): RoutingForwardBookingIntentV1 | null {
  if (!entry?.id || !entry.trackingToken?.trim()) return null;
  const interval = resolveForwardBookingIntervalFromEntry(entry);
  if (!interval) return null;
  const c = entry.client;
  if (!c?.id || entry.patientId == null) return null;

  const fn = pickStr(c.firstName) ?? '';
  const ln = pickStr(c.lastName) ?? '';
  const clientDisplayLabel = [fn, ln].filter(Boolean).join(' ').trim() || undefined;

  const pp = entry.primaryProvider;
  const pi = pp?.id;
  const primaryProviderInternalId =
    pi != null && Number.isFinite(Number(pi)) ? String(pi) : undefined;
  const primaryDoctorPimsId = pickStr(pp?.pimsId) ?? undefined;
  const primaryDoctorDisplayName =
    pickStr(pp?.name) ??
    ([pickStr(pp?.firstName), pickStr(pp?.lastName)].filter(Boolean).join(' ').trim() || undefined);

  const mins =
    entry.serviceMinutes != null && Number.isFinite(Number(entry.serviceMinutes))
      ? Math.max(15, Math.round(Number(entry.serviceMinutes)))
      : 45;

  return {
    v: 1,
    forwardBookingId: entry.id,
    trackingToken: entry.trackingToken.trim(),
    clientId: String(c.id),
    patientId: String(entry.patientId),
    primaryProviderInternalId,
    primaryDoctorPimsId,
    primaryDoctorDisplayName,
    clientDisplayLabel,
    serviceMinutes: mins,
    clientAlerts: pickStr(c.alerts),
    description: entry.description ?? null,
    instructions: entry.instructions ?? null,
    bookingNotes: entry.bookingNotes ?? null,
    staffNote: entry.note ?? null,
    intervalAmount: interval.amount,
    intervalUnit: interval.unit,
    ...(entry.monthsOut != null ? { monthsOut: entry.monthsOut } : {}),
    targetDueDate: entry.targetDueDate ?? null,
    sourceAppointmentId: entry.sourceAppointmentId,
    sourceAppointmentStart: entry.sourceAppointmentStart ?? null,
    patientName: pickStr(entry.patient?.name) ?? null,
  };
}

export function buildRoutingForwardBookingIntentFromEntries(
  anchor: ForwardBookingEntry,
  householdRows: ForwardBookingEntry[]
): RoutingForwardBookingIntentV1 | null {
  const base = buildRoutingForwardBookingIntentFromEntry(anchor);
  if (!base) return null;
  const entries = householdRows
    .map(householdEntryFromForwardBookingRow)
    .filter((row): row is ForwardBookingHouseholdEntry => row != null);
  if (entries.length <= 1) return base;
  return {
    ...base,
    householdEntries: entries,
    householdScope: undefined,
  };
}
