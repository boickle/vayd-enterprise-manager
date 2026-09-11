import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ChevronRight, Plus } from 'lucide-react';
import { fetchPatientByIdStaff } from '../../api/patients';
import { listEncounters, type SoapEncounter } from '../../api/visitWorkflow';
import { listLocalBriefsForPatient } from '../../utils/briefStore';
import type { BriefSession } from '../../utils/briefTypes';
import { BRIEF_KIND_LABEL } from '../../utils/briefTypes';
import {
  clientIdFromPatientRow,
  clientNameFromPatientRow,
  clientPhoneFromRecord,
  formatBriefDateTime,
  patientDisplayName,
  pickStr,
} from '../../utils/briefDisplay';
import BriefRecordReview from './BriefRecordReview';
import BriefCaseHistoryPanel from './BriefCaseHistoryPanel';
import BriefMergePanel from './BriefMergePanel';
import '../../pages/BriefWorkspacePage.css';

export type BriefPatientTab = 'info' | 'sessions' | 'calls' | 'review' | 'history' | 'merge';

const TABS: { id: BriefPatientTab; label: string }[] = [
  { id: 'info', label: 'Patient info' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'calls', label: 'Calls' },
  { id: 'review', label: 'Upload File' },
  { id: 'history', label: 'Case history' },
  { id: 'merge', label: 'Merge patients' },
];

type Props = {
  patientId: string;
  tab: BriefPatientTab;
  onTab: (tab: BriefPatientTab) => void;
  practiceTz: string;
  onOpenSession: (id: string) => void;
  onNew: (prefill: {
    id: string | number;
    name: string;
    clientId?: string | number | null;
    clientName?: string | null;
    clientPhone?: string | null;
  }) => void;
  /** Hide the duplicate header when already shown by the parent (Patients page). */
  embedded?: boolean;
  /** Increment to start a today-as-of case summary. */
  summarizeRequestId?: number;
  summarizeConsumedId?: number;
  onSummarizeConsumed?: (requestId: number) => void;
  clientId?: string | null;
  onRecordsChanged?: () => void;
};

