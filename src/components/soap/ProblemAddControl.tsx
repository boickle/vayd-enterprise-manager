import { useState } from 'react';
import { Check } from 'lucide-react';
import type { PatientProblemAcuity } from '../../api/visitWorkflow';

type Props = {
  disabled?: boolean;
  placeholder?: string;
  /** Extra class for where it sits. */
  className?: string;
  /** Called with the trimmed name and the acuity the person picked. May be async. */
  onAdd: (label: string, acuity: PatientProblemAcuity) => void | Promise<void>;
};

/**
 * The one way to add a problem (owner decision Nov 4, 2026): type the name, then pick Acute or
 * Chronic. Used on the SOAP's Problems section (Manual and AI Scribe), the "Chronic problems on
 * this visit" box and wrap-up. There is no Complaint / Rule-out / Diagnosis choice.
 */
export default function ProblemAddControl({ disabled, placeholder, className, onAdd }: Props) {
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async (acuity: PatientProblemAcuity) => {
    const trimmed = label.trim();
    if (!trimmed || busy || disabled) return;
    setBusy(true);
    try {
      await onAdd(trimmed, acuity);
      setLabel('');
    } finally {
      setBusy(false);
    }
  };

  const off = disabled || busy || !label.trim();
  return (
    <div
      className={['soap-scribe-add-problem', 'soap-problem-add', className]
        .filter(Boolean)
        .join(' ')}
      data-testid="problem-add-control"
    >
      <input
        className="soap-input"
        placeholder={placeholder ?? 'Add a problem…'}
        aria-label="New problem"
        value={label}
        disabled={disabled || busy}
        onChange={(e) => setLabel(e.target.value)}
      />
      <button
        type="button"
        className="soap-btn small primary"
        disabled={off}
        onClick={() => void add('acute')}
      >
        <Check size={12} /> Acute
      </button>
      <button
        type="button"
        className="soap-btn small primary"
        disabled={off}
        onClick={() => void add('chronic')}
      >
        <Check size={12} /> Chronic
      </button>
    </div>
  );
}
