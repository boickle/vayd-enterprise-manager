// src/permissions/ReasonPrompt.tsx
// Reason capture for high-stakes actions (void, reprice, release a colleague's
// lab result). The permission says *who* may act; the reason says *why* they
// did, which is the part a practice actually reviews later.
import { useEffect, useState } from 'react';
import './PermissionGate.css';

export type ReasonPromptProps = {
  open: boolean;
  /** Short verb phrase, e.g. "Void invoice #10482". */
  title: string;
  /** One line on what the reason is for — it appears in the audit log. */
  note?: string;
  /** Common answers, offered as chips so the log stays comparable. */
  presets?: string[];
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
};

const MIN_REASON_LENGTH = 4;

export function ReasonPrompt({
  open,
  title,
  note = 'Recorded in the permission audit log with your name and the time.',
  presets,
  confirmLabel = 'Confirm',
  busy = false,
  error = null,
  onConfirm,
  onCancel,
}: ReasonPromptProps) {
  const [reason, setReason] = useState('');

  useEffect(() => {
    if (open) setReason('');
  }, [open]);

  if (!open) return null;

  const trimmed = reason.trim();
  const tooShort = trimmed.length < MIN_REASON_LENGTH;

  return (
    <div
      className="perm-reason-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="perm-reason-modal" role="dialog" aria-modal="true">
        <div className="perm-reason-title">{title}</div>
        <div className="perm-reason-note">{note}</div>
        {presets && presets.length > 0 && (
          <div className="perm-reason-presets">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`perm-reason-preset${trimmed === preset ? ' is-selected' : ''}`}
                onClick={() => setReason(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        )}
        <textarea
          value={reason}
          autoFocus
          placeholder="Reason"
          onChange={(e) => setReason(e.target.value)}
        />
        {error && <div className="perm-reason-error">{error}</div>}
        <div className="perm-reason-actions">
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || tooShort}
            onClick={() => onConfirm(trimmed)}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
