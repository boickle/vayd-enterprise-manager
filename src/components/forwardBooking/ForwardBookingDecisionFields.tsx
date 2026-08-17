import type { Employee } from '../../api/appointmentSettings';
import type { ForwardBookingIntervalUnit } from '../../api/forwardBooking';
import type { ForwardBookingDispositionMode } from '../../api/forwardBookingDisposition';
import type { ForwardBookingDispositionFormState } from '../../utils/forwardBookingDisposition';
import {
  FORWARD_BOOKING_AMOUNT_OPTIONS,
  FORWARD_BOOKING_UNIT_OPTIONS,
} from '../../utils/forwardBookingFromAppointment';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import './ForwardBookingDecisionFields.css';

export const FORWARD_BOOKING_MODE_OPTIONS: {
  value: ForwardBookingDispositionMode;
  label: string;
  hint: string;
}[] = [
  {
    value: 'booked_at_appointment',
    label: 'Booked at appointment',
    hint: 'Follow-up was booked during this visit — no forward booking list entry.',
  },
  {
    value: 'already_booked',
    label: 'Already booked',
    hint: 'Client already has a follow-up scheduled — no forward booking list entry.',
  },
  {
    value: 'labs_pending',
    label: 'Labs pending',
    hint: 'Recommended: assign this to the doctor first. Once labs are reviewed and the follow-up timing is determined, the doctor can reassign the forward-booking task to the technician.',
  },
  {
    value: 'forward_book_fields',
    label: 'Forward book',
    hint: 'Add to the forward booking list using the interval below.',
  },
  {
    value: 'not_appropriate',
    label: 'Not appropriate',
    hint: 'Follow-up is not appropriate for this visit — no forward booking list entry.',
  },
];

export function forwardBookingModeOption(mode: ForwardBookingDispositionMode) {
  return FORWARD_BOOKING_MODE_OPTIONS.find((o) => o.value === mode);
}

/** Provider rows for the "Forward booking with" select; shaped loosely on purpose
 * since callers pass employees, PIMS providers, or scheduler columns. */
export type ForwardBookingProviderOption = { id: number | string; label: string };

type Props = {
  value: ForwardBookingDispositionFormState;
  /** Field-level patches, so callers can keep their own dirty/validation tracking. */
  onChange: (patch: Partial<ForwardBookingDispositionFormState>) => void;
  /** Called before `onChange` when the mode itself changes, for per-surface defaults
   * (End Visit fills a default assignee/provider here). */
  onModeChange?: (mode: ForwardBookingDispositionMode) => void;
  disabled?: boolean;
  /** Staff/provider lists are still loading — inputs render but stay unusable. */
  metaLoading?: boolean;
  employees: Employee[];
  /** Omit to hide the "Forward booking with" select (surfaces that infer the
   * provider from the visit rather than asking). */
  providers?: ForwardBookingProviderOption[];
  providerId?: string;
  onProviderIdChange?: (value: string) => void;
  /** Multi-pet save: one labs task per pet, so the single title field is replaced
   * by an explanation of what will be created. */
  multiPetLabsTasks?: boolean;
  /** Must be unique per rendered instance — two prompts on one page would
   * otherwise share a radio group and fight over the selection. */
  radioGroupName: string;
  /** Interval/note inputs can be locked while the mode radios stay live (End Visit
   * disables them once the follow-up was booked on the calendar). */
  fieldsDisabled?: boolean;
};

/**
 * The follow-up ("forward booking") prompt: five mutually exclusive outcomes with
 * the fields each one requires.
 *
 * Deliberately shared verbatim between End Visit, tech checkout, and the visit
 * wrap-up. All three write the same `appointments.forwardBookingDisposition`, and a
 * question this consequential — it decides whether the patient is ever seen again —
 * should not read differently depending on which screen caught the staff member.
 *
 * Purely presentational: no saving, no side effects. Whoever renders it owns
 * persistence, because the side effects differ per surface (a queue entry, a labs
 * task, both, or neither).
 */
