import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import type { HouseholdHoldExitKind } from '../utils/appointmentRequestHouseholdHold';

type Props = {
  appt: Appointment;
  practiceTz: string;
  clientLabel?: string | null;
  linkedClientLabel?: string | null;
  exitKind: Extract<HouseholdHoldExitKind, 'booked' | 'removed'>;
  onBack: () => void;
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

export default function OnHoldVisitConvertedPopover({
  appt,
  practiceTz,
  clientLabel,
  linkedClientLabel,
  exitKind,
  onBack,
}: Props) {
  const typeLabel = appointmentTypeLabel(appt);
  const visitRange = formatVisitRange(appt, practiceTz);
  const displayClient = clientLabel?.trim() || linkedClientLabel?.trim();
  const title = exitKind === 'booked' ? 'Appointment booked' : 'Hold removed';
  const body =
    exitKind === 'booked'
      ? 'This hold is now a standard appointment on the calendar. When you are ready, go back to On hold to finish.'
      : 'This calendar hold was removed. When you are ready, go back to On hold to finish.';

  return (
    <div
      className="scheduler-edit-preview-popover scheduler-edit-preview-popover--staff-confirm scheduler-edit-preview-popover--hold-converted"
      role="dialog"
      aria-label={title}
    >
      <div className="scheduler-edit-preview-popover-head">
        <strong className="scheduler-edit-preview-popover-title">{title}</strong>
      </div>

      <div className="scheduler-edit-preview-popover-scroll">
        {displayClient ? (
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--strong">
            {displayClient}
          </p>
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
            {body}
          </p>
        </div>
      </div>

      <div className="scheduler-edit-preview-popover-actions scheduler-edit-preview-popover-actions--confirm">
        <button type="button" className="btn primary" onClick={onBack}>
          Back to On hold
        </button>
      </div>
    </div>
  );
}
