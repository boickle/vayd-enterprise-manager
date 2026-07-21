import type { HoldListItem } from '../api/holds';
import { buildCareOutreachSmsMessage, careOutreachClientHasSmsPhone } from './careOutreachSmsMessage';
import { formatForwardBookingSmsBookedSlot } from './forwardBookingSmsMessage';
import { appendHoldSpotReleaseClause } from './holdSpotReleaseSmsClause';
import {
  holdHouseholdEarliestAppointmentStart,
  holdHouseholdPatientNames,
  holdHouseholdSharedSource,
  type HoldHouseholdGroup,
} from './holdsHousehold';

function clientDisplayName(hold: HoldListItem): string {
  if (!hold.client) return '';
  return `${hold.client.firstName ?? ''} ${hold.client.lastName ?? ''}`.trim();
}

function clientFirstName(hold: HoldListItem): string {
  const fn = hold.client?.firstName?.trim();
  if (fn) {
    const token = fn.split(/\s+/).filter(Boolean)[0];
    if (token) return token;
  }
  const full = clientDisplayName(hold);
  const token = full.split(/\s+/).filter(Boolean)[0];
  return token || 'there';
}

function petNamesPhrase(names: readonly string[]): string {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return 'your pet';
  if (cleaned.length === 1) return cleaned[0]!;
  if (cleaned.length === 2) return `${cleaned[0]} and ${cleaned[1]}`;
  return `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`;
}

export function holdGroupHasSmsPhone(group: HoldHouseholdGroup): boolean {
  const clientId = group.anchor.client?.id;
  if (clientId == null) return false;
  return careOutreachClientHasSmsPhone(group.anchor.client?.phone1);
}

export function buildHoldSmsMessage(
  group: HoldHouseholdGroup,
  practiceTz: string
): string {
  const hold = group.anchor;
  const petNames = holdHouseholdPatientNames(group.holds);
  const source = holdHouseholdSharedSource(group.holds);
  const multiVisit = group.visitSlots.length > 1;
  const appointmentStartIso =
    holdHouseholdEarliestAppointmentStart(group.holds) ??
    group.visitSlots[0]?.anchor.appointmentStart ??
    hold.appointmentStart ??
    '';
  const holdRelease =
    appointmentStartIso.trim() !== ''
      ? { practiceTz, appointmentStartIso: appointmentStartIso.trim() }
      : undefined;

  const doctor = hold.primaryProvider?.lastName?.trim()
    ? `Dr. ${hold.primaryProvider.lastName.trim()}'s team`
    : 'the Vet At Your Door team';
  const firstName = clientFirstName(hold);
  const pets = petNamesPhrase(petNames);

  if (multiVisit) {
    const visitCount = group.visitSlots.length;
    if (source === 'care_outreach' || source === 'schedule_loader') {
      return buildCareOutreachSmsMessage({
        clientFirstName: hold.client?.firstName,
        clientDisplayName: clientDisplayName(hold),
        petNames,
        providerLastName: hold.primaryProvider?.lastName,
        anyPastDue: source === 'schedule_loader',
        holdRelease,
      });
    }
    const base = `Hi ${firstName}, it's ${doctor}! We're following up on your ${visitCount} upcoming hold visits for ${pets}. Please reply if you'd like to confirm or adjust any of these visits.`;
    return holdRelease ? appendHoldSpotReleaseClause(base, holdRelease) : base;
  }

  const slotHold = group.visitSlots[0]?.anchor ?? hold;
  const bookedSlot =
    slotHold.appointmentStart?.trim()
      ? formatForwardBookingSmsBookedSlot(
          slotHold.appointmentStart,
          slotHold.appointmentEnd,
          practiceTz
        )
      : undefined;
  const slotHoldRelease =
    slotHold.appointmentStart?.trim()
      ? { practiceTz, appointmentStartIso: slotHold.appointmentStart.trim() }
      : holdRelease;

  if (source === 'care_outreach' || source === 'schedule_loader') {
    return buildCareOutreachSmsMessage({
      clientFirstName: hold.client?.firstName,
      clientDisplayName: clientDisplayName(hold),
      petNames,
      providerLastName: hold.primaryProvider?.lastName,
      anyPastDue: source === 'schedule_loader',
      bookedSlot,
      holdRelease: slotHoldRelease,
    });
  }

  const datePart = bookedSlot?.dateLabel?.trim() || 'xxxxx';
  const windowStart = bookedSlot?.windowStart?.trim() || 'xxxx';
  const windowEnd = bookedSlot?.windowEnd?.trim() || 'xxxx';

  const base = `Hi ${firstName}, it's ${doctor}! We're following up on the hold for ${pets} on ${datePart} between ${windowStart} and ${windowEnd}. Please reply if you'd like to confirm or adjust the visit.`;
  return slotHoldRelease ? appendHoldSpotReleaseClause(base, slotHoldRelease) : base;
}
