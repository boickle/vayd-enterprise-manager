import type { Employee } from '../api/appointmentSettings';
import type { Provider } from '../api/employee';
import type { ForwardBookingDispositionMode } from '../api/forwardBookingDisposition';
import type { ForwardBookingIntervalUnit } from '../api/forwardBooking';
import { formatEmployeeDisplayName } from '../utils/employeeDisplayName';
import {
  FORWARD_BOOKING_AMOUNT_OPTIONS,
  FORWARD_BOOKING_UNIT_OPTIONS,
} from '../utils/forwardBookingFromAppointment';
import type { ForwardBookingDispositionFormState } from '../utils/forwardBookingDisposition';
import { fromDatetimeLocalValue } from '../utils/taskDateTime';
import { DateTime } from 'luxon';

export type ForwardBookingPetChoiceValue = ForwardBookingDispositionFormState & {
  providerId: string;
};

const MODE_OPTIONS: {
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

function modeOption(mode: ForwardBookingDispositionMode) {
  return MODE_OPTIONS.find((option) => option.value === mode);
}

function providerSelectLabel(p: Provider): string {
  const name =
    [p.firstName, p.lastName]
      .map((part) => (part == null ? '' : String(part).trim()))
      .filter(Boolean)
      .join(' ')
      .trim() ||
    (p.name?.trim() ?? '') ||
    `Provider #${p.id}`;
  const suffix = p.designation?.trim() || p.title?.trim() || '';
  return suffix ? `${name}, ${suffix}` : name;
}

function formatSavedForwardInterval(amount: string, unit: ForwardBookingIntervalUnit | ''): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0 || !unit) return '—';
  const unitLabel = FORWARD_BOOKING_UNIT_OPTIONS.find((option) => option.value === unit)?.label ?? unit;
  return `${n} ${n === 1 ? unitLabel.replace(/s$/, '') : unitLabel.toLowerCase()}`;
}

function formatSavedTaskDatetime(value: string): string {
  const at = fromDatetimeLocalValue(value);
  if (!at) return '—';
  const dt = DateTime.fromISO(at, { zone: 'utc' }).toLocal();
  return dt.isValid ? dt.toFormat('MMM d, yyyy h:mm a') : '—';
}

type Props = {
  patientId: string;
  patientName: string;
  value: ForwardBookingPetChoiceValue;
  locked: boolean;
  saving: boolean;
  metaLoading: boolean;
  employees: Employee[];
  providers: Provider[];
  onChange: (next: ForwardBookingPetChoiceValue) => void;
};

