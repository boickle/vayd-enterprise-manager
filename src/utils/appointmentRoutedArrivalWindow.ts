import type { Appointment } from '../api/roomLoader';
import type { DayData } from '../pages/MyWeek';
import { effectiveWindowForScheduledStart } from './appointmentArrivalWindow';
import { appointmentPracticeDateKey } from './editVisitTimeFields';
import { fetchSchedulerDriveContextForDate } from './schedulerDriveEta';

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
  appointmentType?: Appointment['appointmentType'];
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

/** Load doctor-day + `/routing/eta` and return the routed arrival window for one appointment. */
export async function fetchRoutedArrivalWindowIsosForAppointment(
  appt: Pick<Appointment, 'id' | 'appointmentStart' | 'effectiveWindow' | 'primaryProvider'>,
  practiceTz: string,
  doctorPimsId?: string | null
): Promise<{ startIso: string; endIso: string } | null> {
  const pimsId = doctorPimsId?.trim() || appt.primaryProvider?.pimsId?.trim() || '';
  if (!pimsId) return null;

  const dateKey = appointmentPracticeDateKey(appt.appointmentStart, practiceTz);
  if (!dateKey) return null;

  const drive = await fetchSchedulerDriveContextForDate(dateKey, pimsId);
  if (!drive) return null;

  return arrivalWindowIsosFromDriveDay(drive.dayData, appt.id, appt.effectiveWindow ?? null);
}
