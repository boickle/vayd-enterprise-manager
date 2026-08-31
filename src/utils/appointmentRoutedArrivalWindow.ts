import type { Appointment } from '../api/roomLoader';
import type { DayData } from '../pages/MyWeek';
import {
  effectiveWindowForScheduledStart,
  type AppointmentTypeWindowSource,
} from './appointmentArrivalWindow';
import { appointmentPracticeDateKey } from './editVisitTimeFields';
import {
  fetchSchedulerDoctorDayBundle,
  fetchSchedulerDriveContextForDate,
  fetchSchedulerDriveEtasForDayBundle,
} from './schedulerDriveEta';

export type ArrivalWindowHouseholdContext = {
  windowStartIso?: string | null;
  windowEndIso?: string | null;
  effectiveWindow?: { startIso?: string; endIso?: string } | null;
  primary?: { effectiveWindow?: { startIso?: string; endIso?: string } } | null;
};

export type ArrivalWindowSlotContext = {
  windowStartIso?: string | null;
  windowEndIso?: string | null;
};

/**
 * Resolve arrival window isos for scheduler / doctor-day views.
 * Priority: explicit appointment effectiveWindow → doctor-day effectiveWindow → routed slot → type defaults.
 */
export function resolveArrivalWindowIsos(args: {
  apptEffectiveWindow?: { startIso?: string; endIso?: string } | null;
  household?: ArrivalWindowHouseholdContext | null;
  slot?: ArrivalWindowSlotContext | null;
  scheduledStartIso?: string | null;
  appointmentType?: AppointmentTypeWindowSource | Appointment['appointmentType'];
  appointmentEndIso?: string | null;
  practiceTz: string;
  allowTypeFallback?: boolean;
}): { startIso: string; endIso: string } | null {
  const apptStart = args.apptEffectiveWindow?.startIso?.trim() || null;
  const apptEnd = args.apptEffectiveWindow?.endIso?.trim() || null;
  if (apptStart && apptEnd) {
    return { startIso: apptStart, endIso: apptEnd };
  }

  const h = args.household;
  const doctorDayStart =
    h?.effectiveWindow?.startIso?.trim() ||
    h?.windowStartIso?.trim() ||
    h?.primary?.effectiveWindow?.startIso?.trim() ||
    null;
  const doctorDayEnd =
    h?.effectiveWindow?.endIso?.trim() ||
    h?.windowEndIso?.trim() ||
    h?.primary?.effectiveWindow?.endIso?.trim() ||
    null;
  if (doctorDayStart && doctorDayEnd) {
    return { startIso: doctorDayStart, endIso: doctorDayEnd };
  }

  if (args.slot?.windowStartIso != null && args.slot?.windowEndIso != null) {
    const slotStart = args.slot.windowStartIso.trim();
    const slotEnd = args.slot.windowEndIso.trim();
    if (slotStart && slotEnd) {
      return { startIso: slotStart, endIso: slotEnd };
    }
  }

  if (args.allowTypeFallback !== false && args.scheduledStartIso) {
    const computed = effectiveWindowForScheduledStart(
      args.scheduledStartIso,
      args.appointmentType ?? undefined,
      args.practiceTz,
      { appointmentEndIso: args.appointmentEndIso ?? undefined }
    );
    if (computed) return computed;
  }

  return null;
}

function householdAndSlotForAppointment(
  dayData: DayData,
  apptId: string | number
): { h: DayData['households'][number]; slot: DayData['timeline'][number] } | null {
  const apptKey = String(apptId);
  const households = dayData.households;
  for (let j = 0; j < households.length; j++) {
    const hx = households[j] as { sourceAppointmentIds?: (string | number)[] };
    const ids = hx.sourceAppointmentIds;
    if (!ids?.some((id) => String(id) === apptKey)) continue;
    const slot = dayData.timeline[j] ?? {};
    return { h: households[j], slot };
  }
  return null;
}

