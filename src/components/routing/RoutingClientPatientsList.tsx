import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type MouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { PatientChartSummaryPanel } from '../PatientChartSummaryPanel';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { Heart } from 'lucide-react';
import {
  enrichRoutingClientPatientsMembership,
  extractActivePatientsFromClientStaffRecord,
  loadRoutingPatientHoverSummary,
  type RoutingClientPatientRow,
  type RoutingPatientHoverSummary,
} from '../../utils/routingPatientHoverData';
import { computeVisitHighlightsPopoverPosition } from '../../utils/hoverPopoverPosition';
import '../PatientChartSummary.css';

type HoverState = {
  patient: RoutingClientPatientRow;
  chipEl: HTMLElement;
  x: number;
  y: number;
};

type Props = {
  clientId: string | null | undefined;
  practiceId: number;
  practiceTz: string;
  selectedPatientIds?: ReadonlySet<string>;
  onTogglePatientSelect?: (patient: RoutingClientPatientRow) => void;
  onPatientsLoaded?: (patients: RoutingClientPatientRow[]) => void;
};

export default function RoutingClientPatientsList({
  clientId,
  practiceId,
  practiceTz,
  selectedPatientIds,
  onTogglePatientSelect,
  onPatientsLoaded,
}: Props) {
  const [patients, setPatients] = useState<RoutingClientPatientRow[]>([]);
  const [loadingPatients, setLoadingPatients] = useState(false);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [layout, setLayout] = useState<{
    pos: ReturnType<typeof computeVisitHighlightsPopoverPosition>;
    ready: boolean;
  } | null>(null);
  const [summary, setSummary] = useState<RoutingPatientHoverSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const summaryCacheRef = useRef(new Map<string, RoutingPatientHoverSummary>());
  const hoverTimerRef = useRef<number | null>(null);
  const hideTimerRef = useRef<number | null>(null);
  const chipsContainerRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

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
        const rows = extractActivePatientsFromClientStaffRecord(raw);
        setPatients(rows);
        onPatientsLoaded?.(rows);
        return enrichRoutingClientPatientsMembership(rows);
      })
      .then((enriched) => {
        if (cancelled || !enriched) return;
        setPatients(enriched);
        onPatientsLoaded?.(enriched);
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
  }, [clientId, onPatientsLoaded]);

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

  const hoverAnchorEl = useCallback(
    (chipEl: HTMLElement | null | undefined): HTMLElement | null =>
      chipsContainerRef.current ?? chipEl ?? null,
    []
  );

  const computeLayout = useCallback(
    (state: HoverState, measuredCardH?: number) =>
      computeVisitHighlightsPopoverPosition({
        anchorEl: hoverAnchorEl(state.chipEl),
        x: state.x,
        y: state.y,
        measuredCardH,
        preferSide: 'right',
      }),
    [hoverAnchorEl]
  );

  const loadSummary = useCallback(
    async (patient: RoutingClientPatientRow) => {
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
    (patient: RoutingClientPatientRow, ev: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
      clearHoverTimers();
      const chipEl = ev.currentTarget;
      const x = 'clientX' in ev ? ev.clientX : 0;
      const y = 'clientY' in ev ? ev.clientY : 0;
      hoverTimerRef.current = window.setTimeout(() => {
        setHover({ patient, chipEl, x, y });
        void loadSummary(patient);
      }, 120);
    },
    [clearHoverTimers, loadSummary]
  );

  const scheduleHideHover = useCallback(() => {
    clearHoverTimers();
    hideTimerRef.current = window.setTimeout(() => {
      setHover(null);
      setLayout(null);
      setSummary(null);
      setSummaryLoading(false);
      setSummaryError(null);
    }, 180);
  }, [clearHoverTimers]);

  const hideHover = useCallback(() => {
    clearHoverTimers();
    setHover(null);
    setLayout(null);
    setSummary(null);
    setSummaryLoading(false);
    setSummaryError(null);
  }, [clearHoverTimers]);

  const cancelHideHover = useCallback(() => {
    if (hideTimerRef.current != null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearHoverTimers(), [clearHoverTimers]);

  useLayoutEffect(() => {
    if (!hover) {
      setLayout(null);
      return;
    }
    setLayout({
      pos: computeLayout(hover),
      ready: false,
    });
  }, [hover?.patient.id, hover?.chipEl, computeLayout]);

  useLayoutEffect(() => {
    if (!hover || !layout || layout.ready) return;
    const el = popoverRef.current;
    const measuredH = el ? Math.max(el.scrollHeight, el.getBoundingClientRect().height) : 0;
    setLayout({
      pos: computeLayout(hover, measuredH > 0 ? measuredH : undefined),
      ready: true,
    });
  }, [hover, layout?.ready, computeLayout, summary, summaryLoading, summaryError]);

  useEffect(() => {
    if (!hover || !layout?.ready) return;
    const recompute = () => {
      const el = popoverRef.current;
      const measuredH = el ? Math.max(el.scrollHeight, el.getBoundingClientRect().height) : 0;
      setLayout({
        pos: computeLayout(hover, measuredH > 0 ? measuredH : undefined),
        ready: true,
      });
    };
    window.addEventListener('scroll', recompute, true);
    window.addEventListener('resize', recompute);
    return () => {
      window.removeEventListener('scroll', recompute, true);
      window.removeEventListener('resize', recompute);
    };
  }, [hover, layout?.ready, computeLayout]);

  if (!clientId?.trim()) return null;

  return (
    <div className="routing-client-patients routing-span-full">
      <div className="routing-client-patients-label">
        {onTogglePatientSelect
          ? 'Which patients are you booking? (optional)'
          : 'Active patients'}
      </div>
      {loadingPatients ? (
        <p className="routing-client-patients-hint">Loading patients…</p>
      ) : patients.length === 0 ? (
        <p className="routing-client-patients-hint">No active patients on file for this client.</p>
      ) : (
        <div className="routing-client-patients-chips" role="list" ref={chipsContainerRef}>
          {patients.map((patient) => {
            const isSelected = selectedPatientIds?.has(String(patient.id)) ?? false;
            return (
            <div
              key={patient.id}
              className="routing-client-patient-chip-wrap"
              role="listitem"
              onMouseEnter={(e) => showHover(patient, e)}
              onMouseLeave={scheduleHideHover}
              onFocus={(e) => showHover(patient, e)}
              onBlur={scheduleHideHover}
            >
              <button
                type="button"
                className={`routing-client-patient-chip${
                  isSelected ? ' routing-client-patient-chip--selected' : ''
                }`}
                tabIndex={0}
                aria-pressed={onTogglePatientSelect ? isSelected : undefined}
                onClick={() => {
                  hideHover();
                  onTogglePatientSelect?.(patient);
                }}
              >
                <span className="routing-client-patient-chip-label">
                  {patient.isMember ? (
                    <span
                      className="routing-client-patient-member-heart"
                      title={patient.membershipName?.trim() || 'Member'}
                      aria-hidden
                    >
                      <Heart size={10} fill="#dc2626" color="#dc2626" strokeWidth={1.5} />
                    </span>
                  ) : null}
                  {patient.name}
                </span>
              </button>
            </div>
            );
          })}
        </div>
      )}

      {hover && layout
        ? createPortal(
            <div
              ref={popoverRef}
              className="routing-patient-hover-popover"
              style={{
                position: 'fixed',
                left: layout.pos.left,
                width: layout.pos.width,
                zIndex: 12000,
                visibility: layout.ready ? 'visible' : 'hidden',
                pointerEvents: layout.ready ? 'auto' : 'none',
                ...(layout.pos.bottom != null
                  ? { top: 'auto', bottom: layout.pos.bottom }
                  : { top: layout.pos.top }),
                maxWidth: layout.pos.width,
                maxHeight: layout.pos.maxCardH,
                overflow: 'auto',
              }}
              onMouseEnter={cancelHideHover}
              onMouseLeave={scheduleHideHover}
            >
              <div className="routing-patient-hover-card" role="tooltip">
                <PatientChartSummaryPanel
                  patientName={hover.patient.name}
                  summary={summary}
                  loading={summaryLoading}
                  error={summaryError}
                  showAlerts
                  isMember={hover.patient.isMember}
                  membershipName={hover.patient.membershipName}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
