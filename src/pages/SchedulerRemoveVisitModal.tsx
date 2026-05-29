// Remove (cancel) a visit from the scheduler context menu
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { appointmentRemoveRequiresCancellationReason, cancelAppointment } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { patientsForAppointment } from '../utils/schedulerAddPet';
import './Scheduler.css';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

type Props = {
  appt: Appointment;
  practiceId: number | string;
  accentColor: string;
  onClose: () => void;
  onRemoved: (updated: Appointment) => void;
};

export function SchedulerRemoveVisitModal({
  appt,
  practiceId,
  accentColor,
  onClose,
  onRemoved,
}: Props) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsReason = appointmentRemoveRequiresCancellationReason(
    appt as Appointment & Record<string, unknown>
  );

  const clientName = useMemo(() => {
    const c = appt.client;
    if (!c) return '—';
    const fn = pickStr(c.firstName);
    const ln = pickStr(c.lastName);
    return [fn, ln].filter(Boolean).join(' ').trim() || '—';
  }, [appt.client]);

  const patientsLabel = useMemo(() => {
    const multi = patientsForAppointment(appt);
    if (multi.length > 0) return multi.map((p) => pickStr(p.name) ?? '—').join(', ');
    return '—';
  }, [appt]);

  const runRemove = async (cancellationReason?: string | null) => {
    const trimmed = cancellationReason?.trim();
    if (needsReason && !trimmed) {
      setError('Enter a reason for removing this visit.');
      return;
    }
    if (appt.id == null || !Number.isFinite(Number(appt.id)) || Number(appt.id) <= 0) {
      setError('This visit cannot be removed from the calendar.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const updated = await cancelAppointment(
        appt.id,
        { cancellationFlag: true, cancellationReason: trimmed ?? null },
        { practiceId, appt }
      );
      onRemoved(updated);
      onClose();
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const m = ax?.response?.data?.message;
      if (Array.isArray(m)) setError(m.join(', '));
      else if (typeof m === 'string' && m.trim()) setError(m);
      else if (ax?.message) setError(ax.message);
      else setError('Could not remove this visit.');
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveWithReason = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      setError('Enter a reason for removing this visit.');
      return;
    }
    await runRemove(trimmed);
  };

  const modal = (
    <div
      className="scheduler-modal-backdrop scheduler-modal-backdrop--remove-visit"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <div
        className={`scheduler-modal scheduler-modal--edit scheduler-modal--remove-visit${needsReason ? '' : ' scheduler-modal--remove-visit-confirm'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="scheduler-remove-visit-title"
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ['--scheduler-accent' as string]: accentColor }}
      >
        <div className="scheduler-modal-accent" aria-hidden />
        {needsReason ? (
          <>
            <div className="scheduler-modal-header">
              <div className="scheduler-modal-header-text">
                <p className="scheduler-modal-eyebrow">Visit</p>
                <h2 id="scheduler-remove-visit-title">Remove Visit</h2>
                <p className="scheduler-modal-subtitle">
                  {clientName}
                  <span className="scheduler-modal-subtitle-sep">·</span>
                  {patientsLabel}
                </p>
              </div>
              <button
                type="button"
                className="scheduler-modal-close"
                aria-label="Close"
                disabled={saving}
                onClick={onClose}
              >
                ×
              </button>
            </div>

            <div className="scheduler-modal-body scheduler-modal-body--edit">
              {error ? <p className="scheduler-edit-error">{error}</p> : null}
              <p className="scheduler-modal-muted">
                This visit will be marked cancelled. Enter why it is being removed.
              </p>
              <label className="scheduler-edit-field scheduler-remove-visit-reason">
                <span>Reason (required)</span>
                <textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  disabled={saving}
                  placeholder="e.g. Client cancelled, pet passed away, booked in error…"
                />
              </label>
            </div>

            <div className="scheduler-edit-footer">
              <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="btn"
                disabled={saving}
                onClick={() => void handleRemoveWithReason()}
              >
                {saving ? 'Removing…' : 'Remove Visit'}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="scheduler-remove-visit-confirm-body">
              {error ? <p className="scheduler-edit-error">{error}</p> : null}
              <h2 id="scheduler-remove-visit-title" className="scheduler-remove-visit-confirm-title">
                Remove Visit?
              </h2>
            </div>
            <div className="scheduler-edit-footer">
              <button type="button" className="btn secondary" disabled={saving} onClick={onClose}>
                Cancel
              </button>
              <button type="button" className="btn" disabled={saving} onClick={() => void runRemove()}>
                {saving ? 'Removing…' : 'Remove Visit'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
