import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';

type Props = {
  appt: Appointment;
  practiceTz: string;
  clientLabel?: string | null;
  multiHold?: boolean;
  confirming?: boolean;
  error?: string | null;
  onBack: () => void;
  onRemove: (reason: string) => void | Promise<void>;
};

function formatVisitRange(appt: Appointment, practiceTz: string): string {
  const startIso = appt.appointmentStart;
  const endIso = appt.appointmentEnd;
  if (!startIso) return '—';
  let start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  let end = endIso ? DateTime.fromISO(endIso, { zone: 'utc' }).setZone(practiceTz) : null;
  if (!start.isValid) start = DateTime.fromISO(startIso, { setZone: true }).setZone(practiceTz);
  if (end && !end.isValid) end = DateTime.fromISO(endIso!, { setZone: true }).setZone(practiceTz);
  if (!start.isValid) return '—';
  const datePart = start.toFormat('ccc LLL d · t');
  if (end?.isValid) return `${datePart} – ${end.toFormat('t')}`;
  return datePart;
}

function appointmentTypeLabel(appt: Appointment): string | null {
  return (
    appt.appointmentType?.prettyName?.trim() ||
    appt.appointmentType?.name?.trim() ||
    null
  );
}

export default function OnHoldVisitRemovePopover({
  appt,
  practiceTz,
  clientLabel,
  multiHold = false,
  confirming = false,
  error,
  onBack,
  onRemove,
}: Props) {
  const [step, setStep] = useState<'confirm' | 'reason'>('confirm');
  const [reason, setReason] = useState('');

  const typeLabel = appointmentTypeLabel(appt);
  const visitRange = formatVisitRange(appt, practiceTz);
  const displayClient = clientLabel?.trim();

  const handleRemoveClick = () => {
    setStep('reason');
  };

  const handleSubmitReason = () => {
    const trimmed = reason.trim();
    if (!trimmed || confirming) return;
    void onRemove(trimmed);
  };

  return (
    <div
      className="scheduler-edit-preview-popover scheduler-edit-preview-popover--staff-confirm"
      role="dialog"
      aria-label="Remove hold"
      data-on-hold-visit-remove-popover
    >
      <div className="scheduler-edit-preview-popover-head">
        <strong className="scheduler-edit-preview-popover-title">Remove hold</strong>
      </div>

      <div className="scheduler-edit-preview-popover-scroll">
        {displayClient ? (
          <div className="scheduler-edit-preview-popover-client">
            <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--strong">
              {displayClient}
            </p>
          </div>
        ) : null}

        <div className="scheduler-edit-preview-popover-change">
          {typeLabel ? (
            <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
              {typeLabel}
            </p>
          ) : null}
          <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
            {visitRange}
          </p>
        </div>

        {step === 'confirm' ? (
          <div className="scheduler-edit-preview-popover-body">
            <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
              {multiHold
                ? 'This will cancel every hold in this visit window on the calendar. Go back to return to Holds, or remove to continue.'
                : 'This will cancel this hold on the calendar. Go back to return to Holds, or remove to continue.'}
            </p>
          </div>
        ) : (
          <div className="scheduler-edit-preview-popover-body">
            <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
              Enter why this hold is being removed.
            </p>
            <label className="scheduler-edit-preview-popover-reason">
              <span className="scheduler-edit-preview-popover-reason-label">Reason (required)</span>
              <textarea
                rows={3}
                value={reason}
                disabled={confirming}
                placeholder="e.g. Client cancelled, booked in error…"
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            {error ? (
              <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--error">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </div>

      <div className="scheduler-edit-preview-popover-actions scheduler-edit-preview-popover-actions--confirm">
        {step === 'confirm' ? (
          <>
            <button type="button" className="btn secondary" disabled={confirming} onClick={onBack}>
              Back
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={confirming}
              style={{ background: '#b91c1c', borderColor: '#b91c1c' }}
              onClick={handleRemoveClick}
            >
              Remove
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn secondary"
              disabled={confirming}
              onClick={() => {
                setStep('confirm');
                setReason('');
              }}
            >
              Back
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={confirming || !reason.trim()}
              style={{ background: '#b91c1c', borderColor: '#b91c1c' }}
              onClick={handleSubmitReason}
            >
              {confirming ? 'Removing…' : 'Remove hold'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
