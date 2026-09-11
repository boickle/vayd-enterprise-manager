export const CHAT_DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

export type ChatDayName = (typeof CHAT_DAY_NAMES)[number];

export const CHAT_DAY_LABELS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

export type ChatDayHours = {
  open: string;
  close: string;
};

export type ChatHoursOfOperation = Record<ChatDayName, ChatDayHours | null | undefined>;

export type ChatHoursScheduleLine = {
  day: string;
  hours: string;
};

/** Live chat defaults: weekends only, 8:00 AM – 5:00 PM. */
export function defaultChatHoursOfOperation(): ChatHoursOfOperation {
  return {
    sunday: { open: '08:00', close: '17:00' },
    monday: null,
    tuesday: null,
    wednesday: null,
    thursday: null,
    friday: null,
    saturday: { open: '08:00', close: '17:00' },
  };
}

function isValidTimeString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim());
}

function normalizeDayHours(raw: unknown): ChatDayHours | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const { open, close } = raw as Record<string, unknown>;
  if (!isValidTimeString(open) || !isValidTimeString(close)) return null;
  return { open: open.trim(), close: close.trim() };
}

export function parseChatHoursOfOperation(raw: unknown): ChatHoursOfOperation {
  const defaults = defaultChatHoursOfOperation();
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    if (!raw.trim()) return defaults;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaults;
  }

  const out = { ...defaults };
  for (const dayName of CHAT_DAY_NAMES) {
    const dayHours = normalizeDayHours((parsed as Record<string, unknown>)[dayName]);
    out[dayName] = dayHours;
  }
  return out;
}

export function serializeChatHoursOfOperation(hours: ChatHoursOfOperation): string {
  const normalized = parseChatHoursOfOperation(hours);
  const payload: Record<string, ChatDayHours | null> = {};
  for (const dayName of CHAT_DAY_NAMES) {
    payload[dayName] = normalized[dayName] ?? null;
  }
  return JSON.stringify(payload);
}

export function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return 0;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  return hours * 60 + minutes;
}

export function formatTo12Hour(timeStr: string): string {
  if (!timeStr) return timeStr;
  const match = timeStr.match(/(\d{1,2}):(\d{2})/);
  if (!match) return timeStr;

  let hours = parseInt(match[1], 10);
  const minutes = match[2];

  if (hours >= 24) {
    hours -= 24;
  }

  const period = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;

  return `${hours12}:${minutes} ${period}`;
}

/** Legal copy style: 8:00am (no space before am/pm). */
export function formatToLegalHour(timeStr: string): string {
  const formatted = formatTo12Hour(timeStr);
  return formatted.replace(/\s(AM|PM)$/i, (_, period: string) => period.toLowerCase());
}

export function isDayOpen(hours: ChatHoursOfOperation, dayName: ChatDayName): boolean {
  const dayHours = hours[dayName];
  return Boolean(dayHours?.open && dayHours?.close);
}

export function isChatOpen(
  hours: ChatHoursOfOperation | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!hours) return false;

  const currentDay = now.getDay();
  const currentTimeMinutes = now.getHours() * 60 + now.getMinutes();
  const todayName = CHAT_DAY_NAMES[currentDay];
  const todayChatHours = hours[todayName];

  if (!todayChatHours?.open || !todayChatHours?.close) {
    return false;
  }

  const openMinutes = parseTimeToMinutes(todayChatHours.open);
  let closeMinutes = parseTimeToMinutes(todayChatHours.close);

  if (closeMinutes < openMinutes) {
    closeMinutes += 24 * 60;
  }

  return currentTimeMinutes >= openMinutes && currentTimeMinutes < closeMinutes;
}

export function formatChatHoursSchedule(
  hours: ChatHoursOfOperation | null | undefined,
): ChatHoursScheduleLine[] {
  if (!hours) return [];

  return CHAT_DAY_NAMES.map((dayName, index) => {
    const dayHours = hours[dayName];
    if (!dayHours?.open || !dayHours?.close) {
      return { day: CHAT_DAY_LABELS[index], hours: 'Closed' };
    }

    return {
      day: CHAT_DAY_LABELS[index],
      hours: `${formatTo12Hour(dayHours.open)} - ${formatTo12Hour(dayHours.close)}`,
    };
  });
}

