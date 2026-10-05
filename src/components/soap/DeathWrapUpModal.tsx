import { useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  acceptDeathWrapUpHousehold,
  membershipCancelMoneyLabel,
  type DeathWrapUpKind,
  type DeathWrapUpPreview,
} from '../../utils/deathWrapUp';
import { VISIT_WORKFLOW_PRACTICE_ID } from '../../api/visitWorkflow';
import './DeathWrapUpModal.css';

type Props = {
  previews: DeathWrapUpPreview[];
  kind?: DeathWrapUpKind;
  title?: string;
  lead?: string;
  acceptLabel?: string;
  practiceId?: number;
  onClose: () => void;
  onAccepted: () => void | Promise<void>;
};

function reminderLabel(description: string | null | undefined, dueDate?: string | null): string {
  const name = description?.trim() || 'Reminder';
  if (!dueDate) return name;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return name;
  return `${name} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function defaultTitle(kind: DeathWrapUpKind, many: boolean): string {
  if (kind === 'invoice') return 'After this invoice';
  return many ? 'Inactivating these patients' : 'Inactivating this patient';
}

function defaultLead(kind: DeathWrapUpKind, previews: DeathWrapUpPreview[]): string {
  const names = previews.map((p) => p.patientName).join(', ');
  if (kind === 'invoice') {
    return `Because ${names} has passed, Accept will cancel the items below. Membership money is already on this invoice and was captured with the authorization — it will not be charged or refunded a second time.`;
  }
  if (previews.length > 1) {
    return `Inactivating this client will also inactivate ${names}. Accept will cancel the items below for every pet, then inactivate them.`;
  }
  return `If you inactivate ${names}, Accept will cancel the items below.`;
}

function PetActions({
  preview,
  kind,
  showName,
}: {
  preview: DeathWrapUpPreview;
  kind: DeathWrapUpKind;
  showName: boolean;
}) {
  return (
    <div className="death-wrapup-pet">
      {showName ? <h3 className="death-wrapup-pet-name">{preview.patientName}</h3> : null}

      <section className="death-wrapup-section">
        <h4>Memberships</h4>
        {preview.memberships.length === 0 ? (
          <p className="death-wrapup-empty">None to cancel</p>
        ) : (
          <ul>
            {preview.memberships.map((row) => (
              <li key={row.membershipId}>
                <strong>{row.planName}</strong>
                <span>{membershipCancelMoneyLabel(row, kind, preview)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="death-wrapup-section">
        <h4>Auto-ships</h4>
        {preview.autoships.length === 0 ? (
          <p className="death-wrapup-empty">None to cancel</p>
        ) : (
          <ul>
            {preview.autoships.map((row) => (
              <li key={row.id}>
                <strong>{row.itemName?.trim() || 'Auto-ship'}</strong>
                <span>{row.frequency}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="death-wrapup-section">
        <h4>Reminders</h4>
        {preview.reminders.length === 0 ? (
          <p className="death-wrapup-empty">None to cancel</p>
        ) : (
          <ul>
            {preview.reminders.map((row) => (
              <li key={row.id}>
                <strong>{reminderLabel(row.description, row.dueDate)}</strong>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="death-wrapup-section">
        <h4>Future appointments</h4>
        {preview.futureAppointments.length === 0 ? (
          <p className="death-wrapup-empty">None to cancel</p>
        ) : (
          <ul>
            {preview.futureAppointments.map((row) => (
              <li key={row.appointmentId}>
                <strong>{row.appointmentTypeLabel}</strong>
                <span>{row.scheduledLabel}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function DeathWrapUpModal({
  previews,
  kind = 'invoice',
  title,
  lead,
  acceptLabel,
  practiceId = VISIT_WORKFLOW_PRACTICE_ID,
  onClose,
  onAccepted,
}: Props) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const many = previews.length > 1;

  const accept = async () => {
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptDeathWrapUpHousehold(previews, { practiceId, kind });
      if (result.errors.length) {
        setError(result.errors.join(' '));
        return;
      }
      await onAccepted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not finish these cancellations.');
    } finally {
      setAccepting(false);
    }
  };

  return createPortal(
    <div className="scheduler-modal-backdrop" onClick={accepting ? undefined : onClose}>
      <div
        className="scheduler-modal death-wrapup-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="death-wrapup-title"
      >
        <div className="soap-modal-head">
          <h3 id="death-wrapup-title">{title ?? defaultTitle(kind, many)}</h3>
          <button
            type="button"
            className="soap-icon-btn"
            onClick={onClose}
            disabled={accepting}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <p className="death-wrapup-lead">{lead ?? defaultLead(kind, previews)}</p>

        {previews.map((preview) => (
          <PetActions
            key={preview.patientId}
            preview={preview}
            kind={kind}
            showName={many}
          />
        ))}

        {error ? <div className="soap-error">{error}</div> : null}

        <div className="soap-modal-actions death-wrapup-actions">
          <button type="button" className="soap-btn ghost" onClick={onClose} disabled={accepting}>
            Cancel
          </button>
          <button type="button" className="soap-btn" onClick={() => void accept()} disabled={accepting}>
            {accepting ? 'Working…' : acceptLabel ?? 'Accept'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
