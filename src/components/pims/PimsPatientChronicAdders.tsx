import { useEffect, useRef, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import {
  createPatientPrescription,
  createProblem,
  type PatientPrescription,
  type PatientProblem,
} from '../../api/visitWorkflow';
import { searchItems, type SearchableItem } from '../../api/roomLoader';

type Mode = 'problem' | 'medication' | null;

type Props = {
  patientId: number;
  practiceId: number;
  onProblemCreated: (problem: PatientProblem) => void;
  onMedicationCreated: (rx: PatientPrescription) => void;
};

export default function PimsPatientChronicAdders({
  patientId,
  practiceId,
  onProblemCreated,
  onMedicationCreated,
}: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [problemLabel, setProblemLabel] = useState('');
  const [problemBusy, setProblemBusy] = useState(false);
  const [medName, setMedName] = useState('');
  const [medBusy, setMedBusy] = useState(false);
  const [medResults, setMedResults] = useState<SearchableItem[]>([]);
  const [medSearching, setMedSearching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!mode) return;
    inputRef.current?.focus();
  }, [mode]);

  useEffect(() => {
    if (mode !== 'medication') {
      setMedResults([]);
      setMedSearching(false);
      return;
    }
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
  }, [mode, medName, practiceId, patientId]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMode(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMode(null);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  const close = () => {
    setMode(null);
    setProblemLabel('');
    setMedName('');
    setMedResults([]);
  };

  const addProblem = async () => {
    const label = problemLabel.trim();
    if (!label || problemBusy) return;
    setProblemBusy(true);
    try {
      const created = await createProblem({
        patientId,
        label,
        kind: 'presenting_complaint',
        acuity: 'chronic',
      });
      onProblemCreated(created);
      close();
    } finally {
      setProblemBusy(false);
    }
  };

  const addMedication = async (opts?: { name?: string; inventoryItemId?: number | null }) => {
    const name = (opts?.name ?? medName).trim();
    if (!name || medBusy) return;
    setMedBusy(true);
    try {
      const created = await createPatientPrescription({
        patientId,
        name,
        acuity: 'chronic',
        inventoryItemId: opts?.inventoryItemId ?? null,
      });
      onMedicationCreated(created);
      close();
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
    <div className="pims-emr-chronic-add" ref={rootRef}>
      <div className="pims-emr-chronic-add__actions">
        <button
          type="button"
          className="pims-emr-chronic-add__btn"
          aria-expanded={mode === 'problem'}
          onClick={() => setMode((cur) => (cur === 'problem' ? null : 'problem'))}
        >
          <Plus size={12} aria-hidden /> Problem
        </button>
        <button
          type="button"
          className="pims-emr-chronic-add__btn"
          aria-expanded={mode === 'medication'}
          onClick={() => setMode((cur) => (cur === 'medication' ? null : 'medication'))}
        >
          <Plus size={12} aria-hidden /> Medication
        </button>
      </div>

      {mode === 'problem' ? (
        <div className="pims-emr-chronic-add__panel">
          <input
            ref={inputRef}
            className="input"
            placeholder="Chronic problem"
            value={problemLabel}
            disabled={problemBusy}
            onChange={(e) => setProblemLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void addProblem();
              }
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={problemBusy || !problemLabel.trim()}
            onClick={() => void addProblem()}
          >
            Add
          </button>
        </div>
      ) : null}

      {mode === 'medication' ? (
        <div className="pims-emr-chronic-add__panel pims-emr-chronic-add__panel--med">
          <div className="pims-emr-chronic-add__search">
            <Search size={13} className="pims-emr-chronic-add__search-icon" aria-hidden />
            <input
              ref={inputRef}
              className="input"
              placeholder="Search inventory or type a name"
              value={medName}
              disabled={medBusy}
              onChange={(e) => setMedName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addMedication();
                }
              }}
            />
          </div>
          {medName.trim() ? (
            <div className="pims-emr-chronic-add__results" role="listbox">
              {medSearching ? (
                <div className="pims-emr-chronic-add__empty">Searching inventory…</div>
              ) : null}
              {!medSearching
                ? medResults.map((item, idx) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      key={`inv-${item.inventoryItem?.id ?? idx}`}
                      className="pims-emr-chronic-add__option"
                      disabled={medBusy}
                      onClick={() => pickInventoryMed(item)}
                    >
                      {item.name}
                    </button>
                  ))
                : null}
              <button
                type="button"
                className="pims-emr-chronic-add__option pims-emr-chronic-add__option--free"
                disabled={medBusy || !medName.trim()}
                onClick={() => void addMedication()}
              >
                Add “{medName.trim()}” — not in inventory
              </button>
            </div>
          ) : (
            <p className="pims-emr-chronic-add__hint">
              Pick a catalog item, or type a name that is not in inventory.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
