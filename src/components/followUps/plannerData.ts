import { DateTime } from 'luxon';
import {
  fetchAppointmentById,
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
} from '../../api/appointments';
import { listPatientOpenReminders } from '../../api/careOutreach';
import { fetchClientByIdStaff } from '../../api/clientsStaff';
import { fetchPatientByIdStaff } from '../../api/patients';
import { fetchAllAppointmentTypes, type AppointmentType } from '../../api/appointmentSettings';
import { fetchPrimaryProviders, type Provider } from '../../api/employee';
import type { ForwardBookingDispositionMode } from '../../api/forwardBookingDisposition';
import { fetchClientAppointmentsStaff } from '../../api/pimsAppointments';
import type { Appointment } from '../../api/roomLoader';
import { getVisitReminders, type VisitWrapUp } from '../../api/visitWrapUp';
import { listEncounters } from '../../api/visitWorkflow';
import type { ForwardBookingDisposition } from '../../api/forwardBookingDisposition';
import { clientDoNotSmsFromRecord, clientTextsOffReason } from '../../utils/doNotSmsWarning';
import { forwardBookingDispositionIsComplete } from '../../utils/forwardBookingDisposition';
import { appointmentArrivalWindowIsosForSms } from '../../utils/forwardBookingSmsMessage';
import { appointmentTypeDisplayName } from '../../utils/nextScheduledAppointmentForVisit';
import { activeClientPetsFromPayload, patientsForAppointment } from '../../utils/schedulerAddPet';
import { extractPatientsFromClientPayload } from '../../pages/SchedulerBookModal';
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
  /** Why the planner was opened for this pet (e.g. "Labs are back"); needs a plan. */
  focusReason?: string | null;
  /** Earlier visit that new forward-booking rows for this pet link back to. */
  sourceAppointmentId?: number | null;
  /** Patient record is inactive (e.g. deceased); shown so staff check before booking. */
  inactive?: boolean;
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
  /** "Texts off: replied STOP (Nov 9, 2026)" when Scout turned texts off itself; else null/absent. */
  textsOffReason?: string | null;
  pets: PlannerPet[];
  /**
   * The household's pet list could not be loaded, so pets not on today's visit may be
   * missing (the planner says so instead of "everyone else is booked").
   */
  householdError?: string | null;
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
 * The client's visit list doesn't carry each visit's effective arrival window (which respects the
 * doctor's work start, so an 8:00 first stop arrives 8:00–10:00, not 7:00–9:00). Visits that share a
 * start and provider are one house call, so one GET /appointments/:id per call fills it in.
 */
export async function withEffectiveWindows(
  rows: Appointment[],
  practiceId: number
): Promise<Appointment[]> {
  const callKey = (a: Appointment) => `${a.appointmentStart}|${a.primaryProvider?.id ?? ''}`;
  const missing = new Map<string, Appointment>();
  for (const a of rows) {
    if (a.effectiveWindow?.startIso && a.effectiveWindow?.endIso) continue;
    if (!missing.has(callKey(a))) missing.set(callKey(a), a);
  }
  const found = new Map<string, Pick<Appointment, 'effectiveWindow' | 'arrivalWindow'>>();
  await Promise.all(
    [...missing.entries()].map(async ([key, a]) => {
      const full = await fetchAppointmentById(a.id, { practiceId });
      if (full?.effectiveWindow?.startIso && full.effectiveWindow.endIso) {
        found.set(key, { effectiveWindow: full.effectiveWindow, arrivalWindow: full.arrivalWindow });
      }
    })
  );
  return rows.map((a) => {
    const w = found.get(callKey(a));
    return w && !a.effectiveWindow ? { ...a, ...w } : a;
  });
}

/**
 * Household visits from now on, one entry per visit. Each pet has its own appointment
 * row, so rows with the same start and provider are the same house call.
 */
/**
 * Arrival window for a household visit: if any pet at the visit needs pre-meds, every pet
 * gets the pre-meds window (the same rule the API applies to the calendar and reminders).
 */
export function householdArrivalWindow(
  first: Appointment,
  household: Array<Pick<Appointment, 'needsPremeds'>>,
  tz: string
) {
  const anyPremeds = household.some((a) => a.needsPremeds === true);
  if (!anyPremeds || first.needsPremeds === true)
    return appointmentArrivalWindowIsosForSms(first, tz);
  // The stored window was worked out without the sibling's pre-meds; recompute it.
  return appointmentArrivalWindowIsosForSms(
    { ...first, needsPremeds: true, effectiveWindow: undefined, arrivalWindow: undefined },
    tz
  );
}

