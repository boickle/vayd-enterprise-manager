import { useEffect, useState } from 'react';
import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import {
  PreviewPopoverClientContact,
  type PreviewPopoverClientContact as PreviewPopoverClientContactType,
} from './PreviewPopoverClientContact';
import { AppointmentRequestClientNameChange } from './AppointmentRequestClientNameChange';

export type StaffConfirmHouseholdEditChoice = {
  appointmentId: number;
  label: string;
};

type Props = {
  appt: Appointment;
  practiceTz: string;
  /** Name from the original online request. */
  requestClientLabel?: string | null;
  /** Name from the linked appointment (client / household on file). */
  linkedClientLabel?: string | null;
  /** When true, show request name struck through → linked name if they differ. */
  isNewClient?: boolean;
  clientContact?: PreviewPopoverClientContactType | null;
  /** Multi-pet household — when length > 1, Edit asks which pet to change. */
  householdEditChoices?: StaffConfirmHouseholdEditChoice[];
  confirming?: boolean;
  error?: string | null;
  onConfirm: () => void;
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

function ClientNameDisplay({
  requestClientLabel,
  linkedClientLabel,
  isNewClient,
}: {
  requestClientLabel?: string | null;
  linkedClientLabel?: string | null;
  isNewClient?: boolean;
}) {
  const request = requestClientLabel?.trim();
  const linked = linkedClientLabel?.trim();
  if (!request && !linked) return null;

  return (
    <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--strong">
      <AppointmentRequestClientNameChange
        requestClientLabel={request ?? linked ?? ''}
        linkedClientLabel={linked}
        isNewClient={isNewClient}
        className="scheduler-edit-preview-popover-client-change"
      />
    </p>
  );
}

export function AppointmentRequestStaffConfirmPopover({
  appt,
  practiceTz,
  requestClientLabel,
  linkedClientLabel,
  isNewClient = false,
  clientContact,
  householdEditChoices,
  confirming = false,
  error,
  onConfirm,
  onBack,
  onEdit,
  onEditPet,
}: Props) {
  const [pickingPetToEdit, setPickingPetToEdit] = useState(false);

  useEffect(() => {
    setPickingPetToEdit(false);
  }, [appt.id, householdEditChoices?.length]);

  const visitRange = formatVisitRange(appt, practiceTz);
  const typeLabel = appointmentTypeLabel(appt);

  const multiPetEdit =
    (householdEditChoices?.length ?? 0) > 1 && typeof onEditPet === 'function';

  const handleEditClick = () => {
    if (multiPetEdit) {
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
            This visit has multiple pets. Choose whose appointment you want to edit.
          </p>
          <div className="scheduler-staff-confirm-pet-pick-list">
            {householdEditChoices.map((choice) => (
              <button
                key={choice.appointmentId}
                type="button"
                className="btn secondary scheduler-staff-confirm-pet-pick-btn"
                disabled={confirming}
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
          <button
            type="button"
            className="btn secondary"
            disabled={confirming}
            onClick={() => setPickingPetToEdit(false)}
          >
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
      aria-label="Confirm online booking"
    >
      <div className="scheduler-edit-preview-popover-head">
        <strong className="scheduler-edit-preview-popover-title">Confirm online booking</strong>
      </div>

      <div className="scheduler-edit-preview-popover-scroll">
        {requestClientLabel?.trim() || linkedClientLabel?.trim() ? (
          <div className="scheduler-edit-preview-popover-client">
            <ClientNameDisplay
              requestClientLabel={requestClientLabel}
              linkedClientLabel={linkedClientLabel}
              isNewClient={isNewClient}
            />
          </div>
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
            Hover over appointment to see information
          </p>
        </div>

        {error ? (
          <p className="scheduler-edit-preview-popover-line scheduler-edit-preview-popover-line--error">
            {error}
          </p>
        ) : null}
      </div>

      <div className="scheduler-edit-preview-popover-actions scheduler-edit-preview-popover-actions--confirm">
        <button
          type="button"
          className="btn secondary"
          disabled={confirming}
          onClick={onBack}
        >
          Back
        </button>
        {onEdit ? (
          <button
            type="button"
            className="btn secondary"
            disabled={confirming}
            onClick={handleEditClick}
          >
            Edit
          </button>
        ) : null}
        <button
          type="button"
          className="btn scheduler-edit-preview-popover-confirm"
          disabled={confirming}
          onClick={onConfirm}
        >
          {confirming ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </div>
  );
}
