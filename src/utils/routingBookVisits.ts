/**
 * The appointments a routing (forward booking) Book creates, shared by the Scheduler's
 * Book modal and Schedule follow-ups' "Find a time now" panel, so both send the same
 * POST /appointments bodies and link the same forward-booking rows.
 */
import { createAppointment, type CreateAppointmentPayload } from '../api/appointments';
import type { SchedulerBookPrefill } from '../pages/SchedulerBookModal';
import { resolveForwardBookingBookDefaultDescription } from './forwardBookingBookPrefillDescription';
import type {
  ForwardBookingHouseholdEntry,
  RoutingForwardBookingIntentV1,
} from './routingForwardBookingIntent';

/** One visit at the slot: a pet (or no patient) with its own type, notes and pre-meds. */
export type RoutingBookVisit = {
  /** Null books a "No patient" visit. */
  patientId: string | null;
  appointmentTypeId: number | string;
  description: string;
  instructions: string;
  needsPremeds: boolean;
};

/** What every visit at the slot shares. */
export type RoutingBookSlot = {
  practiceId: number;
  primaryProviderId: number;
  clientId?: number | null;
  appointmentStart: string;
  appointmentEnd: string;
  additionalEmployeeIds?: number[];
  alternateAddressText?: string | null;
  allDay?: boolean;
  /** Skip Settings → Role manual booking checks (routing commit). */
  bookedViaRouting?: boolean;
  extras?: Pick<
    CreateAppointmentPayload,
    'forwardBookingTrackingToken' | 'forwardBookingCreatedVia' | 'joinWaitlistIfSooner'
  >;
};

/** POST /appointments body for one visit at the slot. */
export function routingBookCreatePayload(
  slot: RoutingBookSlot,
  visit: RoutingBookVisit
): CreateAppointmentPayload {
  const patientId = visit.patientId?.trim();
  return {
    practiceId: slot.practiceId,
    primaryProviderId: Number(slot.primaryProviderId),
    ...(slot.additionalEmployeeIds !== undefined
      ? { additionalEmployeeIds: slot.additionalEmployeeIds }
      : {}),
    ...(slot.clientId != null ? { clientId: Number(slot.clientId) } : {}),
    ...(patientId ? { patientId: Number(patientId) } : {}),
    ...(slot.alternateAddressText ? { alternateAddressText: slot.alternateAddressText } : {}),
    appointmentTypeId: Number(visit.appointmentTypeId),
    appointmentStart: slot.appointmentStart,
    appointmentEnd: slot.appointmentEnd,
    ...(slot.allDay ? { allDay: true } : {}),
    description: visit.description.trim() || undefined,
    instructions: visit.instructions.trim() || undefined,
    needsPremeds: visit.needsPremeds,
    ...(slot.bookedViaRouting ? { bookedViaRouting: true } : {}),
    ...(slot.extras ?? {}),
  };
}

/**
 * Create one appointment per visit, in order. `afterCreate` runs after each create
 * (the Book modal saves the alternate address and claims holds there).
 */
export async function createRoutingBookVisits(
  slot: RoutingBookSlot,
  visits: readonly RoutingBookVisit[],
  afterCreate?: (appointmentId: number, visit: RoutingBookVisit) => Promise<void>
): Promise<{
  firstAppointmentId: number | undefined;
  appointmentIds: number[];
  createdByPatientId: Map<string, number>;
}> {
  const appointmentIds: number[] = [];
  const createdByPatientId = new Map<string, number>();
  for (const visit of visits) {
    const created = await createAppointment(routingBookCreatePayload(slot, visit));
    const idRaw = created?.id;
    if (idRaw == null || !Number.isFinite(Number(idRaw))) continue;
    const id = Number(idRaw);
    appointmentIds.push(id);
    const pid = visit.patientId?.trim();
    if (pid) createdByPatientId.set(pid, id);
    if (afterCreate) await afterCreate(id, visit);
  }
  return { firstAppointmentId: appointmentIds[0], appointmentIds, createdByPatientId };
}

/** The forward-booking part of a routing Book's prefill, from the stored intent. */
export function forwardBookingBookPrefillFromIntent(
  fbi: RoutingForwardBookingIntentV1,
  targets: { entries: ForwardBookingHouseholdEntry[] } | null
): Pick<
  SchedulerBookPrefill,
  'forwardBookingTrackingToken' | 'forwardBookingEntryId' | 'forwardBookingVisitCompletes'
> {
  return {
    forwardBookingTrackingToken: fbi.trackingToken,
    forwardBookingEntryId: fbi.forwardBookingId,
    ...(targets && targets.entries.length > 1
      ? {
          forwardBookingVisitCompletes: targets.entries.map((row) => ({
            forwardBookingEntryId: row.forwardBookingId,
            forwardBookingTrackingToken: row.trackingToken,
            patientId: row.patientId,
            patientName: row.patientName,
            description: resolveForwardBookingBookDefaultDescription(row),
            // Each pet's own type and pre-meds (Schedule follow-ups sets them per pet).
            ...(row.appointmentTypeId != null ? { appointmentTypeId: row.appointmentTypeId } : {}),
            needsPremeds: row.needsPremeds === true,
          })),
        }
      : {}),
  };
}
