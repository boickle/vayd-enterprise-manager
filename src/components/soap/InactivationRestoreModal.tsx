import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type {
  InactivationItem,
  InactivationItemKind,
  PatientInactivationRecord,
} from '../../api/patientInactivation';
import {
  closeInactivationRecord,
  inactivationItemKey,
  isRestorable,
  restoreInactivatedItems,
} from '../../utils/inactivationRestore';
import './DeathWrapUpModal.css';

type Props = {
  record: PatientInactivationRecord;
  patientName: string;
  onClose: () => void;
  onDone: (notes: string[]) => void | Promise<void>;
};

const SECTION_TITLES: Record<InactivationItemKind, string> = {
  membership: 'Memberships',
  reminder: 'Reminders',
  prescription: 'Prescription refills',
  autoship: 'Auto-ships',
  mailOrder: 'Pharmacy orders',
  appointment: 'Appointments',
};

const RESTORE_HINTS: Partial<Record<InactivationItemKind, string>> = {
  membership: 'Same membership year; billing restarts at the next regular date. The cancellation charge or refund stays as it was.',
  reminder: 'Shown again on the chart and in outreach',
  prescription: 'Marked as taking again, so refills can be requested',
};

const MANUAL_HINTS: Partial<Record<InactivationItemKind, string>> = {
  autoship: 'Set up a new auto-ship with the client',
  mailOrder: 'Cancellation was sent to the mail team; place a new order if still needed',
  appointment: 'Rebook with the client',
};

const RESTORE_ORDER: InactivationItemKind[] = ['membership', 'reminder', 'prescription'];
const MANUAL_ORDER: InactivationItemKind[] = ['appointment', 'autoship', 'mailOrder'];

function byKind(items: readonly InactivationItem[], kind: InactivationItemKind) {
  return items.filter((item) => item.kind === kind);
}

export default function InactivationRestoreModal({ record, patientName, onClose, onDone }: Props) {
  const [pending, setPending] = useState<InactivationItem[]>(() => record.items.filter(isRestorable));
  const [restoredSoFar, setRestoredSoFar] = useState<InactivationItem[]>([]);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(record.items.filter(isRestorable).map(inactivationItemKey))
  );
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const manual = useMemo(() => record.items.filter((item) => !isRestorable(item)), [record.items]);

  const toggle = (item: InactivationItem) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const key = inactivationItemKey(item);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const finish = async (restored: InactivationItem[], notes: string[]) => {
    await closeInactivationRecord(record.id, restored);
    await onDone(notes);
  };

  const restore = async () => {
    setWorking(true);
    setError(null);
    try {
      const chosen = pending.filter((item) => selected.has(inactivationItemKey(item)));
      const result = await restoreInactivatedItems(chosen);
      const done = [...restoredSoFar, ...result.restored];
      setRestoredSoFar(done);
      const doneKeys = new Set(result.restored.map(inactivationItemKey));
      setPending((prev) => prev.filter((item) => !doneKeys.has(inactivationItemKey(item))));
      if (result.errors.length) {
        setError([...result.errors, ...result.notes].join(' '));
        return;
      }
      await finish(done, result.notes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restore these items.');
    } finally {
      setWorking(false);
    }
  };

  const skip = async () => {
    setWorking(true);
    setError(null);
    try {
      await finish(restoredSoFar, []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close this list.');
    } finally {
      setWorking(false);
    }
  };

  const chosenCount = pending.filter((item) => selected.has(inactivationItemKey(item))).length;

  return createPortal(
    <div className="scheduler-modal-backdrop" onClick={working ? undefined : onClose}>
      <div
        className="scheduler-modal death-wrapup-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="inactivation-restore-title"
      >
        <div className="soap-modal-head">
          <h3 id="inactivation-restore-title">Restore what was stopped?</h3>
          <button
            type="button"
            className="soap-icon-btn"
            onClick={onClose}
            disabled={working}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <p className="death-wrapup-lead">
          {patientName} is active again. When {patientName} was inactivated, these were stopped.
          Untick anything that should stay stopped.
        </p>

        <div className="death-wrapup-pet">
          {RESTORE_ORDER.map((kind) => {
            const rows = byKind(pending, kind);
            if (!rows.length) return null;
            return (
              <section key={kind} className="death-wrapup-section">
                <h4>{SECTION_TITLES[kind]}</h4>
                <ul>
                  {rows.map((item) => (
                    <li key={inactivationItemKey(item)}>
                      <label>
                        <input
                          type="checkbox"
                          checked={selected.has(inactivationItemKey(item))}
                          onChange={() => toggle(item)}
                          disabled={working}
                        />{' '}
                        <strong>{item.label || SECTION_TITLES[kind]}</strong>
                      </label>
                      <span>{RESTORE_HINTS[kind]}</span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}

          {manual.length ? (
            <>
              <h4 className="death-wrapup-pet-name">To redo by hand</h4>
              {MANUAL_ORDER.map((kind) => {
                const rows = byKind(manual, kind);
                if (!rows.length) return null;
                return (
                  <section key={kind} className="death-wrapup-section">
                    <h4>{SECTION_TITLES[kind]}</h4>
                    <ul>
                      {rows.map((item) => (
                        <li key={inactivationItemKey(item)}>
                          <strong>{item.label || SECTION_TITLES[kind]}</strong>
                          <span>{MANUAL_HINTS[kind]}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </>
          ) : null}
        </div>

        {error ? <div className="soap-error">{error}</div> : null}

        <div className="soap-modal-actions death-wrapup-actions">
          <button type="button" className="soap-btn ghost" onClick={() => void skip()} disabled={working}>
            {pending.length ? "Don't restore" : 'Done'}
          </button>
          {pending.length ? (
            <button
              type="button"
              className="soap-btn"
              onClick={() => void restore()}
              disabled={working || chosenCount === 0}
            >
              {working ? 'Working…' : `Restore ${chosenCount} selected`}
            </button>
          ) : null}
        </div>
      </div>
    </div>,
    document.body,
  );
}
