import { DateTime } from 'luxon';
import type { ForwardBookingIntervalUnit } from '../../api/forwardBooking';
import type { ForwardBookingDispositionMode } from '../../api/forwardBookingDisposition';
import { isNonDoctorPlaceholderName } from '../../utils/bookingCalendarMetrics';

/**
 * Pure rules behind the Schedule follow-ups planner (docs/follow-up-scheduler-plan.md).
 * No React, no network: everything here is unit-tested in plannerModel.test.ts.
 */

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export type PlannerPresetKey = '2w' | '1m' | '3m' | '6m' | '1y';
export type PlannerCustomUnit = 'days' | 'weeks' | 'months' | 'years';

export type PlannerInterval =
  | { kind: 'preset'; key: PlannerPresetKey }
  | { kind: 'custom'; amount: number; unit: PlannerCustomUnit }
  /** A specific day, `yyyy-MM-dd` in the practice time zone. */
  | { kind: 'date'; date: string };

export const PLANNER_PRESETS: { key: PlannerPresetKey; label: string }[] = [
  { key: '2w', label: '2 weeks' },
  { key: '1m', label: '1 month' },
  { key: '3m', label: '3 months' },
  { key: '6m', label: '6 months' },
  { key: '1y', label: '1 year' },
];

const PRESET_SPAN: Record<PlannerPresetKey, { amount: number; unit: PlannerCustomUnit }> = {
  '2w': { amount: 2, unit: 'weeks' },
  '1m': { amount: 1, unit: 'months' },
  '3m': { amount: 3, unit: 'months' },
  '6m': { amount: 6, unit: 'months' },
  '1y': { amount: 1, unit: 'years' },
};

function span(interval: PlannerInterval): { amount: number; unit: PlannerCustomUnit } | null {
  if (interval.kind === 'preset') return PRESET_SPAN[interval.key];
  if (interval.kind === 'custom') {
    const amount = Math.max(1, Math.floor(Number(interval.amount) || 1));
    return { amount, unit: interval.unit };
  }
  return null;
}

/** Practice-local start of the day the follow-up is aimed at. */
export function plannerTargetDate(interval: PlannerInterval, today: DateTime): DateTime {
  const base = today.startOf('day');
  if (interval.kind === 'date') {
    const d = DateTime.fromISO(interval.date, { zone: base.zone });
    return d.isValid ? d.startOf('day') : base;
  }
  const s = span(interval)!;
  return base.plus({ [s.unit]: s.amount });
}

/** Card title, e.g. "In 2 weeks", "In 10 days", "On Jan 20, 2027". */
export function plannerIntervalLabel(interval: PlannerInterval, today: DateTime): string {
  if (interval.kind === 'date') {
    return `On ${plannerTargetDate(interval, today).toFormat('LLL d, yyyy')}`;
  }
  if (interval.kind === 'preset') {
    return `In ${PLANNER_PRESETS.find((p) => p.key === interval.key)!.label}`;
  }
  const s = span(interval)!;
  const unit = s.amount === 1 ? s.unit.replace(/s$/, '') : s.unit;
  return `In ${s.amount} ${unit}`;
}

/**
 * The forward-booking API only knows days, weeks and months, and computes the target due
 * date from the day the row is created. Years become months; a specific date becomes the
 * number of days until it, which lands the target on exactly that day.
 */
export function plannerIntervalForApi(
  interval: PlannerInterval,
  today: DateTime
): { intervalAmount: number; intervalUnit: ForwardBookingIntervalUnit } {
  if (interval.kind === 'date') {
    const days = Math.round(
      plannerTargetDate(interval, today).diff(today.startOf('day'), 'days').days
    );
    return { intervalAmount: Math.max(1, days), intervalUnit: 'days' };
  }
  const s = span(interval)!;
  if (s.unit === 'years') return { intervalAmount: s.amount * 12, intervalUnit: 'months' };
  return { intervalAmount: s.amount, intervalUnit: s.unit };
}

