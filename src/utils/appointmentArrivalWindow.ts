import { DateTime } from 'luxon';
import {
  formatIsoInPracticeZone,
  practiceTimeZoneOrDefault,
} from './practiceTimezone';

export type AppointmentTypeWindowSource = {
  name: string;
  prettyName?: string | null;
  windowBeforeMinutes?: number | null;
  windowAfterMinutes?: number | null;
};

export function isFixedTimeAppointmentTypeName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return lower === 'fixed time' || lower.includes('fixed time');
}

/** Customer arrival window from scheduled start + appointment type (±N minutes). */
export function effectiveWindowForScheduledStart(
  appointmentStartIso: string,
  appointmentType: AppointmentTypeWindowSource | undefined,
  practiceTz: string,
  opts?: { appointmentEndIso?: string }
): { startIso: string; endIso: string } | undefined {
  const typeName = (appointmentType?.prettyName || appointmentType?.name || '').trim();
  if (typeName && isFixedTimeAppointmentTypeName(typeName)) {
    return {
      startIso: appointmentStartIso,
      endIso: opts?.appointmentEndIso?.trim() || appointmentStartIso,
    };
  }
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const start = DateTime.fromISO(appointmentStartIso, { zone: 'utc' }).setZone(tz);
  if (!start.isValid) return undefined;
  const before = appointmentType?.windowBeforeMinutes ?? 60;
  const after = appointmentType?.windowAfterMinutes ?? 60;
  return {
    startIso: start.minus({ minutes: before }).toUTC().toISO() ?? appointmentStartIso,
    endIso: start.plus({ minutes: after }).toUTC().toISO() ?? appointmentStartIso,
  };
}

export function arrivalWindowFromScheduledStart(
  appointmentStartIso: string,
  appointmentType: AppointmentTypeWindowSource | undefined,
  practiceTz: string,
  opts?: { appointmentEndIso?: string }
): { windowStartIso: string; windowEndIso: string } | undefined {
  const ew = effectiveWindowForScheduledStart(appointmentStartIso, appointmentType, practiceTz, opts);
  if (!ew) return undefined;
  return { windowStartIso: ew.startIso, windowEndIso: ew.endIso };
}

/** Client-facing copy for a scheduled arrival window. */
export function formatClientArrivalWindowMessage(
  windowStartIso: string,
  windowEndIso: string,
  practiceTz: string,
): string {
  const start = formatIsoInPracticeZone(windowStartIso, practiceTz);
  const end = formatIsoInPracticeZone(windowEndIso, practiceTz);
  if (!start || !end) return '';
  if (start === end) return `We will come at ${start}`;
  return `We will come between ${start} and ${end}`;
}

export function resolveClientArrivalWindowForScheduledStart(
  appointmentStartIso: string,
  appointmentType: AppointmentTypeWindowSource | undefined,
  practiceTz: string,
  opts?: { appointmentEndIso?: string },
): {
  windowStartIso: string;
  windowEndIso: string;
  windowDisplay: string;
} | undefined {
  const window = arrivalWindowFromScheduledStart(
    appointmentStartIso,
    appointmentType,
    practiceTz,
    opts,
  );
  if (!window) return undefined;
  const windowDisplay = formatClientArrivalWindowMessage(
    window.windowStartIso,
    window.windowEndIso,
    practiceTz,
  );
  if (!windowDisplay) return undefined;
  return {
    windowStartIso: window.windowStartIso,
    windowEndIso: window.windowEndIso,
    windowDisplay,
  };
}