type GroupedChatHoursSlot = {
  days: ChatDayName[];
  open: string;
  close: string;
};

function groupChatHoursForDisplay(hours: ChatHoursOfOperation): GroupedChatHoursSlot[] {
  const slots: GroupedChatHoursSlot[] = [];

  for (const dayName of CHAT_DAY_NAMES) {
    const dayHours = hours[dayName];
    if (!dayHours?.open || !dayHours?.close) continue;

    const previousDayIndex = CHAT_DAY_NAMES.indexOf(dayName) - 1;
    const previousDayName = previousDayIndex >= 0 ? CHAT_DAY_NAMES[previousDayIndex] : null;
    const last = slots[slots.length - 1];

    if (
      last &&
      last.open === dayHours.open &&
      last.close === dayHours.close &&
      previousDayName &&
      last.days[last.days.length - 1] === previousDayName
    ) {
      last.days.push(dayName);
      continue;
    }

    slots.push({ days: [dayName], open: dayHours.open, close: dayHours.close });
  }

  return slots;
}

function formatDayRange(dayNames: ChatDayName[]): string {
  const labels = dayNames.map((dayName) => CHAT_DAY_LABELS[CHAT_DAY_NAMES.indexOf(dayName)]);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;

  const indices = dayNames.map((dayName) => CHAT_DAY_NAMES.indexOf(dayName));
  const isConsecutive = indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1);
  if (isConsecutive) {
    return `${labels[0]} through ${labels[labels.length - 1]}`;
  }

  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

export function formatChatHoursLegalSummary(hours: ChatHoursOfOperation): string {
  const slots = groupChatHoursForDisplay(hours);
  if (slots.length === 0) {
    return 'Support is currently unavailable on all days.';
  }

  return slots
    .map((slot) => {
      const dayRange = formatDayRange(slot.days);
      const open = formatToLegalHour(slot.open);
      const close = formatToLegalHour(slot.close);
      return `${dayRange} from ${open} to ${close}`;
    })
    .join(', and ');
}

export function formatSupportAvailabilityIntro(hours: ChatHoursOfOperation): string {
  const openDays = CHAT_DAY_NAMES.filter((dayName) => isDayOpen(hours, dayName));
  if (openDays.length === 7) {
    return 'seven days a week during the following times:';
  }
  if (
    openDays.length === 2 &&
    openDays.includes('saturday') &&
    openDays.includes('sunday')
  ) {
    return 'on weekends during the following times:';
  }
  return 'during the following times:';
}

const PRIORITY_SUPPORT_FOOTER =
  "VAYD will review your pet's history and may consult a veterinarian if needed. No house-call visits are made after hours. If urgent care is recommended, we will direct you to an appropriate emergency facility. This service is unavailable on holidays observed by Vet At Your Door. Hours may change with thirty (30) days of notice.";

export function buildPrioritySupportAgreementParagraph(hours: ChatHoursOfOperation): string {
  const intro = formatSupportAvailabilityIntro(hours);
  const schedule = formatChatHoursLegalSummary(hours);
  return `Members may access priority support from VAYD staff ${intro} ${schedule}. ${PRIORITY_SUPPORT_FOOTER}`;
}

