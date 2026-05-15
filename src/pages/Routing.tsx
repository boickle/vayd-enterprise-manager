// src/pages/Routing.tsx
import {
  FormEvent,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useAuth } from '../auth/AuthProvider';
import { fetchDoctorMonth, type MiniZone } from '../api/appointments';
import { fetchAllAppointmentTypes } from '../api/appointmentSettings';
import { http } from '../api/http';
import {
  monthsCoveringRange,
  summarizeAvgMinutesByAppointmentType,
  type AvgMinutesByTypeRow,
} from '../analytics/appointmentTypeTimeStats';
import { Field } from '../components/Field';
import { KeyValue } from '../components/KeyValue';
import { DateTime } from 'luxon';
import { PreviewMyDayModal } from '../components/PreviewMyDayModal';
import { validateAddress } from '../api/geo';
import {
  normalizeRoutingV2SlotSearchResponse,
  type RoutingSlotSearchOptionalFlags,
  type RoutingV2SlotSearchResult,
} from '../api/routing';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT,
  writeRoutingCalendarPreview,
  type RoutingCalendarPreviewPayloadV1,
} from '../utils/routingCalendarPreviewStorage';
import {
  markRescheduleIntentAppliedToRoutingForm,
  readRoutingRescheduleIntent,
  rescheduleIntentIsActive,
  ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT,
} from '../utils/routingRescheduleIntent';
import {
  clearRoutingUiSnapshot,
  readRoutingUiBootstrap,
  ROUTING_REQUEST_ID_SESSION_KEY,
  ROUTING_WORKSPACE_SCHEDULER_BOOKED_EVENT,
  writeAuthDoctorCache,
  writeRoutingUiSnapshot,
} from '../utils/routingUiSnapshot';
import './Routing.css';

/** Yellow wrap when an optional routing preference is on—makes checked state obvious at a glance. */
const ROUTING_PREF_CHECKED_LABEL: CSSProperties = {
  backgroundColor: '#fef9c3',
  border: '1px solid #ca8a04',
  borderRadius: 8,
  padding: '6px 10px',
  boxSizing: 'border-box',
};

// =========================
// Types
// =========================

type RouteRequest = {
  doctorId: string;
  startDate: string;
  endDate: string;
  newAppt: {
    serviceMinutes: number;
    lat?: number;
    lon?: number;
    address?: string;
    clientId?: string;
  };
};

/**
 * Routing “Service minutes” from the same Appt lengths stats as the popover:
 * 1 pet → regular average; 2+ pets → multipet average × pet count when multipet data exists,
 * otherwise scales the regular average by pet count.
 */
function estimatedServiceMinutesFromStatsRow(row: AvgMinutesByTypeRow, pets: number): number | null {
  const n = Math.floor(Number(pets));
  const petCount = Number.isFinite(n) && n >= 1 ? n : 1;
  const hasSingle = row.count > 0 && row.avgMinutes > 0;
  const mp = row.multipetAvgMinutes;
  const hasMp = mp != null && mp > 0;

  if (petCount === 1) {
    if (hasSingle) return Math.round(row.avgMinutes);
    if (hasMp) return Math.round(mp);
    return null;
  }
  if (hasMp) return Math.round(mp * petCount);
  if (hasSingle) return Math.round(row.avgMinutes * petCount);
  return null;
}

type Slot = 'early' | 'mid' | 'late';

/** Scout empty-day row: `SCOUT_EMPTY_DAY_POLICY=zone_aware` (routing v2). May appear on root, each candidate, or `gaps[]`. */
type ScoutRoutingGapRow = {
  scoutEmptyDayPolicy?: string | null;
  scoutLiaisonPrimaryLabel?: string | null;
  scoutLiaisonLabels?: string[] | null;
  /** i18n keys for liaison strings; surfaced in tooltip / `data-scout-liaison-label-ids`. */
  scoutLiaisonLabelIds?: string[] | null;
  /**
   * Depot→candidate drive class: `local` | `corridor` | `anchor` from drive minutes (≤15 local, ≥25 anchor, between corridor).
   * Same thresholds as anchor classification for N9.
   */
  scoutZoneClass?: string | null;
  /** Not set on zone_aware slim pass; do not show from routing—use My Week / zone-percentages if needed. */
  scoutAnchorPanelShare?: number | null;
  /** Legacy: when `dayHouseholdCount` is absent, UI may treat this as household count. */
  dayClientVisitCount?: number | null;
  /** Scheduled households that day (scout). Preferred over inferring from `dayClientVisitCount`). */
  dayHouseholdCount?: number | null;
  /** Scheduled patients that day (scout). */
  dayPatientCount?: number | null;
  /** True when the day is “strategic light” (≤1 client visit). */
  dayIsStrategicLight?: boolean | null;
  /** True only when zero client visits (scout). */
  dayIsEmpty?: boolean | null;
  /**
   * Slim pass: usually **0** (shape-stable). Heavier scorer used N6; ignore for ranking explanation unless non-zero.
   */
  scoutWeekPanelBalanceN6?: number | null;
  /** Slim pass: usually **0** (shape-stable). */
  scoutPackDayReserveN7?: number | null;
  /**
   * Zone-aware horizon add-on total from the server: **`scoutMultiAnchorDayN9` + `scoutPreservedEmptyDayPenalty`**
   * (plus any future horizon terms the API adds). **N6–N8** stay shape-stable / usually 0. Use total score for ranking;
   * this field is transparency only—do not re-sum client-side for preserve logic.
   */
  scoutZoneAwareScoreDelta?: number | null;
  /** Slim pass: usually **0** (shape-stable). Heavier scorer used N8. */
  scoutZoneHourPackN8?: number | null;
  /**
   * **N9 only:** cross–anchor-zone penalty for **non-local** slots on days with **two+** anchor legs (same thresholds
   * as `scoutZoneClass`). **0** when not applied.
   */
  scoutMultiAnchorDayN9?: number | null;
  /**
   * Additive hit when this option **consumes a preserved empty anchor-seed day** (server-only; ISO week + panel %,
   * depot, centroids, OSRM). **0** when not applied—**do not recompute in the UI.**
   */
  scoutPreservedEmptyDayPenalty?: number | null;
};

type ScoutZoneAwareDiagFields = Pick<
  ScoutRoutingGapRow,
  | 'scoutZoneClass'
  | 'scoutWeekPanelBalanceN6'
  | 'scoutPackDayReserveN7'
  | 'scoutZoneHourPackN8'
  | 'scoutMultiAnchorDayN9'
  | 'scoutPreservedEmptyDayPenalty'
>;

type Winner = {
  date: string;
  insertionIndex: number;
  /** 1-based visit order (1 = first, 2 = second, ...). positionInDay === insertionIndex + 1 */
  positionInDay?: number;
  addedDriveSeconds: number;
  currentDriveSeconds: number;
  projectedDriveSeconds: number;
  suggestedStartSec: number;
  suggestedStartIso: string;
  beforeEdgeSeconds: number;
  withXSeconds: number;
  addedDrivePretty?: string;
  currentDrivePretty?: string;
  projectedDrivePretty?: string;

  // NEW — preference metadata from backend
  prefScore?: number;
  score?: number;
  slot?: Slot | null;
  isFirstEdge?: boolean;
  isLastEdge?: boolean;

  // NEW — day facts for computing remaining non-drive time
  workStartLocal?: string; // "HH:mm" or "HH:mm:ss"
  effectiveEndLocal?: string; // "HH:mm" or "HH:mm:ss"
  bookedServiceSeconds?: number; // seconds of booked service (no driving)
  _emptyDay?: boolean;
  dayIsEmpty?: boolean;
  /**
   * Empty-day candidate placement from routing API. Branch on `'earlier_feasible'` for highlight / copy.
   */
  emptyDayStartVariant?: string | null;
  flags?: string[];
  // 👇 Add these lines:
  overrunSeconds?: number;
  overrunPretty?: string;
  routingRequestId?: string;
  candidateId?: string;
  candidateIndex?: number;
  appointmentId?: number;
  // v2 multi-doctor support
  doctorId?: string; // PIMS ID of the doctor this candidate belongs to
  // Arrival window from backend
  arrivalWindow?: {
    windowStartSec?: number;
    windowEndSec?: number;
    windowStartIso?: string;
    windowEndIso?: string;
  };
  /** Geocoded / routing zone for preview labels, e.g. `New Appointment (3E)`. */
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;
  /** Scoring breakdown from routing-v2; downstreamWindowEdge > 0 means a downstream appt is pushed near its window end */
  scoringComponents?: {
    downstreamWindowEdge?: number;
  };
  /** Seconds since local midnight when return to depot completes (v2 validation). */
  validationReturnSec?: number;
  validationLastEtdSec?: number;
  /** Scout zone-aware policy on this candidate (mirrors root when flattened). */
  scoutEmptyDayPolicy?: string | null;
  scoutLiaisonPrimaryLabel?: string | null;
  scoutLiaisonLabels?: string[];
  scoutLiaisonLabelIds?: string[];
  scoutZoneClass?: string | null;
  scoutAnchorPanelShare?: number | null;
  dayClientVisitCount?: number | null;
  dayHouseholdCount?: number | null;
  dayPatientCount?: number | null;
  dayIsStrategicLight?: boolean | null;
  /** Scout: zero client visits (distinct from routing `dayIsEmpty` / EMPTY ribbon when API sends both). */
  scoutDayNoClients?: boolean | null;
  /** Per-gap scout liaison + day stats (zone-aware empty day). */
  gaps?: ScoutRoutingGapRow[];
  /** Slim pass: usually 0; see handoff. */
  scoutWeekPanelBalanceN6?: number | null;
  /** Slim pass: usually 0; see handoff. */
  scoutPackDayReserveN7?: number | null;
  /** Zone-aware horizon total: N9 + `scoutPreservedEmptyDayPenalty` (+ any future API terms). See handoff. */
  scoutZoneAwareScoreDelta?: number | null;
  /** Slim pass: usually 0; see handoff. */
  scoutZoneHourPackN8?: number | null;
  /** N9 cross–anchor-zone penalty only; see handoff. */
  scoutMultiAnchorDayN9?: number | null;
  /** Preserved empty anchor-seed day consumption penalty; 0 when not applied. Server-only—do not recompute. */
  scoutPreservedEmptyDayPenalty?: number | null;
};

type UnifiedOption = Winner & {
  doctorPimsId: string;
  doctorName: string;
};

type EstimatedCost = {
  dmElements: number;
  dirRequests: number;
  dmCost: number;
  dirCost: number;
  totalCostUSD: number;
};

type RoutingLearningStat = {
  doctorPimsId: string;
  slot: string;
  count: number;
  lastSelectedAt?: string;
};

type RoutingLearning = {
  provider?: string;
  stats?: RoutingLearningStat[];
};

/** One doctor × ISO week from fleet routing v2 `scoutPreservedEmptyDayWeeks` (preserve pass scope). */
type ScoutPreservedEmptyDayWeek = {
  doctorId?: string | null;
  isoWeekMonday?: string | null;
  timeZone?: string | null;
  workingDaysInWeek?: number | null;
  targetPreservedEmpties?: number | null;
  seedAnchorZoneCount?: number | null;
  emptyWorkingIsoDates?: string[] | null;
  seedAnchorZones?: Array<{ zoneId?: string | number | null; zoneName?: string | null }> | null;
  seedAnchorZonesVisitedThisWeek?: Array<{ zoneId?: string | number | null; zoneName?: string | null }> | null;
  anchorZonesStillNeedingPreservation?: Array<{ zoneId?: string | number | null; zoneName?: string | null }> | null;
};

type Result = {
  status: string;
  /**
   * Scout empty-day policy: **`zone_aware`** (extra fields + liaison) vs **`legacy`** (omit zone-aware UI).
   * Server: `SCOUT_EMPTY_DAY_POLICY`. No extra client env vars.
   */
  scoutEmptyDayPolicy?: string | null;
  /** Geocoded zones for the new-appt request; API may also duplicate these on each candidate. */
  clientZone?: MiniZone;
  effectiveZone?: MiniZone;
  winner?: Winner;
  estimatedCost?: EstimatedCost;
  alternates?: Winner[];

  // Any-doctor extras
  doctorPimsId?: string;
  selectedDoctorPimsId?: string;
  selectedDoctorDisplayName?: string;
  selectedDoctor?: {
    pimsId?: string;
    firstName?: string;
    lastName?: string;
    name?: string;
  };
  underThreshold?: boolean;
  doctors?: Array<{
    pimsId: string;
    name?: string;
    top: Winner[];
  }>;
  routingRequestId?: string;
  learning?: RoutingLearning;
  /**
   * Per doctor × ISO week for preserved empty-day scoring (`SCOUT_EMPTY_DAY_POLICY=zone_aware`, with candidates).
   * Omitted for legacy, no candidates, or when zone-aware preserve did not run.
   */
  scoutPreservedEmptyDayWeeks?: ScoutPreservedEmptyDayWeek[] | null;
};

type Client = {
  id: string;
  firstName: string;
  lastName: string;
  address1?: string;
  city?: string;
  state?: string;
  zip?: string;
  lat?: number | string;
  lon?: number | string;
  alerts?: string | null;
};

type Doctor = {
  id?: string | number;
  pimsId?: string;
  firstName?: string;
  middleInitial?: string;
  middleName?: string;
  lastName?: string;
  name?: string;
  employeeId?: string | number;
  employee?: {
    id?: string | number;
    pimsId?: string;
    firstName?: string;
    middleInitial?: string;
    middleName?: string;
    lastName?: string;
  };
};

// =========================
/** Helpers */
// =========================

const DOCTORS_SEARCH_URL = '/employees/search';

function buildDoctorName(emp: any, fallback?: string): string {
  const parts: string[] = [];
  const fn = emp?.firstName ?? emp?.employee?.firstName;
  const mi = emp?.middleInitial ?? emp?.employee?.middleInitial ?? 
             (emp?.middleName ? emp.middleName.charAt(0).toUpperCase() : null) ??
             (emp?.employee?.middleName ? emp.employee.middleName.charAt(0).toUpperCase() : null);
  const ln = emp?.lastName ?? emp?.employee?.lastName;
  
  if (fn) parts.push(fn);
  if (mi) parts.push(mi);
  if (ln) parts.push(ln);
  
  return parts.length > 0 ? parts.join(' ') : (fallback || 'Unknown');
}