// ---------------------------------------------------------------------------
// Reminders against a visit date
// ---------------------------------------------------------------------------

/** One window for every reminder type (decided Nov 3, 2026). */
export const REMINDER_FIT_WINDOW = { daysBefore: 30, daysAfter: 45 } as const;
/** Without a visit to compare against, anything due this soon is flagged. */
export const REMINDER_SOON_DAYS = 60;

export type ReminderFit = 'overdue' | 'soon' | 'early' | 'fits' | 'later' | 'booked';

/**
 * Colors a reminder for one placement.
 * - `fits`: due from 30 days before to 45 days after the visit, so it can be done then.
 * - `early`: comes due before that window, a sign the timing is wrong for this pet.
 * - `overdue` / `later`: already past due / due after this visit.
 * With no visit (`target` null), `soon` marks anything due within 60 days.
 */
export function reminderFit(
  due: DateTime,
  target: DateTime | null,
  today: DateTime,
  opts?: { coveredByUpcomingVisit?: boolean }
): ReminderFit {
  if (opts?.coveredByUpcomingVisit) return 'booked';
  const dueDay = due.startOf('day');
  if (dueDay < today.startOf('day')) return 'overdue';
  if (!target) {
    return dueDay.diff(today.startOf('day'), 'days').days < REMINDER_SOON_DAYS ? 'soon' : 'later';
  }
  const offset = dueDay.diff(target.startOf('day'), 'days').days;
  if (offset < -REMINDER_FIT_WINDOW.daysBefore) return 'early';
  if (offset <= REMINDER_FIT_WINDOW.daysAfter) return 'fits';
  return 'later';
}

// ---------------------------------------------------------------------------
// Which existing follow-up choice a pet saves
// ---------------------------------------------------------------------------

/**
 * Where a pet sits in the planner. A pet may have several placements (2-week recheck and
 * 1-year annual); `none` is exclusive and enforced by the planner.
 */
export type PlacementOutcome =
  /** Booked on the calendar from a new card, or added to a household visit here. */
  | 'booked'
  /** Already on an upcoming visit before the planner opened. */
  | 'already_booked'
  | 'send_to_cls'
  | 'labs_pending'
  | 'none';

const OUTCOME_PRIORITY: PlacementOutcome[] = [
  'booked',
  'send_to_cls',
  'labs_pending',
  'already_booked',
  'none',
];

const OUTCOME_MODE: Record<PlacementOutcome, ForwardBookingDispositionMode> = {
  booked: 'booked_at_appointment',
  send_to_cls: 'forward_book_fields',
  labs_pending: 'labs_pending',
  already_booked: 'already_booked',
  none: 'not_appropriate',
};

/**
 * Today's pets still save exactly one of the five existing choices. The strongest
 * placement wins, so Marvin booked for 2 weeks and sent to the CLs for 1 year reads as
 * "Booked at appointment" (his 1-year row is still created separately).
 */
export function dispositionModeForOutcomes(
  outcomes: readonly PlacementOutcome[]
): ForwardBookingDispositionMode | null {
  for (const o of OUTCOME_PRIORITY) {
    if (outcomes.includes(o)) return OUTCOME_MODE[o];
  }
  return null;
}

// ---------------------------------------------------------------------------
// Provider wording and the owner's confirmation text
// ---------------------------------------------------------------------------

export type PlannerProvider = {
  id: number;
  name: string;
  firstName?: string | null;
  lastName?: string | null;
};

export function providerIsTechTeam(p: Pick<PlannerProvider, 'name'> | null | undefined): boolean {
  return !!p && isNonDoctorPlaceholderName(p.name ?? '');
}