/** Household visits still ahead (not today's), the only ones the planner lists as upcoming. */
function upcomingRows(appts: Appointment[], now: DateTime, todayIds: Set<number>): Appointment[] {
  return appts.filter(
    (a) =>
      !a.isDeleted &&
      !todayIds.has(Number(a.id)) &&
      DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).toMillis() > now.toMillis()
  );
}

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
    const win = householdArrivalWindow(first, rows, opts.tz);
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
 * What the planner is opened for. Checkout passes the visit's wrap-up, Start/End Visit the
 * calendar rows, and the left-nav shortcut just a client (no visit, every pet optional).
 */
export type PlannerVisitInput = {
  clientId: number | null;
  clientName: string | null;
  provider: { id: number; name: string | null } | null;
  /** Pets on the visit being wrapped up; empty when there is no visit. */
  pets: {
    patientId: number;
    name: string;
    species?: string | null;
    appointmentId: number;
    /** Looked up by appointment when not given. */
    soapEncounterId?: string | null;
    disposition?: ForwardBookingDisposition | null;
  }[];
  clientEmails?: string[];
  clientDoNotEmail?: boolean;
  /**
   * Pets the planner was opened for without a visit being wrapped up, e.g. a
   * labs-pending task: they need a plan, but their earlier visit's saved follow-up
   * choice is left as it is.
   */
  focus?: { patientId: number; sourceAppointmentId: number | null; reason: string }[];
};

export function plannerVisitFromWrapUp(w: VisitWrapUp): PlannerVisitInput {
  return {
    clientId: w.clientId,
    clientName: w.clientName,
    provider: w.provider ? { id: w.provider.id, name: w.provider.name } : null,
    pets: w.pets.map((p) => ({
      patientId: Number(p.patientId),
      name: p.patientName,
      species: p.species ?? null,
      appointmentId: Number(p.appointmentId),
      soapEncounterId: p.soapEncounterId,
      disposition: p.forwardBookingDisposition,
    })),
    clientEmails: w.clientEmails,
    clientDoNotEmail: w.clientDoNotEmail,
  };
}

/** Start/End Visit: the anchor appointment plus the same-day household rows it shows. */
export function plannerVisitFromAppointments(
  anchor: Appointment,
  householdRows: readonly Appointment[]
): PlannerVisitInput {
  const rows = householdRows.length ? householdRows : [anchor];
  const c = anchor.client;
  const p = anchor.primaryProvider;
  return {
    clientId: c?.id != null ? Number(c.id) : null,
    clientName: [str(c?.firstName), str(c?.lastName)].filter(Boolean).join(' ') || null,
    provider:
      p?.id != null
        ? {
            id: Number(p.id),
            name: [str(p.firstName), str(p.lastName)].filter(Boolean).join(' ') || null,
          }
        : null,
    pets: rows.flatMap((a) =>
      patientsForAppointment(a)
        .filter((pt) => Number.isFinite(Number(pt.id)))
        .map((pt) => ({
          patientId: Number(pt.id),
          name: str(pt.name) ?? `Patient ${pt.id}`,
          species: null,
          appointmentId: Number(a.id),
          disposition: a.forwardBookingDisposition ?? null,
        }))
    ),
  };
}

/** Left-nav shortcut: a household with no visit being wrapped up. */
export function plannerVisitForClient(
  clientId: number,
  clientName: string | null,
  focus?: PlannerVisitInput['focus']
): PlannerVisitInput {
  return { clientId, clientName, provider: null, pets: [], focus };
}

/**
 * Everything the planner shows, loaded in parallel. A failed side load (reminders,
 * providers) degrades to empty rather than blocking follow-ups.
 */
