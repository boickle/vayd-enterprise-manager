import { Heart } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PatientChartSummaryPanel } from './PatientChartSummaryPanel';
import {
  loadRoutingPatientHoverSummary,
  type RoutingPatientHoverSummary,
} from '../utils/routingPatientHoverData';
import './BookPatientChartButton.css';
import './PatientChartSummary.css';

const PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

export function PatientMembershipHeart({
  membershipName,
  size = 12,
  className,
}: {
  membershipName?: string | null;
  size?: number;
  className?: string;
}) {
  const label = membershipName?.trim() || 'Member';
  return (
    <span title={label} className={className} style={{ display: 'inline-flex', lineHeight: 0 }}>
      <Heart
        size={size}
        fill="#dc2626"
        color="#dc2626"
        strokeWidth={1.75}
        aria-label={label}
      />
    </span>
  );
}

export type CareOutreachPetDetailsReminderLine = {
  id: number;
  description: string;
  providerLabel: string;
  dueLabel: string;
  overdue: boolean;
  hidden?: boolean;
};

type Props = {
  patientId: number | string;
  patientName: string;
  practiceTz: string;
  isMember?: boolean;
  membershipName?: string | null;
  /** Reminders on the care outreach list for this pet (shown in modal). */
  outreachReminders?: CareOutreachPetDetailsReminderLine[];
  className?: string;
};

export function CareOutreachPetDetailsButton({
  patientId,
  patientName,
  practiceTz,
  isMember = false,
  membershipName = null,
  outreachReminders = [],
  className,
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RoutingPatientHoverSummary | null>(null);

  const patientIdStr = String(patientId).trim();

  const loadSummary = useCallback(async () => {
    if (!patientIdStr) {
      setError('Patient id missing.');
      setSummary(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadRoutingPatientHoverSummary(patientIdStr, PRACTICE_ID, practiceTz);
      setSummary(loaded);
    } catch {
      setSummary(null);
      setError('Could not load patient details.');
    } finally {
      setLoading(false);
    }
  }, [patientIdStr, practiceTz]);

  useEffect(() => {
    setOpen(false);
    setSummary(null);
    setError(null);
    setLoading(false);
  }, [patientIdStr]);

  useEffect(() => {
    if (!open) return;
    void loadSummary();
  }, [open, loadSummary]);

  const close = useCallback(() => setOpen(false), []);

  if (!patientIdStr) return null;

  const visibleOutreach = outreachReminders.filter((r) => !r.hidden);

  return (
    <>
      <button
        type="button"
        className={['scheduler-book-patient-details-btn', className].filter(Boolean).join(' ')}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        View details
      </button>
      {open
        ? createPortal(
            <div
              className="scheduler-modal-backdrop scheduler-book-patient-details-backdrop"
              role="presentation"
              onMouseDown={close}
            >
              <div
                className="scheduler-book-patient-details-modal"
                role="dialog"
                aria-modal
                aria-labelledby="care-outreach-pet-details-title"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="scheduler-book-patient-details-head">
                  <h3 id="care-outreach-pet-details-title">
                    <span className="scheduler-book-patient-details-title-row">
                      <span>{patientName.trim() || 'Patient'}</span>
                      {isMember ? (
                        <PatientMembershipHeart membershipName={membershipName} size={11} />
                      ) : null}
                    </span>
                  </h3>
                  <button
                    type="button"
                    className="scheduler-modal-close"
                    aria-label="Close patient details"
                    onClick={close}
                  >
                    ×
                  </button>
                </div>
                <div className="scheduler-book-patient-details-body">
                  {isMember ? (
                    <section className="patient-chart-summary-section">
                      <h4 className="patient-chart-summary-section-title">Membership</h4>
                      <div className="patient-chart-summary-section-body">
                        <p className="patient-chart-summary-line">
                          {membershipName?.trim() || 'Member'}
                        </p>
                      </div>
                    </section>
                  ) : null}
                  <PatientChartSummaryPanel
                    patientName={patientName}
                    summary={summary}
                    loading={loading}
                    error={error}
                    showAlerts
                    showHeader={false}
                  />
                  {visibleOutreach.length > 0 ? (
                    <section className="care-outreach-pet-details-outreach" style={{ marginTop: 14 }}>
                      <h4 className="patient-chart-summary-section-title">On this outreach list</h4>
                      <ul className="patient-chart-summary-list" style={{ margin: '4px 0 0' }}>
                        {visibleOutreach.map((r) => (
                          <li
                            key={r.id}
                            style={r.overdue ? { color: '#dc2626' } : undefined}
                          >
                            <strong>{r.description}</strong>
                            {' · '}
                            {r.providerLabel}
                            {' · Due '}
                            {r.dueLabel}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null}
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
