import { useCallback, useEffect, useMemo, useState } from 'react';
import { Mic, Phone, Stethoscope, Users, FileSearch } from 'lucide-react';
import { DateTime } from 'luxon';
import type { BriefKind } from '../../utils/briefTypes';
import { BRIEF_KIND_HINT, BRIEF_KIND_LABEL, defaultBriefTitle } from '../../utils/briefTypes';
import { searchPatientsStaff, type PatientSearchRow } from '../../api/patients';
import {
  appointmentMatchesPatientId,
  fetchPatientAppointmentsStaff,
} from '../../api/pimsAppointments';
import type { Appointment } from '../../api/roomLoader';
import {
  appointmentIsOpen,
  clientIdFromPatientRow,
  clientNameFromPatientRow,
  clientPhoneFromRecord,
  formatBriefDateTime,
  patientDisplayName,
  pickStr,
} from '../../utils/briefDisplay';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';

export type BriefStartPayload = {
  kind: BriefKind;
  title: string;
  patientId?: string | number | null;
  patientName?: string | null;
  clientId?: string | number | null;
  clientName?: string | null;
  clientPhone?: string | null;
  appointmentId?: number | null;
};

type PrefillPatient = {
  id: string | number;
  name: string;
  clientId?: string | number | null;
  clientName?: string | null;
  clientPhone?: string | null;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onStart: (payload: BriefStartPayload) => void;
  practiceTz: string;
  /** Prefill when starting from a selected patient. */
  initialPatient?: PrefillPatient | null;
  initialKind?: BriefKind | null;
};

const KINDS: { kind: BriefKind; icon: typeof Mic }[] = [
  { kind: 'visit', icon: Stethoscope },
  { kind: 'previsit', icon: Mic },
  { kind: 'callback', icon: Phone },
  { kind: 'huddle', icon: Users },
  { kind: 'review', icon: FileSearch },
];

