import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import type { PatientPrescription, PatientProblem, PatientProblemAcuity } from '../../api/visitWorkflow';
import { deleteProblem, updateProblem } from '../../api/visitWorkflow';
import { searchItems, type SearchableItem } from '../../api/roomLoader';
import { appConfirm } from '../../utils/appDialog';
import {
  newSoapChronicDraftId,
  type SoapChronicDraft,
} from '../../utils/soapChronicDraft';

type Props = {
  patientId: number;
  practiceId: number;
  encounterId?: string | null;
  problems: PatientProblem[];
  chronicMedications: PatientPrescription[];
  draft: SoapChronicDraft;
  disabled?: boolean;
  variant?: 'soap' | 'wrapup';
  onDraftChange: (draft: SoapChronicDraft) => void;
  onProblemSaved?: (problem: PatientProblem) => void;
  onProblemRemoved?: (problemId: string) => void;
};

/**
 * Working copy of chronic problems + meds for this SOAP.
 * Adds, resolves, and stops stay local until wrap-up.
 */
export default function SoapPatientChronicSummary({
  patientId,
  practiceId,
  encounterId,
  problems,
  chronicMedications,
  draft,
  disabled,
  variant = 'soap',
  onDraftChange,
  onProblemSaved,
  onProblemRemoved,
}: Props) {
  const visibleProblems = useMemo(() => {
    const recorded = problems.filter(
      (p) =>
        p.status !== 'resolved' &&
        !draft.resolveProblemIds.includes(p.id),
    );
    const pending = draft.addProblems.map((row) => ({
      id: row.tempId,
      label: row.label,
      acuity: row.acuity,
      pending: true as const,
      newThisVisit: true,
      unpublished: true,
    }));
    return [
      ...recorded.map((p) => ({
        id: p.id,
        label: p.label,
        acuity: p.acuity,
        pending: false as const,
        newThisVisit: Boolean(encounterId && p.createdInEncounterId === encounterId),
        unpublished: Boolean(
          encounterId && p.createdInEncounterId === encounterId && !p.postedToRecordAt,
        ),
      })),
      ...pending,
    ];
  }, [problems, draft.addProblems, draft.resolveProblemIds, encounterId]);

  const visibleMeds = useMemo(() => {
    const recorded = chronicMedications.filter((rx) => !draft.discontinueRxIds.includes(rx.id));
    return [
      ...recorded.map((rx) => ({
        id: String(rx.id),
        numericId: rx.id,
        name: rx.name,
        autoshipStartedAt: rx.autoshipStartedAt,
        inventoryItemId: rx.inventoryItemId,
        pending: false as const,
      })),
      ...draft.addMedications.map((row) => ({
        id: row.tempId,
        numericId: null as number | null,
        name: row.name,
        autoshipStartedAt: null as string | null,
        inventoryItemId: row.inventoryItemId,
        pending: true as const,
      })),
    ];
  }, [chronicMedications, draft.addMedications, draft.discontinueRxIds]);

  const [problemLabel, setProblemLabel] = useState('');
  const [editingProblemId, setEditingProblemId] = useState<string | null>(null);
  const [editingProblemLabel, setEditingProblemLabel] = useState('');
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [editingMedName, setEditingMedName] = useState('');
  const [medName, setMedName] = useState('');
  const [medResults, setMedResults] = useState<SearchableItem[]>([]);
  const [medSearching, setMedSearching] = useState(false);
  const [medOpen, setMedOpen] = useState(false);
  const medBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = medName.trim();
    if (q.length < 2) {
      setMedResults([]);
      setMedSearching(false);
      return;
    }
    let canceled = false;
    setMedSearching(true);
    const handle = window.setTimeout(() => {
      searchItems({ q, practiceId, limit: 12, patientId })
        .then((rows) => {
          if (canceled) return;
          setMedResults(rows.filter((r) => r.itemType === 'inventory'));
        })
        .catch(() => {
          if (!canceled) setMedResults([]);
        })
        .finally(() => {
          if (!canceled) setMedSearching(false);
        });
    }, 250);
    return () => {
      canceled = true;
      window.clearTimeout(handle);
    };
  }, [medName, practiceId, patientId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (medBoxRef.current && !medBoxRef.current.contains(e.target as Node)) {
        setMedOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const resolveChronicProblem = async (
    id: string,
    label: string,
    pending: boolean,
    unpublishedThisVisit: boolean,
  ) => {
    const dropUncommitted = pending || unpublishedThisVisit;
    const ok = await appConfirm({
      title: dropUncommitted ? 'Remove this problem?' : 'Resolve this problem?',
      message: dropUncommitted
        ? `“${label}” was added this visit and is not on the patient record yet. Removing it means it will never be committed.`
        : `Are you sure you want to resolve “${label}”? This will be recorded when you wrap up the SOAP.`,
      confirmLabel: dropUncommitted ? 'Remove' : 'Resolve',
      cancelLabel: 'Keep',
    });
    if (!ok) return;
    if (pending) {
      onDraftChange({
        ...draft,
        addProblems: draft.addProblems.filter((row) => row.tempId !== id),
      });
      return;
    }
    if (unpublishedThisVisit) {
      try {
        await deleteProblem(id);
        onProblemRemoved?.(id);
      } catch {
        /* keep it listed if delete fails */
      }
      return;
    }
    onDraftChange({
      ...draft,
      resolveProblemIds: draft.resolveProblemIds.includes(id)
        ? draft.resolveProblemIds
        : [...draft.resolveProblemIds, id],
    });
  };

  const discontinueMedication = async (
    id: string,
    numericId: number | null,
    name: string,
    pending: boolean,
    autoshipStartedAt: string | null,
  ) => {
    if (autoshipStartedAt) {
      const ok = await appConfirm({
        title: 'Stop this medication?',
        message: `Cancel auto-ship for ${name}?\n\nThis cancels the Stripe subscription and emails the client when you wrap up the SOAP.`,
        confirmLabel: 'Stop',
        cancelLabel: 'Keep',
        danger: true,
      });
      if (!ok) return;
    } else if (pending) {
      const ok = await appConfirm({
        title: 'Remove this medication?',
        message: `“${name}” was added this visit and is not on the patient record yet. Removing it means it will never be committed.`,
        confirmLabel: 'Remove',
        cancelLabel: 'Keep',
      });
      if (!ok) return;
    } else {
      const ok = await appConfirm({
        title: 'Stop this medication?',
        message: `Are you sure you want to stop “${name}”? This will be recorded when you wrap up the SOAP.`,
        confirmLabel: 'Stop',
        cancelLabel: 'Keep',
      });
      if (!ok) return;
    }
    if (pending) {
      onDraftChange({
        ...draft,
        addMedications: draft.addMedications.filter((row) => row.tempId !== id),
      });
      return;
    }
    if (numericId == null) return;
    onDraftChange({
      ...draft,
      discontinueRxIds: draft.discontinueRxIds.includes(numericId)
        ? draft.discontinueRxIds
        : [...draft.discontinueRxIds, numericId],
    });
  };

  const addProblem = (acuity: PatientProblemAcuity) => {
    const label = problemLabel.trim();
    if (!label || disabled) return;
    onDraftChange({
      ...draft,
      addProblems: [
        ...draft.addProblems,
        { tempId: newSoapChronicDraftId('prob'), label, acuity },
      ],
    });
    setProblemLabel('');
  };

  const addMedication = (opts?: { name?: string; inventoryItemId?: number | null }) => {
    const name = (opts?.name ?? medName).trim();
    if (!name || disabled) return;
    onDraftChange({
      ...draft,
      addMedications: [
        ...draft.addMedications,
        {
          tempId: newSoapChronicDraftId('med'),
          name,
          inventoryItemId: opts?.inventoryItemId ?? null,
        },
      ],
    });
    setMedName('');
    setMedResults([]);
    setMedOpen(false);
  };

  const pickInventoryMed = (item: SearchableItem) => {
    const id = Number(item.inventoryItem?.id);
    addMedication({
      name: item.name,
      inventoryItemId: Number.isFinite(id) ? id : null,
    });
  };

  const commitProblemLabel = async (id: string, pending: boolean) => {
    const next = editingProblemLabel.trim();
    setEditingProblemId(null);
    if (!next) return;
    if (pending) {
      onDraftChange({
        ...draft,
        addProblems: draft.addProblems.map((row) =>
          row.tempId === id ? { ...row, label: next } : row,
        ),
      });
      return;
    }
    try {
      const saved = await updateProblem(id, { label: next });
      onProblemSaved?.(saved);
    } catch {
      /* keep the previous label; parent still has the last loaded value */
    }
  };

  const commitMedName = (id: string, pending: boolean) => {
    const next = editingMedName.trim();
    setEditingMedId(null);
    if (!next || !pending) return;
    onDraftChange({
      ...draft,
      addMedications: draft.addMedications.map((row) =>
        row.tempId === id ? { ...row, name: next } : row,
      ),
    });
  };

  return (
    <div className="soap-patient-chronic-grid">
      <div className="soap-scribe-chronic">
        <div className="soap-scribe-chronic-head">
          {variant === 'wrapup' ? 'Problems' : 'Chronic problems on this visit'}
        </div>
        {variant !== 'wrapup' ? (
          <p className="soap-scribe-chronic-empty">Changes apply when you wrap up the SOAP.</p>
        ) : null}
        {visibleProblems.length > 0 ? (
          <ul className="soap-scribe-chronic-list">
            {visibleProblems.map((p) => (
              <li key={p.id} className="soap-scribe-chronic-item">
                <span className="soap-scribe-chronic-item-label">
                  {editingProblemId === p.id ? (
                    <input
                      className="soap-input soap-scribe-chronic-edit"
                      value={editingProblemLabel}
                      autoFocus
                      disabled={disabled}
                      aria-label={`Edit ${p.label}`}
                      onChange={(e) => setEditingProblemLabel(e.target.value)}
                      onBlur={() => void commitProblemLabel(p.id, p.pending)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void commitProblemLabel(p.id, p.pending);
                        }
                        if (e.key === 'Escape') setEditingProblemId(null);
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="soap-scribe-chronic-edit-btn"
                      disabled={disabled}
                      onClick={() => {
                        setEditingProblemId(p.id);
                        setEditingProblemLabel(p.label);
                      }}
                    >
                      {p.label}
                    </button>
                  )}
                  {variant !== 'wrapup' && p.newThisVisit ? (
                    <span className="soap-scribe-chronic-new">NEW THIS VISIT</span>
                  ) : null}
                  {p.acuity === 'acute' ? (
                    <span className="soap-scribe-chronic-catalog"> · acute</span>
                  ) : null}
                  {variant !== 'wrapup' && p.pending && !p.newThisVisit ? (
                    <span className="soap-scribe-chronic-catalog"> · not saved yet</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="soap-scribe-chronic-remove"
                  disabled={disabled}
                  title={`Resolve ${p.label}`}
                  aria-label={`Resolve ${p.label}`}
                  onClick={() =>
                    void resolveChronicProblem(p.id, p.label, p.pending, p.unpublished)
                  }
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="soap-scribe-add-problem soap-patient-chronic-add">
          <input
            className="soap-input"
            placeholder="Add a problem…"
            value={problemLabel}
            disabled={disabled}
            onChange={(e) => setProblemLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addProblem('chronic');
              }
            }}
          />
          <button
            type="button"
            className="soap-btn small primary"
            disabled={disabled || !problemLabel.trim()}
            onClick={() => addProblem('acute')}
          >
            <Check size={12} /> Acute
          </button>
          <button
            type="button"
            className="soap-btn small primary"
            disabled={disabled || !problemLabel.trim()}
            onClick={() => addProblem('chronic')}
          >
            <Check size={12} /> Chronic
          </button>
        </div>
      </div>

      <div className="soap-scribe-chronic soap-scribe-chronic--meds">
        <div className="soap-scribe-chronic-head">
          {variant === 'wrapup' ? 'Medications' : 'Chronic medications on this visit'}
        </div>
        {variant !== 'wrapup' ? (
          <p className="soap-scribe-chronic-empty">Changes apply when you wrap up the SOAP.</p>
        ) : null}
        {visibleMeds.length > 0 ? (
          <ul className="soap-scribe-chronic-list">
            {visibleMeds.map((rx) => (
              <li key={rx.id} className="soap-scribe-chronic-item">
                <span className="soap-scribe-chronic-item-label">
                  {rx.pending && editingMedId === rx.id ? (
                    <input
                      className="soap-input soap-scribe-chronic-edit"
                      value={editingMedName}
                      autoFocus
                      disabled={disabled}
                      aria-label={`Edit ${rx.name}`}
                      onChange={(e) => setEditingMedName(e.target.value)}
                      onBlur={() => commitMedName(rx.id, rx.pending)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitMedName(rx.id, rx.pending);
                        }
                        if (e.key === 'Escape') setEditingMedId(null);
                      }}
                    />
                  ) : rx.pending ? (
                    <button
                      type="button"
                      className="soap-scribe-chronic-edit-btn"
                      disabled={disabled}
                      onClick={() => {
                        setEditingMedId(rx.id);
                        setEditingMedName(rx.name);
                      }}
                    >
                      {rx.name}
                    </button>
                  ) : (
                    rx.name
                  )}
                  {variant !== 'wrapup' && rx.pending ? (
                    <span className="soap-scribe-chronic-new">NEW THIS VISIT</span>
                  ) : null}
                  {variant !== 'wrapup' && rx.autoshipStartedAt ? (
                    <span
                      className="soap-scribe-chronic-autoship"
                      title={`Auto-ship started ${new Date(rx.autoshipStartedAt).toLocaleDateString()}`}
                    >
                      {' '}
                      · auto-ship
                    </span>
                  ) : null}
                  {variant !== 'wrapup' && rx.inventoryItemId != null ? (
                    <span
                      className="soap-scribe-chronic-catalog"
                      title="Linked to catalog for refills"
                    >
                      {' '}
                      · catalog
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  className="soap-scribe-chronic-remove"
                  disabled={disabled}
                  title={`Stop ${rx.name}`}
                  aria-label={`Stop ${rx.name}`}
                  onClick={() =>
                    void discontinueMedication(
                      rx.id,
                      rx.numericId,
                      rx.name,
                      rx.pending,
                      rx.autoshipStartedAt ?? null,
                    )
                  }
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="soap-patient-chronic-med-search" ref={medBoxRef}>
          <div className="soap-scribe-add-problem soap-patient-chronic-add">
            <div className="soap-patient-chronic-med-input">
              <Search size={13} className="soap-patient-chronic-med-icon" aria-hidden />
              <input
                className="soap-input"
                placeholder="Search inventory or type a medication…"
                value={medName}
                disabled={disabled}
                onChange={(e) => {
                  setMedName(e.target.value);
                  setMedOpen(true);
                }}
                onFocus={() => {
                  if (medName.trim().length >= 2) setMedOpen(true);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addMedication();
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="soap-btn small primary"
              disabled={disabled || !medName.trim()}
              onClick={() => addMedication()}
              title="Add as free text (no catalog link)"
            >
              <Plus size={12} /> Add
            </button>
          </div>
          {variant !== 'wrapup' ? (
            <p className="soap-patient-chronic-med-hint">
              Pick a catalog item when you can — helps with future refills. Or Add as free text.
            </p>
          ) : null}
          {medOpen && medName.trim().length >= 2 && (
            <div className="soap-patient-chronic-med-results" role="listbox">
              {medSearching && <div className="soap-plan-result-empty">Searching inventory…</div>}
              {!medSearching && medResults.length === 0 && (
                <div className="soap-plan-result-empty">
                  No inventory matches — Add keeps this as free text.
                </div>
              )}
              {!medSearching &&
                medResults.map((item, idx) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    key={`inv-${item.inventoryItem?.id ?? idx}`}
                    className="soap-plan-result"
                    disabled={disabled}
                    onClick={() => pickInventoryMed(item)}
                  >
                    <span className="soap-tag type-inventory">Inventory</span>
                    <span className="soap-plan-result-name">{item.name}</span>
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
