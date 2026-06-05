import { DateTime } from 'luxon';
import { DepotLocationField } from './DepotLocationField';
import type { ScheduleOverrideDraft } from '../utils/scheduleOverrideBook';
import '../pages/Settings.css';

export type ScheduleOverrideDayFieldsProps = {
  anchorDate: string;
  endDateInclusive?: string | null;
  values: ScheduleOverrideDraft;
  dayOffMode: boolean;
  onValuesChange: (values: ScheduleOverrideDraft) => void;
  onDayOffModeChange: (off: boolean) => void;
  disabled?: boolean;
  loading?: boolean;
  idPrefix?: string;
  /** In-day book slot — restores shift times when clearing day off. */
  suggestedAppointmentWindow?: { workStartLocal: string; workEndLocal: string } | null;
  /** Book-appointment flow: shift times only (depots stay on weekly schedule). */
  showDepotLocations?: boolean;
  /** Primary provider display name (book flow day-off hint). */
  providerName?: string | null;
};

export function ScheduleOverrideDayFields({
  anchorDate,
  endDateInclusive,
  values,
  dayOffMode,
  onValuesChange,
  onDayOffModeChange,
  disabled = false,
  loading = false,
  idPrefix = 'book-override',
  suggestedAppointmentWindow = null,
  showDepotLocations = true,
  providerName = null,
}: ScheduleOverrideDayFieldsProps) {
  const end = endDateInclusive?.trim() || anchorDate;
  const startDt = DateTime.fromISO(anchorDate);
  const endDt = DateTime.fromISO(end);
  const multiDay =
    startDt.isValid && endDt.isValid && endDt.startOf('day') > startDt.startOf('day');
  const title = startDt.isValid
    ? `${anchorDate} ${startDt.toFormat('cccc')}`
    : anchorDate;

  return (
    <div className="settings-override-form scheduler-book-override-form">
      <h4 className="settings-schedule-subtitle">{title}</h4>
      <p className="settings-muted" style={{ marginBottom: 12 }}>
        {showDepotLocations
          ? 'Set start/end time and depot locations for this day. Routing will use these values instead of the weekly schedule.'
          : 'Optionally mark this day off so routing blocks new appointments for the provider.'}
      </p>
      {multiDay ? (
        <p className="scheduler-book-hint muted" style={{ marginTop: 0, marginBottom: 12 }}>
          These settings apply to each day from {startDt.toFormat('MMM d, yyyy')} through{' '}
          {endDt.toFormat('MMM d, yyyy')} for the appointment provider only.
        </p>
      ) : null}
      {loading ? (
        <p className="settings-muted">Loading schedule defaults…</p>
      ) : (
        <>
          <div className="settings-override-times-row">
            {showDepotLocations ? (
              <>
                {!dayOffMode ? (
                  <div className="settings-schedule-row settings-override-times-fields">
                    <div className="settings-schedule-field">
                      <label className="settings-label">Start time</label>
                      <input
                        type="time"
                        className="settings-input"
                        value={values.workStartLocal ?? ''}
                        onChange={(e) => {
                          onDayOffModeChange(false);
                          onValuesChange({ ...values, workStartLocal: e.target.value });
                        }}
                        disabled={disabled}
                      />
                    </div>
                    <div className="settings-schedule-field">
                      <label className="settings-label">End time</label>
                      <input
                        type="time"
                        className="settings-input"
                        value={values.workEndLocal ?? ''}
                        onChange={(e) => {
                          onDayOffModeChange(false);
                          onValuesChange({ ...values, workEndLocal: e.target.value });
                        }}
                        disabled={disabled}
                      />
                    </div>
                  </div>
                ) : (
                  <p className="settings-muted settings-override-day-off-note">
                    This day is marked <strong>off</strong> for routing — no shift times.
                  </p>
                )}
                <div className="settings-override-times-actions">
                  {dayOffMode && suggestedAppointmentWindow ? (
                    <button
                      type="button"
                      className="btn secondary"
                      onClick={() => {
                        onDayOffModeChange(false);
                        onValuesChange({
                          ...values,
                          workStartLocal: suggestedAppointmentWindow.workStartLocal,
                          workEndLocal: suggestedAppointmentWindow.workEndLocal,
                        });
                      }}
                      disabled={disabled}
                    >
                      Use appointment window
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn secondary settings-override-mark-off-btn"
                    onClick={() => {
                      onDayOffModeChange(true);
                      onValuesChange({ ...values, workStartLocal: '', workEndLocal: '' });
                    }}
                    disabled={disabled || dayOffMode}
                  >
                    Mark as day off
                  </button>
                </div>
              </>
            ) : (
              <>
                {!dayOffMode ? (
                  <p className="settings-muted settings-override-day-off-note">
                    Click &ldquo;Mark as Day Off&rdquo; to block appointments for{' '}
                    {providerName?.trim() || 'this provider'} on this day.
                  </p>
                ) : null}
                <div className="settings-override-times-actions">
                  {!dayOffMode ? (
                    <button
                      type="button"
                      className="btn secondary settings-override-mark-off-btn"
                      onClick={() => {
                        onDayOffModeChange(true);
                        onValuesChange({ ...values, workStartLocal: '', workEndLocal: '' });
                      }}
                      disabled={disabled}
                    >
                      Mark as Day Off
                    </button>
                  ) : (
                    <>
                      <span className="settings-muted settings-override-day-off-status">
                        Will be marked as day off once appointment is submitted
                      </span>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => onDayOffModeChange(false)}
                        disabled={disabled}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          {!dayOffMode && showDepotLocations ? (
            <>
              <div className="settings-schedule-section">
                <h4 className="settings-schedule-subtitle">Start depot</h4>
                <DepotLocationField
                  id={`${idPrefix}-start-depot`}
                  lat={values.startDepotLat}
                  lon={values.startDepotLon}
                  onChange={(lat, lon) =>
                    onValuesChange({ ...values, startDepotLat: lat, startDepotLon: lon })
                  }
                  placeholder="Start typing start depot address"
                />
              </div>
              <div className="settings-schedule-section">
                <h4 className="settings-schedule-subtitle">End depot</h4>
                <DepotLocationField
                  id={`${idPrefix}-end-depot`}
                  lat={values.endDepotLat}
                  lon={values.endDepotLon}
                  onChange={(lat, lon) =>
                    onValuesChange({ ...values, endDepotLat: lat, endDepotLon: lon })
                  }
                  placeholder="Start typing end depot address"
                />
              </div>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
