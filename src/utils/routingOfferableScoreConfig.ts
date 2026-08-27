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

/**
 * Share of recently scored slots a bucket admits, 1-100. 57 means "offer the
 * best 57%". Mirrors vayd-api `OfferableScorePercentilesByBucket`.
 */
export type OfferableScorePercentilesByBucket = Partial<
  Record<OfferableScoreDayBucket, number>
>;

/** Measured score distribution, used to turn a percentage into a score ceiling. */
export type OfferableScoreCalibration = {
  generatedAt: string;
  windowDays: number;
  sampleSize: number;
  doctorCount: number;
  excludedDoctorCount: number;
  /** Scoring scale the curve was measured on; a mismatch means it is stale. */
  scoringScale: string;
  /**
   * `measured` reads scores the router emitted on the active scale. `replayed`
   * reconstructs them from pre-change history to bridge the gap after a scoring
   * change, and is an estimate rather than a direct measurement.
   */
  source: 'measured' | 'replayed';
  /** curve[p] = score at percentile p. Length 101, ascending. */
  curve: number[];
};

export const OFFERABLE_SCORE_CALIBRATION_CURVE_POINTS = 101;

export type RoutingOfferableScoreConfig = {
  /**
   * Resolved score ceilings — always what gating uses. Derived from
   * `percentiles` at save time when a calibration exists, so the stored numbers
   * and the slider positions cannot disagree.
   */
  defaults: Record<OfferableScoreDayBucket, number>;
  /** Added to the resolved threshold for member-tier online booking. */
  memberBonus: number;
  /**
   * Optional per-appointment-type overrides. Missing buckets inherit from
   * `defaults`. Types with no entry use defaults entirely.
   */
  byAppointmentTypeId: Record<string, OfferableScoreThresholdsByBucket>;
  /** Editing source of truth once calibrated. Empty means scores were set directly. */
  percentiles: OfferableScorePercentilesByBucket;
  byAppointmentTypeIdPercentiles: Record<
    string,
    OfferableScorePercentilesByBucket
  >;
  calibration: OfferableScoreCalibration | null;
};

/** Mirrors vayd-api ROUTING_OFFERABLE_MEMBER_BONUS. Scales with the gate: 22 under goal-aware density, 25 under legacy. */
export const DEFAULT_MEMBER_BONUS = 22;

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
    percentiles: {},
    byAppointmentTypeIdPercentiles: {},
    calibration: null,
  };
}

function parseScore(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

/** Percentiles are clamped to 1-100; 0 would admit nothing and is always a mistake. */
export function parsePercentile(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 100) return null;
  return rounded;
}

function parsePercentileMap(raw: unknown): OfferableScorePercentilesByBucket {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: OfferableScorePercentilesByBucket = {};
  for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
    const n = parsePercentile((raw as Record<string, unknown>)[bucket]);
    if (n != null) out[bucket] = n;
  }
  return out;
}

function parseCalibration(raw: unknown): OfferableScoreCalibration | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  if (!Array.isArray(obj.curve)) return null;
  const curve = obj.curve.map((v) => Number(v));
  if (
    curve.length !== OFFERABLE_SCORE_CALIBRATION_CURVE_POINTS ||
    curve.some((v) => !Number.isFinite(v))
  ) {
    return null;
  }
  const int = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
  };
  return {
    generatedAt:
      typeof obj.generatedAt === 'string' && obj.generatedAt.trim()
        ? obj.generatedAt
        : new Date(0).toISOString(),
    windowDays: int(obj.windowDays),
    sampleSize: int(obj.sampleSize),
    doctorCount: int(obj.doctorCount),
    excludedDoctorCount: int(obj.excludedDoctorCount),
    scoringScale:
      typeof obj.scoringScale === 'string' && obj.scoringScale.trim()
        ? obj.scoringScale.trim()
        : 'unknown',
    source: obj.source === 'replayed' ? 'replayed' : 'measured',
    curve,
  };
}

/** Score ceiling admitting the best `percentile`% of recently scored slots. */
export function scoreAtPercentile(
  calibration: OfferableScoreCalibration,
  percentile: number,
): number {
  const curve = calibration.curve;
  const last = curve.length - 1;
  const p = Math.min(100, Math.max(0, percentile));
  const lo = Math.floor(p);
  const hi = Math.ceil(p);
  const loScore = curve[Math.min(last, lo)]!;
  if (lo === hi) return Math.round(loScore);
  const hiScore = curve[Math.min(last, hi)]!;
  return Math.round(loScore + (hiScore - loScore) * (p - lo));
}

/** Where an absolute score sits on the curve, for showing a setting as a percentage. */
export function percentileForScore(
  calibration: OfferableScoreCalibration | null,
  score: number,
): number | null {
  if (!calibration) return null;
  const curve = calibration.curve;
  if (score <= curve[0]!) return 0;
  const last = curve.length - 1;
  if (score >= curve[last]!) return 100;
  for (let i = 1; i <= last; i += 1) {
    const prev = curve[i - 1]!;
    const cur = curve[i]!;
    if (score <= cur) {
      if (cur === prev) return i;
      return Math.round(i - 1 + (score - prev) / (cur - prev));
    }
  }
  return 100;
}

/** Recompute every ceiling from its percentile so scores and sliders agree. */
export function resolveConfigFromPercentiles(
  config: RoutingOfferableScoreConfig,
): RoutingOfferableScoreConfig {
  const calibration = config.calibration;
  if (!calibration) return config;

  const defaults = { ...config.defaults };
  for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
    const pct = config.percentiles[bucket];
    if (pct != null) defaults[bucket] = scoreAtPercentile(calibration, pct);
  }

  const byAppointmentTypeId: Record<string, OfferableScoreThresholdsByBucket> =
    {};
  for (const [typeId, buckets] of Object.entries(config.byAppointmentTypeId)) {
    byAppointmentTypeId[typeId] = { ...buckets };
  }
  for (const [typeId, pcts] of Object.entries(
    config.byAppointmentTypeIdPercentiles,
  )) {
    const target = { ...(byAppointmentTypeId[typeId] ?? {}) };
    for (const bucket of OFFERABLE_SCORE_DAY_BUCKETS) {
      const pct = pcts[bucket];
      if (pct != null) target[bucket] = scoreAtPercentile(calibration, pct);
    }
    if (Object.keys(target).length > 0) byAppointmentTypeId[typeId] = target;
  }

  return { ...config, defaults, byAppointmentTypeId };
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

  const byTypePctRaw = obj.byAppointmentTypeIdPercentiles;
  const byAppointmentTypeIdPercentiles: Record<
    string,
    OfferableScorePercentilesByBucket
  > = {};
  if (
    byTypePctRaw &&
    typeof byTypePctRaw === 'object' &&
    !Array.isArray(byTypePctRaw)
  ) {
    for (const [typeId, buckets] of Object.entries(
      byTypePctRaw as Record<string, unknown>,
    )) {
      const id = String(typeId).trim();
      if (!id) continue;
      const map = parsePercentileMap(buckets);
      if (Object.keys(map).length > 0) {
        byAppointmentTypeIdPercentiles[id] = map;
      }
    }
  }

  return resolveConfigFromPercentiles({
    defaults: mergedDefaults,
    memberBonus,
    byAppointmentTypeId,
    percentiles: parsePercentileMap(obj.percentiles),
    byAppointmentTypeIdPercentiles,
    calibration: parseCalibration(obj.calibration),
  });
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
    percentiles: normalized.percentiles,
    byAppointmentTypeIdPercentiles: normalized.byAppointmentTypeIdPercentiles,
    calibration: normalized.calibration,
  });
}
