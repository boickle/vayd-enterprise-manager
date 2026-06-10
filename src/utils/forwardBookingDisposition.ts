import type {
  ForwardBookingDisposition,
  ForwardBookingDispositionMode,
} from '../api/forwardBookingDisposition';
import type { ForwardBookingIntervalUnit } from '../api/forwardBooking';
import type { Appointment } from '../api/roomLoader';
import { fromDatetimeLocalValue, toDatetimeLocalValue } from './taskDateTime';

const DISPOSITION_MODES = new Set<ForwardBookingDispositionMode>([
  'booked_at_appointment',
  'already_booked',
  'labs_pending',
  'forward_book_fields',
  'not_appropriate',
]);

const INTERVAL_UNITS = new Set<ForwardBookingIntervalUnit>(['days', 'weeks', 'months']);

function pickMode(v: unknown): ForwardBookingDispositionMode | null {
  if (typeof v !== 'string') return null;
  return DISPOSITION_MODES.has(v as ForwardBookingDispositionMode)
    ? (v as ForwardBookingDispositionMode)
    : null;
}

function pickUnit(v: unknown): ForwardBookingIntervalUnit | null {
  if (typeof v !== 'string') return null;
  return INTERVAL_UNITS.has(v as ForwardBookingIntervalUnit)
    ? (v as ForwardBookingIntervalUnit)
    : null;
}

function pickPositiveInt(v: unknown): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Read disposition from appointment payload (flat or nested). */
export function forwardBookingDispositionFromAppointment(
  appt: Appointment | Record<string, unknown>
): ForwardBookingDisposition | null {
  const raw = appt as Record<string, unknown>;
  const nested = raw.forwardBookingDisposition;
  const src =
    nested && typeof nested === 'object' ? (nested as Record<string, unknown>) : raw;

  const mode = pickMode(src.mode ?? src.forwardBookingMode);
  if (!mode) return null;

  const labsRaw = src.labsPendingTask;
  let labsPendingTask: ForwardBookingDisposition['labsPendingTask'] = null;
  if (labsRaw && typeof labsRaw === 'object') {
    const l = labsRaw as Record<string, unknown>;
    labsPendingTask = {
      assignedToEmployeeId: pickPositiveInt(l.assignedToEmployeeId ?? l.assigneeEmployeeId),
      title: pickStr(l.title),
      startAt: pickStr(l.startAt ?? l.startLocal),
      dueAt: pickStr(l.dueAt ?? l.dueLocal),
    };
  }

  return {
    mode,
    intervalAmount: pickPositiveInt(src.intervalAmount),
    intervalUnit: pickUnit(src.intervalUnit),
    bookingNotes: pickStr(src.bookingNotes ?? src.booking_notes ?? src.reason),
    labsPendingTask,
  };
}

export type ForwardBookingDispositionFormState = {
  mode: ForwardBookingDispositionMode;
  forwardAmount: string;
  forwardUnit: ForwardBookingIntervalUnit | '';
  bookingNotes: string;
  labsAssigneeEmployeeId: string;
  labsTaskTitle: string;
  labsTaskStartLocal: string;
  labsTaskDueLocal: string;
};

export function forwardBookingFormStateFromDisposition(
  disposition: ForwardBookingDisposition | null,
  defaults: Pick<
    ForwardBookingDispositionFormState,
    'labsTaskTitle' | 'labsTaskStartLocal'
  >
): ForwardBookingDispositionFormState {
  if (!disposition) {
    return {
      mode: 'forward_book_fields',
      forwardAmount: '',
      forwardUnit: '',
      bookingNotes: '',
      labsAssigneeEmployeeId: '',
      labsTaskTitle: defaults.labsTaskTitle,
      labsTaskStartLocal: defaults.labsTaskStartLocal,
      labsTaskDueLocal: '',
    };
  }

  const labs = disposition.labsPendingTask;
  return {
    mode: disposition.mode,
    forwardAmount:
      disposition.intervalAmount != null ? String(disposition.intervalAmount) : '',
    forwardUnit: disposition.intervalUnit ?? '',
    bookingNotes: disposition.bookingNotes ?? '',
    labsAssigneeEmployeeId:
      labs?.assignedToEmployeeId != null ? String(labs.assignedToEmployeeId) : '',
    labsTaskTitle: labs?.title?.trim() || defaults.labsTaskTitle,
    labsTaskStartLocal: labs?.startAt
      ? (toDatetimeLocalValue(labs.startAt) ?? defaults.labsTaskStartLocal)
      : defaults.labsTaskStartLocal,
    labsTaskDueLocal: labs?.dueAt ? (toDatetimeLocalValue(labs.dueAt) ?? '') : '',
  };
}

