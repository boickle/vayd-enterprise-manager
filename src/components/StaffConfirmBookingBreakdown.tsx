import { DateTime } from 'luxon';
import type {
  StaffConfirmBookingBreakdown,
  StaffConfirmBookingBreakdownPet,
  StaffConfirmDurationBreakdown,
} from '../utils/appointmentRequestStaffConfirmRecommendedLength';
import {
  formatStaffConfirmPerPetTotalLine,
  formatStaffConfirmPetDurationLine,
  formatStaffConfirmPetTypeDurationLine,
  formatStaffConfirmPetTypeTotalLine,
  staffConfirmPetTypeBaseTotalMinutes,
} from '../utils/appointmentRequestStaffConfirmRecommendedLength';

type Props = {
  breakdown: StaffConfirmBookingBreakdown;
  originalSubtitle?: string;
  /** Visit start (ISO) used to show a proposed ideal end time for current types. */
  visitStartIso?: string | null;
  /** Timezone for rendering the proposed end time. */
  practiceTz?: string;
};

function formatIdealEndTime(
  visitStartIso: string | null | undefined,
  totalMinutes: number | null,
  practiceTz: string | undefined,
  bookedSlotMinutes: number,
): string | null {
  if (!visitStartIso || totalMinutes == null || totalMinutes <= 0) return null;
  const zone = practiceTz || 'local';
  let start = DateTime.fromISO(visitStartIso, { zone: 'utc' }).setZone(zone);
  if (!start.isValid) start = DateTime.fromISO(visitStartIso, { setZone: true }).setZone(zone);
  if (!start.isValid) return null;
  const end = start.plus({ minutes: totalMinutes });
  const endLabel = `Ideal end time: ${end.toFormat('t')}`;

  // Compare against the predicted (booked) slot length so staff can see how much
  // the ideal visit under/over-runs the block that was reserved.
  if (bookedSlotMinutes > 0) {
    const diff = bookedSlotMinutes - totalMinutes;
    if (diff > 0) return `${endLabel} — ${diff} minutes earlier than predicted`;
    if (diff < 0) return `${endLabel} — ${Math.abs(diff)} minutes later than predicted`;
    return `${endLabel} — same as predicted`;
  }
  return `${endLabel} (${totalMinutes} min)`;
}

function currentAppointmentTypesDiffer(
  original: StaffConfirmDurationBreakdown,
  recommended: StaffConfirmDurationBreakdown,
): boolean {
  if (recommended.typesLabel && original.typesLabel && recommended.typesLabel !== original.typesLabel) {
    return true;
  }
  if (recommended.pets.length !== original.pets.length) return true;
  return recommended.pets.some((pet, index) => {
    const other = original.pets[index];
    return (
      pet.appointmentType.trim() !== (other?.appointmentType.trim() ?? '') ||
      pet.name.trim() !== (other?.name.trim() ?? '')
    );
  });
}

function isHoldTypeLabel(label: string | null | undefined): boolean {
  const value = (label ?? '').trim().toLowerCase();
  return value === 'hold' || value.includes('hold for') || value.includes('hold');
}

function CurrentAppointmentTypesBlock({
  section,
  visitStartIso,
  practiceTz,
  bookedSlotMinutes,
}: {
  section: StaffConfirmDurationBreakdown;
  visitStartIso?: string | null;
  practiceTz?: string;
  bookedSlotMinutes: number;
}) {
  if (section.calendarStillHold) {
    return (
      <div className="scheduler-staff-confirm-booking-breakdown-section">
        <p className="scheduler-staff-confirm-booking-breakdown-subtitle">
          Current appointment types
        </p>
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          Pending new selections
        </p>
      </div>
    );
  }

  // A single pet still on HOLD makes the total meaningless — hold its placeholder
  // block time out of the math until staff pick a real appointment type.
  const hasHoldPet = section.pets.some((pet) => isHoldTypeLabel(pet.appointmentType));

  const totalLine = hasHoldPet ? null : formatStaffConfirmPetTypeTotalLine(section);
  const idealEndLine = hasHoldPet
    ? null
    : formatIdealEndTime(
        visitStartIso,
        staffConfirmPetTypeBaseTotalMinutes(section),
        practiceTz,
        bookedSlotMinutes,
      );

  return (
    <div className="scheduler-staff-confirm-booking-breakdown-section">
      <p className="scheduler-staff-confirm-booking-breakdown-subtitle">
        Current appointment types
      </p>
      {section.pets.length > 0 ? (
        <ul className="scheduler-staff-confirm-booking-breakdown-pets">
          {section.pets.map((pet: StaffConfirmBookingBreakdownPet) => (
            <li key={pet.key}>
              {isHoldTypeLabel(pet.appointmentType)
                ? `${pet.name} — pending appointment type`
                : formatStaffConfirmPetTypeDurationLine(pet)}
            </li>
          ))}
        </ul>
      ) : section.typesLabel ? (
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          {section.typesLabel}
        </p>
      ) : null}
      {hasHoldPet ? (
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          Pending appointment type — total updates once all pets are switched.
        </p>
      ) : null}
      {totalLine ? (
        <p className="scheduler-staff-confirm-booking-breakdown-total">{totalLine}</p>
      ) : null}
      {idealEndLine ? (
        <p className="scheduler-staff-confirm-booking-breakdown-ideal-end">{idealEndLine}</p>
      ) : null}
    </div>
  );
}

function PerPetDurationBlock({
  section,
  subtitle,
}: {
  section: StaffConfirmDurationBreakdown;
  subtitle: string;
}) {
  const totalLine = formatStaffConfirmPerPetTotalLine(section);

  return (
    <div className="scheduler-staff-confirm-booking-breakdown-section">
      <p className="scheduler-staff-confirm-booking-breakdown-subtitle">{subtitle}</p>
      {section.pets.length > 0 ? (
        <ul className="scheduler-staff-confirm-booking-breakdown-pets">
          {section.pets.map((pet) => (
            <li key={pet.key}>{formatStaffConfirmPetDurationLine(pet)}</li>
          ))}
        </ul>
      ) : null}
      {totalLine ? (
        <p className="scheduler-staff-confirm-booking-breakdown-total">{totalLine}</p>
      ) : null}
    </div>
  );
}

export function StaffConfirmBookingBreakdownSection({
  breakdown,
  originalSubtitle = 'Original Booking',
  visitStartIso,
  practiceTz,
}: Props) {
  const { original, recommended, bookedSlotMinutes } = breakdown;
  const isHold = original.calendarStillHold === true;
  const slotMinutes =
    bookedSlotMinutes > 0 ? bookedSlotMinutes : original.bookedMinutes;
  const showCurrentTypes =
    recommended != null &&
    !recommended.usesRequestedTypes &&
    currentAppointmentTypesDiffer(original, recommended);

  return (
    <div className="scheduler-staff-confirm-booking-breakdown">
      <p className="scheduler-staff-confirm-booking-breakdown-title">
        Why this slot is {slotMinutes} minutes
      </p>

      {isHold ? (
        <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
          Pending new selections
        </p>
      ) : (
        <PerPetDurationBlock section={original} subtitle={originalSubtitle} />
      )}

      {showCurrentTypes ? (
        <CurrentAppointmentTypesBlock
          section={recommended}
          visitStartIso={visitStartIso}
          practiceTz={practiceTz}
          bookedSlotMinutes={slotMinutes}
        />
      ) : null}
    </div>
  );
}