function localDoctorDisplayName(d: Doctor) {
  if (d.name) return d.name;
  return buildDoctorName(d, 'Unknown');
}

function doctorPimsIdOf(d: Doctor): string {
  const pid = d.employee?.pimsId ?? d.pimsId;
  if (pid) return String(pid);
  const maybePims = d.employeeId;
  return maybePims ? String(maybePims) : '';
}

function secsToPretty(s?: number) {
  if (s == null) return '-';
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h > 0 ? `${h}h ${mm}m` : `${mm}m`;
}

// Round an ISO timestamp to the nearest N-minute boundary (preserves original TZ)
const ROUND_STEP_MIN = 5;

function roundIsoToStep(iso?: string, stepMin = ROUND_STEP_MIN): string | undefined {
  if (!iso) return undefined;
  const dt = DateTime.fromISO(iso);
  if (!dt.isValid) return iso;
  const stepMs = stepMin * 60 * 1000;
  const roundedMs = Math.round(dt.toMillis() / stepMs) * stepMs;
  // keep the same zone as the incoming ISO
  return DateTime.fromMillis(roundedMs, { zone: dt.zoneName }).toISO() || '';
}

function isoToTime(iso?: string): string {
  if (!iso) return '-';
  const roundedIso = roundIsoToStep(iso) ?? iso;
  const dt = DateTime.fromISO(roundedIso);
  return dt.isValid ? dt.toLocaleString(DateTime.TIME_SIMPLE) : '-';
}

function colorForAddedDrive(seconds?: number): string {
  if (seconds == null) return 'inherit';
  const mins = seconds / 60;
  if (mins < 10) return 'green';
  if (mins <= 20) return 'orange';
  return 'red';
}

function colorForProjectedDrive(seconds?: number): string {
  if (seconds == null) return 'inherit';
  const mins = seconds / 60;
  if (mins <= 90) return 'green';
  if (mins <= 120) return 'orange';
  return 'red';
}

function formatClientAddress(c: Partial<Client>): string {
  const line = [c.address1, c.city, c.state].filter(Boolean).join(', ');
  return [line, c.zip].filter(Boolean).join(' ').trim();
}

const DOCTOR_PALETTE = [
  '#93c5fd',
  '#7dd3fc',
  '#67e8f9',
  '#5eead4',
  '#6ee7b7',
  '#a5b4fc',
  '#c4b5fd',
  '#d8b4fe',
  '#f0abfc',
  '#cbd5e1',
  '#d6d3d1',
];
function colorForDoctor(pimsId: string | undefined): string {
  if (!pimsId) return '#0ea5e9';
  let h = 0;
  for (let i = 0; i < pimsId.length; i++) h = (h * 31 + pimsId.charCodeAt(i)) >>> 0;
  return DOCTOR_PALETTE[h % DOCTOR_PALETTE.length];
}

function isEmptyDay(x: any) {
  return Boolean(x?._emptyDay || x?.dayIsEmpty || x?.flags?.includes?.('EMPTY'));
}

function scoutPolicyZoneAware(policy: unknown): boolean {
  const s = String(policy ?? '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  return s === 'zone_aware';
}

function scoutGapsFromCandidate(row: Record<string, unknown>): ScoutRoutingGapRow[] {
  const raw = row.gaps ?? row.routingGaps;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x) => x && typeof x === 'object') as ScoutRoutingGapRow[];
}

const SCOUT_BADGE_CHIP: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.2,
  padding: '3px 8px',
  borderRadius: 999,
  background: '#e0e7ff',
  color: '#312e81',
  border: '1px solid #c7d2fe',
};

/** Preserved empty-day penalty chip (distinct from N9 indigo). */
const SCOUT_PRESERVED_DAY_CHIP: CSSProperties = {
  display: 'inline-block',
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 0.2,
  padding: '3px 8px',
  borderRadius: 999,
  background: '#fef3c7',
  color: '#713f12',
  border: '1px solid #fcd34d',
};

/** Purple “Zone-aware” pill (Results header + consistency). */
const SCOUT_ZONE_AWARE_BADGE_STYLE: CSSProperties = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: 0.02,
  padding: '5px 14px',
  borderRadius: 8,
  background: 'linear-gradient(180deg, #faf5ff 0%, #f3e8ff 100%)',
  color: '#581c87',
  border: '1px solid #c084fc',
  boxShadow: '0 1px 2px rgba(88, 28, 135, 0.08)',
};

const SCOUT_RESULTS_ZONE_NAME_CHIP: CSSProperties = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 600,
  padding: '4px 12px',
  borderRadius: 8,
  background: '#f1f5f9',
  color: '#0f172a',
  border: '1px solid #cbd5e1',
};

function scoutZoneClassRaw(raw: unknown): string | null {
  if (raw == null || typeof raw !== 'string') return null;
  const t = raw.trim();
  return t ? t : null;
}

function scoutFormatZoneClassLabel(z: string): string {
  const lo = z.toLowerCase();
  if (lo === 'local' || lo === 'corridor' || lo === 'anchor') {
    return z.charAt(0).toUpperCase() + z.slice(1).toLowerCase();
  }
  return z;
}

/** Banner phrase next to Zone-aware (e.g. “Anchor zone”). */
function scoutZoneClassBannerPhrase(z: string): string {
  const lo = z.trim().toLowerCase();
  if (lo === 'anchor') return 'Anchor zone';
  if (lo === 'local') return 'Local zone';
  if (lo === 'corridor') return 'Corridor zone';
  return `${scoutFormatZoneClassLabel(z)} zone`;
}

/** Title case for combined Results chip, e.g. `Anchor Zone`, `Local Zone`. */
function scoutZoneClassBannerTitleCase(z: string): string {
  return scoutZoneClassBannerPhrase(z)
    .split(/\s+/)
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : ''))
    .join(' ');
}

/** One line for the geocoded polygon zone, e.g. `Zone 3W (Lewiston)`. */
function routingPolygonZoneDisplayLine(carrier: {
  effectiveZone?: MiniZone;
  clientZone?: MiniZone;
}): string | null {
  const a = carrier.effectiveZone?.name != null ? String(carrier.effectiveZone.name).trim() : '';
  const b = carrier.clientZone?.name != null ? String(carrier.clientZone.name).trim() : '';
  const raw = a || b;
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.startsWith('zone ')) return raw;
  return `Zone ${raw}`;
}

/** Calendar Monday (YYYY-MM-DD) of the ISO week containing `dateIso` (date part only). */
function calendarIsoWeekMondayYmd(dateIso: string): string {
  const d = DateTime.fromISO(dateIso.slice(0, 10));
  if (!d.isValid) return '';
  const mon = d.minus({ days: d.weekday - 1 });
  return mon.toISODate() ?? '';
}

function scoutPreservedWeekEntryForCandidate(
  weeks: ScoutPreservedEmptyDayWeek[] | null | undefined,
  doctorPimsId: string,
  candidateDateYmd: string
): ScoutPreservedEmptyDayWeek | null {
  if (!Array.isArray(weeks) || weeks.length === 0) return null;
  const weekMon = calendarIsoWeekMondayYmd(candidateDateYmd);
  const doc = String(doctorPimsId ?? '').trim();
  for (const w of weeks) {
    const wMon = String(w.isoWeekMonday ?? '').slice(0, 10);
    const wDoc = String(w.doctorId ?? '').trim();
    if (wDoc === doc && wMon === weekMon) return w;
  }
  return null;
}

/** Muted note listing `anchorZonesStillNeedingPreservation` when the preserved-day chip applies. */
function scoutPreservedAnchorZonesStillNote(
  weeks: ScoutPreservedEmptyDayWeek[] | null | undefined,
  row: {
    scoutPreservedEmptyDayPenalty?: number | null;
    doctorPimsId?: string;
    date?: string;
  }
): ReactNode {
  const p = row.scoutPreservedEmptyDayPenalty;
  if (typeof p !== 'number' || !Number.isFinite(p) || p <= 0) return null;
  const entry = scoutPreservedWeekEntryForCandidate(
    weeks,
    row.doctorPimsId ?? '',
    row.date ?? ''
  );
  const names =
    entry?.anchorZonesStillNeedingPreservation
      ?.map((z) => String(z.zoneName ?? '').trim())
      .filter(Boolean) ?? [];
  if (!names.length) return null;
  return (
    <div
      className="muted"
      style={{ fontSize: 11, marginTop: -4, marginBottom: 8, lineHeight: 1.35 }}
    >
      <strong>
        This uses one of the remaining flexible days Scout is trying to preserve for other far-away
        zones this week.
      </strong>{' '}
      <strong>Zone(s) not yet represented this week:</strong>{' '}
      {names.join(', ')}
    </div>
  );
}

