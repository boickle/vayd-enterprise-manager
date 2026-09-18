import { useCallback, useEffect, useState } from 'react';
import { GitMerge } from 'lucide-react';
import { searchPatientsStaff, type PatientSearchRow } from '../../api/patients';
import { mergePatientsStaff } from '../../api/briefs';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import { clientNameFromPatientRow, patientDisplayName } from '../../utils/briefDisplay';
import { appConfirm } from '../../utils/appDialog';

type Props = {
  keepPatientId: string;
  keepPatientName: string;
};

export default function BriefMergePanel({ keepPatientId, keepPatientName }: Props) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<PatientSearchRow[]>([]);
  const [absorb, setAbsorb] = useState<PatientSearchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (!q || absorb) {
      setHits([]);
      return;
    }
    let canceled = false;
    const t = window.setTimeout(() => {
      void searchPatientsStaff(q, { practiceId: VISIT_WORKFLOW_PRACTICE_ID })
        .then((rows) => {
          if (canceled) return;
          setHits(rows.filter((r) => String(r.id) !== String(keepPatientId)).slice(0, 10));
        })
        .catch(() => {
          if (!canceled) setHits([]);
        });
    }, 280);
    return () => {
      canceled = true;
      window.clearTimeout(t);
    };
  }, [query, absorb, keepPatientId]);

  const run = useCallback(async () => {
    if (!absorb) return;
    const ok = await appConfirm({
      title: 'Merge charts?',
      message: `Merge ${patientDisplayName(absorb)} into ${keepPatientName}? The absorbed chart should no longer be used.`,
      confirmLabel: 'Merge',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await mergePatientsStaff({
      keepPatientId,
      absorbPatientId: absorb.id,
    });
    setOk(result.ok);
    setMessage(result.message);
    setBusy(false);
  }, [absorb, keepPatientId, keepPatientName]);

  return (
    <div className="brief-merge">
      <div className="brief-review__head">
        <GitMerge size={16} aria-hidden />
        <div>
          <h3>Merge patients</h3>
          <p>
            Keep <strong>{keepPatientName}</strong> and merge another (duplicate) patient{' '}
            <strong>into this chart</strong>. Records move here; stop using the absorbed chart
            afterward. Confirm it is the same animal before you continue.
          </p>
        </div>
      </div>
      {absorb ? (
        <div className="brief-picked">
          <span>
            Absorb <strong>{patientDisplayName(absorb)}</strong>
            {clientNameFromPatientRow(absorb) ? ` · ${clientNameFromPatientRow(absorb)}` : ''}
          </span>
          <button type="button" className="brief-text-btn" onClick={() => setAbsorb(null)}>
            Change
          </button>
        </div>
      ) : (
        <label className="brief-field">
          <span className="brief-field-label">Find the duplicate</span>
          <input
            className="brief-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Patient or client name"
          />
        </label>
      )}
      {!absorb && hits.length > 0 ? (
        <ul className="brief-hit-list">
          {hits.map((row) => (
            <li key={String(row.id)}>
              <button type="button" className="brief-hit" onClick={() => setAbsorb(row)}>
                <strong>{patientDisplayName(row)}</strong>
                <span>{clientNameFromPatientRow(row) ?? `ID ${row.id}`}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {message ? <p className={ok ? 'brief-muted' : 'brief-error'}>{message}</p> : null}
      <button
        type="button"
        className="brief-btn primary"
        disabled={!absorb || busy}
        onClick={() => void run()}
      >
        {busy ? 'Merging…' : 'Merge into this chart'}
      </button>
    </div>
  );
}