export default function BriefStartModal({
  open,
  onClose,
  onStart,
  practiceTz,
  initialPatient = null,
  initialKind = null,
}: Props) {
  const [kind, setKind] = useState<BriefKind>('previsit');
  const [title, setTitle] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PatientSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [patient, setPatient] = useState<PrefillPatient | null>(initialPatient);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [apptId, setApptId] = useState<number | null>(null);
  const [loadingAppts, setLoadingAppts] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(initialKind ?? 'previsit');
    setTitle('');
    setQuery('');
    setHits([]);
    setPatient(initialPatient);
    setAppts([]);
    setApptId(null);
  }, [open, initialPatient, initialKind]);

  useEffect(() => {
    if (!open || kind === 'huddle') return;
    const q = query.trim();
    if (!q || patient) {
      setHits([]);
      return;
    }
    let canceled = false;
    const t = window.setTimeout(() => {
      setSearching(true);
      void searchPatientsStaff(q, { practiceId: VISIT_WORKFLOW_PRACTICE_ID, activeOnly: true })
        .then((rows) => {
          if (!canceled) setHits(rows.slice(0, 12));
        })
        .catch(() => {
          if (!canceled) setHits([]);
        })
        .finally(() => {
          if (!canceled) setSearching(false);
        });
    }, 280);
    return () => {
      canceled = true;
      window.clearTimeout(t);
    };
  }, [open, query, patient, kind]);

  useEffect(() => {
    if (!patient || (kind !== 'visit' && kind !== 'previsit')) {
      setAppts([]);
      setApptId(null);
      return;
    }
    let canceled = false;
    setLoadingAppts(true);
    void fetchPatientAppointmentsStaff(patient.id, { practiceId: VISIT_WORKFLOW_PRACTICE_ID })
      .then((rows) => {
        if (canceled) return;
        const now = Date.now() - 14 * 24 * 60 * 60 * 1000;
        const matched = rows
          .filter((a) => appointmentMatchesPatientId(a, String(patient.id)))
          .filter((a) => {
            if (!appointmentIsOpen(a)) return false;
            const start = Date.parse(a.appointmentStart);
            return !Number.isFinite(start) || start >= now || a.isComplete === false;
          })
          .sort((a, b) => Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart))
          .slice(0, 8);
        setAppts(matched);
        setApptId(matched[0]?.id ?? null);
      })
      .catch(() => {
        if (!canceled) setAppts([]);
      })
      .finally(() => {
        if (!canceled) setLoadingAppts(false);
      });
    return () => {
      canceled = true;
    };
  }, [patient, kind]);

  const dateLabel = useMemo(() => DateTime.now().setZone(practiceTz).toFormat('M/d'), [practiceTz]);

  const pickPatient = useCallback((row: PatientSearchRow) => {
    const rec = row as Record<string, unknown>;
    setPatient({
      id: row.id,
      name: patientDisplayName(row),
      clientId: clientIdFromPatientRow(row),
      clientName: clientNameFromPatientRow(row),
      clientPhone: clientPhoneFromRecord(rec),
    });
    setQuery('');
    setHits([]);
  }, []);

  const canStart =
    kind === 'huddle' ||
    (patient != null && (kind !== 'visit' || apptId != null || appts.length === 0));

  if (!open) return null;

  return (
    <div className="brief-modal" role="dialog" aria-modal aria-labelledby="brief-start-title">
      <button
        type="button"
        className="brief-modal__backdrop"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="brief-modal__card">
        <div className="brief-modal__head">
          <h2 id="brief-start-title">
            {patient ? `Start an Epiphany for ${patient.name}` : 'Start an Epiphany'}
          </h2>
          <button type="button" className="brief-icon-btn" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <p className="brief-field-label">Type</p>
        <ul className="brief-kind-list">
          {KINDS.map(({ kind: k, icon: Icon }) => (
            <li key={k}>
              <button
                type="button"
                className={`brief-kind-item${kind === k ? ' is-selected' : ''}`}
                onClick={() => setKind(k)}
              >
                <Icon size={16} strokeWidth={1.75} aria-hidden />
                <span>
                  <strong>{BRIEF_KIND_LABEL[k]}</strong>
                  <em>{BRIEF_KIND_HINT[k]}</em>
                </span>
                {kind === k ? <span className="brief-kind-check">✓</span> : null}
              </button>
            </li>
          ))}
        </ul>

        {kind === 'huddle' ? (
          <label className="brief-field">
            <span className="brief-field-label">Title</span>
            <input
              className="brief-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={defaultBriefTitle('huddle', dateLabel)}
            />
          </label>
        ) : (
          <>
            <label className="brief-field">
              <span className="brief-field-label">Patient</span>
              {patient ? (
                <div className="brief-picked">
                  <span>
                    <strong>{patient.name}</strong>
                    {patient.clientName ? ` · ${patient.clientName}` : ''}
                  </span>
                  <button type="button" className="brief-text-btn" onClick={() => setPatient(null)}>
                    Change
                  </button>
                </div>
              ) : (
                <input
                  className="brief-input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Patient or client name"
                />
              )}
            </label>
            {!patient && (searching || hits.length > 0) ? (
              <ul className="brief-hit-list">
                {searching && hits.length === 0 ? (
                  <li className="brief-muted">Searching…</li>
                ) : null}
                {hits.map((row) => (
                  <li key={String(row.id)}>
                    <button type="button" className="brief-hit" onClick={() => pickPatient(row)}>
                      <strong>{patientDisplayName(row)}</strong>
                      <span>
                        {clientNameFromPatientRow(row) ??
                          pickStr((row as Record<string, unknown>).species) ??
                          ''}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {(kind === 'visit' || kind === 'previsit') && patient ? (
              <div className="brief-field">
                <span className="brief-field-label">
                  {kind === 'visit' ? 'Match to a visit' : 'Link to a visit (optional)'}
                </span>
                {loadingAppts ? (
                  <p className="brief-muted">Looking up upcoming and unfinished visits…</p>
                ) : appts.length === 0 ? (
                  <p className="brief-muted">
                    {kind === 'visit'
                      ? 'No open visits on the books. Book one from Scheduling, or capture prep notes instead.'
                      : 'No open visit to attach. Prep notes will inject the next time you open this patient’s SOAP.'}
                  </p>
                ) : (
                  <ul className="brief-appt-picks">
                    {kind === 'previsit' ? (
                      <li>
                        <label className="brief-radio">
                          <input
                            type="radio"
                            name="brief-appt"
                            checked={apptId == null}
                            onChange={() => setApptId(null)}
                          />
                          Don’t link yet
                        </label>
                      </li>
                    ) : null}
                    {appts.map((a) => (
                      <li key={a.id}>
                        <label className="brief-radio">
                          <input
                            type="radio"
                            name="brief-appt"
                            checked={apptId === a.id}
                            onChange={() => setApptId(a.id)}
                          />
                          {formatBriefDateTime(a.appointmentStart, practiceTz)}
                          {a.isComplete ? '' : ' · open'}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
          </>
        )}

        <div className="brief-modal__foot">
          <button
            type="button"
            className="brief-btn primary"
            disabled={
              !canStart ||
              (kind === 'visit' && patient != null && appts.length > 0 && apptId == null)
            }
            onClick={() => {
              if (kind === 'visit' && patient && !apptId && appts.length > 0) return;
              onStart({
                kind,
                title:
                  title.trim() ||
                  (kind === 'huddle'
                    ? defaultBriefTitle('huddle', dateLabel)
                    : patient
                      ? `${BRIEF_KIND_LABEL[kind]} · ${patient.name}`
                      : BRIEF_KIND_LABEL[kind]),
                patientId: patient?.id ?? null,
                patientName: patient?.name ?? null,
                clientId: patient?.clientId ?? null,
                clientName: patient?.clientName ?? null,
                clientPhone: patient?.clientPhone ?? null,
                appointmentId: apptId,
              });
            }}
          >
            Start Epiphany
          </button>
        </div>
      </div>
    </div>
  );
}
