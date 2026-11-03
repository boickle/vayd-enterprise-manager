import { DateTime } from 'luxon';
import {
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
} from '../../api/appointments';
import { listPatientOpenReminders } from '../../api/careOutreach';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { fetchAllAppointmentTypes, type AppointmentType } from '../../api/appointmentSettings';
import { fetchPrimaryProviders, type Provider } from '../../api/employee';
import type { ForwardBookingDispositionMode } from '../../api/forwardBookingDisposition';
import { fetchClientAppointmentsStaff } from '../../api/pimsAppointments';
import type { Appointment } from '../../api/roomLoader';
import { getVisitReminders, type VisitWrapUp } from '../../api/visitWrapUp';
import { clientDoNotSmsFromRecord } from '../../utils/doNotSmsWarning';
import { forwardBookingDispositionIsComplete } from '../../utils/forwardBookingDisposition';
import { appointmentArrivalWindowIsosForSms } from '../../utils/forwardBookingSmsMessage';
import { appointmentTypeDisplayName } from '../../utils/nextScheduledAppointmentForVisit';
import { activeClientPetsFromPayload, patientsForAppointment } from '../../utils/schedulerAddPet';
import type { PlannerProvider } from './plannerModel';
import { plannerBookableTypes } from './plannerTiming';

export type PlannerPet = {
  patientId: number;
  name: string;
  species: string | null;
  /** On the visit being checked out; these pets must each get a follow-up. */
  onTodaysVisit: boolean;
  appointmentId: number | null;
  soapEncounterId: string | null;
  /** Follow-up already settled for this visit before the planner opened (read-only). */
  savedMode: ForwardBookingDispositionMode | null;
};

export type PlannerReminder = {
  key: string;
  name: string;
  due: DateTime;
  /** Created by today's visit (e.g. vaccine given today, due again next year). */
  fromToday: boolean;
};

export type UpcomingVisit = {
  /** Stable id for the card: first appointment id in the visit. */
  key: string;
  start: DateTime;
  end: DateTime;
  windowStart: DateTime;
  windowEnd: DateTime;
  provider: PlannerProvider | null;
  typeName: string;
  appointments: Appointment[];
  petIds: number[];
};

export type FollowUpPlannerData = {
  tz: string;
  today: DateTime;
  clientId: number;
  clientName: string | null;
  clientFirstName: string | null;
  clientPhone: string | null;
  clientEmails: string[];
  doNotSms: boolean;
  pets: PlannerPet[];
  remindersByPet: Record<number, PlannerReminder[]>;
  upcoming: UpcomingVisit[];
  providers: PlannerProvider[];
  /** Today's provider, the default for every new card. */
  todayProviderId: number | null;
  /** Every type (to price existing visits) and the ones a follow-up can be booked as. */
  appointmentTypes: AppointmentType[];
  bookableTypes: AppointmentType[];
};