export function buildMembershipAgreementText(hours: ChatHoursOfOperation): string {
  const supportParagraph = buildPrioritySupportAgreementParagraph(hours);

  return [
    'Vet At Your Door Membership Agreement',
    'By enrolling your pet in a Vet At Your Door Membership Plan, you agree to the following terms and conditions.',
    'Membership Plans',
    'Foundations: Includes one annual wellness exam and trip fee, recommended annual vaccines based on age and lifestyle, annual lab work, priority scheduling, priority 7-day support from VAYD staff, fifty percent (50%) off the exam fee on additional visits beyond those included in the plan. This discount applies to the exam only; trip fees are not discounted, and the discount does not apply to end-of-life (euthanasia) visits. Member pricing (10% off) in our online store. A store discount code is issued after sign-up. Requires a twelve (12) month commitment.',
    'Golden: Includes two wellness exams with trip fees, recommended annual vaccines based on age and lifestyle, annual advanced lab work, priority scheduling, priority 7-day support from VAYD staff, fifty percent (50%) off the exam fee on additional visits beyond those included in the plan. This discount applies to the exam only; trip fees are not discounted, and the discount does not apply to end-of-life (euthanasia) visits. Member pricing (10% off) in our online store. A store discount code is issued after sign-up. Requires a twelve (12) month commitment.',
    'Puppy / Kitten Add-On: Covers booster vaccine appointments during your pet\'s first year, including the required doctor and technician visits with trip fees that are specifically tied to administering recommended booster vaccines.',
    'Priority 7-Day Support',
    supportParagraph,
    'VCPR Requirements and Limitations for New or Lapsed Patients',
    'A valid Veterinarian-Client-Patient Relationship (VCPR) requires an in-person exam within the past 365 days. If more than twelve (12) months have passed since your pet\'s most recent in-person exam with us, the VCPR is considered expired.',
    'For pets we have not yet seen, or for pets whose VCPR has lapsed, the following services cannot be provided until a current VCPR is re-established through an in-person exam:',
    'Priority 7-day support',
    'Medical advice, triage guidance, or care recommendations from your One Team',
    'Prescription medications or refills of any kind',
    'Once the initial or renewal exam is completed, all membership benefits become fully active.',
    'Memberships do not automatically cancel when the VCPR expires. It is the client\'s responsibility to ensure their pet remains current.',
    'Membership Rules',
    'Benefits apply only to the enrolled pet and cannot be shared or transferred, including to another pet in the same household. Misuse may result in cancellation and repayment of any discounts received.',
    'Memberships bill monthly or annually, renew automatically, and may transition from Foundations to Golden when your pet reaches eight (8) years of age for dogs and cats. We will email you twenty (20) to thirty (30) days before renewal with a recommendation. You may change your selection or cancel at that time.',
    'Foundations, Golden, and Puppy / Kitten plans require a twelve (12) month term. Annual billing saves ten percent (10%) compared with paying monthly.',
    'If your pet passes away or moves, the value of used services will be deducted from the payments you have made. If the value of services used exceeds payments made, the remaining balance will be due before the plan is closed. No partial refunds are issued. Re-enrollment requires a new registration fee if charged.',
    'If the client moves, any refund will be issued only after we receive both a record request from a veterinary hospital outside our service area and a copy of the client\'s new lease or mortgage agreement.',
    'A one-time registration fee, if charged, supports our Angel Fund for pets in need.',
    'Plan Change and Upgrade Limitations',
    'Membership plans, including the Puppy / Kitten Add-On, must be selected at the time of initial enrollment and cannot be added or upgraded mid-term. No other plan upgrades, downgrades, or add-ons may be added after enrollment.',
    'Scheduling and Availability',
    'Visits should be scheduled in advance for best availability. Specific appointment times cannot be guaranteed. Services are available only within our service area and during our regular appointment hours. Members receive priority scheduling, including reserve appointment slots held for members.',
    'We will make every reasonable effort for your pet\'s care to be provided by your dedicated One Team, especially for wellness visits and planned follow-up care. In situations where schedule constraints, urgent needs, staffing limitations, or routing requirements prevent your One Team from being available, another Vet At Your Door team may provide care to ensure your pet is seen in a timely manner.',
    'If we are unable to accommodate an urgent case or a requested appointment time, we may refer you to another facility or veterinary team. No refund, credit, or other remuneration will be provided as a result of such a referral.',
    'Access and Technology Requirements',
    'Internet access and a compatible device are required for virtual support and use of our online store. Instructions and your member store discount code will be provided in the Welcome Email.',
    'Client Conduct',
    'We strive to provide compassionate and high-quality care and expect respectful communication in return. Disrespectful behavior may result in termination of membership without refund.',
    'Membership Scope',
    'Membership supports proactive and routine care. Membership does not guarantee emergency availability.',
  ].join('\n\n');
}
