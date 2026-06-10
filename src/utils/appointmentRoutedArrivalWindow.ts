import type { Appointment } from '../api/roomLoader';
import type { DayData } from '../pages/MyWeek';
import { appointmentPracticeDateKey } from './editVisitTimeFields';
import { fetchSchedulerDriveContextForDate } from './schedulerDriveEta';

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

/** Same window priority as Scheduler hover + Doctor Day: routed ETA slot, then doctor-day effectiveWindow. */
export function arrivalWindowIsosFromDriveDay(
  dayData: DayData,
  apptId: string | number,
  apptEffectiveWindow?: { startIso: string; endIso: string } | null
): { startIso: string; endIso: string } | null {
  const row = householdAndSlotForAppointment(dayData, apptId);
  if (!row) return null;
  const { h, slot } = row;

  const apptWindowStart = apptEffectiveWindow?.startIso?.trim() || null;
  const apptWindowEnd = apptEffectiveWindow?.endIso?.trim() || null;

  const windowStartIso =
    apptWindowStart && apptWindowEnd
      ? apptWindowStart
      : (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowStartIso : null) ??
        (h as { windowStartIso?: string | null }).windowStartIso ??
        (h as { effectiveWindow?: { startIso?: string } }).effectiveWindow?.startIso ??
        (h as { primary?: { effectiveWindow?: { startIso?: string } } }).primary?.effectiveWindow
          ?.startIso ??
        null;

  const windowEndIso =
    apptWindowStart && apptWindowEnd
      ? apptWindowEnd
      : (slot?.windowStartIso != null && slot?.windowEndIso != null ? slot.windowEndIso : null) ??
        (h as { windowEndIso?: string | null }).windowEndIso ??
        (h as { effectiveWindow?: { endIso?: string } }).effectiveWindow?.endIso ??
        (h as { primary?: { effectiveWindow?: { endIso?: string } } }).primary?.effectiveWindow
          ?.endIso ??
        null;

  if (!windowStartIso?.trim() || !windowEndIso?.trim()) return null;
  return { startIso: windowStartIso.trim(), endIso: windowEndIso.trim() };
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
