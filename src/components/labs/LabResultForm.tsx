import { useMemo, useState } from 'react';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import SoapRichTextField from '../soap/SoapRichTextField';
import {
  formatLabRange,
  isLabValueAbnormal,
  saveLabResult,
  type LabResult,
} from '../../api/inHouseLabs';
import './LabResultForm.css';

type Draft = Record<string, { value: string; comments: string }>;

/** Seed the grid from saved answers, falling back to the template defaults. */
function toDraft(result: LabResult): Draft {
  const draft: Draft = {};
  for (const el of result.elementsSnapshot ?? []) {
    const saved = result.values?.[el.key];
    draft[el.key] = {
      value: saved?.value ?? (result.status === 'pending' ? (el.defaultValue ?? '') : ''),
      comments: saved?.comments ?? '',
    };
  }
  return draft;
}

type Props = {
  result: LabResult;
  onSaved: (result: LabResult) => void;
  onCancel?: () => void;
  /** Read-only view for a completed result in the chart. */
  readOnly?: boolean;
};

export default function LabResultForm({ result, onSaved, onCancel, readOnly }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(result));
  const [summary, setSummary] = useState(result.summary ?? '');
  const [saving, setSaving] = useState<'complete' | 'pending' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const elements = useMemo(() => result.elementsSnapshot ?? [], [result.elementsSnapshot]);
  const isSummary = result.templateMode === 'summary';

  const abnormalCount = useMemo(
    () => elements.filter((el) => isLabValueAbnormal(el, draft[el.key]?.value)).length,
    [elements, draft]
  );

  function setCell(key: string, field: 'value' | 'comments', next: string) {
    setDraft((prev) => ({
      ...prev,
      [key]: { ...(prev[key] ?? { value: '', comments: '' }), [field]: next },
    }));
  }

  async function save(status: 'complete' | 'pending') {
    setSaving(status);
    setError(null);
    try {
      const saved = await saveLabResult(result.id, {
        status,
        ...(isSummary
          ? { summary }
          : {
              values: Object.fromEntries(
                Object.entries(draft).map(([k, v]) => [
                  k,
                  { value: v.value || null, comments: v.comments || null },
                ])
              ),
            }),
      });
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save these results.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="lab-result-form">
      <div className="lab-result-form__head">
        <div>
          <h3 className="lab-result-form__title">{result.templateName}</h3>
          {result.lab?.name ? (
            <p className="lab-result-form__sub">Ordered as {result.lab.name}</p>
          ) : null}
        </div>
        {result.status === 'complete' ? (
          <span className="lab-result-form__badge lab-result-form__badge--done">
            <Check size={13} aria-hidden /> Resulted
          </span>
        ) : (
          <span className="lab-result-form__badge lab-result-form__badge--pending">
            <Clock size={13} aria-hidden /> Not run yet
          </span>
        )}
      </div>

      {abnormalCount > 0 ? (
        <p className="lab-result-form__flag" role="status">
          <AlertTriangle size={14} aria-hidden />
          {abnormalCount === 1 ? '1 result needs attention' : `${abnormalCount} results need attention`}
        </p>
      ) : null}

      {isSummary ? (
        <div className="lab-result-form__summary">
          <SoapRichTextField
            value={summary}
            onChange={setSummary}
            onBlur={setSummary}
            disabled={readOnly}
            minHeightPx={220}
            placeholder="Describe what you saw."
          />
        </div>
      ) : (
        <div className="lab-result-form__table-wrap">
          <table className="lab-result-form__table">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Value</th>
                <th scope="col">Reference</th>
                <th scope="col">Comments</th>
              </tr>
            </thead>
            <tbody>
              {elements.map((el) => {
                const cell = draft[el.key] ?? { value: '', comments: '' };
                const abnormal = isLabValueAbnormal(el, cell.value);
                const range = formatLabRange(el);
                return (
                  <tr key={el.key} className={abnormal ? 'is-abnormal' : undefined}>
                    <th scope="row">{el.name}</th>
                    <td>
                      {el.valueType === 'select' ? (
                        <select
                          className="lab-result-form__input"
                          value={cell.value}
                          disabled={readOnly}
                          aria-label={`${el.name} value`}
                          onChange={(e) => setCell(el.key, 'value', e.target.value)}
                        >
                          <option value="">—</option>
                          {(el.options ?? []).map((opt) => (
                            <option key={opt} value={opt}>
                              {opt}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          className="lab-result-form__input"
                          type="text"
                          inputMode={el.valueType === 'number' ? 'decimal' : 'text'}
                          value={cell.value}
                          disabled={readOnly}
                          aria-label={`${el.name} value`}
                          onChange={(e) => setCell(el.key, 'value', e.target.value)}
                        />
                      )}
                      {abnormal ? (
                        <span className="lab-result-form__abnormal">
                          {/* A snap test flags on the choice itself, so "out of range" would read wrong. */}
                          <AlertTriangle size={12} aria-hidden />{' '}
                          {el.abnormalOptions?.length ? 'abnormal' : 'out of range'}
                        </span>
                      ) : null}
                    </td>
                    <td className="lab-result-form__range">{range || '—'}</td>
                    <td>
                      <textarea
                        className="lab-result-form__notes"
                        rows={2}
                        value={cell.comments}
                        disabled={readOnly}
                        aria-label={`${el.name} comments`}
                        onChange={(e) => setCell(el.key, 'comments', e.target.value)}
                      />
                    </td>
                  </tr>
                );
              })}
              {!elements.length ? (
                <tr>
                  <td colSpan={4} className="lab-result-form__empty">
                    This form has no rows yet. Add them in Settings → Lab forms.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {error ? (
        <p className="lab-result-form__error" role="alert">
          {error}
        </p>
      ) : null}

      {!readOnly ? (
        <div className="lab-result-form__actions">
          {onCancel ? (
            <button type="button" className="brief-btn" onClick={onCancel}>
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            className="brief-btn"
            disabled={saving !== null}
            onClick={() => void save('pending')}
          >
            {saving === 'pending' ? 'Saving…' : 'Save, finish later'}
          </button>
          <button
            type="button"
            className="brief-btn brief-btn--primary"
            disabled={saving !== null}
            onClick={() => void save('complete')}
          >
            {saving === 'complete' ? 'Saving…' : 'Save results'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
