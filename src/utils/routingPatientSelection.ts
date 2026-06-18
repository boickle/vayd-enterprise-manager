import type { RoutingForwardBookingScope } from './routingForwardBookingIntent';
import {
  forwardBookingScopeTargets,
  type RoutingForwardBookingIntentV1,
} from './routingForwardBookingIntent';
import {
  rescheduleScopeTargets,
  type RoutingRescheduleIntentV1,
  type RoutingRescheduleScope,
  type RescheduleSameDayVisit,
} from './routingRescheduleIntent';

export type RoutingPatientChipRow = {
  id: string;
  name: string;
};

export function previewPatientsFromChipSelection(
  selectedIds: readonly string[],
  roster: readonly RoutingPatientChipRow[]
): { id: number | string; name: string }[] {
  const want = new Set(selectedIds.map(String));
  return roster
    .filter((p) => want.has(String(p.id)))
    .map((p) => ({ id: p.id, name: p.name }));
}

export function defaultRescheduleSelectedPatientIds(
  intent: RoutingRescheduleIntentV1
): string[] {
  const sameDay = intent.sameDayVisits ?? [];
  if (sameDay.length > 1) {
    if (intent.rescheduleScope === 'selected_pet') {
      return [String(intent.patientId)];
    }
    return sameDay.map((v) => String(v.patientId));
  }
  return [String(intent.patientId)];
}

export function defaultForwardBookingSelectedPatientIds(
  intent: RoutingForwardBookingIntentV1
): string[] {
  const entries = intent.householdEntries ?? [];
  if (entries.length > 1) {
    if (intent.householdScope === 'selected_pet') {
      return [String(intent.patientId)];
    }
    return entries.map((e) => String(e.patientId));
  }
  return [String(intent.patientId)];
}

export function deriveRescheduleScopeFromChipSelection(
  intent: RoutingRescheduleIntentV1,
  selectedIds: readonly string[]
): RoutingRescheduleScope {
  const sameDay = intent.sameDayVisits ?? [];
  if (sameDay.length <= 1) return 'selected_pet';
  const sameDayIds = new Set(sameDay.map((v) => String(v.patientId)));
  const selectedOnDay = selectedIds.filter((id) => sameDayIds.has(String(id)));
  if (selectedOnDay.length >= sameDay.length) return 'household_day';
  return 'selected_pet';
}

export function deriveForwardBookingScopeFromChipSelection(
  intent: RoutingForwardBookingIntentV1,
  selectedIds: readonly string[]
): RoutingForwardBookingScope {
  const entries = intent.householdEntries ?? [];
  if (entries.length <= 1) return 'selected_pet';
  const entryIds = new Set(entries.map((e) => String(e.patientId)));
  const selectedEntries = selectedIds.filter((id) => entryIds.has(String(id)));
  if (selectedEntries.length >= entries.length) return 'household_same_target';
  return 'selected_pet';
}

export function rescheduleTargetsForChipSelection(
  intent: RoutingRescheduleIntentV1,
  selectedPatientIds: readonly string[]
): {
  appointmentIds: number[];
  patientId: string;
  visits: RescheduleSameDayVisit[];
} {
  const selected = new Set(selectedPatientIds.map(String));
  const sameDay = intent.sameDayVisits ?? [];
  const visits = sameDay.filter((v) => selected.has(String(v.patientId)));

  if (visits.length === 0) {
    return rescheduleScopeTargets(intent);
  }

  if (visits.length === sameDay.length && visits.length > 1) {
    const appointmentIds = [...new Set(visits.map((v) => v.appointmentId))];
    return { appointmentIds, patientId: intent.patientId, visits };
  }

  if (visits.length === 1) {
    const v = visits[0]!;
    return { appointmentIds: [v.appointmentId], patientId: v.patientId, visits: [v] };
  }

  const appointmentIds = [...new Set(visits.map((v) => v.appointmentId))];
  const primary =
    visits.find((v) => v.patientId === intent.patientId) ?? visits[0]!;
  return { appointmentIds, patientId: primary.patientId, visits };
}

export function forwardBookingEntriesForChipSelection(
  intent: RoutingForwardBookingIntentV1,
  selectedPatientIds: readonly string[]
) {
  const selected = new Set(selectedPatientIds.map(String));
  const entries = intent.householdEntries ?? [];
  const picked = entries.filter((e) => selected.has(String(e.patientId)));
  if (picked.length === 0) {
    return forwardBookingScopeTargets(intent);
  }
  const anchor =
    picked.find((e) => e.patientId === intent.patientId) ?? picked[0]!;
  return { entries: picked, patientId: anchor.patientId };
}
