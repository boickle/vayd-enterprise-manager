/**
 * Forward booking list → Routing prefill (same sessionStorage + event pattern as reschedule intent).
 */
import type { ForwardBookingEntry, ForwardBookingIntervalUnit } from '../api/forwardBooking';
import { resolveForwardBookingIntervalFromEntry } from './forwardBookingFromAppointment';
import { clearRoutingCalendarPreview } from './routingCalendarPreviewStorage';
import { ROUTING_DISMISS_FORWARD_BOOKING_EVENT } from './routingUiSnapshot';

export const ROUTING_FORWARD_BOOKING_INTENT_STORAGE_KEY = 'vayd:routing-forward-booking-intent-v1';
export const ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT =
  'vayd:routing-forward-booking-intent-updated';

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
  intervalAmount: number;
  intervalUnit: ForwardBookingIntervalUnit;
  /** Legacy echo only — do not use for due-date math. */
  monthsOut?: number;
  targetDueDate?: string | null;
  sourceAppointmentId: number;
  /** When true, successful book navigates back to the forward booking list. */
  returnToListAfterBook?: boolean;
  /**
   * True only while staff entered routing from Forward booking → Book.
   * Prevents stale sessionStorage from hijacking unrelated routing books.
   */
  workspaceActive?: boolean;
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
    return o;
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

  const typeId = entry.appointmentTypeId;
  const appointmentTypeId =
    typeId != null && Number.isFinite(Number(typeId)) ? Number(typeId) : undefined;

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
    appointmentTypeId,
    appointmentTypeName: entry.appointmentTypeName?.trim() || undefined,
    primaryProviderInternalId,
    primaryDoctorPimsId,
    primaryDoctorDisplayName,
    clientDisplayLabel,
    serviceMinutes: mins,
    clientAlerts: pickStr(c.alerts),
    description: entry.description ?? null,
    instructions: entry.instructions ?? null,
    bookingNotes: entry.bookingNotes ?? null,
    intervalAmount: interval.amount,
    intervalUnit: interval.unit,
    ...(entry.monthsOut != null ? { monthsOut: entry.monthsOut } : {}),
    targetDueDate: entry.targetDueDate ?? null,
    sourceAppointmentId: entry.sourceAppointmentId,
  };
}
