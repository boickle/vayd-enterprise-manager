import type {
  StaffConfirmBookingBreakdown,
  StaffConfirmDurationBreakdown,
} from '../utils/appointmentRequestStaffConfirmRecommendedLength';
import {
  formatStaffConfirmBookedMathLine,
  formatStaffConfirmClientStatusLine,
  formatStaffConfirmHoldSchedulingNote,
  formatStaffConfirmNewPatientBufferDetailLine,
  formatStaffConfirmPetBreakdownLine,
  formatStaffConfirmSlotDifferenceLine,
  formatStaffConfirmVisitTimeTotalLine,
} from '../utils/appointmentRequestStaffConfirmRecommendedLength';

type Props = {
  breakdown: StaffConfirmBookingBreakdown;
};

function DurationBreakdownBlock({
  section,
  duration,
  subtitle,
}: {
  section: StaffConfirmDurationBreakdown;
  duration: StaffConfirmDurationBreakdown;
  subtitle?: string;
}) {
  const bufferLine = formatStaffConfirmNewPatientBufferDetailLine(duration);
  const mathLine = formatStaffConfirmBookedMathLine(duration);

  return (
    <div className="scheduler-staff-confirm-booking-breakdown-section">
      {subtitle ? (
        <p className="scheduler-staff-confirm-booking-breakdown-subtitle">{subtitle}</p>
      ) : null}
      {section.typesLabel ? (
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          {section.typesLabel}
        </p>
      ) : null}
      <p className="scheduler-staff-confirm-booking-breakdown-client">
        {formatStaffConfirmClientStatusLine(section)}
      </p>
      {section.pets.length > 0 ? (
        <ul className="scheduler-staff-confirm-booking-breakdown-pets">
          {section.pets.map((pet) => (
            <li key={pet.key}>{formatStaffConfirmPetBreakdownLine(pet)}</li>
          ))}
        </ul>
      ) : null}
      <p className="scheduler-staff-confirm-booking-breakdown-line">
        {formatStaffConfirmVisitTimeTotalLine(duration)}
      </p>
      {bufferLine ? (
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          {bufferLine}
        </p>
      ) : null}
      {mathLine ? (
        <p className="scheduler-staff-confirm-booking-breakdown-total">{mathLine}</p>
      ) : null}
    </div>
  );
}

export function StaffConfirmBookingBreakdownSection({ breakdown }: Props) {
  const holdNote = formatStaffConfirmHoldSchedulingNote(breakdown);
  const differenceLine = formatStaffConfirmSlotDifferenceLine(breakdown);
  const { original, recommended, bookedSlotMinutes } = breakdown;
  const slotMinutes =
    bookedSlotMinutes > 0 ? bookedSlotMinutes : original.bookedMinutes;

  if (recommended) {
    return (
      <div className="scheduler-staff-confirm-booking-breakdown">
        <p className="scheduler-staff-confirm-booking-breakdown-title">
          Why this slot is {slotMinutes} minutes
        </p>
        {holdNote ? (
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
            {holdNote}
          </p>
        ) : null}
        <DurationBreakdownBlock
          section={original}
          duration={original}
          subtitle="Original booking"
        />
        <DurationBreakdownBlock
          section={recommended}
          duration={recommended}
          subtitle={
            recommended.usesRequestedTypes
              ? 'Recommended for requested types'
              : 'Recommended for current types'
          }
        />
        {differenceLine ? (
          <p className="scheduler-staff-confirm-booking-breakdown-difference">{differenceLine}</p>
        ) : null}
      </div>
    );
  }

  const mathLine = formatStaffConfirmBookedMathLine(original);
  const bufferLine = formatStaffConfirmNewPatientBufferDetailLine(original);

  return (
    <div className="scheduler-staff-confirm-booking-breakdown">
      <p className="scheduler-staff-confirm-booking-breakdown-title">
        Why this slot is {slotMinutes} minutes
      </p>
      {holdNote ? (
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          {holdNote}
        </p>
      ) : null}
      <p className="scheduler-staff-confirm-booking-breakdown-client">
        {formatStaffConfirmClientStatusLine(original)}
      </p>
      {original.pets.length > 0 ? (
        <ul className="scheduler-staff-confirm-booking-breakdown-pets">
          {original.pets.map((pet) => (
            <li key={pet.key}>{formatStaffConfirmPetBreakdownLine(pet)}</li>
          ))}
        </ul>
      ) : null}
      <p className="scheduler-staff-confirm-booking-breakdown-line">
        {formatStaffConfirmVisitTimeTotalLine(original)}
      </p>
      {bufferLine ? (
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          {bufferLine}
        </p>
      ) : null}
      {mathLine ? (
        <p className="scheduler-staff-confirm-booking-breakdown-total">{mathLine}</p>
      ) : null}
    </div>
  );
}
