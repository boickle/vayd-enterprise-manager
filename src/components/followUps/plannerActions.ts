import { DateTime } from 'luxon';
import {
  createAppointment,
  deleteAppointment,
  fetchAppointmentById,
  patchAppointment,
} from '../../api/appointments';
import { sendClientSms } from '../../api/clientSms';
import { apiBaseUrl, getToken, practiceHostHeaders } from '../../api/http';
import {
  createForwardBooking,
  removeForwardBooking,
  type ForwardBookingEntry,
} from '../../api/forwardBooking';
import {
  patchForwardBookingDisposition,
  type ForwardBookingDisposition,
} from '../../api/forwardBookingDisposition';
import { fetchClientAppointmentsStaff } from '../../api/pimsAppointments';
import type { Appointment } from '../../api/roomLoader';
import { updateEncounter } from '../../api/visitWorkflow';
import { alignSiblingVisitScheduledTimes } from '../../utils/householdVisitTimeAlign';
import {
  buildRoutingForwardBookingIntentFromEntries,
  buildRoutingForwardBookingIntentFromEntry,
  writeRoutingForwardBookingIntent,
} from '../../utils/routingForwardBookingIntent';
import { patientsForAppointment } from '../../utils/schedulerAddPet';
import { notifyTasksChanged } from '../../utils/taskOwnership';
import { createLabsPendingForwardBookingTasks } from '../forwardBooking/saveForwardBookingDecision';
import { householdArrivalWindow, type PlannerPet, type UpcomingVisit } from './plannerData';
import { plannerIntervalForApi, type PlannerInterval, type PlannerProvider } from './plannerModel';

export type PlannerBooking = {
  appointmentIds: number[];
  start: DateTime;
  windowStart: DateTime;
  windowEnd: DateTime;
  provider: PlannerProvider | null;
  bookedAtMs: number;
  /** Forward-booking rows the booking completed (removed again on Undo). */
  entryIds: number[];
  /** Housemate visits only: the original rows' times, restored on Undo. */
  restoreSiblings?: { id: number; start: string; end: string }[];
};

/**
 * The API keeps one open forward-booking row per source visit, so only a pet's first row
 * from this visit carries the link; any further row for the same pet is created without
 * one (it would otherwise overwrite the first).
 */
export class SourceVisitLinks {
  private used = new Set<number>();
  take(pet: PlannerPet): number | null {
    const source = pet.onTodaysVisit ? pet.appointmentId : (pet.sourceAppointmentId ?? null);
    if (source == null || this.used.has(pet.patientId)) return null;
    this.used.add(pet.patientId);
    return source;
  }
  release(petId: number) {
    this.used.delete(petId);
  }
}

export async function createPlannerForwardBookings(args: {
  practiceId: number;
  clientId: number;
  pets: PlannerPet[];
  interval: PlannerInterval;
  today: DateTime;
  providerId: number | null;
  /** Each pet's own visit type. */
  typeIdFor: (pet: PlannerPet) => number;
  /** Each pet's own "needs pre-meds" (the routing search narrows the household window if any). */
  premedsFor: (pet: PlannerPet) => boolean;
  /** Visit length for the whole card, from the provider's history. */
  serviceMinutes: number;
  notesFor: (pet: PlannerPet) => string;
  links: SourceVisitLinks;
}): Promise<{ entries: ForwardBookingEntry[]; linkedPetIds: number[] }> {
  const { intervalAmount, intervalUnit } = plannerIntervalForApi(args.interval, args.today);
  const entries: ForwardBookingEntry[] = [];
  const linkedPetIds: number[] = [];
  for (const pet of args.pets) {
    const sourceAppointmentId = args.links.take(pet);
    if (sourceAppointmentId != null) linkedPetIds.push(pet.patientId);
    entries.push(
      await createForwardBooking({
        practiceId: args.practiceId,
        sourceAppointmentId,
        clientId: args.clientId,
        patientId: pet.patientId,
        intervalAmount,
        intervalUnit,
        primaryProviderId: args.providerId ?? undefined,
        bookingNotes: args.notesFor(pet),
        needsPremeds: args.premedsFor(pet),
        appointmentTypeId: args.typeIdFor(pet),
        serviceMinutes: args.serviceMinutes,
        createdVia: sourceAppointmentId != null && pet.onTodaysVisit ? 'end_visit' : 'manual',
      })
    );
  }
  return { entries, linkedPetIds };
}

