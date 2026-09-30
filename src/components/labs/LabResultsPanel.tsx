import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Check, Clock, FlaskConical, Plus, X } from 'lucide-react';
import {
  createLabResult,
  isLabValueAbnormal,
  resultedByLabel,
  listLabFormTemplates,
  listPatientLabResults,
  type LabFormTemplate,
  type LabResult,
} from '../../api/inHouseLabs';
import LabResultForm from './LabResultForm';
import './LabResultsPanel.css';

function abnormalCount(result: LabResult): number {
  if (result.templateMode === 'summary') return 0;
  return (result.elementsSnapshot ?? []).filter((el) =>
    isLabValueAbnormal(el, result.values?.[el.key]?.value)
  ).length;
}

function whenLabel(result: LabResult): string {
  const raw = result.resultedAt || result.serviceDate;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

type Props = {
  patientId: number;
  medicalRecordId?: number | null;
  /** Limit to the tests ordered on this visit; omit to show the whole history. */
  encounterOrderIds?: number[];
  title?: string;
};

/**
 * In-house lab results for one patient.
 *
 * The same panel serves the exam room and the morning after: anything ordered
 * shows as waiting until someone fills it in, and whoever saves it is recorded.
 */
export default function LabResultsPanel({
  patientId,
  medicalRecordId,
  encounterOrderIds,
  title = 'In-house labs',
}: Props) {
  const [results, setResults] = useState<LabResult[]>([]);
  const [templates, setTemplates] = useState<LabFormTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<LabResult | null>(null);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listPatientLabResults(patientId);
      setResults(
        encounterOrderIds?.length
          ? rows.filter(
              (r) => r.encounterOrderId != null && encounterOrderIds.includes(r.encounterOrderId)
            )
          : rows
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load in-house labs.');
    } finally {
      setLoading(false);
    }
  }, [patientId, encounterOrderIds]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openPicker() {
    setPicking(true);
    if (!templates.length) {
      try {
        setTemplates(await listLabFormTemplates());
      } catch {
        setTemplates([]);
      }
    }
  }

  async function startForm(template: LabFormTemplate) {
    try {
      const created = await createLabResult({
        patientId,
        labFormTemplateId: template.id,
        medicalRecordId: medicalRecordId ?? null,
      });
      setPicking(false);
      setOpen(created);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start that form.');
    }
  }

  const pending = useMemo(() => results.filter((r) => r.status === 'pending'), [results]);

  return (
    <div className="lab-panel">
      <div className="lab-panel__head">
        <h3 className="lab-panel__title">
          <FlaskConical size={15} aria-hidden /> {title}
          {pending.length ? (
            <span className="lab-panel__pending-count">{pending.length} waiting</span>
          ) : null}
        </h3>
        <button type="button" className="brief-btn" onClick={() => void openPicker()}>
          <Plus size={13} aria-hidden /> Run a lab
        </button>
      </div>

      {error ? (
        <p className="lab-panel__error" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="lab-panel__muted">Loading…</p>
      ) : !results.length ? (
        <p className="lab-panel__muted">No in-house labs for this patient yet.</p>
      ) : (
        <ul className="lab-panel__list">
          {results.map((r) => {
            const flagged = abnormalCount(r);
            const by = resultedByLabel(r);
            return (
              <li key={r.id}>
                <button type="button" className="lab-panel__row" onClick={() => setOpen(r)}>
                  <span className="lab-panel__row-main">
                    <span className="lab-panel__row-name">{r.templateName}</span>
                    <span className="lab-panel__row-meta">
                      {whenLabel(r)}
                      {by ? ` · ${by}` : ''}
                      {r.lab?.name ? ` · ${r.lab.name}` : ''}
                    </span>
                  </span>
                  {r.status === 'pending' ? (
                    <span className="lab-panel__tag lab-panel__tag--pending">
                      <Clock size={12} aria-hidden /> Not run
                    </span>
                  ) : flagged ? (
                    <span className="lab-panel__tag lab-panel__tag--flag">
                      <AlertTriangle size={12} aria-hidden /> {flagged} abnormal
                    </span>
                  ) : (
                    <span className="lab-panel__tag lab-panel__tag--ok">
                      <Check size={12} aria-hidden /> Normal
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picking
        ? createPortal(
            <div
              className="lab-panel__overlay"
              role="dialog"
              aria-modal="true"
              aria-label="Pick a lab form"
            >
              <div className="lab-panel__sheet lab-panel__sheet--narrow">
                <div className="lab-panel__sheet-head">
                  <h3>Which lab?</h3>
                  <button type="button" aria-label="Close" onClick={() => setPicking(false)}>
                    <X size={16} aria-hidden />
                  </button>
                </div>
                {!templates.length ? (
                  <p className="lab-panel__muted">
                    No lab forms are set up yet. Add them in Settings → In-house lab forms.
                  </p>
                ) : (
                  <ul className="lab-panel__picker">
                    {templates.map((t) => (
                      <li key={t.id}>
                        <button type="button" onClick={() => void startForm(t)}>
                          <span>{t.name}</span>
                          <em>{t.category}</em>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>,
            document.body
          )
        : null}

      {open
        ? createPortal(
            <div
              className="lab-panel__overlay"
              role="dialog"
              aria-modal="true"
              aria-label={`${open.templateName} results`}
            >
              <div className="lab-panel__sheet">
                <div className="lab-panel__sheet-head">
                  <h3>Lab results</h3>
                  <button type="button" aria-label="Close" onClick={() => setOpen(null)}>
                    <X size={16} aria-hidden />
                  </button>
                </div>
                <LabResultForm
                  result={open}
                  onCancel={() => setOpen(null)}
                  onSaved={(saved) => {
                    setOpen(null);
                    setResults((prev) => prev.map((r) => (r.id === saved.id ? saved : r)));
                    void load();
                  }}
                />
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
