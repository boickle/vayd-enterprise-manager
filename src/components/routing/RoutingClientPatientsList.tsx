import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { PatientChartSummaryPanel } from '../PatientChartSummaryPanel';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import {
  extractActivePatientsFromClientStaffRecord,
  loadRoutingPatientHoverSummary,
  type RoutingPatientHoverSummary,
} from '../../utils/routingPatientHoverData';
import '../PatientChartSummary.css';

type PatientRow = {
  id: string;
  name: string;
  alerts?: string | null;
};

type HoverAnchor = {
  patient: PatientRow;
  rect: DOMRect;
};

type Props = {
  clientId: string | null | undefined;
  practiceId: number;
  practiceTz: string;
};

export default function RoutingClientPatientsList({ clientId, practiceId, practiceTz }: Props) {
  const [patients, setPatients] = useState<PatientRow[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [hoverAnchor, setHoverAnchor] = useState<HoverAnchor | null>(null);
  const [summary, setSummary] = useState<RoutingPatientHoverSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const summaryCacheRef = useRef(new Map<string, RoutingPatientHoverSummary>());
  const hoverTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const id = clientId?.trim();
    if (!id) {
      setPatients([]);
      setLoadingPatients(false);
      return;
    }

    let cancelled = false;
    setLoadingPatients(true);
    void fetchClientByIdStaff(id)
      .then((raw) => {
        if (cancelled) return;
        setPatients(extractActivePatientsFromClientStaffRecord(raw));
      })
      .catch(() => {
        if (!cancelled) setPatients([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingPatients(false);
      });

    return () => {
      cancelled = true;
    };
  }, [clientId]);

  const clearHoverTimers = useCallback(() => {
    if (hoverTimerRef.current != null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  const positionPopover = useCallback((rect: DOMRect) => {
    const margin = 12;
    const cardWidth = 340;
    const cardHeightGuess = 420;
    const left = Math.min(Math.max(margin, rect.left), window.innerWidth - cardWidth - margin);
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - cardHeightGuess - 8;
    const top =
      belowTop + cardHeightGuess <= window.innerHeight - margin
        ? belowTop
        : Math.max(margin, aboveTop);
    setPopoverStyle({
      position: 'fixed',
      top,
      left,
      width: cardWidth,
      zIndex: 12000,
    });
  }, []);

  const loadSummary = useCallback(
    async (patient: PatientRow) => {
      const cached = summaryCacheRef.current.get(patient.id);
      if (cached) {
        setSummary(cached);
        setSummaryLoading(false);
        setSummaryError(null);
        return;
      }
      setSummaryLoading(true);
      setSummaryError(null);
      setSummary(null);
      try {
        const loaded = await loadRoutingPatientHoverSummary(patient.id, practiceId, practiceTz, {
          alerts: patient.alerts,
        });
        summaryCacheRef.current.set(patient.id, loaded);
        setSummary(loaded);
      } catch {
        setSummaryError('Could not load patient details.');
      } finally {
        setSummaryLoading(false);
      }
    },
    [practiceId, practiceTz]
  );

  const showHover = useCallback(
    (patient: PatientRow, el: HTMLElement) => {
      clearHoverTimers();
      hoverTimerRef.current = window.setTimeout(() => {
        const rect = el.getBoundingClientRect();
        positionPopover(rect);
        setHoverAnchor({ patient, rect });
        void loadSummary(patient);
      }, 120);
    },
    [clearHoverTimers, loadSummary, positionPopover]
  );

  const scheduleHideHover = useCallback(() => {
    clearHoverTimers();
    hideTimerRef.current = window.setTimeout(() => {
      setHoverAnchor(null);
      setSummary(null);
      setSummaryLoading(false);
      setSummaryError(null);
    }, 180);
  }, [clearHoverTimers]);

  const cancelHideHover = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHoverTimers(), [clearHoverTimers]);

  if (!clientId?.trim()) return null;

  return (
    <div className="routing-client-patients routing-span-full">
      <div className="routing-client-patients-label">Active patients</div>
      {loadingPatients ? (
        <p className="routing-client-patients-hint">Loading patients…</p>
      ) : patients.length === 0 ? (
        <p className="routing-client-patients-hint">No active patients on file for this client.</p>
      ) : (
        <div className="routing-client-patients-chips" role="list">
          {patients.map((patient) => (
            <div
              key={patient.id}
              className="routing-client-patient-chip-wrap"
              role="listitem"
              onMouseEnter={(e) => showHover(patient, e.currentTarget)}
              onMouseLeave={scheduleHideHover}
              onFocus={(e) => showHover(patient, e.currentTarget)}
              onBlur={scheduleHideHover}
            >
              <button type="button" className="routing-client-patient-chip" tabIndex={0}>
                {patient.name}
              </button>
            </div>
          ))}
        </div>
      )}

      {hoverAnchor
        ? createPortal(
            <div
              style={popoverStyle}
              onMouseEnter={cancelHideHover}
              onMouseLeave={scheduleHideHover}
            >
              <div className="routing-patient-hover-card" role="tooltip">
                <PatientChartSummaryPanel
                  patientName={hoverAnchor.patient.name}
                  summary={summary}
                  loading={summaryLoading}
                  error={summaryError}
                  showAlerts
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