/** Prefill Routing with the card's rows; the calendar reports back via plannerEvents. */
export function startPlannerSlotSearch(
  entries: ForwardBookingEntry[],
  visit: { appointmentTypeId: number; appointmentTypeName: string; serviceMinutes: number }
): boolean {
  const [anchor] = entries;
  if (!anchor) return false;
  const intent =
    entries.length > 1
      ? buildRoutingForwardBookingIntentFromEntries(anchor, entries)
      : buildRoutingForwardBookingIntentFromEntry(anchor);
  if (!intent) return false;
  writeRoutingForwardBookingIntent({
    ...intent,
    ...(entries.length > 1 ? { householdScope: 'household_same_target' as const } : {}),
    // The card's type and history-based length win over whatever the row carried.
    appointmentTypeId: visit.appointmentTypeId,
    appointmentTypeName: visit.appointmentTypeName,
    serviceMinutes: visit.serviceMinutes,
    workspaceActive: true,
    origin: 'follow_up_planner',
    returnToListAfterBook: false,
  });
  return true;
}

export async function removePlannerForwardBookings(ids: number[], practiceId: number) {
  for (const id of ids) {
    try {
      await removeForwardBooking(id, practiceId);
    } catch {
      /* already gone */
    }
  }
}

/**
 * The tab is closing or reloading mid-search: take the search rows back off the forward
 * booking list. `keepalive` lets the request finish after the page is gone (best effort;
 * the normal close path uses removePlannerForwardBookings).
 */
export function removePlannerForwardBookingsOnUnload(ids: number[], practiceId: number) {
  const token = getToken();
  for (const id of ids) {
    try {
      void fetch(`${apiBaseUrl}/forward-bookings/${encodeURIComponent(String(id))}`, {
        method: 'PATCH',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          ...practiceHostHeaders(),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ practiceId, status: 'removed' }),
      }).catch(() => undefined);
    } catch {
      /* page is going away */
    }
  }
}

/** The household's appointments starting at `startIso` for these pets (one per pet). */
export async function findBookedAppointments(args: {
  practiceId: number;
  clientId: number;
  startIso: string;
  petIds: number[];
  tz: string;
}): Promise<Appointment[]> {
  const start = DateTime.fromISO(args.startIso, { zone: 'utc' });
  const rows = await fetchClientAppointmentsStaff(args.clientId, {
    practiceId: args.practiceId,
    start: start.minus({ minutes: 1 }).toISO()!,
    end: start.plus({ hours: 12 }).toISO()!,
  });
  const pets = new Set(args.petIds);
  return rows.filter((a) => {
    if (a.isDeleted) return false;
    const s = DateTime.fromISO(a.appointmentStart, { zone: 'utc' });
    if (!s.isValid || Math.abs(s.toMillis() - start.toMillis()) > 60_000) return false;
    return patientsForAppointment(a).some((p) => pets.has(Number(p.id)));
  });
}

export function bookingFromAppointments(
  rows: Appointment[],
  opts: {
    tz: string;
    provider: PlannerProvider | null;
    entryIds: number[];
    fallbackStartIso: string;
  }
): PlannerBooking {
  const first = rows[0];
  const startIso = first?.appointmentStart ?? opts.fallbackStartIso;
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(opts.tz);
  const win = first ? householdArrivalWindow(first, rows, opts.tz) : null;
  return {
    appointmentIds: rows.map((r) => Number(r.id)),
    start,
    windowStart: win ? DateTime.fromISO(win.startIso, { zone: 'utc' }).setZone(opts.tz) : start,
    windowEnd: win ? DateTime.fromISO(win.endIso, { zone: 'utc' }).setZone(opts.tz) : start,
    provider: opts.provider,
    bookedAtMs: Date.now(),
    entryIds: opts.entryIds,
  };
}

