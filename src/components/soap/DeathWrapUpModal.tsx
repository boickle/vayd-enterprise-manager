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
import {
  INACTIVATION_REASON_OPTIONS,
  type PatientInactivationReason,
} from '../../api/patients';
import { practiceTimeZoneOrDefault } from '../../utils/practiceTimezone';
import './DeathWrapUpModal.css';

type Props = {
  previews: DeathWrapUpPreview[];
  kind?: DeathWrapUpKind;
  title?: string;
  lead?: string;
  acceptLabel?: string;
  practiceId?: number;
  /**
   * Staff must pick why the pet is leaving (D4). Defaults to on for `kind="inactivate"`.
   * End Visit after euthanasia already knows the reason and turns it off.
   */
  reasonRequired?: boolean;
  onClose: () => void;
  onAccepted: (reason?: PatientInactivationReason) => void | Promise<void>;
};

function reminderLabel(description: string | null | undefined, dueDate?: string | null): string {
  const name = description?.trim() || 'Reminder';
  if (!dueDate) return name;
  const d = new Date(dueDate);
  if (Number.isNaN(d.getTime())) return name;
  return `${name} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function shortDate(iso: string | null | undefined, withTime = false): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-US', {
    timeZone: practiceTimeZoneOrDefault(undefined),
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

/** "Expiring 1 text offer", plus the shared ones the pet is only taken off. */
function closeHeading(
  label: { one: string; many: string },
  closeVerb: string,
  closing: number,
  sharedCount: number,
  petName: string,
): string {
  const parts: string[] = [];
  if (closing > 0) parts.push(`${closeVerb} ${plural(closing, label.one, label.many)}`);
  if (sharedCount > 0) {
    parts.push(`Taking ${petName} off ${plural(sharedCount, `shared ${label.one}`, `shared ${label.many}`)}`);
  }
  if (parts.length) return parts.join(' · ');
  return label.many.charAt(0).toUpperCase() + label.many.slice(1);
}

function defaultTitle(kind: DeathWrapUpKind, many: boolean): string {
  if (kind === 'invoice') return 'After this invoice';
  return many ? 'Inactivating these patients' : 'Inactivating this patient';
}

function defaultLead(kind: DeathWrapUpKind, previews: DeathWrapUpPreview[]): string {
  const names = previews.map((p) => p.patientName).join(', ');
  if (kind === 'invoice') {
    const memberships = previews.flatMap((p) =>
      p.memberships.map((m) => p.moneyOnVisitMembershipIds.includes(m.membershipId)),
    );
    const allOnInvoice = memberships.length > 0 && memberships.every(Boolean);
    return allOnInvoice
      ? `Because ${names} has passed, Accept will cancel the items below. Membership money is already on this invoice, so it is not charged or refunded a second time.`
      : `Because ${names} has passed, Accept will cancel the items below.`;
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
  const heading = (count: number, action: string, label: string) =>
    count > 0 ? `${action} the following ${label}` : label.charAt(0).toUpperCase() + label.slice(1);

  return (
    <div className="death-wrapup-pet">
      {showName ? <h3 className="death-wrapup-pet-name">{preview.patientName}</h3> : null}

      <section className="death-wrapup-section">
        <h4>{heading(preview.memberships.length, 'Cancelling', 'memberships')}</h4>
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
        <h4>{heading(preview.autoships.length, 'Cancelling', 'auto-ships')}</h4>
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
        <h4>{heading(preview.reminders.length, 'Removing', 'reminders')}</h4>
        {preview.reminders.length === 0 ? (
          <p className="death-wrapup-empty">None to remove</p>
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
        <h4>{heading(preview.prescriptions.length, 'Stopping', 'prescription refills')}</h4>
        {preview.prescriptions.length === 0 ? (
          <p className="death-wrapup-empty">None to stop</p>
        ) : (
          <ul>
            {preview.prescriptions.map((row) => (
              <li key={row.id}>
                <strong>{[row.name, row.strength].filter(Boolean).join(' ')}</strong>
                <span>Marked no longer taking, so no refills</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="death-wrapup-section">
        <h4>{heading(preview.mailOrders.length, 'Cancelling', 'pharmacy orders')}</h4>
        {preview.mailOrders.length === 0 ? (
          <p className="death-wrapup-empty">None to cancel</p>
        ) : (
          <ul>
            {preview.mailOrders.map((row) => (
              <li key={row.id}>
                <strong>
                  Order #{row.id}
                  {row.lines?.length
                    ? ` · ${row.lines.map((line) => line.name).filter(Boolean).join(', ')}`
                    : ''}
                </strong>
                <span>The mail team is asked to cancel it and refund anything paid</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <SchedulingSections preview={preview} />

      <section className="death-wrapup-section">
        <h4>{heading(preview.futureAppointments.length, 'Cancelling', 'appointments')}</h4>
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

/** SCH-08 (D5): follow-ups, text offers and waitlist rows. The server closes them on inactivation. */
function SchedulingSections({ preview }: { preview: DeathWrapUpPreview }) {
  const followUps = preview.followUps ?? [];
  const offers = preview.textOffers ?? [];
  const waitlist = preview.waitlist ?? [];
  const expiring = offers.filter((row) => row.action === 'expire').length;
  const removing = waitlist.filter((row) => row.action === 'remove').length;
  const others = (names: string[]) => names.join(', ');
  return (
    <>
      <section className="death-wrapup-section">
        <h4>
          {followUps.length > 0
            ? `Removing ${plural(followUps.length, 'follow-up', 'follow-ups')}`
            : 'Follow-ups'}
        </h4>
        {followUps.length === 0 ? (
          <p className="death-wrapup-empty">None to remove</p>
        ) : (
          <ul>
            {followUps.map((row) => (
              <li key={row.id}>
                <strong>{row.appointmentTypeName?.trim() || 'Follow-up'}</strong>
                <span>
                  {[shortDate(row.targetDueDate) && `Due ${shortDate(row.targetDueDate)}`, 'Taken off the follow-up queue']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="death-wrapup-section">
        <h4>
          {closeHeading(
            { one: 'text offer', many: 'text offers' },
            'Expiring',
            expiring,
            offers.length - expiring,
            preview.patientName,
          )}
        </h4>
        {offers.length === 0 ? (
          <p className="death-wrapup-empty">None to expire</p>
        ) : (
          <ul>
            {offers.map((row) => (
              <li key={row.id}>
                <strong>
                  {[row.appointmentTypeName?.trim() || 'Visit', shortDate(row.offeredSlotDatetime, true)]
                    .filter(Boolean)
                    .join(' · ')}
                </strong>
                <span>
                  {row.action === 'expire'
                    ? 'The link stops working'
                    : `Stays open for ${others(row.otherPetNames)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="death-wrapup-section">
        <h4>
          {closeHeading(
            { one: 'waitlist entry', many: 'waitlist entries' },
            'Removing',
            removing,
            waitlist.length - removing,
            preview.patientName,
          )}
        </h4>
        {waitlist.length === 0 ? (
          <p className="death-wrapup-empty">None to remove</p>
        ) : (
          <ul>
            {waitlist.map((row) => (
              <li key={row.id}>
                <strong>{row.appointmentTypeName?.trim() || 'Waitlist'}</strong>
                <span>
                  {row.action === 'remove'
                    ? 'Taken off the waitlist'
                    : `Stays on the waitlist for ${others(row.otherPetNames)}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

export default function DeathWrapUpModal({
  previews,
  kind = 'invoice',
  title,
  lead,
  acceptLabel,
  practiceId = VISIT_WORKFLOW_PRACTICE_ID,
  reasonRequired,
  onClose,
  onAccepted,
}: Props) {
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<PatientInactivationReason | ''>('');
  const many = previews.length > 1;
  const needsReason = reasonRequired ?? kind === 'inactivate';
  const blockedByReason = needsReason && !reason;

  const accept = async () => {
    if (blockedByReason) return;
    setAccepting(true);
    setError(null);
    try {
      const result = await acceptDeathWrapUpHousehold(previews, { practiceId, kind });
      if (result.errors.length) {
        setError(result.errors.join(' '));
        return;
      }
      await onAccepted(needsReason ? (reason as PatientInactivationReason) : undefined);
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

        {needsReason ? (
          <label className="death-wrapup-reason">
            <span>Reason for inactivating</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as PatientInactivationReason | '')}
              disabled={accepting}
              aria-label="Reason for inactivating"
            >
              <option value="">Choose a reason…</option>
              {INACTIVATION_REASON_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {previews.map((preview) => (
          <PetActions
            key={preview.patientId}
            preview={preview}
            kind={kind}
            showName={many}
          />
        ))}

        {error ? <div className="soap-error">{error}</div> : null}
        {blockedByReason ? (
          <p className="death-wrapup-hint">Choose a reason to continue.</p>
        ) : null}

        <div className="soap-modal-actions death-wrapup-actions">
          <button type="button" className="soap-btn ghost" onClick={onClose} disabled={accepting}>
            Cancel
          </button>
          <button
            type="button"
            className="soap-btn"
            onClick={() => void accept()}
            disabled={accepting || blockedByReason}
          >
            {accepting ? 'Working…' : acceptLabel ?? 'Accept'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