export function ForwardBookingPetChoice({
  patientId,
  patientName,
  value,
  locked,
  saving,
  metaLoading,
  employees,
  providers,
  onChange,
}: Props) {
  const option = modeOption(value.mode);
  const fieldsDisabled = saving || metaLoading;
  const assigneeLabel = (() => {
    const id = Number(value.labsAssigneeEmployeeId);
    if (!Number.isFinite(id)) return '—';
    const employee = employees.find((row) => Number(row.id) === id);
    return employee ? formatEmployeeDisplayName(employee) || employee.email || '—' : '—';
  })();
  const providerLabel = (() => {
    const id = Number(value.providerId);
    if (!Number.isFinite(id)) return '—';
    const row = providers.find((provider) => Number(provider.id) === id);
    return row ? providerSelectLabel(row) : '—';
  })();

  if (locked && option) {
    return (
      <div className="scheduler-forward-booking-saved">
        <p className="scheduler-forward-booking-saved-lead">
          Follow-up choice for {patientName} was saved and cannot be changed here.
        </p>
        <div className="scheduler-forward-booking-mode-option scheduler-forward-booking-mode-option--active scheduler-forward-booking-mode-option--readonly">
          <div className="scheduler-forward-booking-mode-row scheduler-forward-booking-mode-row--readonly">
            <span className="scheduler-forward-booking-mode-copy">
              <span className="scheduler-forward-booking-mode-label">{option.label}</span>
              <span className="scheduler-forward-booking-mode-hint">{option.hint}</span>
            </span>
          </div>
          {value.mode === 'labs_pending' ? (
            <dl className="scheduler-forward-booking-saved-details">
              <div>
                <dt>Assign task to</dt>
                <dd>{assigneeLabel}</dd>
              </div>
              <div>
                <dt>Task</dt>
                <dd>{value.labsTaskTitle.trim() || '—'}</dd>
              </div>
              <div>
                <dt>Start</dt>
                <dd>{formatSavedTaskDatetime(value.labsTaskStartLocal)}</dd>
              </div>
              <div>
                <dt>Due</dt>
                <dd>
                  {value.labsTaskDueLocal.trim()
                    ? formatSavedTaskDatetime(value.labsTaskDueLocal)
                    : 'No due date'}
                </dd>
              </div>
            </dl>
          ) : null}
          {value.mode === 'forward_book_fields' ? (
            <dl className="scheduler-forward-booking-saved-details">
              <div>
                <dt>Forward book</dt>
                <dd>{formatSavedForwardInterval(value.forwardAmount, value.forwardUnit)}</dd>
              </div>
              <div>
                <dt>Forward booking with</dt>
                <dd>{providerLabel}</dd>
              </div>
              <div>
                <dt>Forward booking note</dt>
                <dd>{value.bookingNotes.trim() || '—'}</dd>
              </div>
            </dl>
          ) : null}
          {value.mode === 'not_appropriate' ? (
            <dl className="scheduler-forward-booking-saved-details">
              <div>
                <dt>Reason</dt>
                <dd>{value.bookingNotes.trim() || '—'}</dd>
              </div>
            </dl>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <fieldset className="scheduler-forward-booking-mode-fieldset" disabled={saving}>
      <legend className="scheduler-forward-booking-mode-legend">
        How should follow-up be handled for {patientName}?
      </legend>
      <div
        className="scheduler-forward-booking-mode-stack"
        role="radiogroup"
        aria-label={`Forward booking option for ${patientName}`}
      >
        {MODE_OPTIONS.map(({ value: mode, label, hint }) => {
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
              <label className="scheduler-forward-booking-mode-row">
                <input
                  type="radio"
                  name={`forward-booking-mode-${patientId}`}
                  value={mode}
                  checked={active}
                  onChange={() => onChange({ ...value, mode })}
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
                      onChange={(e) =>
                        onChange({ ...value, labsAssigneeEmployeeId: e.target.value })
                      }
                      disabled={fieldsDisabled}
                      aria-label={`Assign labs pending task for ${patientName}`}
                    >
                      <option value="">Select staff member…</option>
                      {employees.map((employee) => (
                        <option key={employee.id} value={String(employee.id)}>
                          {formatEmployeeDisplayName(employee) || employee.email}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="scheduler-edit-field">
                    <span>Task *</span>
                    <input
                      type="text"
                      value={value.labsTaskTitle}
                      onChange={(e) => onChange({ ...value, labsTaskTitle: e.target.value })}
                      disabled={fieldsDisabled}
                      placeholder="What needs to be done?"
                      aria-label={`Labs pending task for ${patientName}`}
                    />
                  </label>
                  <div className="scheduler-edit-two-col" style={{ marginTop: 10 }}>
                    <label className="scheduler-edit-field">
                      <span>Start *</span>
                      <input
                        type="datetime-local"
                        value={value.labsTaskStartLocal}
                        onChange={(e) => onChange({ ...value, labsTaskStartLocal: e.target.value })}
                        disabled={fieldsDisabled}
                        required
                        aria-label={`Task start for ${patientName}`}
                      />
                    </label>
                    <label className="scheduler-edit-field">
                      <span>Due</span>
                      <input
                        type="datetime-local"
                        value={value.labsTaskDueLocal}
                        onChange={(e) => onChange({ ...value, labsTaskDueLocal: e.target.value })}
                        disabled={fieldsDisabled}
                        aria-label={`Task due for ${patientName}`}
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
                        onChange={(e) => onChange({ ...value, forwardAmount: e.target.value })}
                        disabled={saving}
                        required
                        aria-label={`Forward book amount for ${patientName}`}
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
                            ...value,
                            forwardUnit: e.target.value as ForwardBookingIntervalUnit | '',
                          })
                        }
                        disabled={saving}
                        required
                        aria-label={`Forward book unit for ${patientName}`}
                      >
                        <option value="">Select…</option>
                        {FORWARD_BOOKING_UNIT_OPTIONS.map(({ value: unitValue, label: unitLabel }) => (
                          <option key={unitValue} value={unitValue}>
                            {unitLabel}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                  <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 10 }}>
                    <span>Forward booking with</span>
                    <select
                      className="settings-input"
                      value={value.providerId}
                      onChange={(e) => onChange({ ...value, providerId: e.target.value })}
                      disabled={fieldsDisabled}
                      aria-label={`Forward booking provider for ${patientName}`}
                      style={{ width: '100%' }}
                    >
                      <option value="">Select provider…</option>
                      {providers.map((provider) => (
                        <option key={String(provider.id)} value={String(provider.id)}>
                          {providerSelectLabel(provider)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="scheduler-edit-field" style={{ display: 'block', marginTop: 10 }}>
                    <span>Forward booking note *</span>
                    <p className="settings-muted" style={{ fontSize: 13, margin: '4px 0 8px', fontWeight: 400 }}>
                      Required — shown on the forward booking list and prefilled when booking the follow-up
                      visit.
                    </p>
                    <textarea
                      className="settings-input"
                      rows={2}
                      value={value.bookingNotes}
                      onChange={(e) => onChange({ ...value, bookingNotes: e.target.value })}
                      disabled={saving}
                      required
                      placeholder="e.g. Prefers AM slots, same provider"
                      aria-label={`Forward booking note for ${patientName}`}
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
                    <p className="settings-muted" style={{ fontSize: 13, margin: '4px 0 8px', fontWeight: 400 }}>
                      Required — why is forward booking not appropriate for this visit?
                    </p>
                    <textarea
                      className="settings-input"
                      rows={3}
                      value={value.bookingNotes}
                      onChange={(e) => onChange({ ...value, bookingNotes: e.target.value })}
                      disabled={saving}
                      required
                      placeholder="e.g. Hospice care, client declined follow-up, single euthanasia visit"
                      aria-label={`Reason forward booking is not appropriate for ${patientName}`}
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
