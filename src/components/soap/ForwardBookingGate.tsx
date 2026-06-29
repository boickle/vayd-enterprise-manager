import { useMemo, useState } from 'react';
import { CalendarClock, Check } from 'lucide-react';
import type {
  ForwardBookingDisposition,
  ForwardBookingDispositionMode,
} from '../../api/forwardBookingDisposition';
import {
  buildForwardBookingDispositionPayload,
  forwardBookingFormStateFromDisposition,
  forwardBookingFormStateIsComplete,
  type ForwardBookingDispositionFormState,
} from '../../utils/forwardBookingDisposition';
import { createForwardBooking } from '../../api/forwardBooking';

type Props = {
  appointmentId: number;
  patientId: number;
  clientId: number | null;
  defaultProviderId?: number | null;
  disabled?: boolean;
  value: ForwardBookingDisposition | null;
  /** Persist the disposition onto the encounter; non-null satisfies the gate. */
  onSave: (
    disposition: ForwardBookingDisposition,
    forwardBookingEntryId?: number | null
  ) => Promise<void>;
};

const MODE_LABELS: { mode: ForwardBookingDispositionMode; label: string }[] = [
  { mode: 'booked_at_appointment', label: 'Booked at appointment' },
  { mode: 'already_booked', label: 'Already booked' },
  { mode: 'labs_pending', label: 'Labs pending' },
  { mode: 'forward_book_fields', label: 'Forward book' },
  { mode: 'not_appropriate', label: 'Not appropriate' },
];

const UNIT_OPTIONS = ['days', 'weeks', 'months'] as const;

/**
 * Forward-booking gate (spec §6). Required at the end of the SOAP, per patient.
 * Reuses the shared disposition form utilities (does not rebuild the logic).
 * "Forward book" creates a ForwardBookingEntry on the forward booking list; the
 * other dispositions only satisfy the gate.
 */
export default function ForwardBookingGate({
  appointmentId,
  patientId,
  clientId,
  defaultProviderId,
  disabled,
  value,
  onSave,
}: Props) {
  const [form, setForm] = useState<ForwardBookingDispositionFormState>(() =>
    forwardBookingFormStateFromDisposition(value, {
      labsTaskTitle: 'Review labs and set follow-up timing',
      labsTaskStartLocal: '',
    })
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const complete = useMemo(() => forwardBookingFormStateIsComplete(form), [form]);
  const savedMode = value?.mode ?? null;
  const isSaved = savedMode === form.mode;

  const set = (patch: Partial<ForwardBookingDispositionFormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  /**
   * Persist a disposition. "Forward book" also creates a queue entry, so it must
   * be triggered explicitly; the other modes auto-save on selection.
   */
  const persist = async (state: ForwardBookingDispositionFormState) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      const disposition = buildForwardBookingDispositionPayload(state);
      let entryId: number | null = null;

      if (
        disposition.mode === 'forward_book_fields' &&
        disposition.intervalAmount &&
        disposition.intervalUnit &&
        clientId != null
      ) {
        const entry = await createForwardBooking({
          practiceId: Number(import.meta.env.VITE_PRACTICE_ID) || 1,
          sourceAppointmentId: appointmentId,
          clientId,
          patientId,
          intervalAmount: disposition.intervalAmount,
          intervalUnit: disposition.intervalUnit,
          primaryProviderId: defaultProviderId ?? undefined,
          bookingNotes: disposition.bookingNotes ?? undefined,
          createdVia: 'end_visit',
        });
        entryId = Number(entry.id);
      }

      await onSave(disposition, entryId);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Could not save the forward-booking choice'
      );
    } finally {
      setSaving(false);
    }
  };

  /** Selecting a non-"forward book" mode satisfies the gate immediately. */
  const selectMode = (mode: ForwardBookingDispositionMode) => {
    const next = { ...form, mode };
    setForm(next);
    if (mode !== 'forward_book_fields') void persist(next);
  };

  return (
    <div className="soap-fb">
      <div className="soap-fb-modes">
        {MODE_LABELS.map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            disabled={disabled}
            className={`soap-fb-mode${form.mode === mode ? ' active' : ''}`}
            onClick={() => selectMode(mode)}
          >
            {savedMode === mode && <Check size={13} />} {label}
          </button>
        ))}
      </div>

      {form.mode === 'forward_book_fields' && (
        <div className="soap-fb-fields">
          <label>
            Interval
            <input
              className="soap-input soap-fb-amount"
              inputMode="numeric"
              placeholder="e.g. 2"
              value={form.forwardAmount}
              disabled={disabled}
              onChange={(e) => set({ forwardAmount: e.target.value })}
            />
          </label>
          <label>
            Unit
            <select
              className="soap-input soap-select"
              value={form.forwardUnit}
              disabled={disabled}
              onChange={(e) =>
                set({ forwardUnit: e.target.value as (typeof UNIT_OPTIONS)[number] })
              }
            >
              <option value="">Select…</option>
              {UNIT_OPTIONS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <label className="soap-fb-notes">
            Forward booking note (optional)
            <input
              className="soap-input"
              value={form.bookingNotes}
              disabled={disabled}
              onChange={(e) => set({ bookingNotes: e.target.value })}
            />
          </label>
        </div>
      )}

      {form.mode === 'not_appropriate' && (
        <label className="soap-fb-notes block">
          Reason
          <input
            className="soap-input"
            value={form.bookingNotes}
            disabled={disabled}
            placeholder="Why is follow-up not appropriate?"
            onChange={(e) => set({ bookingNotes: e.target.value })}
            onBlur={() => {
              if (form.mode === 'not_appropriate') void persist(form);
            }}
          />
        </label>
      )}

      {form.mode === 'labs_pending' && (
        <div className="soap-fb-note-hint">
          A task will be assigned to the doctor to review labs and set follow-up
          timing; it can later be reassigned to the tech.
        </div>
      )}

      {error && <div className="soap-error">{error}</div>}

      {!disabled && form.mode === 'forward_book_fields' && (
        <button
          type="button"
          className="soap-btn"
          onClick={() => void persist(form)}
          disabled={!complete || saving}
        >
          <CalendarClock size={14} /> {saving ? 'Saving…' : 'Save forward booking'}
        </button>
      )}

      {!disabled && isSaved && form.mode !== 'forward_book_fields' && (
        <div className="soap-fb-saved">
          <Check size={14} /> {saving ? 'Saving…' : 'Disposition saved'}
        </div>
      )}
    </div>
  );
}