export default function BriefPatientPanel({
  patientId,
  tab,
  onTab,
  practiceTz,
  onOpenSession,
  onNew,
  embedded = false,
  summarizeRequestId = 0,
  summarizeConsumedId = 0,
  onSummarizeConsumed,
  clientId: clientIdProp,
  onRecordsChanged,
}: Props) {
  const [record, setRecord] = useState<Record<string, unknown> | null>(null);
  const [sessions, setSessions] = useState<BriefSession[]>([]);
  const [encounters, setEncounters] = useState<SoapEncounter[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setError(null);
    void fetchPatientByIdStaff(patientId)
      .then((payload) => {
        if (canceled) return;
        setRecord(
          payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null
        );
      })
      .catch((err) => {
        if (!canceled) setError(err instanceof Error ? err.message : 'Could not load patient.');
      });
    setSessions(listLocalBriefsForPatient(patientId));
    void listEncounters({ patientId: Number(patientId) })
      .then((rows) => {
        if (!canceled) setEncounters(rows);
      })
      .catch(() => {
        if (!canceled) setEncounters([]);
      });
    return () => {
      canceled = true;
    };
  }, [patientId]);

  const name = record ? patientDisplayName(record) : `Patient #${patientId}`;
  const clientName = record ? clientNameFromPatientRow(record) : null;
  const clientId = clientIdProp ?? (record ? clientIdFromPatientRow(record) : null);
  const phone = record ? clientPhoneFromRecord(record) : null;
  const firstName = record ? (pickStr(record.firstName) ?? pickStr(record.name) ?? name) : name;
  const lastName = record ? (pickStr(record.lastName) ?? '') : '';

  const prefill = useMemo(
    () => ({
      id: patientId,
      name,
      clientId,
      clientName,
      clientPhone: phone,
    }),
    [patientId, name, clientId, clientName, phone]
  );

  const callSessions = sessions.filter((s) => s.kind === 'callback');

  return (
    <div className="brief-patient">
      {!embedded ? (
        <div className="brief-patient__head">
          <div>
            <h2>{name}&rsquo;s profile</h2>
            {clientName ? <p className="brief-muted">{clientName}</p> : null}
          </div>
          <button type="button" className="brief-btn primary" onClick={() => onNew(prefill)}>
            <Plus size={15} aria-hidden /> New Jot
          </button>
        </div>
      ) : null}

      {!embedded ? (
        <div className="brief-pills" role="tablist" aria-label="Patient Jot sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`brief-pill${tab === t.id ? ' is-active' : ''}`}
              onClick={() => onTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      ) : null}

      {error ? <p className="brief-error">{error}</p> : null}

      {tab === 'info' ? (
        <div className="brief-info-grid">
          <label className="brief-field">
            <span className="brief-field-label">First name</span>
            <input className="brief-input" value={firstName} readOnly />
          </label>
          <label className="brief-field">
            <span className="brief-field-label">Last name</span>
            <input className="brief-input" value={lastName} readOnly />
          </label>
          <p className="brief-hint">
            Identity lives on the patient chart so it isn&apos;t edited in two places.{' '}
            <Link to={`/schedule/patients?patientId=${encodeURIComponent(patientId)}`}>
              Open full chart
            </Link>
          </p>
        </div>
      ) : null}

      {tab === 'sessions' ? (
        <ul className="brief-entry-list">
          {sessions.length === 0 && encounters.length === 0 ? (
            <li className="brief-empty-row">No Jot sessions or SOAP visits yet.</li>
          ) : null}
          {sessions.map((s) => (
            <li key={s.id}>
              <button type="button" className="brief-entry" onClick={() => onOpenSession(s.id)}>
                <div>
                  <strong>{s.title}</strong>
                  <span>
                    {BRIEF_KIND_LABEL[s.kind]} · {formatBriefDateTime(s.updatedAt, practiceTz)}
                  </span>
                  {s.transcript.trim() ? (
                    <em>
                      {s.transcript.trim().slice(0, 140)}
                      {s.transcript.trim().length > 140 ? '…' : ''}
                    </em>
                  ) : null}
                </div>
                <ChevronRight size={16} aria-hidden />
              </button>
            </li>
          ))}
          {encounters.map((enc) => (
            <li key={enc.id}>
              <Link
                className="brief-entry"
                to={`/schedule/soap/${enc.appointmentId}/${enc.patientId}${
                  enc.clientId ? `?clientId=${enc.clientId}` : ''
                }`}
              >
                <div>
                  <strong>SOAP · visit #{enc.appointmentId}</strong>
                  <span>
                    {enc.status === 'completed' ? 'Signed' : 'Open'} ·{' '}
                    {formatBriefDateTime(enc.updated, practiceTz)}
                  </span>
                </div>
                <ChevronRight size={16} aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {tab === 'calls' ? (
        <ul className="brief-entry-list">
          {callSessions.length === 0 ? (
            <li className="brief-empty-row">No calls recorded yet.</li>
          ) : (
            callSessions.map((s) => (
              <li key={s.id}>
                <button type="button" className="brief-entry" onClick={() => onOpenSession(s.id)}>
                  <div>
                    <strong>{s.title}</strong>
                    <span>{formatBriefDateTime(s.updatedAt, practiceTz)}</span>
                    {s.transcript.trim() ? <em>{s.transcript.trim().slice(0, 140)}</em> : null}
                  </div>
                  <ChevronRight size={16} aria-hidden />
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}

      {tab === 'review' ? (
        <BriefRecordReview
          patientId={patientId}
          patientName={name}
          clientId={clientId != null ? String(clientId) : null}
          onAccepted={onRecordsChanged}
        />
      ) : null}

      {tab === 'history' ? (
        <BriefCaseHistoryPanel
          patientId={patientId}
          patientName={name}
          practiceTz={practiceTz}
          onNewJot={() => onNew(prefill)}
          summarizeRequestId={summarizeRequestId}
          summarizeConsumedId={summarizeConsumedId}
          onSummarizeConsumed={onSummarizeConsumed}
          hideChromeActions={embedded}
        />
      ) : null}

      {tab === 'merge' ? (
        <BriefMergePanel keepPatientId={patientId} keepPatientName={name} />
      ) : null}
    </div>
  );
}
