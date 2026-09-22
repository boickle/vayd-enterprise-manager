import { AlertTriangle, Heart, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RoutingPatientHoverSummary, RoutingPatientReminderLine } from '../utils/routingPatientHoverData';
import { declineReminder, formatDeclinedDate } from '../api/declinedTreatments';
import { patchReminder } from '../api/careOutreach';
import { appConfirm, appPrompt } from '../utils/appDialog';
import './PatientChartSummary.css';

function ReminderRow({
  reminder,
  onApplyRefillExpiration,
  onDecline,
  onRemove,
  busy,
  callback = false,
}: {
  reminder: RoutingPatientReminderLine;
  onApplyRefillExpiration?: (dateInput: string) => void;
  onDecline?: (reminder: RoutingPatientReminderLine) => void;
  onRemove?: (reminder: RoutingPatientReminderLine) => void;
  busy?: boolean;
  callback?: boolean;
}) {
  return (
    <li className="patient-chart-summary-reminder">
      <span>
        {reminder.label}
        {callback ? (
          <span className="patient-chart-summary-callback-meta">
            {reminder.assigneeName ? `Assigned to ${reminder.assigneeName}` : 'Unassigned'}
          </span>
        ) : null}
      </span>
      {onApplyRefillExpiration && reminder.dueDateInput ? (
        <button
          type="button"
          className="patient-chart-summary-refill-exp"
          onClick={() => onApplyRefillExpiration(reminder.dueDateInput!)}
        >
          Refill exp
        </button>
      ) : null}
      {!callback && onDecline ? (
        <button
          type="button"
          className="patient-chart-summary-reminder-no"
          title="Owner declined — stays on the chart"
          aria-label={`Owner declined ${reminder.label}`}
          disabled={busy}
          onClick={() => onDecline(reminder)}
        >
          🚫
        </button>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          className="patient-chart-summary-reminder-x"
          title={callback ? 'Remove this callback' : 'Remove from this list only'}
          aria-label={`Remove ${reminder.label}`}
          disabled={busy}
          onClick={() => onRemove(reminder)}
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </li>
  );
}

function SummarySection({
  title,
  children,
  tone = 'default',
}: {
  title: string;
  children: ReactNode;
  tone?: 'default' | 'overdue';
}) {
  return (
    <section
      className={`patient-chart-summary-section${
        tone === 'overdue' ? ' patient-chart-summary-section--overdue' : ''
      }`}
    >
      <h4 className="patient-chart-summary-section-title">{title}</h4>
      <div className="patient-chart-summary-section-body">{children}</div>
    </section>
  );
}

type Props = {
  patientName: string;
  summary: RoutingPatientHoverSummary | null;
  loading?: boolean;
  error?: string | null;
  showAlerts?: boolean;
  isMember?: boolean;
  membershipName?: string | null;
  /** When false, omit the patient name header (e.g. modal title already shows it). */
  showHeader?: boolean;
  className?: string;
  /** Apply a reminder due date to the open prescription's refill expiration. */
  onApplyRefillExpiration?: (dateInput: string) => void;
  /** Reload the summary after a staff decline. */
  onChanged?: () => void;
  allowDecline?: boolean;
};

export function PatientChartSummaryPanel({
  patientName,
  summary,
  loading = false,
  error = null,
  showAlerts = true,
  isMember = false,
  membershipName = null,
  showHeader = true,
  className,
  onApplyRefillExpiration,
  onChanged,
  allowDecline = true,
}: Props) {
  const membershipLabel = membershipName?.trim() || 'Member';
  const [decliningId, setDecliningId] = useState<string | null>(null);

  const declineRow = async (reminder: RoutingPatientReminderLine) => {
    const numeric = Number(reminder.id);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const proceed = await appConfirm({
      title: 'Owner declined this?',
      message: `Record “${reminder.label}” under Declined and as a red note on the medical record, with your name.`,
      confirmLabel: 'Record decline',
      cancelLabel: 'Cancel',
    });
    if (!proceed) return;
    const note = await appPrompt({
      title: 'Decline note (optional)',
      message: 'Why was this declined?',
      placeholder: 'Optional',
      confirmLabel: 'Save',
      cancelLabel: 'Skip note',
    });
    setDecliningId(reminder.id);
    try {
      await declineReminder(numeric, note);
      onChanged?.();
    } finally {
      setDecliningId(null);
    }
  };

  const removeRow = async (reminder: RoutingPatientReminderLine) => {
    const numeric = Number(reminder.id);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const proceed = await appConfirm({
      title: 'Remove this reminder?',
      message: reminder.reminderType && /^(callback|todo)$/i.test(reminder.reminderType)
        ? 'It will come off the staff callbacks & tasks list. It will not stay on the chart or under Declined.'
        : 'It will come off this list. Nothing is written to the chart.',
      confirmLabel: 'Remove',
      cancelLabel: 'Keep it',
    });
    if (!proceed) return;
    setDecliningId(reminder.id);
    try {
      await patchReminder(numeric, { isHidden: true });
      onChanged?.();
    } finally {
      setDecliningId(null);
    }
  };

  const actions = allowDecline
    ? { onDecline: declineRow, onRemove: removeRow }
    : {};
  return (
    <div className={['patient-chart-summary-panel', className].filter(Boolean).join(' ')}>
      {showHeader ? (
        <div className="patient-chart-summary-panel-head">
          <span className="patient-chart-summary-panel-name">{patientName.trim() || 'Patient'}</span>
          {isMember ? (
            <span className="patient-chart-summary-panel-membership">
              <Heart size={11} fill="#dc2626" color="#dc2626" strokeWidth={1.75} aria-hidden />
              <span>{membershipLabel}</span>
            </span>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <p className="patient-chart-summary-muted">Loading…</p>
      ) : error ? (
        <p className="patient-chart-summary-error">{error}</p>
      ) : summary ? (
        <div className="patient-chart-summary-sections">
          <SummarySection title="Primary provider">
            {summary.primaryProviderName ? (
              <p className="patient-chart-summary-line">{summary.primaryProviderName}</p>
            ) : (
              <p className="patient-chart-summary-muted">Not assigned</p>
            )}
          </SummarySection>

          {showAlerts && summary.alerts ? (
            <SummarySection title="Patient alerts">
              <p className="patient-chart-summary-alert-line">
                <AlertTriangle
                  size={14}
                  strokeWidth={2.25}
                  aria-hidden
                  className="patient-chart-summary-alert-icon"
                />
                <span>{summary.alerts}</span>
              </p>
            </SummarySection>
          ) : null}

          <SummarySection title="Last Appointment">
            {summary.lastAppointmentLine ? (
              <p className="patient-chart-summary-line">{summary.lastAppointmentLine}</p>
            ) : (
              <p className="patient-chart-summary-muted">No prior appointment on file</p>
            )}
          </SummarySection>

          <SummarySection title="Next Appointment">
            {summary.nextAppointmentLine ? (
              <p className="patient-chart-summary-line">{summary.nextAppointmentLine}</p>
            ) : (
              <p className="patient-chart-summary-muted">No future appointment</p>
            )}
          </SummarySection>

          <SummarySection title="Callbacks & Tasks">
            {(summary.callbackReminders ?? []).length > 0 ||
            (summary.staffTasks ?? []).length > 0 ? (
              <ul className="patient-chart-summary-list">
                {(summary.callbackReminders ?? []).map((r) => (
                  <ReminderRow
                    key={`reminder:${r.id}`}
                    reminder={r}
                    callback
                    busy={decliningId === r.id}
                    onRemove={allowDecline ? removeRow : undefined}
                  />
                ))}
                {(summary.staffTasks ?? []).map((t) => (
                  <li
                    key={`task:${t.id}`}
                    className={`patient-chart-summary-reminder${
                      t.overdue ? ' patient-chart-summary-reminder--overdue' : ''
                    }`}
                  >
                    <span>
                      {t.title}
                      <span className="patient-chart-summary-callback-meta">
                        {[
                          t.assigneeName ? `Assigned to ${t.assigneeName}` : 'Unassigned',
                          t.dueLabel ? `${t.overdue ? 'Past due' : 'Due'} ${t.dueLabel}` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="patient-chart-summary-muted">None</p>
            )}
          </SummarySection>

          <SummarySection title="Past due" tone="overdue">
            {summary.overdueReminders.length > 0 ? (
              <ul className="patient-chart-summary-list patient-chart-summary-list--overdue">
                {summary.overdueReminders.map((r) => (
                  <ReminderRow
                    key={r.id}
                    reminder={r}
                    onApplyRefillExpiration={onApplyRefillExpiration}
                    busy={decliningId === r.id}
                    {...actions}
                  />
                ))}
              </ul>
            ) : (
              <p className="patient-chart-summary-muted">None</p>
            )}
          </SummarySection>

          <SummarySection title="Upcoming">
            {summary.activeReminders.length > 0 ? (
              <ul className="patient-chart-summary-list">
                {summary.activeReminders.map((r) => (
                  <ReminderRow
                    key={r.id}
                    reminder={r}
                    onApplyRefillExpiration={onApplyRefillExpiration}
                    busy={decliningId === r.id}
                    {...actions}
                  />
                ))}
              </ul>
            ) : (
              <p className="patient-chart-summary-muted">None</p>
            )}
          </SummarySection>

          <SummarySection title="Declined">
            {(summary.declinedItems ?? []).length > 0 ? (
              <ul className="patient-chart-summary-list">
                {(summary.declinedItems ?? []).map((item) => (
                  <li key={item.id} className="patient-chart-summary-declined">
                    <span>{item.label}</span>
                    <span>
                      {item.declinedAt
                        ? `declined ${formatDeclinedDate(item.declinedAt)}`
                        : 'declined'}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="patient-chart-summary-muted">None</p>
            )}
          </SummarySection>
        </div>
      ) : null}
    </div>
  );
}
