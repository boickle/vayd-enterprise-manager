import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Stethoscope } from 'lucide-react';
import {
  appointmentMatchesPatientId,
  fetchPatientAppointmentsStaff,
} from '../../api/pimsAppointments';
import type { Appointment } from '../../api/roomLoader';
import { listEncounters, VISIT_WORKFLOW_PRACTICE_ID, type SoapEncounter } from '../../api/visitWorkflow';
import {
  appointmentIsOpen,
  formatBriefDateTime,
} from '../../utils/briefDisplay';

type Props = {
  open: boolean;
  onClose: () => void;
  patientId: string;
  patientName: string;
  clientId: string | null;
  practiceTz: string;
  onOpenSoap: (appointmentId: number, patientId: string, clientId: string | null) => void;
  onBookAppointment?: () => void;
};

function apptLabel(a: Appointment, practiceTz: string): string {
  const when = formatBriefDateTime(a.appointmentStart, practiceTz) || a.appointmentStart;
  const reason = (a.description ?? a.appointmentType?.name ?? '').trim();
  return reason ? `${when} · ${reason}` : when;
}

export default function PimsStartSoapModal({
  open,
  onClose,
  patientId,
  patientName,
  clientId,
  practiceTz,
  onOpenSoap,
  onBookAppointment,
}: Props) {
  const [drafts, setDrafts] = useState<SoapEncounter[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let canceled = false;
    setBusy(true);
    setError(null);
    const pid = Number(patientId);
    void Promise.all([
      Number.isFinite(pid)
        ? listEncounters({ patientId: pid, status: 'draft' })
        : Promise.resolve([] as SoapEncounter[]),
      fetchPatientAppointmentsStaff(patientId, { practiceId: VISIT_WORKFLOW_PRACTICE_ID }),
    ])
      .then(([encRows, apptRows]) => {
        if (canceled) return;
        const openDrafts = (encRows ?? [])
          .filter((e) => e.status === 'draft')
          .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
        setDrafts(openDrafts);
        const draftApptIds = new Set(openDrafts.map((e) => e.appointmentId));
        const nowFloor = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const matched = (apptRows ?? [])
          .filter((a) => appointmentMatchesPatientId(a, patientId))
          .filter((a) => {
            if (!appointmentIsOpen(a)) return false;
            if (draftApptIds.has(a.id)) return false;
            const start = Date.parse(a.appointmentStart);
            return !Number.isFinite(start) || start >= nowFloor || a.isComplete === false;
          })
          .sort((a, b) => Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart))
          .slice(0, 12);
        setAppts(matched);
      })
      .catch((err) => {
        if (!canceled) {
          setDrafts([]);
          setAppts([]);
          setError(err instanceof Error ? err.message : 'Could not load visits.');
        }
      })
      .finally(() => {
        if (!canceled) setBusy(false);
      });
    return () => {
      canceled = true;
    };
  }, [open, patientId]);

  const empty = useMemo(
    () => !busy && drafts.length === 0 && appts.length === 0,
    [busy, drafts.length, appts.length],
  );

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="pims-chart-pick" role="dialog" aria-modal="true" aria-labelledby="pims-start-soap-title">
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card">
        <div className="pims-chart-pick__head">
          <h3 id="pims-start-soap-title">
            <Stethoscope size={16} aria-hidden /> Start SOAP · {patientName}
          </h3>
          <button type="button" className="pims-chart-pick__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="pims-chart-pick__empty" style={{ marginBottom: 10 }}>
          Pick an open SOAP to continue, or a visit on the books to start one.
        </p>

        {error ? <p className="brief-error">{error}</p> : null}
        {busy ? <p className="pims-chart-pick__empty">Loading…</p> : null}

        {!busy && drafts.length > 0 ? (
          <>
            <p className="pims-chart-work__label" style={{ margin: '4px 0 6px' }}>
              Open SOAPs
            </p>
            <ul className="pims-chart-pick__list">
              {drafts.map((enc) => (
                <li key={enc.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSoap(enc.appointmentId, patientId, clientId);
                      onClose();
                    }}
                  >
                    <strong>Continue open SOAP</strong>
                    <span>
                      Appt #{enc.appointmentId}
                      {enc.updated ? ` · updated ${formatBriefDateTime(enc.updated, practiceTz)}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {!busy && appts.length > 0 ? (
          <>
            <p className="pims-chart-work__label" style={{ margin: '10px 0 6px' }}>
              Visits on the books
            </p>
            <ul className="pims-chart-pick__list">
              {appts.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onOpenSoap(a.id, patientId, clientId);
                      onClose();
                    }}
                  >
                    <strong>{apptLabel(a, practiceTz)}</strong>
                    <span>Start or resume SOAP for this visit</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {empty ? (
          <p className="pims-chart-pick__empty">
            No open SOAP and no upcoming visit on the books for {patientName}. Book a visit first —
            SOAP always ties to an appointment.
          </p>
        ) : null}

        <div className="pims-chart-pick__foot">
          {onBookAppointment ? (
            <button
              type="button"
              className="brief-btn primary"
              onClick={() => {
                onClose();
                onBookAppointment();
              }}
            >
              Book appointment
            </button>
          ) : null}
          <button type="button" className="brief-btn" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
