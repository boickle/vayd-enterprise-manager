import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import type { RoutingPatientHoverSummary } from '../utils/routingPatientHoverData';
import './PatientChartSummary.css';

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
  /** When false, omit the patient name header (e.g. modal title already shows it). */
  showHeader?: boolean;
  className?: string;
};

export function PatientChartSummaryPanel({
  patientName,
  summary,
  loading = false,
  error = null,
  showAlerts = true,
  showHeader = true,
  className,
}: Props) {
  return (
    <div className={['patient-chart-summary-panel', className].filter(Boolean).join(' ')}>
      {showHeader ? (
        <div className="patient-chart-summary-panel-head">{patientName.trim() || 'Patient'}</div>
      ) : null}
      {loading ? (
        <p className="patient-chart-summary-muted">Loading…</p>
      ) : error ? (
        <p className="patient-chart-summary-error">{error}</p>
      ) : summary ? (
        <div className="patient-chart-summary-sections">
          {showAlerts && summary.alerts ? (
            <SummarySection title="Alerts">
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
                  <li key={r.id}>{r.label}</li>
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
                  <li key={r.id}>{r.label}</li>
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
