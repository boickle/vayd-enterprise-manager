import type { Appointment } from '../api/roomLoader';
import { isPracticeCalendarBlockAppointment } from '../api/appointments';
import { appointmentIsCalendarOnlyStaffItem } from './calendarOnlyStaffAppointment';
import { patientsForAppointment } from './schedulerAddPet';

export type WaitlistAddPrefill = {
  clientId: number;
  clientLabel: string;
  /** Pets on the visit; empty means staff picks after pets load (all active selected by default). */
  patientIds: number[];
  appointmentTypeId?: number;
  preferredProviderId?: number;
};

export function waitlistAddDisabledReason(appt: Appointment): string | undefined {
  if (isPracticeCalendarBlockAppointment(appt)) {
    return 'Calendar blocks cannot be added to the waitlist.';
  }
  if (appointmentIsCalendarOnlyStaffItem(appt)) {
    return 'Staff calendar items cannot be added to the waitlist.';
  }
  const clientId = Number(appt.client?.id);
  if (!Number.isFinite(clientId) || clientId <= 0) {
    return 'Needs a linked client to add to the waitlist.';
  }
  return undefined;
}

export function buildWaitlistAddPrefillFromAppointment(appt: Appointment): WaitlistAddPrefill | null {
  if (waitlistAddDisabledReason(appt)) return null;
  const client = appt.client!;
  const clientId = Number(client.id);
  const fn = String(client.firstName ?? '').trim();
  const ln = String(client.lastName ?? '').trim();
  const clientLabel = [fn, ln].filter(Boolean).join(' ').trim() || `Client #${clientId}`;
  const patientIds = patientsForAppointment(appt)
    .map((p) => Number(p.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  const typeId = Number(appt.appointmentType?.id);
  const providerId = Number(appt.primaryProvider?.id);
  return {
    clientId,
    clientLabel,
    patientIds,
    ...(Number.isFinite(typeId) && typeId > 0 ? { appointmentTypeId: typeId } : {}),
    ...(Number.isFinite(providerId) && providerId > 0 ? { preferredProviderId: providerId } : {}),
  };
}