/** Same window priority as Scheduler hover + Doctor Day. */
export function arrivalWindowIsosFromDriveDay(
  dayData: DayData,
  apptId: string | number,
  apptEffectiveWindow?: { startIso: string; endIso: string } | null
): { startIso: string; endIso: string } | null {
  const row = householdAndSlotForAppointment(dayData, apptId);
  if (!row) return null;
  const { h, slot } = row;
  const practiceTz = dayData.timezone || 'America/New_York';
  const primary = (h as { primary?: { appointmentStart?: string; appointmentEnd?: string; appointmentType?: Appointment['appointmentType'] } }).primary;
  return resolveArrivalWindowIsos({
    apptEffectiveWindow,
    household: h as ArrivalWindowHouseholdContext,
    slot,
    scheduledStartIso: h.startIso ?? primary?.appointmentStart ?? null,
    appointmentType: primary?.appointmentType,
    appointmentEndIso: h.endIso ?? primary?.appointmentEnd ?? null,
    practiceTz,
  });
}

type DoctorDayDoctorRef = {
  id?: number | string | null;
  pimsId?: string | null;
};

/** Doctor ids for GET /appointments/doctor — internal employee id first (Scheduler / Doctor Day parity). */
export function doctorIdCandidatesForVisitAssignee(
  assignee?: DoctorDayDoctorRef | null,
  fallbackAssignee?: DoctorDayDoctorRef | null
): string[] {
  const out: string[] = [];
  const add = (v: unknown) => {
    const s = v != null ? String(v).trim() : '';
    if (s && !out.includes(s)) out.push(s);
  };
  for (const ref of [assignee, fallbackAssignee]) {
    if (!ref) continue;
    add(ref.id);
    add(ref.pimsId);
  }
  return out;
}

/**
 * Doctor-day effective window for one appointment (GET /appointments/doctor).
 * Ignores stored appointment `effectiveWindow` so SMS matches Scheduler doctor-day columns.
 */
export async function fetchDoctorDayEffectiveWindowIsosForAppointment(
  appt: Pick<Appointment, 'id' | 'appointmentStart' | 'primaryProvider'>,
  practiceTz: string,
  doctorIds?: string | string[] | null,
  fallbackAssignee?: DoctorDayDoctorRef | null
): Promise<{ startIso: string; endIso: string } | null> {
  const candidates = [
    ...(Array.isArray(doctorIds) ? doctorIds : doctorIds ? [doctorIds] : []),
    ...doctorIdCandidatesForVisitAssignee(appt.primaryProvider ?? null, fallbackAssignee),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);

  if (!candidates.length) return null;

  const dateKey = appointmentPracticeDateKey(appt.appointmentStart, practiceTz);
  if (!dateKey) return null;

  const apptKey = String(appt.id);

  for (const doctorId of candidates) {
    const { effectiveWindowByApptId, bundle } = await fetchSchedulerDoctorDayBundle(dateKey, doctorId);
    const fromDoctorDay = effectiveWindowByApptId.get(apptKey);
    if (fromDoctorDay) return fromDoctorDay;

    if (!bundle?.households?.length) continue;

    const { dayData } = await fetchSchedulerDriveEtasForDayBundle(bundle, doctorId);
    const fromDrive = arrivalWindowIsosFromDriveDay(dayData, appt.id, null);
    if (fromDrive) return fromDrive;
  }

  return null;
}

/** Load doctor-day + `/routing/eta` and return the routed arrival window for one appointment. */
export async function fetchRoutedArrivalWindowIsosForAppointment(
  appt: Pick<Appointment, 'id' | 'appointmentStart' | 'effectiveWindow' | 'primaryProvider'>,
  practiceTz: string,
  doctorIds?: string | string[] | null
): Promise<{ startIso: string; endIso: string } | null> {
  const candidates = [
    ...(Array.isArray(doctorIds) ? doctorIds : doctorIds ? [doctorIds] : []),
    ...doctorIdCandidatesForVisitAssignee(appt.primaryProvider ?? null),
  ]
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s, i, arr) => arr.indexOf(s) === i);

  if (!candidates.length) return null;

  const dateKey = appointmentPracticeDateKey(appt.appointmentStart, practiceTz);
  if (!dateKey) return null;

  for (const doctorId of candidates) {
    const drive = await fetchSchedulerDriveContextForDate(dateKey, doctorId);
    if (!drive) continue;
    const win = arrivalWindowIsosFromDriveDay(drive.dayData, appt.id, appt.effectiveWindow ?? null);
    if (win) return win;
  }

  return null;
}
