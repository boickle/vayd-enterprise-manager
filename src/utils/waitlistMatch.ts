import type { WaitlistEntry, WaitlistPreferredWindow } from '../api/waitlist';
import { practiceTimeZoneOrDefault } from './practiceTimezone';
import { DateTime } from 'luxon';

const WINDOW_DAYS: Record<WaitlistPreferredWindow, number | null> = {
  asap: 14,
  week: 7,
  two_weeks: 14,
  month: 30,
  flexible: null,
};

export const WAITLIST_WINDOW_OPTIONS: { value: WaitlistPreferredWindow; label: string; hint: string }[] = [
  { value: 'asap', label: 'ASAP', hint: 'Call first when something opens in the next 2 weeks' },
  { value: 'week', label: 'Next 7 days', hint: 'Only if the opening is this week' },
  { value: 'two_weeks', label: 'Next 2 weeks', hint: 'Openings within 14 days' },
  { value: 'month', label: 'Next 30 days', hint: 'Can wait up to a month' },
  { value: 'flexible', label: 'Flexible', hint: 'Any cancellation — keep them in the pool' },
];

export function waitlistWindowLabel(window: WaitlistPreferredWindow | null | undefined): string {
  return WAITLIST_WINDOW_OPTIONS.find((o) => o.value === window)?.label ?? 'ASAP';
}

export function waitlistDaysWaiting(entry: Pick<WaitlistEntry, 'created'>, practiceTz?: string): number {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const created = DateTime.fromISO(entry.created, { zone: 'utc' }).setZone(tz).startOf('day');
  const today = DateTime.now().setZone(tz).startOf('day');
  if (!created.isValid) return 0;
  return Math.max(0, Math.floor(today.diff(created, 'days').days));
}

export function waitlistEntryMatchesTargetDate(
  entry: Pick<WaitlistEntry, 'created' | 'preferredWindow' | 'preferredStartDate' | 'preferredEndDate'>,
  targetDateYmd: string,
  practiceTz?: string,
): boolean {
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const target = DateTime.fromISO(targetDateYmd, { zone: tz }).startOf('day');
  if (!target.isValid) return false;
  const created = DateTime.fromISO(entry.created, { zone: 'utc' }).setZone(tz).startOf('day');
  const start = entry.preferredStartDate?.trim()
    ? DateTime.fromISO(entry.preferredStartDate.trim(), { zone: tz }).startOf('day')
    : created;
  if (start.isValid && target < start) return false;
  if (entry.preferredEndDate?.trim()) {
    const end = DateTime.fromISO(entry.preferredEndDate.trim(), { zone: tz }).startOf('day');
    if (end.isValid && target > end) return false;
    return true;
  }
  const days = WINDOW_DAYS[entry.preferredWindow] ?? null;
  if (days == null) return true;
  const windowEnd = (start.isValid ? start : created).plus({ days });
  return target <= windowEnd;
}

export function waitlistSortForCancellation(
  a: WaitlistEntry,
  b: WaitlistEntry,
  args: { doctorInternalId?: number | null; targetDateYmd?: string | null; practiceTz?: string },
): number {
  const target = args.targetDateYmd?.trim() || null;
  if (target) {
    const matchA = waitlistEntryMatchesTargetDate(a, target, args.practiceTz) ? 0 : 1;
    const matchB = waitlistEntryMatchesTargetDate(b, target, args.practiceTz) ? 0 : 1;
    if (matchA !== matchB) return matchA - matchB;
  }
  const doc = args.doctorInternalId;
  if (doc != null && Number.isFinite(doc) && doc > 0) {
    const prefA = Number(a.preferredProviderId) === Number(doc) ? 0 : 1;
    const prefB = Number(b.preferredProviderId) === Number(doc) ? 0 : 1;
    if (prefA !== prefB) return prefA - prefB;
  }
  const asapRank = (w: WaitlistPreferredWindow) => (w === 'asap' ? 0 : w === 'flexible' ? 2 : 1);
  const asap = asapRank(a.preferredWindow) - asapRank(b.preferredWindow);
  if (asap !== 0) return asap;
  return String(a.created).localeCompare(String(b.created));
}

export function waitlistClientDisplayName(entry: WaitlistEntry): string {
  const c = entry.client;
  const name = `${c?.firstName ?? ''} ${c?.lastName ?? ''}`.trim();
  return name || `Client #${entry.clientId}`;
}

export function waitlistClientFirstName(entry: WaitlistEntry): string | null {
  const fn = entry.client?.firstName?.trim();
  if (fn) return fn.split(/\s+/).filter(Boolean)[0] ?? null;
  const full = waitlistClientDisplayName(entry);
  return full.split(/\s+/).filter(Boolean)[0] ?? null;
}

export function waitlistAddressLine(entry: WaitlistEntry): string {
  const c = entry.client;
  return [c?.address1, c?.city, c?.state, c?.zipcode].map((s) => s?.trim()).filter(Boolean).join(', ');
}

export function waitlistPetNames(entry: WaitlistEntry): string[] {
  return (entry.patients ?? []).map((p) => p.name?.trim()).filter((n): n is string => Boolean(n));
}
