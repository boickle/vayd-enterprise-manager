import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { PatientChartSummaryPanel } from './PatientChartSummaryPanel';
import {
  loadRoutingPatientHoverSummary,
  type RoutingPatientHoverSummary,
} from '../utils/routingPatientHoverData';
import './BookPatientChartButton.css';

type Props = {
  patientId: string;
  patientName: string;
  practiceId: number;
  practiceTz: string;
  /** Omit alerts when they are already visible elsewhere (book modal). */
  showAlerts?: boolean;
  className?: string;
  label?: string;
};

export function BookPatientChartButton({
  patientId,
  patientName,
  practiceId,
  practiceTz,
  showAlerts = false,
  className,
  label = 'Patient details',
}: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<RoutingPatientHoverSummary | null>(null);

  const loadSummary = useCallback(async () => {
    const id = patientId.trim();
    if (!id) {
      setError('Patient id missing.');
      setSummary(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const loaded = await loadRoutingPatientHoverSummary(id, practiceId, practiceTz);
      setSummary(loaded);
    } catch {
      setSummary(null);
      setError('Could not load patient details.');
    } finally {
      setLoading(false);
    }
  }, [patientId, practiceId, practiceTz]);

  useEffect(() => {
    if (!open) return;
    void loadSummary();
  }, [open, loadSummary]);

  const close = useCallback(() => {
    setOpen(false);
  }, []);

  if (!patientId.trim()) return null;

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
        {label}
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
                aria-labelledby="scheduler-book-patient-details-title"
                onMouseDown={(e) => e.stopPropagation()}
              >
                <div className="scheduler-book-patient-details-head">
                  <h3 id="scheduler-book-patient-details-title">
                    {patientName.trim() || 'Patient'}
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
                  <PatientChartSummaryPanel
                    patientName={patientName}
                    summary={summary}
                    loading={loading}
                    error={error}
                    showAlerts={showAlerts}
                    showHeader={false}
                  />
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </>
  );
}
