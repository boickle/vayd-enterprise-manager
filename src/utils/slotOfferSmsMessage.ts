import { DateTime } from 'luxon';
import { appendCareOutreachSmsSuffix } from './careOutreachSmsMessage';
import { clientFirstNameForSms } from './clientFirstNameForSms';
import { formatForwardBookingSmsBookedSlot } from './forwardBookingSmsMessage';
import { providerLastNameFromDisplayName } from './scheduleLoaderSmsMessage';

function formatPetNamesPhrase(names: readonly string[]): { phrase: string; count: number } {
  const cleaned = names.map((n) => n.trim()).filter(Boolean);
  if (cleaned.length === 0) return { phrase: 'your pet', count: 1 };
  if (cleaned.length === 1) return { phrase: cleaned[0]!, count: 1 };
  if (cleaned.length === 2) return { phrase: `${cleaned[0]} and ${cleaned[1]}`, count: 2 };
  return {
    phrase: `${cleaned.slice(0, -1).join(', ')}, and ${cleaned[cleaned.length - 1]}`,
    count: cleaned.length,
  };
}

/** Client-facing date for slot-offer SMS — e.g. Tuesday, June 23 */
export function formatSlotOfferSmsDateLabel(iso: string, practiceTz: string): string {
  const trimmed = iso.trim();
  const dateOnly = trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed;
  let dt = DateTime.fromISO(dateOnly, { zone: practiceTz });
  if (!dt.isValid) {
    dt = DateTime.fromISO(trimmed, { zone: 'utc' }).setZone(practiceTz);
  }
  if (!dt.isValid) return 'xxxxx';
  return dt.toFormat('EEEE, MMMM d');
}

export function buildSlotOfferSmsMessage(opts: {
  clientFirstName?: string | null;
  clientDisplayName?: string | null;
  petNames: readonly string[];
  providerDisplayName?: string | null;
  arrivalWindowStartIso: string;
  arrivalWindowEndIso: string;
  /** Slot calendar date (YYYY-MM-DD) for window labels when window spans midnight. */
  slotDateIso?: string | null;
  /** When true, use past-due wording ("a few things past due" / "get … caught up"). */
  anyPastDue?: boolean;
  practiceTz: string;
}): string {
  const firstName = clientFirstNameForSms({
    firstName: opts.clientFirstName,
    displayLabel: opts.clientDisplayName,
  });
  const { phrase: pets, count: petCount } = formatPetNamesPhrase(opts.petNames);
  const lastName = providerLastNameFromDisplayName(opts.providerDisplayName) ?? 'your veterinarian';
  const dateLabel = formatSlotOfferSmsDateLabel(
    opts.slotDateIso?.trim() || opts.arrivalWindowStartIso,
    opts.practiceTz
  );
  const window = formatForwardBookingSmsBookedSlot(
    opts.arrivalWindowStartIso,
    opts.arrivalWindowEndIso,
    opts.practiceTz,
    opts.slotDateIso?.trim() || opts.arrivalWindowStartIso
  );
  const haveVerb = petCount === 1 ? 'has' : 'have';
  const petsAgain = petCount === 1 ? pets : 'them';
  const lead = `Hi ${firstName}, it's Vet At Your Door. Good news — Dr. ${lastName} will be in your area on ${dateLabel} and can arrive between ${window.windowStart} and ${window.windowEnd}.`;
  if (opts.anyPastDue) {
    return appendCareOutreachSmsSuffix(
      `${lead} It looks like ${pets} ${haveVerb} a few things past due, so this is a great chance to get ${petsAgain} all caught up. Tap the link below to confirm this time`
    );
  }
  return appendCareOutreachSmsSuffix(
    `${lead} ${pets} ${haveVerb} a few things coming due soon, so this is a great chance to get ${petsAgain} up to date. Tap the link below to confirm this time`
  );
}
