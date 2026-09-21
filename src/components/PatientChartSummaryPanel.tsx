import { AlertTriangle, Heart } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { RoutingPatientHoverSummary } from '../utils/routingPatientHoverData';
import { declineReminder, formatDeclinedDate } from '../api/declinedTreatments';
import { appConfirm, appPrompt } from '../utils/appDialog';
import './PatientChartSummary.css';

function ReminderRow({
  id,
  label,
  dueDateInput,
  onApplyRefillExpiration,
  onDecline,
  declining,
}: {
  id: string;
  label: string;
  dueDateInput: string | null;
  onApplyRefillExpiration?: (dateInput: string) => void;
  onDecline?: (id: string) => void;
  declining?: boolean;
}) {
  return (
    <li>
      <span>{label}</span>
      {onApplyRefillExpiration && dueDateInput ? (
        <button
          type="button"
          className="patient-chart-summary-refill-exp"
          onClick={() => onApplyRefillExpiration(dueDateInput)}
        >
          Refill exp
        </button>
      ) : null}
      {onDecline ? (
        <button
          type="button"
          className="patient-chart-summary-refill-exp"
          disabled={declining}
          onClick={() => onDecline(id)}
        >
          Decline
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

  const declineRow = async (id: string) => {
    const numeric = Number(id);
    if (!Number.isFinite(numeric) || numeric <= 0) return;
    const proceed = await appConfirm({
      title: 'Decline this reminder',
      message: 'This will stop reminding and keep a declined date on the chart. Continue?',
      confirmLabel: 'Decline',
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
    setDecliningId(id);
    try {
      await declineReminder(numeric, note);
      onChanged?.();
    } finally {
      setDecliningId(null);
    }
  };
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

          <SummarySection title="Active Reminders">
            {summary.activeReminders.length > 0 ? (
              <ul className="patient-chart-summary-list">
                {summary.activeReminders.map((r) => (
                  <ReminderRow
                    key={r.id}
                    id={r.id}
                    label={r.label}
                    dueDateInput={r.dueDateInput}
                    onApplyRefillExpiration={onApplyRefillExpiration}
                    onDecline={allowDecline ? declineRow : undefined}
                    declining={decliningId === r.id}
                  />
                ))}
              </ul>
            ) : (
              <p className="patient-chart-summary-muted">None</p>
            )}
          </SummarySection>

          <SummarySection title="Overdue Reminders" tone="overdue">
            {summary.overdueReminders.length > 0 ? (
              <ul className="patient-chart-summary-list patient-chart-summary-list--overdue">
                {summary.overdueReminders.map((r) => (
                  <ReminderRow
                    key={r.id}
                    id={r.id}
                    label={r.label}
                    dueDateInput={r.dueDateInput}
                    onApplyRefillExpiration={onApplyRefillExpiration}
                    onDecline={allowDecline ? declineRow : undefined}
                    declining={decliningId === r.id}
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
