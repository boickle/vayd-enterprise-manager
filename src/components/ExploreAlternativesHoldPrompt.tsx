import { createPortal } from 'react-dom';
import { useEffect, useState } from 'react';
import type { AppointmentType } from '../api/appointmentSettings';
import '../pages/Scheduler.css';

function holdTypeLabel(t: AppointmentType): string {
  return t.prettyName?.trim() || t.name?.trim() || `Type ${t.id}`;
}

type Props = {
  open: boolean;
  /** Appointment types with isHold = true, offered as conversion targets. */
  holdTypes: AppointmentType[];
  /** The original appointment still needs converting to a hold type. */
  sourceNeedsHold: boolean;
  /** The newly-added alternative still needs converting to a hold type. */
  newNeedsHold: boolean;
  converting?: boolean;
  onConfirm: (holdTypeId: number) => void;
  onDismiss: () => void;
};

/**
 * After "Explore alternatives" books a second appointment, nudge staff to keep BOTH the original
 * and the alternative on hold so the client does not lose either slot. Offers the practice's
 * isHold appointment types as conversion targets.
 */
export default function ExploreAlternativesHoldPrompt({
  open,
  holdTypes,
  sourceNeedsHold,
  newNeedsHold,
  converting = false,
  onConfirm,
  onDismiss,
}: Props) {
  const [selectedTypeId, setSelectedTypeId] = useState<string>('');

  useEffect(() => {
    if (!open) {
      setSelectedTypeId('');
      return;
    }
    if (holdTypes.length > 0) {
      setSelectedTypeId((prev) => prev || String(holdTypes[0].id));
    }
  }, [open, holdTypes]);

  if (!open) return null;

  const bothNeed = sourceNeedsHold && newNeedsHold;
  const whichLabel = bothNeed
    ? 'Neither the original appointment nor the new alternative is a hold type.'
    : newNeedsHold
      ? 'The new alternative is not a hold type.'
      : sourceNeedsHold
        ? 'The original appointment is not a hold type.'
        : '';
  const changeTarget = bothNeed
    ? 'both appointments'
    : newNeedsHold
      ? 'the new appointment'
      : 'the original appointment';
  const canConfirm = !converting && holdTypes.length > 0 && Boolean(selectedTypeId);

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !converting) onDismiss();
      }}
    >
      <div
        className="scheduler-modal explore-alternatives-hold-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="explore-hold-prompt-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Alternatives</p>
            <h2 id="explore-hold-prompt-title">Keep both as holds?</h2>
          </div>
          <button
            type="button"
            className="scheduler-modal-close"
            aria-label="Close"
            disabled={converting}
            onClick={onDismiss}
          >
            ×
          </button>
        </div>

        <div className="scheduler-modal-body">
          <p>
            The client is exploring options without giving up their original slot. Best practice is
            to keep <strong>both</strong> appointments on hold so neither slot is lost while they
            decide. {whichLabel}
          </p>
          {holdTypes.length > 0 ? (
            <label className="scheduler-book-field scheduler-book-field--full">
              <span className="scheduler-book-field-label">Change {changeTarget} to hold type</span>
              <select
                className="scheduler-book-input"
                value={selectedTypeId}
                disabled={converting}
                onChange={(e) => setSelectedTypeId(e.target.value)}
              >
                {holdTypes.map((t) => (
                  <option key={t.id} value={String(t.id)}>
                    {holdTypeLabel(t)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p>No hold appointment types are configured for this practice.</p>
          )}
        </div>

        <div className="scheduler-book-actions explore-alternatives-hold-prompt-actions">
          <button
            type="button"
            className="scheduler-book-btn secondary"
            disabled={converting}
            onClick={onDismiss}
          >
            Keep as-is
          </button>
          <button
            type="button"
            className="scheduler-book-btn primary"
            disabled={!canConfirm}
            onClick={() => {
              const id = Number(selectedTypeId);
              if (Number.isFinite(id) && id > 0) onConfirm(id);
            }}
          >
            {converting
              ? 'Changing…'
              : bothNeed
                ? 'Change both to hold'
                : 'Change to hold'}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
