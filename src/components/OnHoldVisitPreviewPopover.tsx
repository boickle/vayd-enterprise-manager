import { useState } from 'react';
import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import {
  PreviewPopoverClientContact,
  type PreviewPopoverClientContact as PreviewPopoverClientContactType,
} from './PreviewPopoverClientContact';
import type { StaffConfirmHouseholdEditChoice } from './AppointmentRequestStaffConfirmPopover';

type Props = {
  appt: Appointment;
  practiceTz: string;
  clientLabel?: string | null;
  linkedClientLabel?: string | null;
  clientContact?: PreviewPopoverClientContactType | null;
  /** Multi-pet household — when length > 1, Edit asks which pet to change. */
  householdEditChoices?: StaffConfirmHouseholdEditChoice[];
  onBack: () => void;
  onEdit?: () => void;
  onEditPet?: (appointmentId: number) => void;
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

export default function OnHoldVisitPreviewPopover({
  appt,
  practiceTz,
  clientLabel,
  linkedClientLabel,
  clientContact,
  householdEditChoices,
  onBack,
  onEdit,
  onEditPet,
}: Props) {
  const [pickingPetToEdit, setPickingPetToEdit] = useState(false);
  const typeLabel = appointmentTypeLabel(appt);
  const visitRange = formatVisitRange(appt, practiceTz);
  const displayClient = clientLabel?.trim() || linkedClientLabel?.trim();

  const handleEditClick = () => {
    if (householdEditChoices && householdEditChoices.length > 1) {
      setPickingPetToEdit(true);
      return;
    }
    onEdit?.();
  };

  if (pickingPetToEdit && householdEditChoices) {
    return (
      <div
        className="scheduler-edit-preview-popover scheduler-edit-preview-popover--staff-confirm"
        role="dialog"
        aria-label="Choose pet to edit"
      >
        <div className="scheduler-edit-preview-popover-head">
          <strong className="scheduler-edit-preview-popover-title">Which pet?</strong>
        </div>
        <div className="scheduler-edit-preview-popover-scroll">
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--muted">
            This hold has multiple pets. Choose whose appointment you want to edit.
          </p>
          <div className="scheduler-staff-confirm-pet-pick-list">
            {householdEditChoices.map((choice) => (
              <button
                key={choice.appointmentId}
                type="button"
                className="btn secondary scheduler-staff-confirm-pet-pick-btn"
                onClick={() => {
                  onEditPet?.(choice.appointmentId);
                  setPickingPetToEdit(false);
                }}
              >
                {choice.label}
              </button>
            ))}
          </div>
        </div>
        <div className="scheduler-edit-preview-popover-actions scheduler-edit-preview-popover-actions--confirm">
          <button type="button" className="btn secondary" onClick={() => setPickingPetToEdit(false)}>
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="scheduler-edit-preview-popover scheduler-edit-preview-popover--staff-confirm"
      role="dialog"
      aria-label="On hold visit"
    >
      <div className="scheduler-edit-preview-popover-head">
        <strong className="scheduler-edit-preview-popover-title">On hold visit</strong>
      </div>

      <div className="scheduler-edit-preview-popover-scroll">
        {displayClient ? (
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--strong">
            {displayClient}
          </p>
        ) : null}

        <PreviewPopoverClientContact contact={clientContact} />

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
            Review this calendar hold. Edit to change time, visit type, or pets — or go back to On
            hold.
          </p>
        </div>
      </div>

      <div className="scheduler-edit-preview-popover-actions scheduler-edit-preview-popover-actions--confirm">
        <button type="button" className="btn secondary" onClick={onBack}>
          Back to On hold
        </button>
        {onEdit ? (
          <button type="button" className="btn primary" onClick={handleEditClick}>
            Edit appointment
          </button>
        ) : null}
      </div>
    </div>
  );
}
