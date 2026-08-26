/**
 * Configurable max routing scores for client-offered slots (appointment request
 * self-schedule + texted offers). Lower score = better fit.
 *
 * Thresholds vary by appointment type and how soon the suggested slot is relative
 * to "today" in the practice timezone. Unset per-type values fall back to globals.
 */
import { DateTime } from 'luxon';
import { ROUTING_OFFERABLE_MAX_SCORE } from './routingOfferableScore';

export const ROUTING_OFFERABLE_SCORE_THRESHOLDS_KEY =
  'routing.offerableScoreThresholds';

/** Day-proximity buckets for offerable max score. */
export type OfferableScoreDayBucket =
  | 'sameDay'
  | 'nextDay'
  | 'withinWeek'
  | 'later';

export const OFFERABLE_SCORE_DAY_BUCKETS: OfferableScoreDayBucket[] = [
  'sameDay',
  'nextDay',
  'withinWeek',
  'later',
];

export const OFFERABLE_SCORE_DAY_BUCKET_LABELS: Record<
  OfferableScoreDayBucket,
  string
> = {
  sameDay: 'Same day',
  nextDay: 'Next day',
  withinWeek: 'Within 7 days (2–6)',
  later: 'Later (7+ days)',
};

export const OFFERABLE_SCORE_DAY_BUCKET_HINTS: Record<
  OfferableScoreDayBucket,
  string
> = {
  sameDay: 'Slot starts today — typically allow a higher (worse) score to fill openings.',
  nextDay: 'Slot starts tomorrow.',
  withinWeek: 'Slot is 2–6 days from today.',
  later: 'Slot is 7 or more days from today.',
};

export type OfferableScoreThresholdsByBucket = Partial<
  Record<OfferableScoreDayBucket, number>
>;

export type RoutingOfferableScoreConfig = {
  /** Global defaults when an appointment type does not override a bucket. */
  defaults: Record<OfferableScoreDayBucket, number>;
  /** Added to the resolved threshold for member-tier online booking. */
  memberBonus: number;
  /**
   * Optional per-appointment-type overrides. Missing buckets inherit from
   * `defaults`. Types with no entry use defaults entirely.
   */
  byAppointmentTypeId: Record<string, OfferableScoreThresholdsByBucket>;
};

export const DEFAULT_MEMBER_BONUS = 25;

export function defaultRoutingOfferableScoreConfig(): RoutingOfferableScoreConfig {
  return {
    defaults: {
      sameDay: ROUTING_OFFERABLE_MAX_SCORE,
      nextDay: ROUTING_OFFERABLE_MAX_SCORE,
      withinWeek: ROUTING_OFFERABLE_MAX_SCORE,
      later: ROUTING_OFFERABLE_MAX_SCORE,
    },
    memberBonus: DEFAULT_MEMBER_BONUS,
    byAppointmentTypeId: {},
  };
}

function parseScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseBucketMap(
  raw: unknown,
): OfferableScoreThresholdsByBucket {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: OfferableScoreThresholdsByBucket = {};
  for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
    const n = parseScore((raw as Record<string, unknown>)[bucket]);
    if (n != null) out[bucket] = n;
  }
  return out;
}

/** Parse practice-settings JSON (object or string) into a normalized config. */
export function parseRoutingOfferableScoreConfig(
  raw: unknown,
): RoutingOfferableScoreConfig {
  const defaults = defaultRoutingOfferableScoreConfig();
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return defaults;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return defaults;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return defaults;
  }

  const obj = parsed as Record<string, unknown>;
  const defaultBuckets = parseBucketMap(obj.defaults);
  const mergedDefaults: Record<OfferableScoreDayBucket, number> = {
    ...defaults.defaults,
  };
  for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
    const n = defaultBuckets[bucket];
    if (n != null) mergedDefaults[bucket] = n;
  }

  const memberBonusParsed = parseScore(obj.memberBonus);
  const memberBonus =
    memberBonusParsed != null ? memberBonusParsed : defaults.memberBonus;

  const byTypeRaw = obj.byAppointmentTypeId;
  const byAppointmentTypeId: Record<string, OfferableScoreThresholdsByBucket> =
    {};
  if (byTypeRaw && typeof byTypeRaw === 'object' && !Array.isArray(byTypeRaw)) {
    for (const [typeId, buckets] of Object.entries(
      byTypeRaw as Record<string, unknown>,
    )) {
      const id = String(typeId).trim();
      if (!id) continue;
      const map = parseBucketMap(buckets);
      if (Object.keys(map).length > 0) {
        byAppointmentTypeId[id] = map;
      }
    }
  }

  return {
    defaults: mergedDefaults,
    memberBonus,
    byAppointmentTypeId,
  };
}

