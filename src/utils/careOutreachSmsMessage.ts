import type { ForwardBookingSmsBookedSlot } from './forwardBookingSmsMessage';

/** Appended to client-facing care outreach SMS (hold follow-up and text offers). */
export const CARE_OUTREACH_SMS_SUFFIX = '-- neighborhood slots go fast.';

export function appendCareOutreachSmsSuffix(message: string): string {
  const trimmed = message.trimEnd();
  if (trimmed.includes(CARE_OUTREACH_SMS_SUFFIX)) return trimmed;
  return `${trimmed} ${CARE_OUTREACH_SMS_SUFFIX}`;
}

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

function normalizeClientFirstName(
  clientFirstName?: string | null,
  clientDisplayName?: string | null
): string {
  const fn = clientFirstName?.trim();
  if (fn) {
    const token = fn.split(/\s+/).filter(Boolean)[0];
    if (token) return token;
  }
  const full = clientDisplayName?.trim();
  if (full) {
    const token = full.split(/\s+/).filter(Boolean)[0];
    if (token) return token;
  }
  return 'there';
}

export function careOutreachDoctorClosingPhrase(providerLastName?: string | null): string {
  const ln = providerLastName?.trim();
  if (!ln) return 'us';
  return `Dr. ${ln}`;
}

export function buildCareOutreachSmsMessage(opts: {
  petNames: readonly string[];
  clientFirstName?: string | null;
  clientDisplayName?: string | null;
  bookedSlot?: ForwardBookingSmsBookedSlot;
  providerLastName?: string | null;
  /** When true, use past-due wording (Schedule loader style). */
  anyPastDue?: boolean;
}): string {
  const firstName = normalizeClientFirstName(opts.clientFirstName, opts.clientDisplayName);
  const { phrase: pets, count: petCount } = formatPetNamesPhrase(opts.petNames);
  const haveVerb = petCount === 1 ? 'has' : 'have';
  const datePart = opts.bookedSlot?.dateLabel?.trim() || 'xxxxx';
  const windowStart = opts.bookedSlot?.windowStart?.trim() || 'xxxx';
  const windowEnd = opts.bookedSlot?.windowEnd?.trim() || 'xxxx';
  const doctorLastName = opts.providerLastName?.trim() || 'xxxxx';
  if (opts.anyPastDue) {
    return appendCareOutreachSmsSuffix(
      `Hi ${firstName}, it's Dr. ${doctorLastName}'s team at Vet At Your Door! It looks like ${pets} ${haveVerb} a few things past due, and Dr. ${doctorLastName} is going to be in your neighborhood on ${datePart} between ${windowStart} and ${windowEnd}. Would it be a good time for the team to stop by then to get ${pets} all up to date?`
    );
  }
  return appendCareOutreachSmsSuffix(
    `Hi ${firstName}, it's Dr. ${doctorLastName}'s team at Vet At Your Door! It looks like ${pets} ${haveVerb} a few things coming due, and Dr. ${doctorLastName} is already going to be in your neighborhood on ${datePart} between ${windowStart} and ${windowEnd}. Would it be a good time for the team to stop by then?`
  );
}

export function careOutreachClientHasSmsPhone(phone: string | null | undefined): boolean {
  const raw = phone?.trim();
  if (!raw) return false;
  return raw.replace(/\D/g, '').length >= 10;
}
