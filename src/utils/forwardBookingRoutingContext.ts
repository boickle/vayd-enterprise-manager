import { DateTime } from 'luxon';
import type { RoutingForwardBookingIntentV1 } from './routingForwardBookingIntent';
import { formatForwardBookingIntervalLabel } from './forwardBookingFromAppointment';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

export type ForwardBookingWorkspaceContextView = {
  clientLabel: string;
  patientNames: string[];
  visitLine: string;
  originalVisitLabel: string | null;
  targetDateLabel: string | null;
  providerLabel: string | null;
  bookingNote: string | null;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function formatForwardBookingDisplayDate(
  iso: string | null | undefined,
  practiceTz: string
): string | null {
  if (!iso?.trim()) return null;
  const dt = DateTime.fromISO(iso, { zone: 'utc' }).setZone(practiceTimeZoneOrDefault(practiceTz));
  return dt.isValid ? dt.toFormat('EEE, MMM d, yyyy') : null;
}

export function buildForwardBookingWorkspaceContext(
  intent: RoutingForwardBookingIntentV1 | null | undefined,
  practiceTz: string
): ForwardBookingWorkspaceContextView | null {
  if (!intent) return null;

  const intervalLabel = formatForwardBookingIntervalLabel({
    intervalAmount: intent.intervalAmount,
    intervalUnit: intent.intervalUnit,
    monthsOut: intent.monthsOut,
  });
  const typeName = intent.appointmentTypeName?.trim() || 'Visit';
  const visitLine =
    intervalLabel !== '—' ? `${typeName} · ${intervalLabel}` : typeName;

  const householdNames = (intent.householdEntries ?? [])
    .map((e) => pickStr(e.patientName))
    .filter(Boolean) as string[];
  const patientNames =
    householdNames.length > 0
      ? householdNames
      : intent.patientName?.trim()
        ? [intent.patientName.trim()]
        : [];

  const targetIso = intent.targetDueDate?.trim() || null;

  return {
    clientLabel: intent.clientDisplayLabel?.trim() || 'Client',
    patientNames,
    visitLine,
    originalVisitLabel: formatForwardBookingDisplayDate(intent.sourceAppointmentStart, practiceTz),
    targetDateLabel: formatForwardBookingDisplayDate(targetIso, practiceTz),
    providerLabel: intent.primaryDoctorDisplayName?.trim() || null,
    bookingNote: intent.bookingNotes?.trim() || null,
  };
}

/** Compact one-line summary for embedded scheduler bar. */
export function forwardBookingWorkspaceContextBarLine(
  ctx: ForwardBookingWorkspaceContextView
): string {
  const parts = [ctx.clientLabel];
  if (ctx.patientNames.length === 1) parts.push(ctx.patientNames[0]!);
  else if (ctx.patientNames.length > 1) parts.push(`${ctx.patientNames.length} pets`);
  parts.push(ctx.visitLine);
  if (ctx.targetDateLabel) parts.push(`Target ${ctx.targetDateLabel}`);
  return parts.join(' · ');
}
