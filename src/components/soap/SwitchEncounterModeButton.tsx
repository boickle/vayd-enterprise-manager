import { useEffect, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { switchEncounterMode, type SoapEncounter } from '../../api/visitWorkflow';
import { apiErrorMessage } from '../../api/http';
import '../AppDialog.css';

type Target = 'soap' | 'medical_note';

const COPY: Record<Target, { button: string; title: string; question: string; confirm: string }> = {
  soap: {
    button: 'Switch to SOAP',
    title: 'Switch to a SOAP?',
    question: 'Switch this medical note to a SOAP? The note text moves into the SOAP.',
    confirm: 'Switch to SOAP',
  },
  medical_note: {
    button: 'Switch to medical note',
    title: 'Switch to a medical note?',
    question: 'Switch this SOAP to a medical note? Nothing has been entered on it yet.',
    confirm: 'Switch to medical note',
  },
};

/**
 * Fix a wrong pick before signing (owner decision Nov 4, 2026): a medical note becomes a SOAP
 * (its text moves into the SOAP), or an untouched SOAP becomes a medical note. Renders nothing
 * when `hidden` (the record is signed, or the SOAP already has something entered).
 */
export default function SwitchEncounterModeButton({
  encounterId,
  to,
  hidden = false,
  disabled = false,
  beforeSwitch,
  onSwitched,
}: {
  encounterId: string | null | undefined;
  to: Target;
  hidden?: boolean;
  disabled?: boolean;
  /** Save anything still pending first; may name the chart note being edited. */
  beforeSwitch?: () => Promise<{ chartNoteId?: string | null } | void>;
  onSwitched: (encounter: SoapEncounter) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[to];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy]);

  if (hidden || !encounterId) return null;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const prepared = (await beforeSwitch?.()) || {};
      const next = await switchEncounterMode(
        encounterId,
        to === 'soap' ? 'comprehensive' : 'medical_note',
        { chartNoteId: prepared.chartNoteId ?? null }
      );
      setOpen(false);
      onSwitched(next);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="soap-btn"
        disabled={disabled || busy}
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        <ArrowLeftRight size={15} aria-hidden /> {copy.button}
      </button>
      {open ? (
        <div
          className="app-dialog-backdrop"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !busy) setOpen(false);
          }}
        >
          <div
            className="app-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="switch-mode-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <h2 id="switch-mode-title" className="app-dialog__title">
              {copy.title}
            </h2>
            <p className="app-dialog__body">{copy.question}</p>
            {error ? (
              <p className="soap-error" role="alert">
                {error}
              </p>
            ) : null}
            <div className="app-dialog__actions">
              <button
                type="button"
                className="app-dialog__btn"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="app-dialog__btn app-dialog__btn--primary"
                disabled={busy}
                onClick={() => void confirm()}
              >
                {busy ? 'Switching…' : copy.confirm}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
