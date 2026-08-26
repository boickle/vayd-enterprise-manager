import { DateTime } from 'luxon';
import type { CSSProperties } from 'react';
import type { Appointment } from '../api/roomLoader';

type Props = {
  appt: Appointment;
  practiceTz: string;
  clientLabel?: string | null;
  dialogStyle?: CSSProperties;
  onBack: () => void;
  onRemove: () => void;
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

export function NotBookedRemoveVisitGateModal({
  appt,
  practiceTz,
  clientLabel,
  dialogStyle,
  onBack,
  onRemove,
}: Props) {
  const typeLabel = appointmentTypeLabel(appt);
  const visitRange = formatVisitRange(appt, practiceTz);

  return (
    <div
      className="scheduler-not-booked-gate-dialog scheduler-modal scheduler-modal--edit"
      role="dialog"
      aria-modal="true"
      aria-labelledby="not-booked-remove-gate-title"
      style={dialogStyle}
    >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">Appointment request</p>
            <h2 id="not-booked-remove-gate-title">Remove calendar visit first</h2>
            {clientLabel?.trim() ? (
              <p className="scheduler-modal-subtitle">{clientLabel.trim()}</p>
            ) : null}
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" onClick={onBack}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body scheduler-modal-body--edit">
          <p className="scheduler-modal-muted">
            This request still has a visit on the calendar. Remove it before marking the request as
            not booked.
          </p>
          <div className="scheduler-edit-preview-popover-change" style={{ marginTop: 12 }}>
            {typeLabel ? (
              <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
                {typeLabel}
              </p>
            ) : null}
            <p className="scheduler-edit-preview-popover-change-line scheduler-edit-preview-popover-change-line--now">
              {visitRange}
            </p>
          </div>
        </div>

        <div className="scheduler-edit-footer">
          <button type="button" className="btn secondary" onClick={onBack}>
            Back
          </button>
          <button type="button" className="btn" onClick={onRemove}>
            Remove visit
          </button>
        </div>
    </div>
  );
}