/**
 * Whole calendar days from today (practice TZ) until the slot's local calendar day.
 * Same day → 0, tomorrow → 1, etc. Invalid dates return a large offset (later bucket).
 */
export function daysFromTodayForSlot(
  slotIsoOrDate: string | null | undefined,
  practiceTz: string,
  now: DateTime = DateTime.now(),
): number {
  const tz = practiceTz?.trim() || 'America/New_York';
  const today = now.setZone(tz).startOf('day');
  if (!slotIsoOrDate?.trim()) return 999;
  const raw = slotIsoOrDate.trim();
  const slot = raw.includes('T')
    ? DateTime.fromISO(raw, { zone: tz })
    : DateTime.fromISO(`${raw}T12:00:00`, { zone: tz });
  if (!slot.isValid) return 999;
  const slotDay = slot.startOf('day');
  return Math.max(0, Math.floor(slotDay.diff(today, 'days').days));
}

export function offerableScoreDayBucket(
  daysFromToday: number,
): OfferableScoreDayBucket {
  if (daysFromToday <= 0) return 'sameDay';
  if (daysFromToday === 1) return 'nextDay';
  if (daysFromToday <= 6) return 'withinWeek';
  return 'later';
}

export type ResolveOfferableMaxScoreParams = {
  config: RoutingOfferableScoreConfig;
  appointmentTypeId?: number | null;
  /** Whole days from today until the suggested slot (practice TZ). */
  daysFromToday: number;
  isMember?: boolean;
};

/**
 * Resolve the max offerable routing score for a candidate slot.
 * Per-type override for the day bucket, else global default, then + memberBonus.
 */
export function resolveOfferableMaxScore(
  params: ResolveOfferableMaxScoreParams,
): number {
  const { config, appointmentTypeId, daysFromToday, isMember } = params;
  const bucket = offerableScoreDayBucket(daysFromToday);
  const typeKey =
    appointmentTypeId != null && Number.isFinite(Number(appointmentTypeId))
      ? String(Number(appointmentTypeId))
      : null;
  const typeOverride =
    typeKey != null ? config.byAppointmentTypeId[typeKey]?.[bucket] : undefined;
  const base =
    typeOverride != null && Number.isFinite(typeOverride)
      ? typeOverride
      : config.defaults[bucket];
  const bonus = isMember ? Math.max(0, config.memberBonus) : 0;
  return base + bonus;
}

/** True when score is within the resolved max for this slot. Null/undefined score → allow. */
export function isRoutingScoreOfferableForConfig(
  score: unknown,
  params: ResolveOfferableMaxScoreParams,
): boolean {
  if (score == null) return true;
  const n = Number(score);
  if (!Number.isFinite(n)) return false;
  return n <= resolveOfferableMaxScore(params);
}

/** Highest threshold in the config (all defaults + overrides + member bonus). */
export function maxOfferableScoreInConfig(
  config: RoutingOfferableScoreConfig,
  options?: { includeMemberBonus?: boolean },
): number {
  let max = 0;
  for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
    max = Math.max(max, config.defaults[bucket]);
  }
  for (const overrides of Object.values(config.byAppointmentTypeId)) {
    for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
      const n = overrides[bucket];
      if (n != null) max = Math.max(max, n);
    }
  }
  if (options?.includeMemberBonus !== false) {
    max += Math.max(0, config.memberBonus);
  }
  return max;
}

/** Serialize for practice settings (string values). */
export function serializeRoutingOfferableScoreConfig(
  config: RoutingOfferableScoreConfig,
): string {
  const normalized = parseRoutingOfferableScoreConfig(config);
  return JSON.stringify({
    defaults: normalized.defaults,
    memberBonus: normalized.memberBonus,
    byAppointmentTypeId: normalized.byAppointmentTypeId,
  });
}
