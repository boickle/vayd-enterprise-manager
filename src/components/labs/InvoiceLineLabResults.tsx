import { useState } from 'react';
import { ChevronDown, ChevronRight, FlaskConical } from 'lucide-react';
import { resultedByLabel, type LabResult } from '../../api/inHouseLabs';
import LabResultForm from './LabResultForm';
import LabResultChip from './LabResultChip';
import './InvoiceLineLabResults.css';

type Props = {
  results: LabResult[];
  onSaved: (saved: LabResult) => void;
  /** Read-only, e.g. a finalized bill someone without edit rights is looking at. */
  readOnly?: boolean;
};

function whenLabel(result: LabResult): string {
  const raw = result.resultedAt;
  if (!raw) return '';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The in-house forms for one lab charge, entered right where the charge is.
 * A form still waiting opens by itself so a snap test is one click away; a
 * resulted one folds up behind its chip so the line stays short.
 */
export default function InvoiceLineLabResults({ results, onSaved, readOnly }: Props) {
  const [openIds, setOpenIds] = useState<Record<number, boolean>>({});

  if (!results.length) return null;

  return (
    <div className="line-labs">
      {results.map((r) => {
        const pending = r.status === 'pending';
        const open = openIds[r.id] ?? pending;
        const by = resultedByLabel(r);
        return (
          <div key={r.id} className={`line-labs__form${open ? ' is-open' : ''}`}>
            <button
              type="button"
              className="line-labs__head"
              aria-expanded={open}
              onClick={() => setOpenIds((prev) => ({ ...prev, [r.id]: !open }))}
            >
              {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <FlaskConical size={13} aria-hidden />
              <span className="line-labs__name">{r.templateName}</span>
              <LabResultChip results={[r]} />
              {!pending ? (
                <span className="line-labs__meta">
                  {whenLabel(r)}
                  {by ? ` · ${by}` : ''}
                </span>
              ) : null}
              {!open ? (
                <span className="line-labs__cta">{pending ? 'Run lab' : 'View'}</span>
              ) : null}
            </button>
            {open ? (
              <LabResultForm
                key={`${r.id}:${r.status}:${r.resultedAt ?? ''}`}
                result={r}
                readOnly={readOnly}
                onSaved={(saved) => {
                  onSaved(saved);
                  if (saved.status === 'complete') {
                    setOpenIds((prev) => ({ ...prev, [saved.id]: false }));
                  }
                }}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
