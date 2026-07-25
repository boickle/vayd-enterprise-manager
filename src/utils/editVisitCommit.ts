import {
  appointmentAlternateAddressText,
  patchAppointment,
  putAppointmentAlternateAddress,
} from '../api/appointments';
import type { AppointmentType } from '../api/appointmentSettings';
import type { Appointment } from '../api/roomLoader';
import { appointmentTypeAllowsClient } from './appointmentTypeSettings';
import { DateTime } from 'luxon';
import {
  appendEditedByStaffNote,
  appendLinkedClientStaffNote,
  type AppointmentChangeActor,
  type EditVisitChangeKind,
} from './appointmentChangeAuditNote';
import {
  addressMatchAllowsLink,
  appointmentClientHomeAddress,
  appointmentResolvedClientId,
  clientAddressFromRecord,
  compareVisitAddressToClientHome,
  visitAddressForLinkMatching,
} from './visitAddressMatch';
import type { EditVisitLinkSelection } from '../components/EditVisitLinkClientPanel';
import type { EditVisitPatientSelection } from '../components/EditVisitAddPatientPanel';
import { excludePatientIdsAtSlot, patientsForAppointment } from './schedulerAddPet';

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
  /** Attach a patient when the visit already has a client. */
  assignPatient?: CommitAssignVisitPatientInput;
};

export type CommitAssignVisitPatientInput = {
  patientId: number;
  patientLabel?: string | null;
};

export function commitAssignPatientFromEditVisitSelection(
  selection: EditVisitPatientSelection | null | undefined
): CommitAssignVisitPatientInput | undefined {
  if (!selection?.patientId?.trim()) return undefined;
  const patientId = Number(selection.patientId);
  if (!Number.isFinite(patientId) || patientId <= 0) return undefined;
  return {
    patientId,
    patientLabel: selection.patientLabel,
  };
}

/** PATCH patient only when the selection differs from the visit's current patient. */
export function resolveEditVisitAssignPatient(
  appt: Appointment,
  selection: EditVisitPatientSelection | null | undefined
): CommitAssignVisitPatientInput | undefined {
  if (!selection?.patientId?.trim()) return undefined;
  const nextId = selection.patientId.trim();
  const current = patientsForAppointment(appt)[0]?.id;
  if (current != null && String(current) === nextId) return undefined;
  return commitAssignPatientFromEditVisitSelection(selection);
}

export function validateEditVisitPatientSelection(input: {
  appt: Appointment;
  patientSelection: EditVisitPatientSelection | null | undefined;
  slotStartIso: string;
  slotEndIso: string;
  allAppointments: Appointment[];
}): string | null {
  const patientId = input.patientSelection?.patientId?.trim();
  if (!patientId) return null;

  const clientId = appointmentResolvedClientId(input.appt);
  if (!clientId) return null;

  const current = patientsForAppointment(input.appt)[0]?.id;
  if (current != null && String(current) === patientId) return null;

  const start = DateTime.fromISO(input.slotStartIso, { zone: 'utc' });
  const end = DateTime.fromISO(input.slotEndIso, { zone: 'utc' });
  if (!start.isValid || !end.isValid) return null;

  const excludeAppointmentId = typeof input.appt.id === 'number' ? input.appt.id : undefined;
  const blocked = excludePatientIdsAtSlot(
    clientId,
    start.toMillis(),
    end.toMillis(),
    input.allAppointments,
    { excludeAppointmentId }
  );
  if (!blocked.includes(patientId)) return null;

  const name = input.patientSelection?.patientLabel?.trim() || 'This patient';
  return `${name} is already scheduled for this client at this time. Choose a different patient or reschedule the other visit.`;
}

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

/** Selected type forbids a client but the visit already has (or is linking) one. */
export function validateEditVisitAppointmentTypeClientConflict(input: {
  appointmentType: AppointmentType | undefined;
  hasLinkedClient: boolean;
}): string | null {
  if (!input.appointmentType || !input.hasLinkedClient) return null;
  if (appointmentTypeAllowsClient(input.appointmentType)) return null;
  const label = String(
    input.appointmentType.prettyName || input.appointmentType.name || 'This appointment type',
  ).trim();
  return `${label} does not allow a client. Choose a different appointment type or unlink the client first.`;
}

export function validateEditVisitLinkSelection(input: {
  linkSelection: EditVisitLinkSelection | null | undefined;
  visitAddress: string | null;
  requirePatient: boolean;
}): string | null {
  const { linkSelection, visitAddress, requirePatient } = input;
  if (!linkSelection?.clientId?.trim()) return null;

  if (visitAddress?.trim() && linkSelection.keepAlternateAddress !== true) {
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
    if (!link.skipAddressMatch && link.keepAlternateAddress !== true && link.visitAddress?.trim()) {
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

  const assign = input.assignPatient;
  if (assign) {
    if (!Number.isFinite(assign.patientId) || assign.patientId <= 0) {
      throw new Error('Choose a valid patient.');
    }
    patchBody.patientId = assign.patientId;
  }

  const updated = await patchAppointment(input.appointmentId, patchBody, {
    practiceId: input.practiceId,
  });

  if (
    link?.visitAddress?.trim() &&
    link.clientHomeAddress?.trim() &&
    link.keepAlternateAddress !== true
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

  // Already-linked visits: clear a stale ALT that matches the client's home.
  const home =
    link?.clientHomeAddress?.trim() ||
    (updated.client && typeof updated.client === 'object'
      ? clientAddressFromRecord(updated.client as Record<string, unknown>)
      : null) ||
    appointmentClientHomeAddress(updated);
  const alt = appointmentAlternateAddressText(updated);
  if (
    alt?.trim() &&
    home?.trim() &&
    link?.keepAlternateAddress !== true &&
    addressMatchAllowsLink(compareVisitAddressToClientHome(alt, home))
  ) {
    await putAppointmentAlternateAddress(input.appointmentId, { addressText: '' });
    return {
      ...updated,
      alternateAddress: null,
      alternateAddressText: null,
      isAlternateStop: false,
    } as Appointment;
  }

  return updated;
}