/** How the owner text names who is coming: "Dr. Patel" or "our tech team". */
export function providerTextLabel(p: PlannerProvider | null | undefined): string {
  if (!p) return 'our team';
  if (providerIsTechTeam(p)) return 'our tech team';
  const last = p.lastName?.trim();
  if (last) return `Dr. ${last}`;
  // "Dr. Sam Nguyen, DVM" → "Dr. Nguyen"
  const parts = p.name
    .replace(/,.*$/, '')
    .replace(/^dr\.?\s+/i, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts.length ? `Dr. ${parts[parts.length - 1]}` : 'our team';
}

export type ConfirmationBooking = {
  start: DateTime;
  /** Arrival window shown to the owner. */
  windowStart: DateTime;
  windowEnd: DateTime;
  petNames: string[];
  provider: PlannerProvider | null;
  /** Set when the pets were added to a housemate's visit, e.g. "Greta". */
  joiningPetNames?: string[];
};

export function joinNames(names: readonly string[]): string {
  const n = names.map((s) => s.trim()).filter(Boolean);
  if (n.length <= 2) return n.join(' & ');
  return `${n.slice(0, -1).join(', ')} & ${n[n.length - 1]}`;
}

/** Bookings in date order, which is also the order of lines in the text. */
export function sortConfirmationBookings(bookings: readonly ConfirmationBooking[]) {
  return [...bookings].sort((a, b) => a.start.toMillis() - b.start.toMillis());
}

/**
 * The text goes out from the provider on the earliest booked visit. Tech Team (or no
 * provider) returns null, which callers send from the practice main line.
 */
export function confirmationSendProvider(
  bookings: readonly ConfirmationBooking[]
): PlannerProvider | null {
  const first = sortConfirmationBookings(bookings)[0];
  if (!first?.provider || providerIsTechTeam(first.provider)) return null;
  return first.provider;
}

export function buildFollowUpConfirmationText(args: {
  clientFirstName: string | null;
  practiceName: string;
  bookings: readonly ConfirmationBooking[];
  /** Pets the CLs will call about, with the month they will reach out. */
  clMentions?: readonly { petNames: string[]; around: DateTime }[];
  labsPetNames?: readonly string[];
}): string {
  const hi = args.clientFirstName?.trim() ? `Hi ${args.clientFirstName.trim()}` : 'Hi';
  const lines = sortConfirmationBookings(args.bookings).map((b) => {
    const joining = b.joiningPetNames?.length
      ? ` (same visit as ${joinNames(b.joiningPetNames)})`
      : '';
    return `• ${joinNames(b.petNames)}: ${b.start.toFormat('ccc, LLL d, yyyy')}, arriving between ${b.windowStart.toFormat('h:mm a')} and ${b.windowEnd.toFormat('h:mm a')} with ${providerTextLabel(b.provider)}${joining}`;
  });
  const extra: string[] = [];
  for (const m of args.clMentions ?? []) {
    extra.push(
      `We'll reach out around ${m.around.toFormat('LLLL yyyy')} to schedule ${joinNames(m.petNames)}.`
    );
  }
  if (args.labsPetNames?.length) {
    extra.push(
      `We'll be in touch about ${joinNames(args.labsPetNames)} once lab results are back.`
    );
  }
  return [
    `${hi}, thanks for having us today! Here's what we booked:`,
    lines.join('\n'),
    ...(extra.length ? ['', extra.join(' ')] : []),
    '',
    `Reply to this text if anything needs to change. – ${args.practiceName}`,
  ].join('\n');
}

/** Same 160/153-character split carriers use. */
export function smsSegmentCount(text: string): number {
  const n = text.length;
  if (n <= 160) return 1;
  return Math.ceil(n / 153);
}

// ---------------------------------------------------------------------------
// Undo window after booking
// ---------------------------------------------------------------------------

/** Booked appointments lock after this; changes then go through the calendar. */
export const BOOKING_UNDO_MS = 10_000;

export function bookingUndoOpen(bookedAtMs: number, nowMs: number): boolean {
  return nowMs - bookedAtMs < BOOKING_UNDO_MS;
}