export function buildForwardBookingDispositionPayload(
  state: ForwardBookingDispositionFormState
): ForwardBookingDisposition {
  const payload: ForwardBookingDisposition = { mode: state.mode };

  if (state.mode === 'forward_book_fields') {
    const amount = Number(state.forwardAmount);
    if (Number.isFinite(amount) && amount > 0 && state.forwardUnit) {
      payload.intervalAmount = amount;
      payload.intervalUnit = state.forwardUnit;
    }
    payload.bookingNotes = state.bookingNotes.trim() || null;
  }

  if (state.mode === 'not_appropriate') {
    payload.bookingNotes = state.bookingNotes.trim() || null;
  }

  if (state.mode === 'labs_pending') {
    const assigneeId = Number(state.labsAssigneeEmployeeId);
    const startAt = fromDatetimeLocalValue(state.labsTaskStartLocal);
    const dueAt = fromDatetimeLocalValue(state.labsTaskDueLocal);
    payload.labsPendingTask = {
      assignedToEmployeeId: Number.isFinite(assigneeId) ? assigneeId : null,
      title: state.labsTaskTitle.trim() || null,
      startAt: startAt ?? null,
      dueAt: dueAt ?? null,
    };
  }

  return payload;
}

/** True when all required fields for the chosen mode are present. */
export function forwardBookingDispositionIsComplete(
  disposition: ForwardBookingDisposition | null | undefined
): boolean {
  if (!disposition?.mode) return false;

  switch (disposition.mode) {
    case 'booked_at_appointment':
    case 'already_booked':
      return true;
    case 'not_appropriate':
      return Boolean(disposition.bookingNotes?.trim());
    case 'forward_book_fields':
      return (
        disposition.intervalAmount != null &&
        disposition.intervalAmount > 0 &&
        Boolean(disposition.intervalUnit)
      );
    case 'labs_pending': {
      const l = disposition.labsPendingTask;
      const assigneeId = l?.assignedToEmployeeId;
      return (
        assigneeId != null &&
        Number(assigneeId) > 0 &&
        Boolean(l?.title?.trim()) &&
        Boolean(l?.startAt?.trim())
      );
    }
    default:
      return false;
  }
}

export function forwardBookingFormStateIsComplete(
  state: ForwardBookingDispositionFormState
): boolean {
  return forwardBookingDispositionIsComplete(buildForwardBookingDispositionPayload(state));
}

/** True when the appointment already has a persisted follow-up disposition from the API. */
export function hasPersistedForwardBookingDisposition(
  appt: Appointment | Record<string, unknown> | null | undefined
): boolean {
  return forwardBookingDispositionFromAppointment(appt ?? {})?.mode != null;
}

/** Lock the End Visit follow-up UI when a complete disposition is already saved. */
export function shouldLockForwardBookingDisposition(
  appt: Appointment | Record<string, unknown> | null | undefined
): boolean {
  return forwardBookingDispositionIsComplete(
    forwardBookingDispositionFromAppointment(appt ?? {})
  );
}

/** Throw when the API accepted the PATCH but dropped required fields (helps diagnose backend gaps). */
export function assertForwardBookingDispositionSaved(
  sent: ForwardBookingDisposition,
  saved: ForwardBookingDisposition | null | undefined
): void {
  if (!saved?.mode) {
    throw new Error('The server did not save the forward booking choice. Check that PATCH /forward-booking-disposition is implemented.');
  }
  if (sent.mode === 'not_appropriate') {
    const sentNotes = sent.bookingNotes?.trim();
    const savedNotes = saved.bookingNotes?.trim();
    if (sentNotes && !savedNotes) {
      throw new Error(
        'The server saved "Not appropriate" but did not store the reason. The API must persist bookingNotes for mode not_appropriate.'
      );
    }
  }
}

/** Attach normalized disposition onto appointment rows from range/realtime APIs. */
export function mergeForwardBookingDispositionOntoAppointment(appt: Appointment): Appointment {
  const disposition = forwardBookingDispositionFromAppointment(appt);
  if (!disposition) return appt;
  return { ...appt, forwardBookingDisposition: disposition };
}
