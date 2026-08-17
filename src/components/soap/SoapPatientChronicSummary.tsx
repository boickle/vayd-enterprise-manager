import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Plus, Search, X } from 'lucide-react';
import {
  createPatientPrescription,
  createProblem,
  updatePatientPrescription,
  updateProblem,
  type PatientPrescription,
  type PatientProblem,
  type PatientProblemAcuity,
} from '../../api/visitWorkflow';
import { searchItems, type SearchableItem } from '../../api/roomLoader';

type Props = {
  patientId: number;
  practiceId: number;
  createdInEncounterId?: string | null;
  problems: PatientProblem[];
  chronicMedications: PatientPrescription[];
  disabled?: boolean;
  onProblemCreated: (problem: PatientProblem) => void;
  onProblemUpdated: (problem: PatientProblem) => void;
  onMedicationCreated: (rx: PatientPrescription) => void;
  onMedicationUpdated: (rx: PatientPrescription) => void;
};

/**
 * Chronic problems + meds pinned with the patient header (not inside the AI scribe card).
 * Same actions as the patient EMR: resolve a problem, discontinue a chronic med.
 */
export default function SoapPatientChronicSummary({
  patientId,
  practiceId,
  createdInEncounterId,
  problems,
  chronicMedications,
  disabled,
  onProblemCreated,
  onProblemUpdated,
  onMedicationCreated,
  onMedicationUpdated,
}: Props) {
  const chronicOnRecord = useMemo(
    () => problems.filter((p) => p.acuity === 'chronic' && p.status !== 'resolved'),
    [problems]
  );
  const [busyId, setBusyId] = useState<string | number | null>(null);
  const [problemLabel, setProblemLabel] = useState('');
  const [problemBusy, setProblemBusy] = useState(false);
  const [medName, setMedName] = useState('');
  const [medBusy, setMedBusy] = useState(false);
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

  const resolveChronicProblem = async (p: PatientProblem) => {
    setBusyId(p.id);
    try {
      onProblemUpdated(await updateProblem(p.id, { status: 'resolved' }));
    } finally {
      setBusyId(null);
    }
  };

  const discontinueMedication = async (rx: PatientPrescription) => {
    setBusyId(rx.id);
    try {
      onMedicationUpdated(await updatePatientPrescription(rx.id, { discontinued: true }));
    } finally {
      setBusyId(null);
    }
  };

  const addProblem = async (acuity: PatientProblemAcuity) => {
    const label = problemLabel.trim();
    if (!label || problemBusy || disabled) return;
    setProblemBusy(true);
    try {
      const created = await createProblem({
        patientId,
        label,
        kind: 'presenting_complaint',
        acuity,
        createdInEncounterId: createdInEncounterId ?? undefined,
      });
      onProblemCreated(created);
      setProblemLabel('');
    } finally {
      setProblemBusy(false);
    }
  };

  const addMedication = async (opts?: { name?: string; inventoryItemId?: number | null }) => {
    const name = (opts?.name ?? medName).trim();
    if (!name || medBusy || disabled) return;
    setMedBusy(true);
    try {
      const created = await createPatientPrescription({
        patientId,
        name,
        acuity: 'chronic',
        inventoryItemId: opts?.inventoryItemId ?? null,
      });
      onMedicationCreated(created);
      setMedName('');
      setMedResults([]);
      setMedOpen(false);
    } finally {
      setMedBusy(false);
    }
  };

  const pickInventoryMed = (item: SearchableItem) => {
    const id = Number(item.inventoryItem?.id);
    void addMedication({
      name: item.name,
      inventoryItemId: Number.isFinite(id) ? id : null,
    });
  };

  return (
    <div className="soap-patient-chronic-grid">
      <div className="soap-scribe-chronic">
        <div className="soap-scribe-chronic-head">Chronic problems on record</div>
        {chronicOnRecord.length === 0 ? (
          <p className="soap-scribe-chronic-empty">None listed</p>
        ) : (
          <ul className="soap-scribe-chronic-list">
            {chronicOnRecord.map((p) => (
              <li key={p.id} className="soap-scribe-chronic-item">
                <span className="soap-scribe-chronic-item-label">{p.label}</span>
                <button
                  type="button"
                  className="soap-scribe-chronic-remove"
                  disabled={disabled || busyId != null}
                  title={`Resolved — take ${p.label} off the chronic list`}
                  aria-label={`Mark ${p.label} resolved`}
                  onClick={() => void resolveChronicProblem(p)}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="soap-scribe-add-problem soap-patient-chronic-add">
          <input
            className="soap-input"
            placeholder="Add a problem…"
            value={problemLabel}
            disabled={disabled || problemBusy}
            onChange={(e) => setProblemLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addProblem('chronic');
              }
            }}
          />
          <button
            type="button"
            className="soap-btn small primary"
            disabled={disabled || problemBusy || !problemLabel.trim()}
            onClick={() => void addProblem('acute')}
          >
            <Check size={12} /> Acute
          </button>
          <button
            type="button"
            className="soap-btn small primary"
            disabled={disabled || problemBusy || !problemLabel.trim()}
            onClick={() => void addProblem('chronic')}
          >
            <Check size={12} /> Chronic
          </button>
        </div>
      </div>

      <div className="soap-scribe-chronic soap-scribe-chronic--meds">
        <div className="soap-scribe-chronic-head">Chronic medications on record</div>
        {chronicMedications.length === 0 ? (
          <p className="soap-scribe-chronic-empty">None listed</p>
        ) : (
          <ul className="soap-scribe-chronic-list">
            {chronicMedications.map((rx) => (
              <li key={rx.id} className="soap-scribe-chronic-item">
                <span className="soap-scribe-chronic-item-label">
                  {rx.name}
                  {rx.inventoryItemId != null ? (
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
                  disabled={disabled || busyId != null}
                  title={`No longer taking — take ${rx.name} off the chronic list`}
                  aria-label={`${rx.name} no longer taking`}
                  onClick={() => void discontinueMedication(rx)}
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="soap-patient-chronic-med-search" ref={medBoxRef}>
          <div className="soap-scribe-add-problem soap-patient-chronic-add">
            <div className="soap-patient-chronic-med-input">
              <Search size={13} className="soap-patient-chronic-med-icon" aria-hidden />
              <input
                className="soap-input"
                placeholder="Search inventory or type a medication…"
                value={medName}
                disabled={disabled || medBusy}
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
                    void addMedication();
                  }
                }}
              />
            </div>
            <button
              type="button"
              className="soap-btn small primary"
              disabled={disabled || medBusy || !medName.trim()}
              onClick={() => void addMedication()}
              title="Add as free text (no catalog link)"
            >
              <Plus size={12} /> Add
            </button>
          </div>
          <p className="soap-patient-chronic-med-hint">
            Pick a catalog item when you can — helps with future refills. Or Add as free text.
          </p>
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
                    disabled={medBusy}
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
