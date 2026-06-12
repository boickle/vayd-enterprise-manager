import type { AppointmentTypeCatalog } from './appointmentTypeSettings';
import { pointsPerPatientForType } from './appointmentTypeSettings';
import {
  forwardBookingScopeTargets,
  type RoutingForwardBookingIntentV1,
} from './routingForwardBookingIntent';

function formatPatientNameList(names: string[]): string {
  const list = names.map((n) => n.trim()).filter(Boolean);
  if (list.length === 0) return 'patient';
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(', ')}, and ${list[list.length - 1]}`;
}

export function forwardBookingBookedPatientNames(args: {
  forwardBookingVisitCompletes?: Array<{ patientName?: string | null }> | null;
  intent: RoutingForwardBookingIntentV1 | null;
}): string[] {
  const fromCompletes = args.forwardBookingVisitCompletes
    ?.map((row) => row.patientName?.trim())
    .filter((name): name is string => Boolean(name));
  if (fromCompletes?.length) return fromCompletes;

  const intent = args.intent;
  if (!intent) return [];
  const { entries } = forwardBookingScopeTargets(intent);
  return entries
    .map((row) => row.patientName?.trim())
    .filter((name): name is string => Boolean(name));
}

export function isHoldAppointmentTypeForBook(
  catalog: AppointmentTypeCatalog | undefined,
  opts: { typeId?: number | null; typeName?: string | null }
): boolean {
  return pointsPerPatientForType(catalog, opts) <= 0;
}

export function buildForwardBookingBookSuccessToast(args: {
  patientNames: string[];
  clientName: string;
  isHold: boolean;
}): string {
  const pets = formatPatientNameList(args.patientNames);
  const client = args.clientName.trim() || 'client';
  if (args.isHold) {
    return `Put on hold ${pets} for ${client}.`;
  }
  return `Booked ${pets} for ${client}.`;
}