export default function ForwardBookingDecisionFields({
  value,
  onChange,
  onModeChange,
  disabled,
  metaLoading,
  employees,
  providers,
  providerId,
  onProviderIdChange,
  multiPetLabsTasks,
  radioGroupName,
  fieldsDisabled,
}: Props) {
  const intervalDisabled = disabled || fieldsDisabled;

  return (
    <fieldset className="scheduler-forward-booking-mode-fieldset" disabled={disabled}>
      <legend className="scheduler-forward-booking-mode-legend">
        How should follow-up be handled?
      </legend>
      <div
        className="scheduler-forward-booking-mode-stack"
        role="radiogroup"
        aria-label="Forward booking option"
      >
        {FORWARD_BOOKING_MODE_OPTIONS.map(({ value: mode, label, hint }) => {
          const active = value.mode === mode;
          return (
            <div
              key={mode}
              className={[
                'scheduler-forward-booking-mode-option',
                active ? 'scheduler-forward-booking-mode-option--active' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <label className="scheduler-forward-booking-mode-row" aria-label={label}>
                <input
                  type="radio"
                  name={radioGroupName}
                  value={mode}
                  checked={active}
                  onChange={() => {
                    onModeChange?.(mode);
                    onChange({ mode });
                  }}
                />
                <span className="scheduler-forward-booking-mode-copy">
                  <span className="scheduler-forward-booking-mode-label">{label}</span>
                  <span className="scheduler-forward-booking-mode-hint">{hint}</span>
                </span>
              </label>

              {active && mode === 'labs_pending' ? (
                <div className="scheduler-forward-booking-mode-panel">
                  <label className="scheduler-edit-field">
                    <span>Assign task to *</span>
                    <select
                      value={value.labsAssigneeEmployeeId}
                      onChange={(e) => onChange({ labsAssigneeEmployeeId: e.target.value })}
                      disabled={disabled || metaLoading}
                      aria-label="Assign labs pending task to"
                    >
                      <option value="">Select staff member…</option>
                      {employees.map((em) => (
                        <option key={em.id} value={String(em.id)}>
                          {formatEmployeeDisplayName(em) || em.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  {multiPetLabsTasks ? (
                    <div className="scheduler-forward-booking-mode-hint" style={{ marginTop: 4 }}>
                      Creates one task per selected pet (e.g. &quot;Forward book [pet name] once
                      labs come back&quot;). Each task links to that pet&apos;s visit so staff can
                      add forward booking individually.
                    </div>
                  ) : (
                    <label className="scheduler-edit-field">
                      <span>Task *</span>
                      <input
                        type="text"
                        value={value.labsTaskTitle}
                        onChange={(e) => onChange({ labsTaskTitle: e.target.value })}
                        disabled={disabled || metaLoading}
                        placeholder="What needs to be done?"
                        aria-label="Labs pending task description"
                      />
                    </label>
                  )}
                  <div className="scheduler-edit-two-col" style={{ marginTop: 10 }}>
                    <label className="scheduler-edit-field">
                      <span>Start *</span>
                      <input
                        type="datetime-local"
                        value={value.labsTaskStartLocal}
                        onChange={(e) => onChange({ labsTaskStartLocal: e.target.value })}
                        disabled={disabled || metaLoading}
                        required
                        aria-label="Task start date and time"
                      />
                    </label>
                    <label className="scheduler-edit-field">
                      <span>Due</span>
                      <input
                        type="datetime-local"
                        value={value.labsTaskDueLocal}
                        onChange={(e) => onChange({ labsTaskDueLocal: e.target.value })}
                        disabled={disabled || metaLoading}
                        aria-label="Task due date and time"
                      />
                      <span className="settings-muted scheduler-forward-booking-field-hint">
                        Optional — leave blank for no due date.
                      </span>
                    </label>
                  </div>
                </div>
              ) : null}

              {active && mode === 'forward_book_fields' ? (
                <div className="scheduler-forward-booking-mode-panel">
                  <div className="scheduler-edit-two-col">
                    <label className="scheduler-edit-field">
                      <span>Forward book *</span>
                      <select
                        value={value.forwardAmount}
                        onChange={(e) => onChange({ forwardAmount: e.target.value })}
                        disabled={intervalDisabled}
                        required
                        aria-label="Forward book amount"
                      >
                        <option value="">Select…</option>
                        {FORWARD_BOOKING_AMOUNT_OPTIONS.map((n) => (
                          <option key={n} value={String(n)}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="scheduler-edit-field">
                      <span>Unit *</span>
                      <select
                        value={value.forwardUnit}
                        onChange={(e) =>
                          onChange({
                            forwardUnit: e.target.value as ForwardBookingIntervalUnit | '',
                          })
                        }
                        disabled={intervalDisabled}
                        required
                        aria-label="Forward book unit"
                      >
                        <option value="">Select…</option>
                        {FORWARD_BOOKING_UNIT_OPTIONS.map(
                          ({ value: unitValue, label: unitLabel }) => (
                            <option key={unitValue} value={unitValue}>
                              {unitLabel}
                            </option>
                          )
                        )}
                      </select>
                    </label>
                  </div>
                  {providers ? (
                    <label
                      className="scheduler-edit-field"
                      style={{ display: 'block', marginTop: 10 }}
                    >
                      <span>Forward booking with</span>
                      <select
                        className="settings-input"
                        value={providerId ?? ''}
                        onChange={(e) => onProviderIdChange?.(e.target.value)}
                        disabled={intervalDisabled || metaLoading}
                        aria-label="Forward booking provider"
                        style={{ width: '100%' }}
                      >
                        <option value="">Select provider…</option>
                        {providers.map((p) => (
                          <option key={String(p.id)} value={String(p.id)}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <label
                    className="scheduler-edit-field"
                    style={{ display: 'block', marginTop: 10 }}
                  >
                    <span>Forward booking note</span>
                    <p
                      className="settings-muted"
                      style={{ fontSize: 13, margin: '4px 0 8px', fontWeight: 400 }}
                    >
                      Optional — shown on the forward booking list and prefilled when booking the
                      follow-up visit.
                    </p>
                    <textarea
                      className="settings-input"
                      rows={2}
                      value={value.bookingNotes}
                      onChange={(e) => onChange({ bookingNotes: e.target.value })}
                      disabled={intervalDisabled}
                      placeholder="e.g. Prefers AM slots, same provider"
                      aria-label="Forward booking note"
                      style={{
                        width: '100%',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        fontSize: 14,
                      }}
                    />
                  </label>
                </div>
              ) : null}

              {active && mode === 'not_appropriate' ? (
                <div className="scheduler-forward-booking-mode-panel">
                  <label className="scheduler-edit-field" style={{ display: 'block' }}>
                    <span>Reason *</span>
                    <p
                      className="settings-muted"
                      style={{ fontSize: 13, margin: '4px 0 8px', fontWeight: 400 }}
                    >
                      Required — why is forward booking not appropriate for this visit?
                    </p>
                    <textarea
                      className="settings-input"
                      rows={3}
                      value={value.bookingNotes}
                      onChange={(e) => onChange({ bookingNotes: e.target.value })}
                      disabled={disabled}
                      required
                      placeholder="e.g. Hospice care, client declined follow-up, single euthanasia visit"
                      aria-label="Reason forward booking is not appropriate"
                      style={{
                        width: '100%',
                        resize: 'vertical',
                        fontFamily: 'inherit',
                        fontSize: 14,
                      }}
                    />
                  </label>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </fieldset>
  );
}
