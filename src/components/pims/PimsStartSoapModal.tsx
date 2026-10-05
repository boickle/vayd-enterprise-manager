import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { ClipboardList, Stethoscope } from 'lucide-react';
import {
  appointmentMatchesPatientId,
  fetchPatientAppointmentsStaff,
} from '../../api/pimsAppointments';
import type { Appointment } from '../../api/roomLoader';
import { listScoutChartNotes, type ScoutChartNote } from '../../api/scoutChart';
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
  onOpenMedicalNote: (appointmentId: number, patientId: string, clientId: string | null) => void;
  onContinueStandaloneNote?: () => void;
  onBookAppointment?: () => void;
};

function apptLabel(a: Appointment, practiceTz: string): string {
  const when = formatBriefDateTime(a.appointmentStart, practiceTz) || a.appointmentStart;
  const reason = (a.description ?? a.appointmentType?.prettyName ?? a.appointmentType?.name ?? '').trim();
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
  onOpenMedicalNote,
  onContinueStandaloneNote,
  onBookAppointment,
}: Props) {
  const [drafts, setDrafts] = useState<SoapEncounter[]>([]);
  const [noteDrafts, setNoteDrafts] = useState<ScoutChartNote[]>([]);
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
        ? listEncounters({ patientId: pid })
        : Promise.resolve([] as SoapEncounter[]),
      Number.isFinite(pid)
        ? listScoutChartNotes(pid, 'draft')
        : Promise.resolve([] as ScoutChartNote[]),
      fetchPatientAppointmentsStaff(patientId, { practiceId: VISIT_WORKFLOW_PRACTICE_ID }),
    ])
      .then(([encRows, noteRows, apptRows]) => {
        if (canceled) return;
        const openDrafts = (encRows ?? [])
          .filter((e) => e.status !== 'completed')
          .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated));
        const seenAppt = new Set<number>();
        const uniqueOpen = openDrafts.filter((e) => {
          if (seenAppt.has(e.appointmentId)) return false;
          seenAppt.add(e.appointmentId);
          return true;
        });
        setDrafts(uniqueOpen);
        setNoteDrafts((noteRows ?? []).filter((n) => n.status === 'draft' && n.body.trim()));
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
          setNoteDrafts([]);
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
    () => !busy && drafts.length === 0 && noteDrafts.length === 0 && appts.length === 0,
    [busy, drafts.length, noteDrafts.length, appts.length],
  );

  const openSoap = (appointmentId: number) => {
    onOpenSoap(appointmentId, patientId, clientId);
    onClose();
  };
  const openNote = (appointmentId: number) => {
    onOpenMedicalNote(appointmentId, patientId, clientId);
    onClose();
  };

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="pims-chart-pick"
      role="dialog"
      aria-modal="true"
      aria-labelledby="pims-start-encounter-title"
    >
      <button type="button" className="pims-chart-pick__backdrop" aria-label="Close" onClick={onClose} />
      <div className="pims-chart-pick__card">
        <div className="pims-chart-pick__head">
          <h3 id="pims-start-encounter-title">
            <Stethoscope size={16} aria-hidden /> Start/Continue encounter · {patientName}
          </h3>
          <button type="button" className="pims-chart-pick__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="pims-chart-pick__empty" style={{ marginBottom: 10 }}>
          Continue an open SOAP or medical note, or start one on a visit.
        </p>

        {error ? <p className="brief-error">{error}</p> : null}
        {busy ? <p className="pims-chart-pick__empty">Loading…</p> : null}

        {!busy && drafts.length > 0 ? (
          <>
            <p className="pims-chart-work__label" style={{ margin: '4px 0 6px' }}>
              Open
            </p>
            <ul className="pims-chart-pick__list">
              {drafts.map((enc) => (
                <li key={enc.id} className="pims-chart-pick__encounter">
                  <div>
                    <strong>Visit #{enc.appointmentId}</strong>
                    <span>
                      {enc.updated
                        ? `Updated ${formatBriefDateTime(enc.updated, practiceTz)}`
                        : 'Open encounter'}
                    </span>
                  </div>
                  <div className="pims-chart-pick__encounter-actions">
                    <button type="button" onClick={() => openSoap(enc.appointmentId)}>
                      <Stethoscope size={14} aria-hidden /> SOAP
                    </button>
                    <button type="button" onClick={() => openNote(enc.appointmentId)}>
                      <ClipboardList size={14} aria-hidden /> Medical note
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {!busy && noteDrafts.length > 0 && onContinueStandaloneNote ? (
          <>
            <p className="pims-chart-work__label" style={{ margin: drafts.length ? '10px 0 6px' : '4px 0 6px' }}>
              Open medical notes
            </p>
            <ul className="pims-chart-pick__list">
              {noteDrafts.map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onContinueStandaloneNote();
                      onClose();
                    }}
                  >
                    <strong>Continue medical note</strong>
                    <span>
                      {note.updated
                        ? `Draft saved ${formatBriefDateTime(note.updated, practiceTz)}`
                        : 'Draft on the chart'}
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
                <li key={a.id} className="pims-chart-pick__encounter">
                  <div>
                    <strong>{apptLabel(a, practiceTz)}</strong>
                    <span>Start SOAP or a medical note for this visit</span>
                  </div>
                  <div className="pims-chart-pick__encounter-actions">
                    <button type="button" onClick={() => openSoap(a.id)}>
                      <Stethoscope size={14} aria-hidden /> SOAP
                    </button>
                    <button type="button" onClick={() => openNote(a.id)}>
                      <ClipboardList size={14} aria-hidden /> Medical note
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {empty ? (
          <p className="pims-chart-pick__empty">
            No open encounter and no upcoming visit on the books for {patientName}. Book a visit
            first — SOAP and visit medical notes tie to an appointment.
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