/**
 * Adds pets to a housemate's upcoming visit: one appointment per pet at the visit's
 * start, then every row in the visit is aligned to the longer end time (the same steps
 * the scheduler's add-pet uses).
 */
export async function addPetsToUpcomingVisit(args: {
  practiceId: number;
  clientId: number;
  visit: UpcomingVisit;
  pets: PlannerPet[];
  notesFor: (pet: PlannerPet) => string;
  /** Visit type for each added pet. */
  typeIdFor: (pet: PlannerPet) => number;
  /** "Needs pre-meds" for each added pet. */
  premedsFor: (pet: PlannerPet) => boolean;
  /** History-based extra time for all added pets together. */
  addedMinutes: number;
}): Promise<PlannerBooking> {
  const { visit } = args;
  if (!visit.provider) throw new Error('That visit has no provider, so pets cannot be added here.');
  const startIso = visit.start.toUTC().toISO()!;
  const endIso = visit.end.plus({ minutes: args.addedMinutes }).toUTC().toISO()!;
  const created: number[] = [];
  try {
    for (const pet of args.pets) {
      const row = await createAppointment({
        practiceId: args.practiceId,
        primaryProviderId: visit.provider.id,
        clientId: args.clientId,
        patientId: pet.patientId,
        appointmentTypeId: args.typeIdFor(pet),
        appointmentStart: startIso,
        appointmentEnd: endIso,
        description: args.notesFor(pet) || undefined,
        ...(args.premedsFor(pet) ? { needsPremeds: true } : {}),
        bookedViaRouting: true,
      });
      created.push(Number(row.id));
    }
    await alignSiblingVisitScheduledTimes({
      siblings: visit.appointments,
      startIso,
      endIso,
      practiceId: args.practiceId,
    });
  } catch (e) {
    // Leave nothing half-added.
    for (const id of created) await deleteAppointment(id).catch(() => undefined);
    throw e;
  }
  // A pre-meds pet narrows the whole household's arrival window.
  const tz = visit.start.zoneName ?? 'utc';
  const first = visit.appointments[0];
  const win =
    first && args.pets.some((p) => args.premedsFor(p))
      ? householdArrivalWindow(first, [{ needsPremeds: true }], tz)
      : null;
  return {
    appointmentIds: created,
    start: visit.start,
    windowStart: win
      ? DateTime.fromISO(win.startIso, { zone: 'utc' }).setZone(tz)
      : visit.windowStart,
    windowEnd: win ? DateTime.fromISO(win.endIso, { zone: 'utc' }).setZone(tz) : visit.windowEnd,
    provider: visit.provider,
    bookedAtMs: Date.now(),
    entryIds: [],
    restoreSiblings: visit.appointments.map((a) => ({
      id: Number(a.id),
      start: a.appointmentStart,
      end: a.appointmentEnd,
    })),
  };
}

/** Undo within the 10-second window: remove what the booking created and put times back. */
export async function undoPlannerBooking(b: PlannerBooking, practiceId: number) {
  for (const id of b.appointmentIds) await deleteAppointment(id);
  await removePlannerForwardBookings(b.entryIds, practiceId);
  for (const s of b.restoreSiblings ?? []) {
    await patchAppointment(
      s.id,
      { appointmentStart: s.start, appointmentEnd: s.end, bookedViaRouting: true },
      { practiceId }
    );
  }
}

export type PetDisposition = {
  pet: PlannerPet;
  disposition: ForwardBookingDisposition;
  entryId?: number | null;
  taskId?: number | null;
};

