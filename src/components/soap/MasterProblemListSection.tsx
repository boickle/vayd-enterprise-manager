import { useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import {
  createProblem,
  deleteProblem,
  updateProblem,
  type PatientProblem,
  type PatientProblemKind,
  type PatientProblemStatus,
} from '../../api/visitWorkflow';

type Props = {
  patientId: number;
  encounterId: string;
  problems: PatientProblem[];
  linkedProblemIds: string[];
  disabled?: boolean;
  onChange: (problems: PatientProblem[]) => void;
  onToggleLink: (problemId: string, linked: boolean) => void;
};

const KIND_LABEL: Record<PatientProblemKind, string> = {
  presenting_complaint: 'Complaint',
  rule_out: 'Rule-out',
  diagnosis: 'Diagnosis',
};

const STATUS_OPTIONS: PatientProblemStatus[] = ['open', 'active', 'resolved'];

/**
 * Master Problem List (spec §5.3). A presenting complaint or rule-out is a valid
 * entry on its own — no final diagnosis required. Active problems carry forward.
 */
export default function MasterProblemListSection({
  patientId,
  encounterId,
  problems,
  linkedProblemIds,
  disabled,
  onChange,
  onToggleLink,
}: Props) {
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<PatientProblemKind>('presenting_complaint');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const trimmed = label.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      const created = await createProblem({
        patientId,
        label: trimmed,
        kind,
        status: 'active',
        createdInEncounterId: encounterId,
      });
      onChange([created, ...problems]);
      onToggleLink(created.id, true);
      setLabel('');
    } finally {
      setBusy(false);
    }
  };

  const changeStatus = async (p: PatientProblem, status: PatientProblemStatus) => {
    const updated = await updateProblem(p.id, { status });
    onChange(problems.map((x) => (x.id === p.id ? updated : x)));
  };

  const remove = async (p: PatientProblem) => {
    await deleteProblem(p.id);
    onChange(problems.filter((x) => x.id !== p.id));
    onToggleLink(p.id, false);
  };

  return (
    <div className="soap-mpl">
      {!disabled && (
        <div className="soap-mpl-add">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as PatientProblemKind)}
            className="soap-input soap-select"
          >
            <option value="presenting_complaint">Complaint</option>
            <option value="rule_out">Rule-out</option>
            <option value="diagnosis">Diagnosis</option>
          </select>
          <input
            className="soap-input"
            placeholder="Add a problem (no diagnosis required)…"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add();
            }}
          />
          <button type="button" className="soap-btn" onClick={add} disabled={busy}>
            <Plus size={14} /> Add
          </button>
        </div>
      )}

      {problems.length === 0 ? (
        <div className="soap-empty">No problems on the list yet.</div>
      ) : (
        <ul className="soap-mpl-list">
          {problems.map((p) => {
            const linked = linkedProblemIds.includes(p.id);
            return (
              <li key={p.id} className={`soap-mpl-item status-${p.status}`}>
                <button
                  type="button"
                  className={`soap-mpl-link${linked ? ' linked' : ''}`}
                  title={linked ? 'Addressed this visit' : 'Link to this assessment'}
                  disabled={disabled}
                  onClick={() => onToggleLink(p.id, !linked)}
                >
                  {linked ? <Check size={14} /> : null}
                </button>
                <span className={`soap-tag kind-${p.kind}`}>{KIND_LABEL[p.kind]}</span>
                <span className="soap-mpl-label">{p.label}</span>
                <select
                  value={p.status}
                  disabled={disabled}
                  className="soap-input soap-select soap-mpl-status"
                  onChange={(e) =>
                    changeStatus(p, e.target.value as PatientProblemStatus)
                  }
                >
                  {STATUS_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                {!disabled && (
                  <button
                    type="button"
                    className="soap-icon-btn"
                    title="Remove"
                    onClick={() => remove(p)}
                  >
                    <X size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