function str(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function plannerProviderFromApi(p: Provider): PlannerProvider {
  return {
    id: Number(p.id),
    name:
      [str(p.firstName), str(p.lastName)].filter(Boolean).join(' ') ||
      str(p.name) ||
      `Provider ${p.id}`,
    firstName: str(p.firstName),
    lastName: str(p.lastName),
  };
}

function providerFromAppointment(a: Appointment): PlannerProvider | null {
  const p = a.primaryProvider;
  if (!p || p.id == null) return null;
  return {
    id: Number(p.id),
    name: [str(p.firstName), str(p.lastName)].filter(Boolean).join(' ') || `Provider ${p.id}`,
    firstName: str(p.firstName),
    lastName: str(p.lastName),
  };
}

function dueDate(raw: string | null | undefined, tz: string): DateTime | null {
  if (!raw) return null;
  // A bare date is a calendar day in the practice; a timestamp is UTC.
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const d = DateTime.fromISO(raw, { zone: dateOnly ? tz : 'utc' });
  return d.isValid ? d.setZone(tz).startOf('day') : null;
}

/**
 * Household visits from now on, one entry per visit. Each pet has its own appointment
 * row, so rows with the same start and provider are the same house call.
 */
export function groupUpcomingVisits(
  appointments: Appointment[],
  opts: { tz: string; now: DateTime; excludeAppointmentIds: Set<number> }
): UpcomingVisit[] {
  const groups = new Map<string, Appointment[]>();
  for (const a of appointments) {
    if (a.isDeleted || a.allDay) continue;
    if (opts.excludeAppointmentIds.has(Number(a.id))) continue;
    if (isAppointmentCancelledOnPracticeCalendar(a) || isPracticeCalendarBlockAppointment(a))
      continue;
    const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' });
    if (!start.isValid || start <= opts.now) continue;
    const key = `${start.toMillis()}|${a.primaryProvider?.id ?? ''}`;
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const out: UpcomingVisit[] = [];
  for (const rows of groups.values()) {
    const first = rows[0];
    const start = DateTime.fromISO(first.appointmentStart, { zone: 'utc' }).setZone(opts.tz);
    const end = DateTime.fromISO(
      rows
        .map((r) => r.appointmentEnd)
        .sort()
        .pop() ?? first.appointmentEnd,
      { zone: 'utc' }
    ).setZone(opts.tz);
    const win = appointmentArrivalWindowIsosForSms(first, opts.tz);
    const petIds = rows.flatMap((r) =>
      patientsForAppointment(r)
        .map((p) => Number(p.id))
        .filter((id) => Number.isFinite(id))
    );
    out.push({
      key: String(first.id),
      start,
      end,
      windowStart: win ? DateTime.fromISO(win.startIso, { zone: 'utc' }).setZone(opts.tz) : start,
      windowEnd: win ? DateTime.fromISO(win.endIso, { zone: 'utc' }).setZone(opts.tz) : start,
      provider: providerFromAppointment(first),
      typeName: appointmentTypeDisplayName(first),
      appointments: rows,
      petIds: [...new Set(petIds)],
    });
  }
  return out.sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

/**
 * Everything the planner shows, loaded in parallel. A failed side load (reminders,
 * providers) degrades to empty rather than blocking follow-ups.
 */
export async function loadFollowUpPlannerData(args: {
  wrapUp: VisitWrapUp;
  practiceId: number;
  tz: string;
}): Promise<FollowUpPlannerData> {
  const { wrapUp, tz } = args;
  const clientId = wrapUp.clientId;
  if (clientId == null) throw new Error('This visit has no client on file.');
  const now = DateTime.now().setZone(tz);
  const todayIds = new Set(wrapUp.pets.map((p) => Number(p.appointmentId)));

  const [clientPayload, appts, providers, visitReminders, appointmentTypes] = await Promise.all([
    fetchClientByIdStaff(clientId).catch(() => null),
    fetchClientAppointmentsStaff(clientId, {
      practiceId: args.practiceId,
      start: now.toUTC().toISO()!,
      end: now.plus({ months: 24 }).toUTC().toISO()!,
    }).catch(() => [] as Appointment[]),
    fetchPrimaryProviders().catch(() => [] as Provider[]),
    wrapUp.pets[0]?.soapEncounterId
      ? getVisitReminders(wrapUp.pets[0].soapEncounterId).catch(() => ({ pets: [] }))
      : Promise.resolve({ pets: [] }),
    fetchAllAppointmentTypes(args.practiceId).catch(() => [] as AppointmentType[]),
  ]);

  const todayPets: PlannerPet[] = wrapUp.pets.map((p) => ({
    patientId: Number(p.patientId),
    name: p.patientName,
    species: p.species ?? null,
    onTodaysVisit: true,
    appointmentId: Number(p.appointmentId),
    soapEncounterId: p.soapEncounterId,
    savedMode: forwardBookingDispositionIsComplete(p.forwardBookingDisposition)
      ? p.forwardBookingDisposition!.mode
      : null,
  }));
  const todaySet = new Set(todayPets.map((p) => p.patientId));
  const householdPets: PlannerPet[] = activeClientPetsFromPayload(clientPayload)
    .filter((p) => !todaySet.has(Number(p.id)))
    .map((p) => ({
      patientId: Number(p.id),
      name: p.name,
      species: null,
      onTodaysVisit: false,
      appointmentId: null,
      soapEncounterId: null,
      savedMode: null,
    }));
  const pets = [...todayPets, ...householdPets];

  const openReminders = await Promise.all(
    pets.map((p) => listPatientOpenReminders(p.patientId).catch(() => []))
  );
  const remindersByPet: Record<number, PlannerReminder[]> = {};
  pets.forEach((pet, i) => {
    const rows: PlannerReminder[] = [];
    const seen = new Set<string>();
    const add = (r: PlannerReminder) => {
      const k = `${r.name.toLowerCase()}|${r.due.toISODate()}`;
      if (seen.has(k)) return;
      seen.add(k);
      rows.push(r);
    };
    const proposed = visitReminders.pets.find((v) => Number(v.patientId) === pet.patientId);
    for (const r of proposed?.reminders ?? []) {
      const due = dueDate(r.dueDate, tz);
      if (!r.removed && due) add({ key: `p:${r.key}`, name: r.description, due, fromToday: true });
    }
    for (const r of openReminders[i]) {
      const due = dueDate(r.dueDate ?? null, tz);
      if (due) add({ key: `o:${r.id}`, name: r.description, due, fromToday: false });
    }
    remindersByPet[pet.patientId] = rows.sort((a, b) => a.due.toMillis() - b.due.toMillis());
  });

  const client = (clientPayload ?? {}) as Record<string, unknown>;
  const plannerProviders = providers.map(plannerProviderFromApi);
  const todayProviderId = wrapUp.provider?.id ?? null;
  if (todayProviderId != null && !plannerProviders.some((p) => p.id === todayProviderId)) {
    plannerProviders.unshift({ id: todayProviderId, name: wrapUp.provider?.name ?? 'Provider' });
  }

  return {
    tz,
    today: now,
    clientId,
    clientName: wrapUp.clientName,
    clientFirstName: str(client.firstName) ?? str(wrapUp.clientName?.split(/\s+/)[0]),
    clientPhone: str(client.phone1) ?? str(client.phone2),
    clientEmails: wrapUp.clientDoNotEmail ? [] : (wrapUp.clientEmails ?? []),
    doNotSms: clientDoNotSmsFromRecord(clientPayload),
    pets,
    remindersByPet,
    upcoming: groupUpcomingVisits(appts, { tz, now, excludeAppointmentIds: todayIds }),
    providers: plannerProviders,
    todayProviderId,
    appointmentTypes,
    bookableTypes: plannerBookableTypes(appointmentTypes),
  };
}