/**
 * The branches a labs task is filed on. The API only lets staff file tasks on branches
 * they belong to (admins excepted), so:
 * - the visit's branch when the signed-in staff member belongs to it;
 * - otherwise the practice branches they belong to;
 * - otherwise (their branches could not be loaded) the visit's branch.
 * Never every branch of the practice.
 */
export function chooseLabsTaskBranchIds(args: {
  visitBranchId: number | null;
  staffBranchIds: readonly number[];
  practiceBranchIds: readonly number[];
}): number[] {
  const inPractice = new Set(args.practiceBranchIds);
  const mine = [...new Set(args.staffBranchIds)].filter(
    (id) => inPractice.size === 0 || inPractice.has(id)
  );
  const visit = args.visitBranchId;
  if (visit != null && mine.includes(visit)) return [visit];
  if (mine.length) return mine;
  return visit != null ? [visit] : [];
}

function appointmentBranchId(a: Appointment | null): number | null {
  const raw = (a as { branch?: { id?: unknown } | null; branchId?: unknown } | null) ?? null;
  const n = Number(raw?.branch?.id ?? raw?.branchId);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function createLabsTask(args: {
  pet: PlannerPet;
  clientId: number;
  practiceId: number;
  /** Branches the signed-in staff member belongs to. */
  staffBranchIds: number[];
  /** Active branches of the practice. */
  practiceBranchIds: number[];
  assigneeIds: number[];
  startAt: string;
  note: string;
}): Promise<number> {
  if (!args.pet.appointmentId)
    throw new Error(`${args.pet.name} has no visit to link the labs task to.`);
  const visit = await fetchAppointmentById(args.pet.appointmentId, {
    practiceId: args.practiceId,
  });
  const branchIds = chooseLabsTaskBranchIds({
    visitBranchId: appointmentBranchId(visit),
    staffBranchIds: args.staffBranchIds,
    practiceBranchIds: args.practiceBranchIds,
  });
  if (branchIds.length === 0)
    throw new Error('Could not determine practice branches for the task.');
  const id = await createLabsPendingForwardBookingTasks({
    title: `Forward book ${args.pet.name} once labs are back${args.note ? ` (${args.note})` : ''}`,
    branchIds,
    assigneeEmployeeIds: args.assigneeIds,
    startAt: args.startAt,
    dueAt: null,
    links: [
      { entityType: 'client', entityId: args.clientId },
      { entityType: 'appointment', entityId: args.pet.appointmentId },
      { entityType: 'patient', entityId: args.pet.patientId },
    ],
  });
  notifyTasksChanged();
  return id;
}

/** Same double write as saveForwardBookingDecision: appointment and SOAP encounter. */
export async function savePetDisposition(d: PetDisposition, practiceId: number) {
  if (d.pet.appointmentId == null) return;
  await patchForwardBookingDisposition(d.pet.appointmentId, d.disposition, { practiceId });
  if (d.pet.soapEncounterId) {
    await updateEncounter(d.pet.soapEncounterId, {
      forwardBookingDisposition: d.disposition as unknown as Record<string, unknown>,
      ...(d.entryId != null ? { forwardBookingEntryId: d.entryId } : {}),
      ...(d.taskId != null ? { forwardBookingTaskId: d.taskId } : {}),
    });
  }
}

export async function sendPlannerConfirmationText(args: {
  clientId: number;
  message: string;
  sendProvider: PlannerProvider | null;
  patientIds: number[];
  practiceId: number;
}) {
  await sendClientSms(args.clientId, {
    message: args.message,
    // No provider (Tech Team) → the API's default practice line, never the reminders line.
    ...(args.sendProvider ? { primaryProviderId: args.sendProvider.id } : {}),
    source: 'follow_up_confirmation',
    patientIds: args.patientIds,
    practiceId: args.practiceId,
  });
}
