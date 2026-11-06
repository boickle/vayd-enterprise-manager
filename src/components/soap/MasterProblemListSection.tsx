import { useState } from 'react';
import { Check, X } from 'lucide-react';
import {
  createProblem,
  deleteProblem,
  updateProblem,
  type PatientProblem,
  type PatientProblemAcuity,
  type PatientProblemStatus,
} from '../../api/visitWorkflow';
import ProblemAddControl from './ProblemAddControl';

type Props = {
  patientId: number;
  encounterId: string;
  problems: PatientProblem[];
  linkedProblemIds: string[];
  disabled?: boolean;
  onChange: (problems: PatientProblem[]) => void;
  onToggleLink: (problemId: string, linked: boolean) => void;
};

const STATUS_OPTIONS: { value: PatientProblemStatus; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
];

const ACUITY_OPTIONS: { value: PatientProblemAcuity; label: string }[] = [
  { value: 'acute', label: 'Acute' },
  { value: 'chronic', label: 'Chronic' },
];

/**
 * The pet's one problem list (spec §5.3; owner decisions Nov 4, 2026), the same in Manual SOAP and
 * AI Scribe. A problem is a name, Acute or Chronic (picked when adding), and Active or Resolved.
 * The presenting complaint lives in Subjective; rule-outs go in the clinical reasoning text.
 * Active problems carry forward.
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
  /** In-flight wording edits, keyed by problem id. These labels print on the medical record,
   * so they stay editable after the problem is on the list. */
  const [labelDrafts, setLabelDrafts] = useState<Record<string, string>>({});

  const add = async (label: string, acuity: PatientProblemAcuity) => {
    const created = await createProblem({
      patientId,
      label,
      acuity,
      status: 'active',
      createdInEncounterId: encounterId,
    });
    onChange([created, ...problems]);
    onToggleLink(created.id, true);
  };

  const replace = (updated: PatientProblem) =>
    onChange(problems.map((x) => (x.id === updated.id ? updated : x)));

  const changeStatus = async (p: PatientProblem, status: PatientProblemStatus) => {
    replace(await updateProblem(p.id, { status }));
  };

  const changeAcuity = async (p: PatientProblem, acuity: PatientProblemAcuity) => {
    replace(await updateProblem(p.id, { acuity }));
  };

  const clearDraft = (id: string) =>
    setLabelDrafts((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

  const commitLabel = async (p: PatientProblem) => {
    const draft = labelDrafts[p.id];
    if (draft === undefined) return;
    const trimmed = draft.trim();
    clearDraft(p.id);
    if (!trimmed || trimmed === p.label) return;
    replace(await updateProblem(p.id, { label: trimmed }));
  };

  const remove = async (p: PatientProblem) => {
    await deleteProblem(p.id);
    onChange(problems.filter((x) => x.id !== p.id));
    onToggleLink(p.id, false);
  };

  return (
    <div className="soap-mpl" data-testid="soap-problem-list">
      {!disabled && <ProblemAddControl onAdd={add} placeholder="Add a problem…" />}

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
                {disabled ? (
                  <span className="soap-mpl-label">{p.label}</span>
                ) : (
                  <input
                    className="soap-mpl-label soap-mpl-label-input"
                    aria-label="Problem wording"
                    value={labelDrafts[p.id] ?? p.label}
                    onChange={(e) =>
                      setLabelDrafts((prev) => ({ ...prev, [p.id]: e.target.value }))
                    }
                    onBlur={() => void commitLabel(p)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur();
                      if (e.key === 'Escape') clearDraft(p.id);
                    }}
                  />
                )}
                <select
                  value={p.acuity ?? ''}
                  disabled={disabled}
                  className="soap-input soap-select soap-mpl-acuity"
                  aria-label="Acute or chronic"
                  title="Chronic problems pin to the top of the patient record"
                  onChange={(e) => {
                    if (e.target.value) void changeAcuity(p, e.target.value as PatientProblemAcuity);
                  }}
                >
                  {p.acuity == null ? (
                    <option value="" disabled>
                      Pick…
                    </option>
                  ) : null}
                  {ACUITY_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value={p.status === 'resolved' ? 'resolved' : 'active'}
                  disabled={disabled}
                  className="soap-input soap-select soap-mpl-status"
                  aria-label="Active or resolved"
                  onChange={(e) => changeStatus(p, e.target.value as PatientProblemStatus)}
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
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
