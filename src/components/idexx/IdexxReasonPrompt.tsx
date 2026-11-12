import { useEffect, useState } from 'react';
import '../../permissions/PermissionGate.css';

/** Q2 (Nov 7, 2026): a short pick list plus "Other" with free text. No "vet to sign later" option. */
export const IDEXX_REASONS = ['Vet reviewed verbally', 'Vet asked me to send it to the client'] as const;
const OTHER = 'Other';

type Props = {
  open: boolean;
  title: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

/** Asks a tech why they are releasing a result a vet has not signed. The answer is logged on the chart. */
export default function IdexxReasonPrompt({
  open,
  title,
  confirmLabel,
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: Props) {
  const [choice, setChoice] = useState<string>('');
  const [other, setOther] = useState('');

  useEffect(() => {
    if (open) {
      setChoice('');
      setOther('');
    }
  }, [open]);

  if (!open) return null;

  const reason = choice === OTHER ? (other.trim() ? `Other: ${other.trim()}` : '') : choice;

  return (
    <div className="perm-reason-backdrop">
      <div
        className="perm-reason-modal"
        role="dialog"
        aria-modal="true"
        data-testid="idexx-reason-prompt"
      >
        <div className="perm-reason-title">{title}</div>
        <div className="perm-reason-note">
          Pick a reason. It is saved on the result and in the pet&apos;s History with your name and
          the time.
        </div>
        <div
          role="radiogroup"
          aria-label="Reason"
          style={{ display: 'grid', gap: 6, margin: '8px 0' }}
        >
          {[...IDEXX_REASONS, OTHER].map((r) => (
            <label key={r} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="radio"
                name="idexx-reason"
                checked={choice === r}
                onChange={() => setChoice(r)}
              />
              {r}
            </label>
          ))}
        </div>
        {choice === OTHER ? (
          <textarea
            value={other}
            maxLength={450}
            placeholder="Reason"
            onChange={(e) => setOther(e.target.value)}
          />
        ) : null}
        {error ? <div className="perm-reason-error">{error}</div> : null}
        <div className="perm-reason-actions">
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || !reason}
            onClick={() => onConfirm(reason)}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