function scoutN9CrossesAnchorZones(n: number): boolean {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/** Slim pass: N9 / zone-aware anchor stacking—plain label + numeric in tooltip (penalty > 0 only). */
function scoutAnchorRoutingCrossingCopy(n9: number): { label: string; tooltip: string } {
  const val = Number.isInteger(n9) ? String(n9) : n9.toFixed(2);
  return {
    label: 'Adds Another Anchor Zone',
    tooltip: `This option adds another anchor reach on a day that already has two or more long (anchor) drives from depot before this visit. Routing adjustment (N9): ${val}. Lower total score is still better.`,
  };
}

function scoutFmtScoreDelta(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Muted line + tooltip for `scoutZoneAwareScoreDelta` (total); breakdown when N9 / preserved fields are present. */
function scoutZoneAwareDeltaUi(row: {
  scoutZoneAwareScoreDelta?: number | null;
  scoutMultiAnchorDayN9?: number | null;
  scoutPreservedEmptyDayPenalty?: number | null;
}): { value: string; title: string } | null {
  const d = row.scoutZoneAwareScoreDelta;
  if (typeof d !== 'number' || !Number.isFinite(d)) return null;
  const n9 = row.scoutMultiAnchorDayN9;
  const pr = row.scoutPreservedEmptyDayPenalty;
  const n9Ok = typeof n9 === 'number' && Number.isFinite(n9);
  const prOk = typeof pr === 'number' && Number.isFinite(pr) && pr > 0;
  const parts: string[] = [
    `Total zone-aware score delta (from server): ${scoutFmtScoreDelta(d)}. Lower total score is still better.`,
  ];
  if (n9Ok) parts.push(`Includes N9 (multi-anchor): ${scoutFmtScoreDelta(n9)}.`);
  if (prOk) parts.push(`Includes preserved empty-day penalty: ${scoutFmtScoreDelta(pr)}.`);
  parts.push('Do not recompute preserve logic in the UI; panel context is GET /patients/provider/:id/zone-percentages.');
  return { value: scoutFmtScoreDelta(d), title: parts.join(' ') };
}

function scoutZoneAwareDiagHasContent(row: ScoutZoneAwareDiagFields): boolean {
  if (scoutZoneClassRaw(row.scoutZoneClass)) return true;
  const n6 =
    typeof row.scoutWeekPanelBalanceN6 === 'number' &&
    Number.isFinite(row.scoutWeekPanelBalanceN6) &&
    row.scoutWeekPanelBalanceN6 > 0;
  const n7 =
    typeof row.scoutPackDayReserveN7 === 'number' &&
    Number.isFinite(row.scoutPackDayReserveN7) &&
    row.scoutPackDayReserveN7 > 0;
  const n8 =
    typeof row.scoutZoneHourPackN8 === 'number' &&
    Number.isFinite(row.scoutZoneHourPackN8) &&
    row.scoutZoneHourPackN8 > 0;
  const n9Crossing =
    typeof row.scoutMultiAnchorDayN9 === 'number' &&
    Number.isFinite(row.scoutMultiAnchorDayN9) &&
    scoutN9CrossesAnchorZones(row.scoutMultiAnchorDayN9);
  const preserved =
    typeof row.scoutPreservedEmptyDayPenalty === 'number' &&
    Number.isFinite(row.scoutPreservedEmptyDayPenalty) &&
    row.scoutPreservedEmptyDayPenalty > 0;
  return n6 || n7 || n8 || n9Crossing || preserved;
}

function ScoutZoneAwareDiagnosticsRow({
  row,
  hideZoneClass,
  variant = 'block',
}: {
  row: ScoutZoneAwareDiagFields;
  /** When true, omit depot→candidate zone class (shown once in Results header for this search). */
  hideZoneClass?: boolean;
  /** `inline`: no outer margin—use inside a parent flex row with day stat badges. */
  variant?: 'block' | 'inline';
}) {
  const zc = hideZoneClass ? null : scoutZoneClassRaw(row.scoutZoneClass);
  const n6Show =
    typeof row.scoutWeekPanelBalanceN6 === 'number' &&
    Number.isFinite(row.scoutWeekPanelBalanceN6) &&
    row.scoutWeekPanelBalanceN6 > 0;
  const n7Show =
    typeof row.scoutPackDayReserveN7 === 'number' &&
    Number.isFinite(row.scoutPackDayReserveN7) &&
    row.scoutPackDayReserveN7 > 0;
  const n8Show =
    typeof row.scoutZoneHourPackN8 === 'number' &&
    Number.isFinite(row.scoutZoneHourPackN8) &&
    row.scoutZoneHourPackN8 > 0;
  const n9Val = row.scoutMultiAnchorDayN9;
  const n9Crossing =
    typeof n9Val === 'number' && Number.isFinite(n9Val) && scoutN9CrossesAnchorZones(n9Val);
  const n9Copy = n9Crossing ? scoutAnchorRoutingCrossingCopy(n9Val) : null;
  const preservedShow =
    typeof row.scoutPreservedEmptyDayPenalty === 'number' &&
    Number.isFinite(row.scoutPreservedEmptyDayPenalty) &&
    row.scoutPreservedEmptyDayPenalty > 0;
  if (!zc && !n6Show && !n7Show && !n8Show && !n9Crossing && !preservedShow) return null;
  const inner = (
    <>
      {zc ? (
        <span
          style={SCOUT_BADGE_CHIP}
          title="From depot→candidate drive: ≤15 min = local, ≥25 min = anchor, between = corridor. Same minute thresholds as anchor legs counted for N9."
        >
          Zone class: {scoutFormatZoneClassLabel(zc)}
        </span>
      ) : null}
      {n6Show ? (
        <span
          title="N6 week–panel (heavier scorer). On slim pass this is usually 0—shown only when non-zero."
        >
          Week–panel (N6): {row.scoutWeekPanelBalanceN6}
        </span>
      ) : null}
      {n7Show ? (
        <span title="N7 pack-day reserve. Slim pass: usually 0—shown only when non-zero.">
          Pack-day reserve (N7): {row.scoutPackDayReserveN7}
        </span>
      ) : null}
      {n8Show ? (
        <span title="N8 zone-hour pack. Slim pass: usually 0—shown only when non-zero.">
          Zone-hour pack (N8): {row.scoutZoneHourPackN8}
        </span>
      ) : null}
      {n9Copy ? (
        <span style={SCOUT_BADGE_CHIP} title={n9Copy.tooltip}>
          {n9Copy.label}
        </span>
      ) : null}
      {preservedShow ? (
        <span
          style={SCOUT_PRESERVED_DAY_CHIP}
          title="Additive score from consuming a preserved empty anchor-seed day (server). Panel mix: GET /patients/provider/:id/zone-percentages. Do not recompute in the client."
        >
          Uses preserved empty day
        </span>
      ) : null}
    </>
  );
  if (variant === 'inline') {
    return (
      <span
        className="muted"
        style={{
          display: 'inline-flex',
          flexWrap: 'wrap',
          gap: '4px 10px',
          alignItems: 'center',
          fontSize: 11,
        }}
      >
        {inner}
      </span>
    );
  }
  return (
    <div
      className="muted"
      style={{
        fontSize: 11,
        marginBottom: 6,
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 14px',
        alignItems: 'center',
      }}
    >
      {inner}
    </div>
  );
}

/**
 * Local strings for `scoutLiaisonLabelIds` when mapping id → copy (API still sends English in primary/labels).
 * `balances_week` = N4 busy-day spread only; `keeps_week_panel_mix` = panel-mix / N6 (distinct).
 */
const SCOUT_LIAISON_LABEL_ID_COPY: Record<string, string> = {
  keeps_week_panel_mix: 'Keeps week vs panel mix (N6)',
  balances_week: 'Balances busy-day spread across the week (N4 only)',
  fits_far_run_day: 'Fits a day that already runs farther from home',
  fits_zone_pack_day: 'Fits a day already concentrated in this zone (panel time budget)',
  outside_zones_drive_fit: 'Address not in a zone polygon',
  earliest_available: 'Earliest available (fallback)',
  consumes_preserved_anchor_seed_day: 'Consumes a preserved empty anchor-seed day',
  breaks_empty_day_integrity: 'Breaks empty-day integrity (preserve rule)',
  low_cluster_value_preserved_day: 'Low cluster value on a preserved day',
};

/** Extra tooltip lines for liaison ids (product meaning). */
const SCOUT_LIAISON_LABEL_LONG_TOOLTIP: Record<string, string> = {
  fits_far_run_day:
    'The day already tends to have longer depot→stop legs after adding this visit, so we pack the farther run onto that day instead of burning a “lighter” day—useful when a slot wins over another with similar drive.',
  fits_zone_pack_day:
    'N8: avoid diluting a day that is already mostly one zone’s booked hours when the week’s hours × panel say that zone deserves that time—soft rule; whitespace on the slot can reduce the penalty.',
  consumes_preserved_anchor_seed_day:
    'This placement uses a day the router treats as a preserved empty “anchor seed” for the week; the server adds a penalty so panel / cluster goals stay honest.',
  breaks_empty_day_integrity:
    'Related preserve rule: scheduling here would break the intended empty-day pattern the server is protecting.',
  low_cluster_value_preserved_day:
    'Related preserve rule: this day had low cluster value under the preserved-empty-day policy.',
};

/** When true, omit Client Liaison Note — preserve is already shown as the amber chip (+ tooltips on Δ / chip). */
const SCOUT_PRESERVE_LIAISON_ID_SET = new Set<string>([
  'consumes_preserved_anchor_seed_day',
  'breaks_empty_day_integrity',
  'low_cluster_value_preserved_day',
]);

function scoutRoutingHideLiaisonCopyForPreserve(row: {
  scoutPreservedEmptyDayPenalty?: number | null;
  scoutLiaisonLabelIds?: string[] | null;
}): boolean {
  const p = row.scoutPreservedEmptyDayPenalty;
  if (typeof p === 'number' && Number.isFinite(p) && p > 0) return true;
  const ids = row.scoutLiaisonLabelIds ?? [];
  return ids.some((id) => SCOUT_PRESERVE_LIAISON_ID_SET.has(String(id).trim().toLowerCase()));
}

function scoutLiaisonIdHint(id: string): string | null {
  const k = id.trim().toLowerCase();
  return SCOUT_LIAISON_LABEL_ID_COPY[k] ?? null;
}

function scoutHumanizeLabelId(id: string): string {
  const k = id.trim().toLowerCase();
  if (SCOUT_LIAISON_LABEL_ID_COPY[k]) return SCOUT_LIAISON_LABEL_ID_COPY[k];
  const w = id.replace(/_/g, ' ').trim().toLowerCase();
  return w ? w.charAt(0).toUpperCase() + w.slice(1) : '';
}

function scoutLiaisonIdsTooltip(ids: string[]): string {
  const parts: string[] = [`i18n: ${ids.join(', ')}`];
  for (const id of ids) {
    const k = id.trim().toLowerCase();
    const hint = scoutLiaisonIdHint(id);
    const long = SCOUT_LIAISON_LABEL_LONG_TOOLTIP[k];
    if (hint) parts.push(`${id.trim()} → ${hint}${long ? ` — ${long}` : ''}`);
    else
      parts.push(
        `${id.trim()} (no local hint—use scoutLiaisonPrimaryLabel / scoutLiaisonLabels from API)`
      );
  }
  return parts.join(' · ');
}

/** Dedupe primary + list when the API repeats the same line (e.g. "Fits an existing route" twice). */
function scoutLiaisonDedupeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\ban?\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function scoutLiaisonUniquePhrases(primary: string, labels: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    const k = scoutLiaisonDedupeKey(t);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(t);
  };
  add(primary);
  for (const l of labels) add(l);
  return out;
}

/** One line: "Client Liaison Note: …". Label ids only in `title` / `data-scout-liaison-label-ids`. */
function ScoutLiaisonCopyBlock({ row }: { row: ScoutRoutingGapRow }) {
  const primary = (row.scoutLiaisonPrimaryLabel ?? '').trim();
  const labels = (row.scoutLiaisonLabels ?? []).map((s) => String(s).trim()).filter(Boolean);
  const ids = (row.scoutLiaisonLabelIds ?? []).map((s) => String(s).trim()).filter(Boolean);
  const phrases = scoutLiaisonUniquePhrases(primary, labels);
  const title = ids.length ? scoutLiaisonIdsTooltip(ids) : undefined;
  if (phrases.length === 0) {
    if (!ids.length) return null;
    const human = ids.map((id) => scoutHumanizeLabelId(id)).filter(Boolean).join('; ');
    return (
      <p
        style={{
          margin: '0 0 8px 0',
          padding: '6px 10px',
          borderRadius: 8,
          background: '#f8fafc',
          border: '1px solid #e2e8f0',
          fontSize: 13,
          color: '#1e293b',
        }}
        title={title}
        data-scout-liaison-label-ids={ids.join(',')}
      >
        <span style={{ fontWeight: 600 }}>Client Liaison Note:</span> {human}
      </p>
    );
  }
  const body = phrases.join('; ');
  return (
    <p
      style={{
        margin: '0 0 8px 0',
        padding: '6px 10px',
        borderRadius: 8,
        background: '#f8fafc',
        border: '1px solid #e2e8f0',
        fontSize: 13,
        color: '#1e293b',
      }}
      title={title}
      data-scout-liaison-label-ids={ids.length ? ids.join(',') : undefined}
    >
      <span style={{ fontWeight: 600 }}>Client Liaison Note:</span> {body}
    </p>
  );
}

function scoutFiniteNumber(...vals: unknown[]): number | null {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** Household / patient totals for the day; accepts alternate API keys on the row object. */
function scoutHouseholdsAndPatientsFromRow(row: ScoutRoutingGapRow): {
  households: number | null;
  patients: number | null;
} {
  const r = row as Record<string, unknown>;
  const households =
    scoutFiniteNumber(
      row.dayHouseholdCount,
      r.dayHouseholds,
      r.householdCount,
      r.dayHouseholdTotal
    ) ?? scoutFiniteNumber(row.dayClientVisitCount);
  const patients = scoutFiniteNumber(
    row.dayPatientCount,
    r.dayPatients,
    r.patientCount,
    r.totalPatients,
    r.dayPatientTotal
  );
  return { households, patients };
}

function ScoutDayStatBadges({
  row,
  embedded,
}: {
  row: ScoutRoutingGapRow;
  /** When true, return chip nodes only (no wrapper) so they sit in a parent flex row. */
  embedded?: boolean;
}) {
  const chips: JSX.Element[] = [];
  if (row.dayIsEmpty === true) {
    chips.push(
      <span key="empty" style={SCOUT_BADGE_CHIP} title="No households or patients scheduled this day (scout).">
        Empty day
      </span>
    );
  }
  if (row.dayIsStrategicLight === true) {
    chips.push(
      <span
        key="strategic"
        style={SCOUT_BADGE_CHIP}
        title="Strategic light: at most one household scheduled this day."
      >
        Strategic light
      </span>
    );
  }
  const { households: hNum, patients: pNum } = scoutHouseholdsAndPatientsFromRow(row);
  if (hNum != null && !(row.dayIsEmpty === true && hNum === 0)) {
    const label =
      pNum != null
        ? `${hNum} household${hNum === 1 ? '' : 's'}, ${pNum} patient${pNum === 1 ? '' : 's'}`
        : `${hNum} household${hNum === 1 ? '' : 's'}`;
    const title =
      pNum != null
        ? 'Households and patients scheduled on this day.'
        : 'Households scheduled this day. Patient total appears when the API sends dayPatientCount.';
    chips.push(
      <span key="hhpt" style={SCOUT_BADGE_CHIP} title={title}>
        {label}
      </span>
    );
  }
  if (!chips.length) return null;
  if (embedded) return <>{chips}</>;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>{chips}</div>;
}

/** Day metrics: prefer first gap that defines any scout stat; else candidate-level fields. */
function scoutDayMetricsForCandidate(opt: Winner): ScoutRoutingGapRow {
  const gaps = scoutGapsFromCandidate(opt as unknown as Record<string, unknown>);
  const fromGap = gaps.find(
    (g) =>
      g.dayIsEmpty != null ||
      g.dayIsStrategicLight != null ||
      typeof g.dayClientVisitCount === 'number' ||
      typeof g.dayHouseholdCount === 'number' ||
      typeof g.dayPatientCount === 'number'
  );
  if (fromGap) {
    return {
      dayClientVisitCount: fromGap.dayClientVisitCount ?? null,
      dayHouseholdCount: fromGap.dayHouseholdCount ?? null,
      dayPatientCount: fromGap.dayPatientCount ?? null,
      dayIsStrategicLight: fromGap.dayIsStrategicLight ?? null,
      dayIsEmpty: fromGap.dayIsEmpty ?? null,
    };
  }
  const count = opt.dayClientVisitCount;
  const noClients =
    opt.scoutDayNoClients === true ||
    (typeof count === 'number' && Number.isFinite(count) && count === 0);
  return {
    dayClientVisitCount: typeof count === 'number' && Number.isFinite(count) ? count : null,
    dayHouseholdCount: opt.dayHouseholdCount ?? null,
    dayPatientCount: opt.dayPatientCount ?? null,
    dayIsStrategicLight: opt.dayIsStrategicLight ?? null,
    dayIsEmpty: noClients ? true : null,
  };
}

function DoctorIcon({ color = 'white' }: { color?: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" style={{ display: 'block' }}>
      <path d="M12 12a5 5 0 1 0-5-5 5 5 0 0 0 5 5Z" stroke={color} strokeWidth="2" />
      <path d="M4 21a8 8 0 0 1 16 0" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function extractErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const maybe = err as { response?: { data?: { message?: string } }; message?: string };
    return maybe.response?.data?.message ?? maybe.message ?? 'Request failed';
  }
  return 'Request failed';
}

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

const ROUTING_PRACTICE_ID = Number(import.meta.env.VITE_PRACTICE_ID) || 1;

function SlotChip({ slot }: { slot?: Slot | null }) {
  return null; // Slot labels (Early / Mid / Late) not shown
}

function EdgeChip({ first, last }: { first?: boolean; last?: boolean }) {
  if (!first && !last) return null;
  const text = first ? 'First of day' : 'Last of day';
  return (
    <span
      style={{
        background: '#eef2ff',
        color: '#3730a3',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
}

/** "HH:mm" or "HH:mm:ss" → seconds since midnight */
function hmsToSec(hms?: string): number | undefined {
  if (!hms) return undefined;
  const [hh = 0, mm = 0, ss = 0] = hms.split(':').map(Number);
  if ([hh, mm, ss].some((n) => Number.isNaN(n))) return undefined;
  return hh * 3600 + mm * 60 + ss;
}

/** Best-effort: if booked is suspiciously small, treat it as minutes. */
function normalizeBookedServiceToSeconds(booked?: number, windowSec?: number): number {
  if (typeof booked !== 'number' || !Number.isFinite(booked) || booked < 0) return 0;
  // If value looks like minutes (e.g., < 8 hours) and minutes*60 fits window, convert.
  const asSec = Math.floor(booked);
  if (asSec < 8 * 3600 && windowSec && booked * 60 <= windowSec) return Math.floor(booked * 60);
  return asSec;
}

/** DoctorDay-style whitespace after insertion */
/** Remaining whitespace after inserting the new appt.
 *  Mirrors DoctorDay: whitespace = shift - (drive + service + new)
 */
function remainingWhitespaceSeconds(
  opt: {
    workStartLocal?: string; // "HH:mm" or "HH:mm:ss"
    effectiveEndLocal?: string; // "HH:mm" or "HH:mm:ss"
    bookedServiceSeconds?: number; // seconds of existing service (non-drive)
    projectedDriveSeconds?: number; // drive *with* the new appt
    currentDriveSeconds?: number; // fallback only
  },
  newServiceMinutes: number
): number | undefined {
  const ws = hmsToSec(opt.workStartLocal);
  const ee = hmsToSec(opt.effectiveEndLocal);

  // We need the work window and the *existing* service to compute whitespace.
  if (ws == null || ee == null) return undefined;
  if (typeof opt.bookedServiceSeconds !== 'number' || opt.bookedServiceSeconds < 0) {
    // Backend didn’t send booked service → avoid showing a misleading, too-large number.
    return undefined;
  }

  const windowSec = Math.max(0, ee - ws);

  // Use projected drive if present; fall back to current drive.
  const driveSec = Math.max(
    0,
    Math.floor(opt.projectedDriveSeconds ?? opt.currentDriveSeconds ?? 0)
  );

  const bookedServiceSec = Math.max(0, Math.floor(opt.bookedServiceSeconds));
  const newServiceSec = Math.max(0, Math.floor(newServiceMinutes * 60));

  const used = driveSec + bookedServiceSec + newServiceSec;
  return Math.max(0, windowSec - used);
}

/** Guard for finite numbers */
function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

/** How many seconds the shift overruns the work window (>=0). */
function endOfDayOverrunSeconds(
  opt: {
    workStartLocal?: string; // "HH:mm" or "HH:mm:ss"
    effectiveEndLocal?: string; // "HH:mm" or "HH:mm:ss"
    bookedServiceSeconds?: number; // may be minutes in some responses
    projectedDriveSeconds?: number;
    currentDriveSeconds?: number;
    addedDriveSeconds?: number;
  },
  newServiceMinutes: number
): number | undefined {
  const ws = hmsToSec(opt.workStartLocal);
  const ee = hmsToSec(opt.effectiveEndLocal);
  if (ws == null || ee == null) return undefined;

  const windowSec = Math.max(0, ee - ws);

  // Drive: prefer projected; otherwise current + added
  const driveSec = finite(opt.projectedDriveSeconds)
    ? Math.floor(opt.projectedDriveSeconds)
    : finite(opt.currentDriveSeconds) && finite(opt.addedDriveSeconds)
      ? Math.floor(opt.currentDriveSeconds + opt.addedDriveSeconds)
      : undefined;
  if (!finite(driveSec)) return undefined;

  // Service: normalize to seconds (handles minute-vs-second ambiguity)
  const bookedServiceSec = normalizeBookedServiceToSeconds(opt.bookedServiceSeconds, windowSec);
  const newServiceSec = Math.max(0, Math.floor(newServiceMinutes * 60));

  // Overrun = -(time budget delta) when delta < 0
  const used = driveSec + bookedServiceSec + newServiceSec;
  const delta = windowSec - used;
  return delta < 0 ? -delta : 0;
}

const NONE_SELECTION_KEY = '__routing-none__';

function deriveRoutingRequestId(res: Result | null | undefined): string | undefined {
  if (!res) return undefined;
  if (res.routingRequestId) return res.routingRequestId;
  if (res.winner?.routingRequestId) return res.winner.routingRequestId;
  if (Array.isArray(res.alternates)) {
    for (const alt of res.alternates) {
      if (alt?.routingRequestId) return alt.routingRequestId;
    }
  }
  if (Array.isArray(res.doctors)) {
    for (const doc of res.doctors) {
      if (Array.isArray(doc.top)) {
        for (const top of doc.top) {
          if (top?.routingRequestId) return top.routingRequestId;
        }
      }
    }
  }
  return undefined;
}

// =========================
/* Component */
// =========================

type RoutingProps = {
  /** When true, "Book appointment" updates the embedded calendar via event instead of navigating to `/schedule/scheduler`. */
  calendarWorkspaceMode?: boolean;
};

export default function Routing({ calendarWorkspaceMode = false }: RoutingProps) {
  const { token: authToken, userId: authUserId, doctorId: authDoctorInternalId } = useAuth();
  const bootstrap = useMemo(() => readRoutingUiBootstrap(), []);

  // -------- Form state --------
  const [form, setForm] = useState<RouteRequest>(() => ({ ...bootstrap.form }));

  // Preferences
  const [preferredWeekday, setPreferredWeekday] = useState<number[]>(() => [...bootstrap.preferredWeekday]);
  const [preferredTimeOfDay, setPreferredTimeOfDay] = useState<'first' | 'middle' | 'end' | null>(
    () => bootstrap.preferredTimeOfDay
  );
  /** UI: "Force Earliest Time"; API: `preferEarliestFeasibleStart` on empty-day routing. */
  const [preferEarliestFeasibleStart, setPreferEarliestFeasibleStart] = useState(
    () => bootstrap.preferEarliestFeasibleStart
  );
  const [edgeFirst, setEdgeFirst] = useState(() => bootstrap.edgeFirst);
  const [edgeLast, setEdgeLast] = useState(() => bootstrap.edgeLast);

  // Toggles
  const [multiDoctor, setMultiDoctor] = useState(() => bootstrap.multiDoctor);
  const [useTraffic, setUseTraffic] = useState(() => bootstrap.useTraffic);
  const [maxAddedDriveMinutes] = useState(20);
  // Reserve/Overflow option: 'reserve-only' | 'reserve-overflow' | null
  const [reserveOption, setReserveOption] = useState<'reserve-only' | 'reserve-overflow' | null>(
    () => bootstrap.reserveOption
  );

  // -------- UX state --------
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(() => (bootstrap.result as Result | null) ?? null);
  const [addressError, setAddressError] = useState<string | null>(null);

  // -------- Client search --------
  const [clientQuery, setClientQuery] = useState(() => bootstrap.clientQuery);
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientBoxRef = useRef<HTMLDivElement | null>(null);
  const latestClientQueryRef = useRef('');

  // -------- Doctor search --------
  const [doctorQuery, setDoctorQuery] = useState(() => bootstrap.doctorQuery);
  const [doctorResults, setDoctorResults] = useState<Doctor[]>([]);
  const [doctorSearching, setDoctorSearching] = useState(false);
  const [showDoctorDropdown, setShowDoctorDropdown] = useState(false);
  const doctorBoxRef = useRef<HTMLDivElement | null>(null);
  const [apptLengthsLoading, setApptLengthsLoading] = useState(false);
  const [apptLengthsRows, setApptLengthsRows] = useState<AvgMinutesByTypeRow[]>([]);
  const [apptLengthsError, setApptLengthsError] = useState<string | null>(null);
  /** Selected row from Appt lengths stats (same list as the popover); empty = do not auto-fill minutes. */
  const [routingApptStatsTypeKey, setRoutingApptStatsTypeKey] = useState('');
  const [routingPetCount, setRoutingPetCount] = useState(1);
  const latestDoctorQueryRef = useRef('');
  const [doctorActiveIdx, setDoctorActiveIdx] = useState<number>(-1);
  const [clientActiveIdx, setClientActiveIdx] = useState<number>(-1);

  // -------- Winner doctor name cache --------
  const [doctorNames, setDoctorNames] = useState<Record<string, string>>(() => ({ ...bootstrap.doctorNames }));
  const doctorNameReqs = useRef<Record<string, Promise<string>>>({});

  const [schedulePreview, setSchedulePreview] = useState<null | { opt: UnifiedOption; scope: 'day' | 'week' }>(
    null
  );
  const [doctorIdByPims, setDoctorIdByPims] = useState<Record<string, string>>({});
  const [selectedClientAlerts, setSelectedClientAlerts] = useState<string | null>(
    () => bootstrap.selectedClientAlerts
  );
  const [latestRoutingRequestId, setLatestRoutingRequestId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      return sessionStorage.getItem(ROUTING_REQUEST_ID_SESSION_KEY);
    } catch {
      return null;
    }
  });

  const rememberRoutingRequestId = useCallback((id?: string | null) => {
    if (!id) return;
    setLatestRoutingRequestId(id);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem(ROUTING_REQUEST_ID_SESSION_KEY, id);
      } catch {
        /* ignore persistence errors */
      }
    }
  }, []);

  const [feedbackSubmittingKey, setFeedbackSubmittingKey] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<string | null>(null);
  const [feedbackSuccessKey, setFeedbackSuccessKey] = useState<string | null>(
    () => bootstrap.feedbackSuccessKey
  );
  const [scheduleBookTypeId, setScheduleBookTypeId] = useState<number | null>(
    () => bootstrap.scheduleBookTypeId
  );
  /** Option keys for which POST /appointments succeeded (calendar book flow). */
  const [scheduleBookedKeys, setScheduleBookedKeys] = useState<Record<string, true>>(
    () => ({ ...bootstrap.scheduleBookedKeys })
  );

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [hasActiveRescheduleIntent, setHasActiveRescheduleIntent] = useState(() =>
    rescheduleIntentIsActive()
  );

  useEffect(() => {
    function syncRescheduleIntentFlag() {
      setHasActiveRescheduleIntent(rescheduleIntentIsActive());
    }
    syncRescheduleIntentFlag();
    window.addEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, syncRescheduleIntentFlag);
    return () =>
      window.removeEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, syncRescheduleIntentFlag);
  }, []);

  /** Calendar “Reschedule…” → hydrate Routing form once per intent row. */
  useEffect(() => {
    function mergeRescheduleIntentFromCalendar() {
      const intent = readRoutingRescheduleIntent();
      if (!intent || intent.appliedToRoutingForm) return;

      setForm((f) => ({
        ...f,
        newAppt: {
          ...f.newAppt,
          clientId: intent.clientId,
          address: intent.address?.trim() || f.newAppt.address,
          lat: intent.lat ?? f.newAppt.lat,
          lon: intent.lon ?? f.newAppt.lon,
          serviceMinutes:
            intent.serviceMinutes > 0 ? intent.serviceMinutes : Math.max(15, f.newAppt.serviceMinutes || 45),
        },
      }));

      const label = intent.clientDisplayLabel?.trim();
      if (label) setClientQuery(label);

      const tid = intent.appointmentTypeId;
      if (tid != null && Number.isFinite(Number(tid))) setScheduleBookTypeId(Number(tid));

      const alerts = intent.clientAlerts;
      if (alerts !== undefined && alerts !== null) setSelectedClientAlerts(alerts);

      const pimsDoc = intent.primaryDoctorPimsId?.trim();
      if (pimsDoc) {
        setForm((f) => ({ ...f, doctorId: pimsDoc }));
        setDoctorQuery((q) => {
          if (q.trim()) return q;
          const dn = intent.primaryDoctorDisplayName?.trim();
          return dn || `Doctor ${pimsDoc}`;
        });
      }

      setResult(null);
      setFeedbackError(null);
      setFeedbackToast('Reschedule: client loaded. Run routing, open My Week, then confirm the new time.');
      markRescheduleIntentAppliedToRoutingForm();
    }

    mergeRescheduleIntentFromCalendar();
    window.addEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, mergeRescheduleIntentFromCalendar);
    return () =>
      window.removeEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, mergeRescheduleIntentFromCalendar);
  }, []);

  useEffect(() => {
    if (!authToken) clearRoutingUiSnapshot();
  }, [authToken]);

  /** Practice calendar (embedded) completed a book/reschedule — drop routing candidates from the pane. */
  useEffect(() => {
    if (!calendarWorkspaceMode) return;
    function clearRoutingAfterCalendarBook() {
      setResult(null);
      setError(null);
      setSchedulePreview(null);
      setFeedbackError(null);
      setFeedbackToast(null);
      setFeedbackSubmittingKey(null);
      setFeedbackSuccessKey(null);
      setScheduleBookedKeys({});
      setLatestRoutingRequestId(null);
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.removeItem(ROUTING_REQUEST_ID_SESSION_KEY);
        } catch {
          /* ignore */
        }
      }
    }
    window.addEventListener(ROUTING_WORKSPACE_SCHEDULER_BOOKED_EVENT, clearRoutingAfterCalendarBook);
    return () =>
      window.removeEventListener(ROUTING_WORKSPACE_SCHEDULER_BOOKED_EVENT, clearRoutingAfterCalendarBook);
  }, [calendarWorkspaceMode]);

  useEffect(() => {
    if (!authToken || !authDoctorInternalId?.trim()) return;
    const internal = authDoctorInternalId.trim();
    const cacheUserId = authUserId?.trim() || null;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await http.get(`/employees/${encodeURIComponent(internal)}`);
        const emp = Array.isArray(data) ? data[0] : data;
        const pimsRaw =
          emp?.pimsId != null
            ? String(emp.pimsId)
            : emp?.employee?.pimsId != null
              ? String(emp.employee.pimsId)
              : '';
        const pimsId = pimsRaw.trim();
        if (cancelled || !pimsId) return;
        const displayName = buildDoctorName(emp, `Doctor ${pimsId}`);
        if (cacheUserId) writeAuthDoctorCache(cacheUserId, pimsId, displayName);
        setForm((f) => (f.doctorId.trim() ? f : { ...f, doctorId: pimsId }));
        setDoctorQuery((q) => (q.trim() ? q : displayName));
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken, authUserId, authDoctorInternalId]);

  useEffect(() => {
    if (loading || !authToken) return;
    const uid = authUserId?.trim() || null;
    writeRoutingUiSnapshot({
      v: 1,
      userId: uid,
      form,
      result,
      multiDoctor,
      useTraffic,
      preferredWeekday,
      preferredTimeOfDay,
      preferEarliestFeasibleStart,
      edgeFirst,
      edgeLast,
      reserveOption,
      clientQuery,
      doctorQuery,
      doctorNames,
      scheduleBookedKeys,
      feedbackSuccessKey,
      selectedClientAlerts,
      scheduleBookTypeId,
    });
  }, [
    loading,
    authToken,
    authUserId,
    form,
    result,
    multiDoctor,
    useTraffic,
    preferredWeekday,
    preferredTimeOfDay,
    preferEarliestFeasibleStart,
    edgeFirst,
    edgeLast,
    reserveOption,
    clientQuery,
    doctorQuery,
    doctorNames,
    scheduleBookedKeys,
    feedbackSuccessKey,
    selectedClientAlerts,
    scheduleBookTypeId,
  ]);

  useEffect(() => {
    const b = searchParams.get('booked');
    if (!b) return;
    setScheduleBookedKeys((m) => ({ ...m, [b]: true }));
    setFeedbackToast('Appointment added to the schedule.');
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  async function openMyDay(opt: UnifiedOption) {
    // 👇 allow undefined here
    let internalId: string | undefined = doctorIdByPims[opt.doctorPimsId];

    if (!internalId) {
      try {
        const { data } = await http.get(`/employees/pims/${encodeURIComponent(opt.doctorPimsId)}`);
        const emp = Array.isArray(data) ? data[0] : data;

        // 👇 resolve to a temp, then narrow
        const resolvedId =
          (emp?.id != null ? String(emp.id) : undefined) ??
          (emp?.employee?.id != null ? String(emp.employee.id) : undefined);

        if (resolvedId) {
          internalId = resolvedId;
          setDoctorIdByPims((m) => ({ ...m, [opt.doctorPimsId]: resolvedId }));
        }
      } catch {
        /* ignore; we'll bail below if still missing */
      }
    }

    if (!internalId) return; // couldn’t resolve → don’t open

    // Pass INTERNAL id via the same property your Preview/DoctorDay read
    setSchedulePreview({ opt: { ...opt, doctorPimsId: internalId }, scope: 'day' });
  }
  function closeSchedulePreview() {
    setSchedulePreview(null);
  }

  async function openMyWeek(opt: UnifiedOption) {
    let internalId: string | undefined = doctorIdByPims[opt.doctorPimsId];
    if (!internalId) {
      try {
        const { data } = await http.get(`/employees/pims/${encodeURIComponent(opt.doctorPimsId)}`);
        const emp = Array.isArray(data) ? data[0] : data;
        const resolvedId =
          (emp?.id != null ? String(emp.id) : undefined) ??
          (emp?.employee?.id != null ? String(emp.employee.id) : undefined);
        if (resolvedId) {
          internalId = resolvedId;
          setDoctorIdByPims((m) => ({ ...m, [opt.doctorPimsId]: resolvedId }));
        }
      } catch {
        /* ignore */
      }
    }
    if (!internalId) return;

    const clientIdRaw = form.newAppt.clientId?.trim();
    if (!clientIdRaw) {
      setFeedbackError('Select a client before opening the calendar preview.');
      return;
    }
    if (scheduleBookTypeId == null) {
      setFeedbackError('Appointment types are still loading. Try again in a moment.');
      return;
    }
    if (!opt.suggestedStartIso) {
      setFeedbackError('This option has no suggested start time.');
      return;
    }

    setFeedbackError(null);
    const merged = { ...opt, doctorPimsId: internalId } as UnifiedOption;
    const payload: RoutingCalendarPreviewPayloadV1 = {
      version: 1,
      option: { ...(merged as unknown as Record<string, unknown>), doctorPimsId: internalId } as RoutingCalendarPreviewPayloadV1['option'],
      serviceMinutes: Math.max(1, Number(form.newAppt.serviceMinutes) || 30),
      newApptMeta: {
        clientId: form.newAppt.clientId,
        address: form.newAppt.address,
        lat: form.newAppt.lat,
        lon: form.newAppt.lon,
      },
      appointmentTypeId: scheduleBookTypeId,
      clientDisplayLabel: clientQuery.trim() || undefined,
    };
    const rescheduleRow = readRoutingRescheduleIntent();
    if (rescheduleRow) {
      payload.rescheduleAppointmentId = rescheduleRow.appointmentId;
      payload.reschedulePatientId = rescheduleRow.patientId;
    }
    writeRoutingCalendarPreview(payload);
    if (calendarWorkspaceMode) {
      window.dispatchEvent(new Event(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT));
    } else {
      navigate('/schedule/scheduler?routingPreview=1');
    }
  }

  const hasFinalSelection = feedbackSuccessKey != null;

  function routingOptionKey(opt: UnifiedOption): string {
    return `${opt.doctorPimsId}-${opt.date}-${opt.insertionIndex}-${opt.candidateIndex ?? ''}`;
  }

  async function submitFeedbackForNone() {
    if (hasFinalSelection) return;

    setFeedbackSubmittingKey(NONE_SELECTION_KEY);
    setFeedbackError(null);
    setFeedbackToast(null);

    const routingRequestId = latestRoutingRequestId ?? deriveRoutingRequestId(result);
    if (!routingRequestId) {
      setFeedbackError('Missing routing request identifier for this suggestion.');
      setFeedbackSubmittingKey(null);
      return;
    }

    const payload = {
      routingRequestId,
      selectionStatus: 'rejected' as const,
    };

    try {
      await http.post('/routing/feedback', payload);
      rememberRoutingRequestId(routingRequestId);
      setFeedbackToast('Thanks! We recorded that none of the suggestions were chosen.');
      setFeedbackSuccessKey(NONE_SELECTION_KEY);
    } catch (err) {
      setFeedbackError(extractErrorMessage(err));
    } finally {
      setFeedbackSubmittingKey(null);
    }
  }

  useEffect(() => {
    // Collect all doctor IDs that need names fetched
    const doctorIdsToFetch = new Set<string>();
    
    // Add primary doctor from result header
    const primaryPid = result?.selectedDoctorPimsId || result?.doctorPimsId;
    if (primaryPid) doctorIdsToFetch.add(primaryPid);
    
    // For v2 multi-doctor mode, collect doctorIds from candidates
    if (result?.winner?.doctorId) {
      doctorIdsToFetch.add(result.winner.doctorId);
    }
    if (result?.alternates) {
      for (const alt of result.alternates) {
        if (alt.doctorId) {
          doctorIdsToFetch.add(alt.doctorId);
        }
      }
    }
    
    // Fetch names for all doctor IDs that don't already have names
    for (const pid of doctorIdsToFetch) {
      if (!pid || doctorNames[pid]) continue;
      if (!doctorNameReqs.current[pid]) {
        doctorNameReqs.current[pid] = (async () => {
          try {
            const { data } = await http.get(`/employees/pims/${encodeURIComponent(pid)}`);
            const emp = Array.isArray(data) ? data[0] : data;

            const name = buildDoctorName(emp, `Doctor ${pid}`);

            const internalId =
              (emp?.id != null ? String(emp.id) : undefined) ??
              (emp?.employee?.id != null ? String(emp.employee.id) : undefined);

            setDoctorNames((m) => ({ ...m, [pid]: name }));
            if (internalId) setDoctorIdByPims((m) => ({ ...m, [pid]: internalId }));
            return name;
          } catch {
            const fallback = `Doctor ${pid}`;
            setDoctorNames((m) => ({ ...m, [pid]: fallback }));
            return fallback;
          } finally {
            delete doctorNameReqs.current[pid];
          }
        })();
      }
    }
  }, [result, doctorNames]);

  useEffect(() => {
    const id = deriveRoutingRequestId(result);
    if (id) rememberRoutingRequestId(id);
  }, [result, rememberRoutingRequestId]);

  useEffect(() => {
    if (!feedbackToast) return;
    const timeout =
      typeof window !== 'undefined'
        ? window.setTimeout(() => setFeedbackToast(null), 5000)
        : null;
    return () => {
      if (timeout != null) window.clearTimeout(timeout);
    };
  }, [feedbackToast]);

  useEffect(() => {
    let cancelled = false;
    fetchAllAppointmentTypes(ROUTING_PRACTICE_ID)
      .then((rows) => {
        if (cancelled) return;
        const active = rows.filter((t) => t.isActive !== false && !t.isDeleted);
        const prefer =
          active.find((t) =>
            /wellness|standard|check-up|checkup|office/i.test(String(t.prettyName || t.name || ''))
          ) ?? active[0];
        if (prefer?.id != null) {
          setScheduleBookTypeId((cur) => (cur != null ? cur : Number(prefer.id)));
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // =========================
  // Effects
  // =========================

  // Client search
  useEffect(() => {
    const q = (clientQuery ?? '').trim();
    latestClientQueryRef.current = q;
    if (!q) {
      setClientResults([]);
      setShowClientDropdown(false);
      return;
    }
    const t = setTimeout(async () => {
      setClientSearching(true);
      try {
        const { data } = await http.get('/clients/search', { params: { q } });
        if (latestClientQueryRef.current === q) {
          setClientResults(Array.isArray(data) ? data : []);
          setShowClientDropdown(true);
        }
      } catch (e) {
        console.error('Client search failed', e);
      } finally {
        setClientSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [clientQuery]);

  // Doctor search
  useEffect(() => {
    const q = doctorQuery.trim();
    latestDoctorQueryRef.current = q;
    if (!q) {
      setDoctorResults([]);
      setShowDoctorDropdown(false);
      return;
    }
    const t = setTimeout(async () => {
      setDoctorSearching(true);
      try {
        const { data } = await http.get(DOCTORS_SEARCH_URL, { params: { q } });
        if (latestDoctorQueryRef.current === q) {
          setDoctorResults(Array.isArray(data) ? data : []);
          setShowDoctorDropdown(true);
        }
      } catch (e) {
        console.error('Doctor search failed', e);
      } finally {
        setDoctorSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [doctorQuery]);

  // Close dropdowns
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (clientBoxRef.current && !clientBoxRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
      if (doctorBoxRef.current && !doctorBoxRef.current.contains(e.target as Node)) {
        setShowDoctorDropdown(false);
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  useEffect(() => {
    setRoutingApptStatsTypeKey('');
    setRoutingPetCount(1);
    if (!form.doctorId.trim()) {
      setApptLengthsRows([]);
    }
  }, [form.doctorId]);

  const loadApptLengthStats = useCallback(async () => {
    const doctorId = form.doctorId.trim();
    if (!doctorId) return;
    setApptLengthsLoading(true);
    setApptLengthsError(null);
    try {
      const end = DateTime.now().startOf('day');
      const start = end.minus({ days: 29 });
      const startStr = start.toISODate()!;
      const endStr = end.toISODate()!;
      const months = monthsCoveringRange(startStr, endStr);
      const responses = await Promise.all(
        months.map(({ year, month }) => fetchDoctorMonth(year, month, doctorId))
      );
      const allDays = responses.flatMap((r) => r.days ?? []);
      const rows = summarizeAvgMinutesByAppointmentType(allDays, startStr, endStr, doctorId);
      setApptLengthsRows(rows);
    } catch (e) {
      setApptLengthsError(extractErrorMessage(e));
      setApptLengthsRows([]);
    } finally {
      setApptLengthsLoading(false);
    }
  }, [form.doctorId]);

  useEffect(() => {
    if (!form.doctorId.trim()) return;
    void loadApptLengthStats();
  }, [form.doctorId, loadApptLengthStats]);

  useEffect(() => {
    if (!routingApptStatsTypeKey) return;
    const row = apptLengthsRows.find((r) => r.typeName === routingApptStatsTypeKey);
    if (!row) return;
    const mins = estimatedServiceMinutesFromStatsRow(row, routingPetCount);
    if (mins == null || mins < 1) return;
    setForm((f) => ({
      ...f,
      newAppt: { ...f.newAppt, serviceMinutes: mins },
    }));
  }, [routingApptStatsTypeKey, routingPetCount, apptLengthsRows]);

  // Fetch doctor name if missing
  useEffect(() => {
    const pid = result?.selectedDoctorPimsId || result?.doctorPimsId;
    if (!pid || doctorNames[pid]) return;
    if (!doctorNameReqs.current[pid]) {
      doctorNameReqs.current[pid] = (async () => {
        try {
          const { data } = await http.get(`/employees/pims/${encodeURIComponent(pid)}`);
          const emp = Array.isArray(data) ? data[0] : data;
          const name = buildDoctorName(emp, `Doctor ${pid}`);
          setDoctorNames((m) => ({ ...m, [pid]: name }));
          return name;
        } catch {
          const fallback = `Doctor ${pid}`;
          setDoctorNames((m) => ({ ...m, [pid]: fallback }));
          return fallback;
        } finally {
          delete doctorNameReqs.current[pid];
        }
      })();
    }
  }, [result, doctorNames]);

  // =========================
  // Handlers
  // =========================

  function onChange<K extends keyof RouteRequest>(key: K, value: RouteRequest[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function onNewApptChange<K extends keyof RouteRequest['newAppt']>(
    key: K,
    value: RouteRequest['newAppt'][K]
  ) {
    setForm((f) => {
      if (key === 'address') {
        setAddressError(null);
        return {
          ...f,
          newAppt: {
            ...f.newAppt,
            address: (value as string) ?? '',
            lat: undefined,
            lon: undefined,
          },
        };
      }
      return { ...f, newAppt: { ...f.newAppt, [key]: value } };
    });
  }

  function pickClient(c: Client) {
    const addr = formatClientAddress(c);
    const latNum = typeof c.lat === 'string' ? parseFloat(c.lat) : c.lat;
    const lonNum = typeof c.lon === 'string' ? parseFloat(c.lon) : c.lon;

    setForm((f) => ({
      ...f,
      newAppt: {
        ...f.newAppt,
        clientId: String(c.id),
        address: addr,
        lat: Number.isFinite(latNum as number) ? (latNum as number) : undefined,
        lon: Number.isFinite(lonNum as number) ? (lonNum as number) : undefined,
      },
    }));
    setAddressError(null);

    setClientQuery(`${c.lastName}, ${c.firstName}`);
    setClientResults([]);
    setShowClientDropdown(false);
    setSelectedClientAlerts((c as any).alerts ?? null);
  }

  function pickDoctor(d: Doctor) {
    const pimsId = doctorPimsIdOf(d);
    if (!pimsId) {
      console.warn('No pimsId on doctor record', d);
      return;
    }
    setForm((f) => ({ ...f, doctorId: pimsId }));
    setDoctorQuery(localDoctorDisplayName(d));
    setDoctorResults([]);
    setShowDoctorDropdown(false);
  }

  function diffDaysInclusive(aISO: string, bISO: string) {
    const a = new Date(aISO + 'T00:00:00');
    const b = new Date(bISO + 'T00:00:00');
    const ms = b.getTime() - a.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return days + 1;
  }

  async function submitRoutingRequest(endpoint: string, doctorIdsArray?: string[]) {
    setError(null);
    setResult(null);
    setAddressError(null);
    setFeedbackSubmittingKey(null);
    setFeedbackSuccessKey(null);
    setFeedbackToast(null);
    setFeedbackError(null);
    setScheduleBookedKeys({});

    if (new Date(form.endDate) < new Date(form.startDate)) {
      setError('End date must be on or after the start date.');
      return;
    }

    // Ensure we have coords; if not, validate typed address to street-level.
    let newApptPayload = { ...form.newAppt };
    const hasCoords =
      Number.isFinite(newApptPayload.lat as number) &&
      Number.isFinite(newApptPayload.lon as number);
    const addr = (newApptPayload.address ?? '').trim();

    if (!hasCoords) {
      if (!addr) {
        setError('Please select a client or enter a valid street address.');
        setAddressError('Enter a street address or pick a client.');
        return;
      }
      try {
        const chk = await validateAddress(addr, { minLevel: 'street' });
        if (!chk.ok) {
          setError(chk.message);
          setAddressError(chk.message);
          return;
        }
        newApptPayload = {
          ...newApptPayload,
          lat: chk.result.lat,
          lon: chk.result.lon,
          address: chk.result.formattedAddress || addr,
        };
        // Persist so preview/modal have coordinates.
        setForm((f) => ({ ...f, newAppt: newApptPayload }));
      } catch (geErr) {
        const msg =
          (geErr as any)?.response?.data?.message ||
          (geErr as any)?.message ||
          'Failed to validate address.';
        setError(msg);
        setAddressError(msg);
        return;
      }
    }

    const numDays = Math.max(1, diffDaysInclusive(form.startDate, form.endDate));

    // If both edge boxes are selected, cancel the preference.
    const preferEdge: 'first' | 'last' | null =
      edgeFirst && !edgeLast ? 'first' : edgeLast && !edgeFirst ? 'last' : null;

    // Map reserveOption to ignoreEmergencyBlocks and allowOverflow
    const ignoreEmergencyBlocks = reserveOption === 'reserve-only' || reserveOption === 'reserve-overflow';
    const allowOverflow = reserveOption === 'reserve-overflow';

    // Format preferredWeekday: single number (backward compatible) or array of numbers
    const preferredWeekdayPayload: number | number[] | null = 
      preferredWeekday.length === 0 
        ? null 
        : preferredWeekday.length === 1 
          ? preferredWeekday[0] 
          : preferredWeekday;

    const base: Record<string, unknown> & RoutingSlotSearchOptionalFlags = {
      startDate: form.startDate,
      numDays,
      newAppt: newApptPayload,
      useTraffic,
      ignoreEmergencyBlocks,
      preferredWeekday: preferredWeekdayPayload,
      preferredTimeOfDay, // 'first' | 'middle' | 'end' | null
      preferEdge, // 'first' | 'last' | null
      ...(allowOverflow
        ? {
            returnToDepot: 'afterHoursOk' as const,
            tailOvertimeMinutes: 120 as const,
          }
        : {}),
      ...(preferEarliestFeasibleStart ? { preferEarliestFeasibleStart: true } : {}),
    };

    // Determine if this is a v2 endpoint
    const isV2 = endpoint.includes('/v2');

    let payload: any;
    if (isV2) {
      // v2 endpoint supports new multi-doctor format
      if (multiDoctor && doctorIdsArray && doctorIdsArray.length > 0) {
        payload = {
          doctorIds: doctorIdsArray,
          ...base,
          maxAddedDriveMinutes,
        };
      } else if (multiDoctor) {
        const ids = form.doctorId.trim() ? [form.doctorId.trim()] : [];
        payload = {
          doctorIds: ids,
          ...base,
          maxAddedDriveMinutes,
        };
      } else {
        // Single doctor mode for v2
        payload = {
          doctorId: form.doctorId,
          ...base,
        };
      }
    } else {
      // Legacy endpoints (v1)
      payload = multiDoctor
        ? { primaryDoctorPimsId: form.doctorId, ...base, maxAddedDriveMinutes }
        : { doctorId: form.doctorId, ...base };
    }

    setLoading(true);
    try {
      const { data } = await http.post<Result>(endpoint, payload);
      const normalized = normalizeRoutingV2SlotSearchResponse(
        data as RoutingV2SlotSearchResult
      ) as Result;
      setResult(normalized);
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Validate form before submission
  function validateForm(): { valid: boolean; error?: string } {
    if (!form.doctorId || !form.doctorId.trim()) {
      return { valid: false, error: 'Please select a doctor.' };
    }

    if (!form.startDate) {
      return { valid: false, error: 'Please select a start date.' };
    }

    if (!form.endDate) {
      return { valid: false, error: 'Please select an end date.' };
    }

    if (new Date(form.endDate) < new Date(form.startDate)) {
      return { valid: false, error: 'End date must be on or after the start date.' };
    }

    const hasCoords =
      Number.isFinite(form.newAppt.lat as number) &&
      Number.isFinite(form.newAppt.lon as number);
    const hasAddress = (form.newAppt.address ?? '').trim().length > 0;

    if (!hasCoords && !hasAddress) {
      return { valid: false, error: 'Please select a client or enter a valid street address.' };
    }

    if (!form.newAppt.serviceMinutes || form.newAppt.serviceMinutes <= 0) {
      return { valid: false, error: 'Please enter a valid service duration.' };
    }

    return { valid: true };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    
    // Validate form first
    const validation = validateForm();
    if (!validation.valid) {
      setError(validation.error || 'Please fill in all required fields.');
      return;
    }

    const endpoint = '/routing/v2';

    if (multiDoctor) {
      const primary = form.doctorId.trim();
      if (!primary) {
        setError('Please select a doctor.');
        return;
      }
      await submitRoutingRequest(endpoint, [primary]);
    } else {
      await submitRoutingRequest(endpoint);
    }
  }

  // =========================
  // Build unified options
  // =========================

  const displayOptions: UnifiedOption[] = useMemo(() => {
    const rows: UnifiedOption[] = [];
    const requestIdFromResult = result?.routingRequestId ?? latestRoutingRequestId ?? undefined;

    // Helper for displayInsertionIndex calculation
    const isEmptyDay = (x: any) =>
      Boolean(x?.dayIsEmpty || x?._emptyDay || x?.flags?.includes?.('EMPTY'));

    // Sort function: by score (lowest first)
    const sortByScore = (a: UnifiedOption, b: UnifiedOption) => {
      const aScore = typeof a.score === 'number' ? a.score : Number.POSITIVE_INFINITY;
      const bScore = typeof b.score === 'number' ? b.score : Number.POSITIVE_INFINITY;
      return aScore - bScore;
    };

    if (multiDoctor && result?.doctors) {
      // Multi-doctor mode: no explicit winner, just sort all options by score
      for (const d of result.doctors) {
        const pid = d.pimsId;
        const name = d.name || doctorNames[pid] || `Doctor ${pid}`;
        for (const w of d.top || [])
          rows.push({
            ...w,
            doctorPimsId: pid,
            doctorName: name,
            routingRequestId: w.routingRequestId ?? requestIdFromResult,
          });
      }
      // Sort all options by score (lowest first)
      rows.sort(sortByScore);
    } else if (result) {
      // Single-doctor mode or v2 multi-doctor mode: winner should always be first, then sorted alternates
      // For v2, each candidate has its own doctorId
      const defaultPid = result.selectedDoctorPimsId || result.doctorPimsId || form.doctorId;
      const defaultName =
        result.selectedDoctor?.name ||
        result.selectedDoctorDisplayName ||
        doctorNames[defaultPid] ||
        buildDoctorName(result.selectedDoctor, `Doctor ${defaultPid}`);
      
      // Helper to get doctor info for a candidate (supports v2 doctorId field)
      const getDoctorInfo = (candidate: Winner): { pid: string; name: string } => {
        if (candidate.doctorId) {
          // v2 multi-doctor mode: candidate has its own doctorId
          const pid = candidate.doctorId;
          const name = doctorNames[pid] || `Doctor ${pid}`;
          return { pid, name };
        }
        // Legacy mode: use default doctor
        return { pid: defaultPid, name: defaultName };
      };
      
      let winnerOption: UnifiedOption | null = null;
      const alternateOptions: UnifiedOption[] = [];
      
      if (result.winner) {
        const docInfo = getDoctorInfo(result.winner);
        winnerOption = {
          ...result.winner,
          doctorPimsId: docInfo.pid,
          doctorName: docInfo.name,
          routingRequestId: result.winner.routingRequestId ?? requestIdFromResult,
        };
      }
      
      if (result.alternates) {
        for (const w of result.alternates) {
          const docInfo = getDoctorInfo(w);
          alternateOptions.push({
            ...w,
            doctorPimsId: docInfo.pid,
            doctorName: docInfo.name,
            routingRequestId: w.routingRequestId ?? requestIdFromResult,
          });
        }
      }
      
      // Combine winner and alternates, then sort all by score (lowest first)
      if (winnerOption) {
        rows.push(winnerOption);
      }
      rows.push(...alternateOptions);
      rows.sort(sortByScore);
    }

    return rows.map((r, idx) => {
      // Force index look nice for EMPTY day
      const empty = isEmptyDay(r);
      const displayInsertionIndex = empty ? 1 : (r.insertionIndex ?? 0) + 1;
      const positionInDay = r.positionInDay ?? displayInsertionIndex;
      return {
        ...r,
        displayInsertionIndex,
        positionInDay,
        routingRequestId: r.routingRequestId ?? requestIdFromResult,
        candidateIndex: r.candidateIndex ?? idx,
      };
    });
  }, [multiDoctor, result, doctorNames, form.doctorId, latestRoutingRequestId]);

  /** Zone class + polygon name are the same for all cards in a search—show once in Results header. */
  const routingZoneAwareResultsBanner = useMemo(() => {
    if (!result || !scoutPolicyZoneAware(result.scoutEmptyDayPolicy)) return null;
    let zoneClassRaw: string | null = scoutZoneClassRaw(result.winner?.scoutZoneClass);
    let polyLine: string | null = routingPolygonZoneDisplayLine({
      effectiveZone: result.winner?.effectiveZone,
      clientZone: result.winner?.clientZone,
    });
    if (!polyLine) {
      polyLine = routingPolygonZoneDisplayLine({
        effectiveZone: result.effectiveZone,
        clientZone: result.clientZone,
      });
    }
    for (const o of displayOptions) {
      if (!zoneClassRaw) zoneClassRaw = scoutZoneClassRaw(o.scoutZoneClass);
      if (!polyLine) {
        polyLine = routingPolygonZoneDisplayLine({
          effectiveZone: o.effectiveZone,
          clientZone: o.clientZone,
        });
      }
      if (zoneClassRaw && polyLine) break;
    }
    return { zoneClassRaw, polyLine };
  }, [result, displayOptions]);

  // =========================
  // Render
  // =========================

  const weekdayLabels: Array<{ n: number; label: string }> = [
    { n: 1, label: 'Mon' },
    { n: 2, label: 'Tue' },
    { n: 3, label: 'Wed' },
    { n: 4, label: 'Thu' },
    { n: 5, label: 'Fri' },
    { n: 6, label: 'Sat' },
    { n: 7, label: 'Sun' },
  ];

  return (
    <div className="routing-page-root">
      {/* ------- Form ------- */}
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Get Best Route</h2>
        <form onSubmit={onSubmit} className="routing-form-stack">
          {/* Doctor picker */}
          <div className="routing-doctor-row">
            <Field label="Doctor">
              <div style={{ position: 'relative', width: '100%' }}>
                <div
                  ref={doctorBoxRef}
                  className="routing-doctor-input-wrap"
                  style={{
                    position: 'relative',
                  }}
                >
                  <input
                    className="input"
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    value={doctorQuery}
                    onChange={(e) => {
                      setDoctorQuery(e.target.value);
                      setDoctorActiveIdx(-1);
                    }}
                    placeholder="Type doctor name..."
                    onFocus={() => doctorResults.length && setShowDoctorDropdown(true)}
                    onKeyDown={(e) => {
                      if (!doctorResults.length) return;

                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setShowDoctorDropdown(true);
                        setDoctorActiveIdx((i) => (i < doctorResults.length - 1 ? i + 1 : 0));
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setShowDoctorDropdown(true);
                        setDoctorActiveIdx((i) => (i <= 0 ? doctorResults.length - 1 : i - 1));
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const pick =
                          doctorActiveIdx >= 0 ? doctorResults[doctorActiveIdx] : doctorResults[0];
                        if (pick) {
                          pickDoctor(pick);
                          setShowDoctorDropdown(false);
                          setDoctorResults([]); // ensure no later “auto-pick” overrides
                        }
                      } else if (e.key === 'Escape') {
                        setShowDoctorDropdown(false);
                      }
                    }}
                    required
                  />

                  {doctorSearching && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      Searching...
                    </div>
                  )}

                  {showDoctorDropdown && doctorResults.length > 0 && (
                    <ul
                      className="dropdown"
                      role="listbox"
                      style={{
                        position: 'absolute',
                        top: 'calc(100% + 6px)',
                        left: 0,
                        right: 0,
                        background: '#fff',
                        border: '1px solid #ccc',
                        borderRadius: 8,
                        boxShadow: '0 6px 16px rgba(0,0,0,0.15)',
                        listStyle: 'none',
                        margin: 0,
                        padding: 0,
                        maxHeight: 260,
                        overflowY: 'auto',
                        zIndex: 1000,
                      }}
                    >
                    {doctorResults.map((d, i) => {
                      const selected = i === doctorActiveIdx;
                      const key = doctorPimsIdOf(d) || String(d.id ?? localDoctorDisplayName(d));
                      return (
                        <li key={key} role="presentation" style={{ padding: 0 }}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            // CRITICAL: select on mousedown, *before* blur/outside-click closes list
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              pickDoctor(d);
                              setShowDoctorDropdown(false);
                              setDoctorResults([]);
                            }}
                            className="dropdown-btn"
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '10px 12px',
                              background: selected ? '#f0f7f4' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              borderRadius: 10,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#f6fbf9';
                              setDoctorActiveIdx(i);
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = selected
                                ? '#f0f7f4'
                                : 'transparent';
                            }}
                          >
                            {localDoctorDisplayName(d)}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
                </div>
              </div>
            </Field>
          </div>

          {/* Dates */}
          <div className="routing-grid-2 routing-row-dates">
            <Field label="Start Date">
              <input
                className="date"
                type="date"
                value={form.startDate}
                onChange={(e) => onChange('startDate', e.target.value)}
                required
              />
            </Field>
            <Field label="End Date">
              <input
                className="date"
                type="date"
                value={form.endDate}
                onChange={(e) => onChange('endDate', e.target.value)}
                required
              />
            </Field>
          </div>

          {/* Appointment & client */}
          <div className="routing-grid-2 routing-row-appt">
            <Field label="Service minutes">
              <div className="routing-service-row">
                <input
                  className="input"
                  type="number"
                  min={1}
                  style={{ width: 88 }}
                  value={form.newAppt.serviceMinutes}
                  onChange={(e) => onNewApptChange('serviceMinutes', Number(e.target.value))}
                />
                <select
                  className="input"
                  aria-label="Appointment type from averages"
                  style={{ minWidth: 0 }}
                  disabled={!form.doctorId.trim() || apptLengthsLoading}
                  value={routingApptStatsTypeKey}
                  onChange={(e) => setRoutingApptStatsTypeKey(e.target.value)}
                >
                  <option value="">Type (optional)</option>
                  {apptLengthsRows.map((row) => (
                    <option key={row.typeName} value={row.typeName}>
                      {row.typeName}
                    </option>
                  ))}
                </select>
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <span className="muted" style={{ fontSize: 13 }}>
                    Pets
                  </span>
                  <input
                    className="input"
                    type="number"
                    min={1}
                    style={{ width: 64 }}
                    value={routingPetCount}
                    onChange={(e) => {
                      const v = Math.floor(Number(e.target.value));
                      setRoutingPetCount(Number.isFinite(v) && v >= 1 ? v : 1);
                    }}
                  />
                </label>
              </div>
              {!form.doctorId.trim() ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Select a doctor to load appointment type averages (last 30 days).
                </div>
              ) : apptLengthsLoading && apptLengthsRows.length === 0 ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  Loading appointment types…
                </div>
              ) : apptLengthsRows.length === 0 && !apptLengthsError ? (
                <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                  No appointment types in the last 30 days for this doctor.
                </div>
              ) : apptLengthsError ? (
                <div style={{ color: '#b91c1c', fontSize: 12, marginTop: 6 }}>{apptLengthsError}</div>
              ) : null}
            </Field>

            <Field label="Search Client (last name)">
              <div ref={clientBoxRef} style={{ position: 'relative' }}>
                <input
                  className="input"
                  value={clientQuery}
                  onChange={(e) => {
                    setClientQuery(e.target.value);
                    setClientActiveIdx(-1);
                    setSelectedClientAlerts(null);
                  }}
                  placeholder="Type last name..."
                  onFocus={() => clientResults.length && setShowClientDropdown(true)}
                  onKeyDown={(e) => {
                    if (!clientResults.length) return;

                    if (e.key === 'ArrowDown') {
                      e.preventDefault();
                      setShowClientDropdown(true);
                      setClientActiveIdx((i) => (i < clientResults.length - 1 ? i + 1 : 0));
                    } else if (e.key === 'ArrowUp') {
                      e.preventDefault();
                      setShowClientDropdown(true);
                      setClientActiveIdx((i) => (i <= 0 ? clientResults.length - 1 : i - 1));
                    } else if (e.key === 'Enter') {
                      e.preventDefault();
                      const pick =
                        clientActiveIdx >= 0 ? clientResults[clientActiveIdx] : clientResults[0];
                      if (pick) {
                        pickClient(pick);
                        setShowClientDropdown(false);
                        setClientResults([]);
                      }
                    } else if (e.key === 'Escape') {
                      setShowClientDropdown(false);
                    }
                  }}
                />

                {clientSearching && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Searching...
                  </div>
                )}

                {showClientDropdown && clientResults.length > 0 && (
                  <ul
                    className="dropdown"
                    role="listbox"
                    style={{
                      position: 'absolute',
                      top: '100%',
                      marginTop: 6,
                      left: 0,
                      right: 0,
                      background: '#fff',
                      border: '1px solid #ccc',
                      borderRadius: 8,
                      boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      maxHeight: 260,
                      overflowY: 'auto',
                      zIndex: 1000,
                    }}
                  >
                    {clientResults.map((c, i) => {
                      const selected = i === clientActiveIdx;
                      const key = String(c.id);
                      return (
                        <li key={key} role="presentation" style={{ padding: 0 }}>
                          <button
                            type="button"
                            role="option"
                            aria-selected={selected}
                            // CRITICAL: select on mousedown to beat blur/outside-click
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              pickClient(c);
                              setShowClientDropdown(false);
                              setClientResults([]);
                            }}
                            className="dropdown-btn"
                            style={{
                              width: '100%',
                              textAlign: 'left',
                              padding: '10px 12px',
                              background: selected ? '#f0f7f4' : 'transparent',
                              border: 'none',
                              cursor: 'pointer',
                              borderRadius: 10,
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.backgroundColor = '#f6fbf9';
                              setClientActiveIdx(i);
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.backgroundColor = selected
                                ? '#f0f7f4'
                                : 'transparent';
                            }}
                          >
                            <div style={{ fontWeight: 600 }}>
                              {c.lastName}, {c.firstName}
                            </div>
                            <div className="muted" style={{ fontSize: 12 }}>
                              {formatClientAddress(c) || '—'}
                            </div>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </Field>

            <div className="routing-span-full">
              <Field label="Address (optional)">
                <input
                  className="input"
                  value={form.newAppt.address ?? ''}
                  onChange={(e) => onNewApptChange('address', e.target.value)}
                  placeholder="123 Main St, Portland ME"
                />
                {addressError ? (
                  <div className="danger" style={{ marginTop: 6 }}>
                    {addressError}
                  </div>
                ) : (
                  form.newAppt.lat != null &&
                  form.newAppt.lon != null &&
                  (form.newAppt.address ?? '').trim() && (
                    <div className="muted" style={{ marginTop: 6 }}>
                      ✓ Address verified
                    </div>
                  )
                )}
              </Field>
            </div>
            {!clientSearching && selectedClientAlerts && selectedClientAlerts.trim() && (
              <div
                className="routing-span-full"
                style={{
                  marginTop: 0,
                  padding: '8px 10px',
                  background: '#fff7ed', // soft amber
                  border: '1px solid #fdba74', // amber border
                  color: '#7c2d12', // dark amber text
                  borderRadius: 8,
                  whiteSpace: 'pre-wrap', // keep line breaks from server
                  fontSize: 13,
                  lineHeight: 1.3,
                }}
              >
                <strong style={{ fontWeight: 700 }}>Client alert:</strong> {selectedClientAlerts}
              </div>
            )}
          </div>

          {/* Preferences */}
          <div className="card routing-prefs-card" style={{ padding: 12, background: '#f8fafc' }}>
            <h4 style={{ margin: '4px 0 10px 0' }}>Preferences (optional)</h4>

            {/* Toggles */}
            <div className="routing-prefs-grid-2">
              <Field label="Reserve/Overflow">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label
                    className={`routing-prefs-check${reserveOption === 'reserve-only' ? ' field-red' : ''}`}
                    style={reserveOption === 'reserve-only' ? ROUTING_PREF_CHECKED_LABEL : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={reserveOption === 'reserve-only'}
                      onChange={(e) => {
                        if (e.target.checked) {
                          // Check this one, uncheck the other
                          setReserveOption('reserve-only');
                        } else {
                          // Uncheck this one
                          setReserveOption(null);
                        }
                      }}
                    />
                    <span>Use Reserve Time (no overflow)</span>
                  </label>
                  <label
                    className={`routing-prefs-check${reserveOption === 'reserve-overflow' ? ' field-red' : ''}`}
                    style={reserveOption === 'reserve-overflow' ? ROUTING_PREF_CHECKED_LABEL : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={reserveOption === 'reserve-overflow'}
                      onChange={(e) => {
                        if (e.target.checked) {
                          // Check this one, uncheck the other
                          setReserveOption('reserve-overflow');
                        } else {
                          // Uncheck this one
                          setReserveOption(null);
                        }
                      }}
                    />
                    <span>Use Reserve + Allow Overflow</span>
                  </label>
                </div>
              </Field>

              <Field label="Multi-doctor">
                <label
                  className="routing-prefs-check"
                  style={multiDoctor ? ROUTING_PREF_CHECKED_LABEL : { cursor: 'pointer' }}
                >
                  <input
                    type="checkbox"
                    checked={multiDoctor}
                    onChange={(e) => setMultiDoctor(e.target.checked)}
                  />
                  <span>Try other doctors for best fit</span>
                </label>
              </Field>
            </div>

            {/* Preferred weekday */}
            <Field label="Preferred Day of Week">
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {weekdayLabels.map(({ n, label }) => (
                  <label
                    key={n}
                    style={{
                      display: 'inline-flex',
                      gap: 6,
                      alignItems: 'center',
                      cursor: 'pointer',
                      ...(preferredWeekday.includes(n) ? ROUTING_PREF_CHECKED_LABEL : {}),
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={preferredWeekday.includes(n)}
                      onChange={() => {
                        setPreferredWeekday((cur) => {
                          if (cur.includes(n)) {
                            return cur.filter((day) => day !== n);
                          } else {
                            return [...cur, n].sort((a, b) => a - b);
                          }
                        });
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Select one or more days. Multiple selections are supported.
              </div>
            </Field>

            {/* Preferred time of day */}
            <Field label="Preferred Time of Day">
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                {[
                  { key: 'first', label: 'First part of day' },
                  // { key: 'middle', label: 'Middle of day' },
                  { key: 'end', label: 'End of day' },
                ].map(({ key, label }) => (
                  <label
                    key={key}
                    style={{
                      display: 'inline-flex',
                      gap: 6,
                      alignItems: 'center',
                      cursor: 'pointer',
                      ...(preferredTimeOfDay === (key as 'first' | 'middle' | 'end')
                        ? ROUTING_PREF_CHECKED_LABEL
                        : {}),
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={preferredTimeOfDay === (key as 'first' | 'middle' | 'end')}
                      onChange={() =>
                        setPreferredTimeOfDay((cur) => (cur === key ? null : (key as any)))
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
                <label
                  style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginLeft: 8 }}
                >
                  <input
                    type="checkbox"
                    checked={preferredTimeOfDay === null}
                    onChange={() => setPreferredTimeOfDay(null)}
                  />
                  <span>None</span>
                </label>
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                Only one time window can be selected. Click again to unselect.
              </div>
            </Field>

            <div style={{ marginTop: 10, maxWidth: 560 }}>
              <label
                style={{
                  display: 'inline-flex',
                  gap: 8,
                  alignItems: 'center',
                  cursor: 'pointer',
                  ...(preferEarliestFeasibleStart ? ROUTING_PREF_CHECKED_LABEL : {}),
                }}
              >
                <input
                  type="checkbox"
                  checked={preferEarliestFeasibleStart}
                  onChange={(e) => setPreferEarliestFeasibleStart(e.target.checked)}
                />
                <span style={{ fontWeight: 600 }}>Force Earliest Time</span>
              </label>
              {preferEarliestFeasibleStart && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: 8,
                    backgroundColor: '#fefce8',
                    border: '1px solid #fde68a',
                  }}
                >
                  <div className="muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
                    Turn on when the appointment must be early (outliers, long drives, front-loading the
                    day).
                  </div>
                  <div className="muted" style={{ fontSize: 13, lineHeight: 1.5, marginTop: 8 }}>
                    <strong>Only applies on empty days.</strong> You’ll still see optimized times—this adds an
                    early option (shown in yellow).
                  </div>
                </div>
              )}
            </div>

            {/* Edge preference (kept hidden for now) */}
            {/* ... */}
          </div>

          {error && <div className="danger">{error}</div>}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? 'Calculating…' : 'Get Best Route'}
            </button>
          </div>
        </form>
      </div>

      {/* ------- Results ------- */}
      <div className="card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: result ? 6 : 0,
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>Results</h3>
          {result && scoutPolicyZoneAware(result.scoutEmptyDayPolicy) ? (
            <Fragment>
              <span
                style={SCOUT_ZONE_AWARE_BADGE_STYLE}
                title="Scout empty-day policy is zone_aware. Liaison copy and day badges appear on each result and per gap."
              >
                Zone-aware
              </span>
              {(() => {
                const b = routingZoneAwareResultsBanner;
                if (!b) return null;
                const poly = b.polyLine;
                const zc = b.zoneClassRaw;
                const combined =
                  poly && zc
                    ? `${poly}: ${scoutZoneClassBannerTitleCase(zc)}`
                    : poly
                      ? poly
                      : zc
                        ? scoutZoneClassBannerTitleCase(zc)
                        : null;
                if (!combined) return null;
                const title =
                  poly && zc
                    ? `Geocoded routing zone (${poly}). Depot→candidate drive class: ${scoutZoneClassBannerTitleCase(zc)} (≤15 min local, ≥25 min anchor, between corridor).`
                    : poly
                      ? 'Geocoded routing zone for this search (effective zone when present, otherwise client zone).'
                      : 'From depot→candidate drive: ≤15 min = local, ≥25 min = anchor, between = corridor.';
                const chipStyle = poly ? SCOUT_RESULTS_ZONE_NAME_CHIP : SCOUT_BADGE_CHIP;
                return (
                  <span style={chipStyle} title={title}>
                    {combined}
                  </span>
                );
              })()}
            </Fragment>
          ) : null}
        </div>

        {result ? (
          <div style={{ fontSize: 12, fontWeight: 'bold', marginBottom: 8 }}>Lower score is better</div>
        ) : null}

        {feedbackToast && (
          <div
            style={{
              marginBottom: 12,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #bbf7d0',
              background: '#ecfdf5',
              color: '#047857',
              fontSize: 14,
            }}
          >
            {feedbackToast}
          </div>
        )}

        {feedbackError && (
          <div className="danger" style={{ marginBottom: 12 }}>
            {feedbackError}
          </div>
        )}

        {!result && <p className="muted">Run a search to see winner and alternates here.</p>}

        {result && displayOptions.length === 0 && <p>no results found</p>}

        {result && displayOptions.length > 0 && (
          <Fragment>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
              <button
                type="button"
                className="btn secondary"
                onClick={() => submitFeedbackForNone()}
                disabled={
                  hasFinalSelection ||
                  feedbackSubmittingKey === NONE_SELECTION_KEY ||
                  feedbackSuccessKey === NONE_SELECTION_KEY
                }
              >
                {feedbackSubmittingKey === NONE_SELECTION_KEY ? 'Saving…' : 'None chosen'}
              </button>
            </div>
            <div className="routing-results-options">
              {displayOptions.map((opt, idx) => {
                const headerColor = colorForDoctor(opt.doctorPimsId);
                const optionKey = routingOptionKey(opt);
                const scheduleBooked = Boolean(scheduleBookedKeys[optionKey]);
                const whitespaceAfterBookingSec =
                  (opt as any).whitespaceAfterBookingSeconds ??
                  (function () {
                    return remainingWhitespaceSeconds(
                      {
                        workStartLocal: opt.workStartLocal,
                        effectiveEndLocal: opt.effectiveEndLocal,
                        bookedServiceSeconds: opt.bookedServiceSeconds,
                        projectedDriveSeconds:
                          (Number.isFinite(opt.projectedDriveSeconds) &&
                            Math.floor(opt.projectedDriveSeconds)) ||
                          (Number.isFinite(opt.currentDriveSeconds) &&
                          Number.isFinite(opt.addedDriveSeconds)
                            ? Math.floor(
                                (opt.currentDriveSeconds as number) +
                                  (opt.addedDriveSeconds as number)
                              )
                            : undefined),
                        currentDriveSeconds: opt.currentDriveSeconds,
                      },
                      form.newAppt.serviceMinutes
                    );
                  })();

                const emptyBadge = isEmptyDay(opt);
                const shiftOverrunSec =
                  typeof opt.overrunSeconds === 'number' ? opt.overrunSeconds : 0;
                const overtimeBadge = finite(shiftOverrunSec) && shiftOverrunSec >= 60;
                const isEarlierFeasibleEmptyDay = opt.emptyDayStartVariant === 'earlier_feasible';

                const rootScoutAware = scoutPolicyZoneAware(result?.scoutEmptyDayPolicy);
                const candScoutAware = scoutPolicyZoneAware(opt.scoutEmptyDayPolicy);
                const scoutGaps = scoutGapsFromCandidate(opt as unknown as Record<string, unknown>);
                const gapPolicyAware = scoutGaps.some((g) => scoutPolicyZoneAware(g.scoutEmptyDayPolicy));
                const showScoutUi = rootScoutAware || candScoutAware || gapPolicyAware;
                const candidateScoutRow: ScoutRoutingGapRow = {
                  scoutLiaisonPrimaryLabel: opt.scoutLiaisonPrimaryLabel,
                  scoutLiaisonLabels: opt.scoutLiaisonLabels,
                  scoutLiaisonLabelIds: opt.scoutLiaisonLabelIds,
                };
                const candidateScoutCopy =
                  !!(candidateScoutRow.scoutLiaisonPrimaryLabel?.trim() ||
                    (candidateScoutRow.scoutLiaisonLabels ?? []).some(Boolean) ||
                    (candidateScoutRow.scoutLiaisonLabelIds ?? []).some(Boolean));
                const metricsRow = scoutDayMetricsForCandidate(opt);
                const zoneAwareDeltaLine = showScoutUi ? scoutZoneAwareDeltaUi(opt) : null;

                return (
                  <div
                    key={`${opt.doctorPimsId}-${opt.date}-${opt.insertionIndex}-${idx}`}
                    className="card"
                    style={{
                      position: 'relative',
                      paddingTop: 48,
                      ...(isEarlierFeasibleEmptyDay
                        ? {
                            backgroundColor: '#fefce8',
                            border: '1px solid #fde68a',
                            boxSizing: 'border-box',
                          }
                        : {}),
                    }}
                  >
                    <div
                      style={{
                        position: 'absolute',
                        top: 10,
                        left: 10,
                        right: 10,
                        height: 28,
                        borderRadius: 10,
                        padding: '0 12px',
                        background: `linear-gradient(135deg, ${headerColor}, ${headerColor}cc)`,
                        color: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        fontWeight: 700,
                        letterSpacing: 0.2,
                        gap: 10,
                      }}
                    >
                      <span
                        style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                      >
                        {opt.doctorName}
                      </span>
                      {typeof opt.score === 'number' && (
                        <span style={{ fontWeight: 600, opacity: 0.9, whiteSpace: 'nowrap' }}>
                          (Score: {Number.isInteger(opt.score) ? String(opt.score) : opt.score.toFixed(2)})
                        </span>
                      )}
                      <span style={{ marginLeft: 'auto' }}>
                        <DoctorIcon />
                      </span>
                    </div>

                    {emptyBadge && (
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: -20,
                          transform: 'rotate(35deg)',
                          background: '#16a34a',
                          color: 'white',
                          padding: '6px 18px',
                          fontWeight: 800,
                          letterSpacing: 1,
                          boxShadow: '0 6px 14px rgba(0,0,0,0.2)',
                          borderRadius: 6,
                          pointerEvents: 'none',
                        }}
                      >
                        EMPTY
                      </div>
                    )}

                    {overtimeBadge && (
                      <div
                        style={{
                          position: 'absolute',
                          top: emptyBadge ? 40 : 8,
                          right: -20,
                          transform: 'rotate(35deg)',
                          background: '#dc2626',
                          color: 'white',
                          padding: '6px 18px',
                          fontWeight: 800,
                          letterSpacing: 1,
                          boxShadow: '0 6px 14px rgba(0,0,0,0.2)',
                          borderRadius: 6,
                          pointerEvents: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {`OVERFLOW +${Math.round((shiftOverrunSec ?? 0) / 60)}m`}
                      </div>
                    )}

                    <h3 style={{ margin: '6px 0 8px 0' }}>
                      {DateTime.fromISO(opt.date).toFormat('cccc LL-dd-yyyy')} @{' '}
                      {isoToTime(opt.suggestedStartIso)}
                    </h3>

                    {scheduleBooked && (
                      <div
                        style={{
                          marginBottom: 12,
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid #86efac',
                          background: '#f0fdf4',
                          color: '#166534',
                          fontSize: 14,
                          fontWeight: 700,
                        }}
                      >
                        Appointment booked
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                      <SlotChip slot={opt.slot ?? null} />
                      <EdgeChip first={opt.isFirstEdge} last={opt.isLastEdge} />
                    </div>

                    {(opt.scoringComponents?.downstreamWindowEdge ?? 0) > 0 && (
                      <div
                        style={{
                          marginBottom: 8,
                          padding: '8px 12px',
                          borderRadius: 8,
                          background: '#fef3c7',
                          border: '1px solid #f59e0b',
                          color: '#92400e',
                          fontSize: 13,
                          fontWeight: 600,
                        }}
                      >
                        ⚠ At least one downstream appointment is pushed within 15 minutes of its window end.
                      </div>
                    )}

                    {showScoutUi && (
                      <div style={{ marginBottom: 10 }}>
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            gap: 6,
                            alignItems: 'center',
                            marginBottom: 8,
                          }}
                        >
                          <ScoutDayStatBadges row={metricsRow} embedded />
                          <ScoutZoneAwareDiagnosticsRow
                            row={opt}
                            hideZoneClass
                            variant="inline"
                          />
                        </div>
                        {scoutPreservedAnchorZonesStillNote(result?.scoutPreservedEmptyDayWeeks, opt)}
                        {(rootScoutAware || candScoutAware) &&
                        candidateScoutCopy &&
                        !scoutRoutingHideLiaisonCopyForPreserve(opt) ? (
                          <ScoutLiaisonCopyBlock row={candidateScoutRow} />
                        ) : null}
                        {scoutGaps.map((gap, gi) => {
                          const gapAware =
                            rootScoutAware || scoutPolicyZoneAware(gap.scoutEmptyDayPolicy);
                          if (!gapAware) return null;
                          const gapCopy =
                            !!(gap.scoutLiaisonPrimaryLabel?.trim() ||
                              (gap.scoutLiaisonLabels ?? []).some(Boolean) ||
                              (gap.scoutLiaisonLabelIds ?? []).some(Boolean));
                          const gapStats =
                            gap.dayIsEmpty === true ||
                            gap.dayIsStrategicLight === true ||
                            typeof gap.dayClientVisitCount === 'number' ||
                            typeof gap.dayHouseholdCount === 'number' ||
                            typeof gap.dayPatientCount === 'number';
                          const gapDiag = scoutZoneAwareDiagHasContent(gap);
                          if (!gapCopy && !gapStats && !gapDiag) return null;
                          const gapDeltaLine = scoutZoneAwareDeltaUi(gap);
                          return (
                            <div key={`scout-gap-${gi}`} style={{ marginTop: 8 }}>
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 6,
                                  alignItems: 'center',
                                  marginBottom: 8,
                                }}
                              >
                                <ScoutDayStatBadges row={gap} embedded />
                                <ScoutZoneAwareDiagnosticsRow
                                  row={gap}
                                  hideZoneClass={Boolean(
                                    routingZoneAwareResultsBanner?.zoneClassRaw
                                  )}
                                  variant="inline"
                                />
                              </div>
                              {scoutPreservedAnchorZonesStillNote(result?.scoutPreservedEmptyDayWeeks, {
                                scoutPreservedEmptyDayPenalty: gap.scoutPreservedEmptyDayPenalty,
                                doctorPimsId: opt.doctorPimsId,
                                date: opt.date,
                              })}
                              {gapDeltaLine ? (
                                <div
                                  className="muted"
                                  style={{ fontSize: 11, marginTop: 4, marginBottom: 4 }}
                                  title={gapDeltaLine.title}
                                >
                                  <strong>Zone-aware Δ:</strong> {gapDeltaLine.value}
                                </div>
                              ) : null}
                              {gapCopy && !scoutRoutingHideLiaisonCopyForPreserve(gap) ? (
                                <ScoutLiaisonCopyBlock row={gap} />
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <KeyValue
                        k="Visit #"
                        v={String((opt as any).positionInDay ?? (opt as any).displayInsertionIndex ?? opt.insertionIndex + 1)}
                      />
                      <KeyValue
                        k="Visit Window"
                        v={
                          <strong>
                            {opt.arrivalWindow?.windowStartIso && opt.arrivalWindow?.windowEndIso
                              ? `${isoToTime(opt.arrivalWindow.windowStartIso)} – ${isoToTime(opt.arrivalWindow.windowEndIso)}`
                              : isoToTime(opt.suggestedStartIso)}
                          </strong>
                        }
                      />
                      <KeyValue
                        k="Added Drive"
                        v={opt.addedDrivePretty ?? secsToPretty(opt.addedDriveSeconds)}
                        color={colorForAddedDrive(opt.addedDriveSeconds)}
                      />
                      <KeyValue
                        k="Projected Drive"
                        v={opt.projectedDrivePretty ?? secsToPretty(opt.projectedDriveSeconds)}
                        color={colorForProjectedDrive(opt.projectedDriveSeconds)}
                      />
                      <KeyValue
                        k="Current Drive"
                        v={opt.currentDrivePretty ?? secsToPretty(opt.currentDriveSeconds)}
                        color="inherit"
                      />
                      <KeyValue
                        k="Whitespace After Booking"
                        v={secsToPretty(whitespaceAfterBookingSec)}
                        color="inherit"
                      />
                    </div>

                    {zoneAwareDeltaLine ? (
                      <div
                        className="muted"
                        style={{ fontSize: 12, marginTop: 4, marginBottom: 4 }}
                        title={zoneAwareDeltaLine.title}
                      >
                        <strong>Zone-aware Δ:</strong> {zoneAwareDeltaLine.value}
                      </div>
                    ) : null}

                    <div
                      style={{
                        marginTop: 16,
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 8,
                        justifyContent: 'flex-end',
                      }}
                    >
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => openMyDay(opt)}
                      >
                        My Day
                      </button>
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() => openMyWeek(opt)}
                        disabled={!form.newAppt.clientId?.trim() || scheduleBookTypeId == null}
                        title={
                          !form.newAppt.clientId?.trim()
                            ? 'Select a client first'
                            : scheduleBookTypeId == null
                              ? 'Loading appointment types…'
                              : hasActiveRescheduleIntent
                                ? 'Open the practice calendar to reschedule into this slot'
                                : 'Open the practice calendar to book this slot'
                        }
                      >
                        {hasActiveRescheduleIntent ? 'Reschedule appointment' : 'Book Appointment'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Fragment>
        )}

      </div>
      {schedulePreview && (
        <PreviewMyDayModal
          key={`routing-preview-${schedulePreview.opt.date}-${schedulePreview.opt.insertionIndex}-${schedulePreview.opt.suggestedStartIso}`}
          option={schedulePreview.opt}
          scheduleScope={schedulePreview.scope}
          onScheduleScopeChange={(scope) =>
            setSchedulePreview((p) => (p ? { ...p, scope } : null))
          }
          onClose={closeSchedulePreview}
          serviceMinutes={form.newAppt.serviceMinutes}
          newApptMeta={{
            clientId: form.newAppt.clientId,
            address: form.newAppt.address,
            lat: form.newAppt.lat,
            lon: form.newAppt.lon,
          }}
        />
      )}

    </div>
  );
}
