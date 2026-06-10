import { patchAppointment, putAppointmentAlternateAddress } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import {
  appendEditedByStaffNote,
  appendLinkedClientStaffNote,
  type AppointmentChangeActor,
  type EditVisitChangeKind,
} from './appointmentChangeAuditNote';
import {
  addressMatchAllowsLink,
  compareVisitAddressToClientHome,
  visitAddressForLinkMatching,
} from './visitAddressMatch';
import type { EditVisitLinkSelection } from '../components/EditVisitLinkClientPanel';

export type EditVisitFormSnapshot = {
  appointmentTypeId: number;
  primaryProviderId: number;
  additionalEmployeeIds: number[];
  description: string;
  instructions: string;
  statusName: string;
  confirmStatusName: string;
  isComplete: boolean;
  allDay: boolean;
};

export type CommitLinkVisitClientInput = {
  clientId: number;
  patientId?: number | null;
  visitAddress: string | null;
  clientHomeAddress: string | null;
  clientLabel: string;
  patientLabel?: string | null;
  /** When true, skip address match validation (no visit address on file). */
  skipAddressMatch?: boolean;
  /** When true, link without clearing alternate routing address. */
  keepAlternateAddress?: boolean;
  linkAudit?: {
    actor: AppointmentChangeActor;
    practiceTz: string;
  };
};

export type CommitEditVisitInput = {
  appointmentId: number;
  practiceId: number;
  appointmentStart: string;
  appointmentEnd: string;
  form: EditVisitFormSnapshot;
  /** When set (type preview on calendar), overrides `form.appointmentTypeId`. */
  previewAppointmentTypeId?: number | null;
  /** Append edit audit line(s) to staff notes before save. */
  editedByAudit?: {
    actor: AppointmentChangeActor;
    practiceTz: string;
    changes: EditVisitChangeKind[];
  };
  /** Attach client/patient to an unlinked visit on the same PATCH. */
  linkClient?: CommitLinkVisitClientInput;
};

export function commitLinkClientFromEditVisitSelection(
  appt: Appointment,
  selection: EditVisitLinkSelection | null | undefined,
  linkAudit?: { actor: AppointmentChangeActor; practiceTz: string }
): CommitLinkVisitClientInput | undefined {
  if (!selection?.clientId?.trim()) return undefined;
  const visitAddress = visitAddressForLinkMatching(appt);
  return {
    clientId: Number(selection.clientId),
    patientId: selection.patientId?.trim() ? Number(selection.patientId) : null,
    visitAddress,
    clientHomeAddress: selection.clientHomeAddress,
    clientLabel: selection.clientLabel,
    patientLabel: selection.patientLabel,
    skipAddressMatch: !visitAddress?.trim(),
    keepAlternateAddress: selection.keepAlternateAddress,
    linkAudit,
  };
}

export function validateEditVisitLinkSelection(input: {
  linkSelection: EditVisitLinkSelection | null | undefined;
  visitAddress: string | null;
  requirePatient: boolean;
}): string | null {
  const { linkSelection, visitAddress, requirePatient } = input;
  if (!linkSelection?.clientId?.trim()) return null;

  if (visitAddress?.trim() && !linkSelection.keepAlternateAddress) {
    const quality = compareVisitAddressToClientHome(visitAddress, linkSelection.clientHomeAddress);
    if (!addressMatchAllowsLink(quality)) {
      return (
        'The selected client\'s home address does not match this visit address. Choose a client at the same location, or check "Keep as alternate address, but link this client".'
      );
    }
  }
  if (requirePatient && !linkSelection.patientId?.trim()) {
    return 'Choose a patient for this client before saving.';
  }
  return null;
}

export async function commitEditVisit(input: CommitEditVisitInput): Promise<Appointment> {
  const typeId =
    input.previewAppointmentTypeId != null &&
    Number.isFinite(Number(input.previewAppointmentTypeId))
      ? Number(input.previewAppointmentTypeId)
      : input.form.appointmentTypeId;

  if (!Number.isFinite(typeId) || typeId <= 0) {
    throw new Error('Choose a valid appointment type.');
  }
  if (!Number.isFinite(input.form.primaryProviderId) || input.form.primaryProviderId <= 0) {
    throw new Error('Choose a primary provider.');
  }

  const description = input.form.description.trim();
  let instructions = input.form.instructions.trim();
  if (input.editedByAudit?.changes.length) {
    instructions = appendEditedByStaffNote(
      instructions,
      input.editedByAudit.actor,
      input.editedByAudit.practiceTz,
      input.editedByAudit.changes
    ).trim();
  }

  const link = input.linkClient;
  if (link) {
    if (!Number.isFinite(link.clientId) || link.clientId <= 0) {
      throw new Error('Choose a valid client to link.');
    }
    if (link.patientId != null && (!Number.isFinite(link.patientId) || link.patientId <= 0)) {
      throw new Error('Choose a valid patient to link.');
    }
    if (!link.skipAddressMatch && !link.keepAlternateAddress && link.visitAddress?.trim()) {
      const quality = compareVisitAddressToClientHome(link.visitAddress, link.clientHomeAddress);
      if (!addressMatchAllowsLink(quality)) {
        throw new Error(
          'The selected client\'s home address does not match this visit address. Choose a client at the same location.'
        );
      }
    }
    if (link.linkAudit) {
      instructions = appendLinkedClientStaffNote(
        instructions,
        link.linkAudit.actor,
        link.linkAudit.practiceTz,
        link.clientLabel,
        link.patientLabel
      ).trim();
    }
  }

  const patchBody: Record<string, unknown> = {
    appointmentTypeId: typeId,
    primaryProviderId: input.form.primaryProviderId,
    additionalEmployeeIds: input.form.additionalEmployeeIds,
    description: description || null,
    instructions: instructions || null,
    statusName: input.form.statusName.trim() || null,
    confirmStatusName: input.form.confirmStatusName.trim() || null,
    isComplete: input.form.isComplete,
    allDay: input.form.allDay,
    appointmentStart: input.appointmentStart,
    appointmentEnd: input.appointmentEnd,
    /** PATCH on existing visit — not manual booking; skip role type permission gate. */
    bookedViaRouting: true,
  };

  if (link) {
    patchBody.clientId = link.clientId;
    if (link.patientId != null) patchBody.patientId = link.patientId;
  }

  const updated = await patchAppointment(input.appointmentId, patchBody, {
    practiceId: input.practiceId,
  });

  if (
    link?.visitAddress?.trim() &&
    link.clientHomeAddress?.trim() &&
    !link.keepAlternateAddress
  ) {
    const quality = compareVisitAddressToClientHome(link.visitAddress, link.clientHomeAddress);
    if (addressMatchAllowsLink(quality)) {
      await putAppointmentAlternateAddress(input.appointmentId, { addressText: '' });
      return {
        ...updated,
        alternateAddress: null,
        alternateAddressText: null,
        isAlternateStop: false,
      } as Appointment;
    }
  }

  return updated;
}
