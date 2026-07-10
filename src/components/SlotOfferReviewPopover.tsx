import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';

type Props = {
  appt: Appointment;
  practiceTz: string;
  clientLabel?: string | null;
  confirming?: boolean;
  error?: string | null;
  onBack: () => void;
  onReviewed: () => void;
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

export default function SlotOfferReviewPopover({
  appt,
  practiceTz,
  clientLabel,
  confirming = false,
  error,
  onBack,
  onReviewed,
}: Props) {
  const typeLabel = appointmentTypeLabel(appt);
  const visitRange = formatVisitRange(appt, practiceTz);

  return (
    <div
      className="scheduler-edit-preview-popover scheduler-edit-preview-popover--staff-confirm"
      role="dialog"
      aria-label="Review appointment"
      data-slot-offer-review-popover
    >
      <div className="scheduler-edit-preview-popover-head">
        <strong className="scheduler-edit-preview-popover-title">Review appointment</strong>
      </div>

      <div className="scheduler-edit-preview-popover-scroll">
        {clientLabel?.trim() ? (
          <div className="scheduler-edit-preview-popover-client">
            <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--strong">
              {clientLabel.trim()}
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

        <div className="scheduler-edit-preview-popover-body">
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
            Verify this visit on the calendar. When it looks correct, mark it reviewed to move the
            offer to Booked.
          </p>
          {error ? (
            <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--error">
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="scheduler-edit-preview-popover-actions scheduler-edit-preview-popover-actions--confirm">
        <button type="button" className="btn secondary" disabled={confirming} onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn primary" disabled={confirming} onClick={onReviewed}>
          {confirming ? 'Saving…' : 'Reviewed'}
        </button>
      </div>
    </div>
  );
}