export async function loadFollowUpPlannerData(args: {
  visit: PlannerVisitInput;
  practiceId: number;
  tz: string;
}): Promise<FollowUpPlannerData> {
  const { tz } = args;
  const visit = args.visit;
  const clientId = visit.clientId;
  if (clientId == null) throw new Error('This visit has no client on file.');
  const now = DateTime.now().setZone(tz);
  const todayIds = new Set(visit.pets.map((p) => Number(p.appointmentId)));

  // The chart copy of the follow-up choice is what lets the chart be completed, so find
  // each pet's chart when the caller only knows the appointment.
  const visitPets = await Promise.all(
    visit.pets.map(async (p) => {
      if (p.soapEncounterId) return p;
      const enc = await listEncounters({
        appointmentId: p.appointmentId,
        patientId: p.patientId,
      }).catch(() => []);
      return { ...p, soapEncounterId: enc[0]?.id ?? null };
    })
  );
  const firstEncounter = visitPets.find((p) => p.soapEncounterId)?.soapEncounterId ?? null;

  const [clientPayload, appts, providers, visitReminders, appointmentTypes] = await Promise.all([
    // The household's pets come from here: try twice before giving up on them.
    fetchClientByIdStaff(clientId)
      .catch(() => fetchClientByIdStaff(clientId))
      .catch(() => null),
    fetchClientAppointmentsStaff(clientId, {
      practiceId: args.practiceId,
      start: now.toUTC().toISO()!,
      end: now.plus({ months: 24 }).toUTC().toISO()!,
    }).catch(() => [] as Appointment[]),
    fetchPrimaryProviders().catch(() => [] as Provider[]),
    firstEncounter
      ? getVisitReminders(firstEncounter).catch(() => ({ pets: [] }))
      : Promise.resolve({ pets: [] }),
    fetchAllAppointmentTypes(args.practiceId).catch(() => [] as AppointmentType[]),
  ]);

  const todayPets: PlannerPet[] = visitPets.map((p) => ({
    patientId: Number(p.patientId),
    name: p.name,
    species: p.species ?? null,
    onTodaysVisit: true,
    appointmentId: Number(p.appointmentId),
    soapEncounterId: p.soapEncounterId ?? null,
    savedMode: forwardBookingDispositionIsComplete(p.disposition ?? null)
      ? p.disposition!.mode
      : null,
  }));
  const todaySet = new Set(todayPets.map((p) => p.patientId));
  const householdRows: { id: number; name: string }[] = activeClientPetsFromPayload(
    clientPayload
  ).map((p) => ({ id: Number(p.id), name: p.name }));
  // A pet on one of the household's upcoming visits is in the household even when the
  // pet list did not load (or left it out). Pets the list has as inactive stay out.
  const listed = new Set(extractPatientsFromClientPayload(clientPayload).map((p) => Number(p.id)));
  for (const a of appts) {
    if (a.isDeleted || isAppointmentCancelledOnPracticeCalendar(a)) continue;
    for (const pt of patientsForAppointment(a)) {
      const id = Number(pt.id);
      if (!Number.isFinite(id) || listed.has(id) || householdRows.some((r) => r.id === id))
        continue;
      householdRows.push({ id, name: str(pt.name) ?? `Patient ${id}` });
    }
  }
  const householdPets: PlannerPet[] = householdRows
    .filter((p) => Number.isFinite(p.id) && !todaySet.has(p.id))
    .map((p) => {
      const focus = visit.focus?.find((f) => f.patientId === Number(p.id));
      return {
        patientId: Number(p.id),
        name: p.name,
        species: null,
        onTodaysVisit: false,
        appointmentId: null,
        soapEncounterId: null,
        savedMode: null,
        focusReason: focus?.reason ?? null,
        sourceAppointmentId: focus?.sourceAppointmentId ?? null,
      };
    })
    // Pets the planner was opened for come first.
    .sort((a, b) => Number(!!b.focusReason) - Number(!!a.focusReason));
  // A pet the planner was opened for must never vanish because its record is inactive.
  const missingFocus = (visit.focus ?? []).filter(
    (f) => !todaySet.has(f.patientId) && !householdPets.some((p) => p.patientId === f.patientId)
  );
  const inactiveFocusPets: PlannerPet[] = await Promise.all(
    missingFocus.map(async (f) => {
      const raw = (await fetchPatientByIdStaff(f.patientId).catch(() => null)) as Record<
        string,
        unknown
      > | null;
      return {
        patientId: f.patientId,
        name: str(raw?.name) ?? `Patient ${f.patientId}`,
        species: str(raw?.species) ?? null,
        onTodaysVisit: false,
        appointmentId: null,
        soapEncounterId: null,
        savedMode: null,
        focusReason: f.reason,
        sourceAppointmentId: f.sourceAppointmentId,
        inactive: true,
      };
    })
  );
  const pets = [...todayPets, ...inactiveFocusPets, ...householdPets];

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
  const todayProviderId = visit.provider?.id ?? null;
  if (todayProviderId != null && !plannerProviders.some((p) => p.id === todayProviderId)) {
    plannerProviders.unshift({ id: todayProviderId, name: visit.provider?.name ?? 'Provider' });
  }

  return {
    tz,
    today: now,
    clientId,
    clientName:
      visit.clientName ??
      ([str(client.firstName), str(client.lastName)].filter(Boolean).join(' ') || null),
    clientFirstName: str(client.firstName) ?? str(visit.clientName?.split(/\s+/)[0]),
    clientPhone: str(client.phone1) ?? str(client.phone2),
    clientEmails:
      visit.clientDoNotEmail || client.doNotEmail === true
        ? []
        : (visit.clientEmails ??
          [str(client.email), str(client.secondEmail)].filter((e): e is string => !!e)),
    doNotSms: clientDoNotSmsFromRecord(clientPayload),
    textsOffReason: clientTextsOffReason(clientPayload),
    pets,
    householdError:
      clientPayload == null
        ? 'Could not load the rest of the household. Close and reopen to try again.'
        : null,
    remindersByPet,
    upcoming: groupUpcomingVisits(await withEffectiveWindows(upcomingRows(appts, now, todayIds), args.practiceId), {
      tz,
      now,
      excludeAppointmentIds: todayIds,
    }),
    providers: plannerProviders,
    todayProviderId,
    appointmentTypes,
    bookableTypes: plannerBookableTypes(appointmentTypes),
  };
}
