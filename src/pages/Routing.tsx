// src/pages/Routing.tsx
import {
  type JSX,
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
import { fetchDoctorDay, fetchDoctorMonth, type MiniZone } from '../api/appointments';
import { fetchAllAppointmentTypes, fetchEmployee, type AppointmentType } from '../api/appointmentSettings';
import {
  appointmentTypeAllowsClient,
  appointmentTypeIncludedInRouting,
  normalizeAppointmentTypeFromApi,
  preferCalmingPremedVisitTypeId,
  sortAppointmentTypesForPicker,
} from '../utils/appointmentTypeSettings';
import { fetchClientByIdStaff } from '../api/clientsStaff';
import { http } from '../api/http';
import {
  monthsCoveringRange,
  normalizeAppointmentType,
  summarizeAvgMinutesByAppointmentType,
  type AvgMinutesByTypeRow,
} from '../analytics/appointmentTypeTimeStats';
import { Field } from '../components/Field';
import { AddressAutocomplete, type AddressFields } from '../components/AddressAutocomplete';
import { ForwardBookingWorkspaceContextPanel } from '../components/ForwardBookingWorkspaceContextPanel';
import { AppointmentRequestRoutingSummary } from '../components/AppointmentRequestRoutingSummary';
import RoutingClientPatientsList from '../components/routing/RoutingClientPatientsList';
import {
  defaultAppointmentRequestSelectedPatientIds,
  defaultForwardBookingSelectedPatientIds,
  defaultRescheduleSelectedPatientIds,
  deriveForwardBookingScopeFromChipSelection,
  deriveRescheduleScopeFromChipSelection,
  previewPatientsFromChipSelection,
  rescheduleTargetsForChipSelection,
  type RoutingPatientChipRow,
} from '../utils/routingPatientSelection';
import { KeyValue } from '../components/KeyValue';
import { DateTime } from 'luxon';
import { validateAddress } from '../api/geo';
import {
  addressFieldsDisplayText,
  addressFieldsFromClient,
  addressFieldsFromFreeText,
  addressFieldsFromRoutingCoords,
  EMPTY_ADDRESS_FIELDS,
  geocodeRoutingAddressText,
  parseCoordinate,
} from '../utils/verifiedAddress';
import { fetchPrimaryProviders } from '../api/employee';
import { lookupClientZoneForAddress, type ClientZoneLookupResult } from '../api/zoneLookup';
import {
  fetchVeterinariansForDoctorSelect,
  findDoctorsNotAssignedToClientZone,
  formatDoctorSelectSeeingClientsBadge,
  formatDoctorZoneConfirmMessage,
  formatDoctorZoneInlineWarning,
  getDoctorClientZoneStatus,
  distinctDaysOfWeekInDateRange,
} from '../utils/veterinarianZoneLookup';
import {
  normalizeRoutingV2SlotSearchResponse,
  type RoutingSlotSearchOptionalFlags,
  type RescheduleOriginalBooking,
  type RoutingV2SlotSearchResult,
} from '../api/routing';
import {
  rescheduleOriginalScoreSummary,
  rescheduleScoreHeaderSuffix,
  fetchAndCacheRescheduleSourcePlacementSnapshot,
  resolveRescheduleOriginalVisitForCompare,
} from '../utils/routingRescheduleScoreCompare';
import {
  routingCardWindowWarningMessage,
  routingCardWindowWarningReasons,
} from '../utils/routingCardWindowWarning';
import { useNavigate, useSearchParams } from 'react-router';
import {
  clearRoutingCalendarPreview,
  readRoutingCalendarPreview,
  ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT,
  ROUTING_FOCUS_RESCHEDULE_SOURCE_EVENT,
  ROUTING_PREVIEW_ETA_WINDOW_WARNINGS_EVENT,
  routingCalendarPreviewOptionKey,
  type RoutingPreviewEtaWindowWarningsDetail,
  writeRoutingCalendarPreview,
  type RoutingCalendarPreviewPayloadV1,
} from '../utils/routingCalendarPreviewStorage';
import { hasActiveRoutingCalendarPreview } from '../utils/routingCalendarPreviewGuard';
import { coerceOverrunSeconds, startPastWorkdayEndSeconds } from '../utils/depotReturnOverrun';
import { arrivalWindowIsZeroWidth } from '../utils/windowWarning';
import {
  buildRoutingRescheduleContextForSlotSearch,
  clearRoutingRescheduleIntent,
  dismissRoutingRescheduleWorkspace,
  markRescheduleIntentAppliedToRoutingForm,
  readRoutingRescheduleIntent,
  rescheduleIntentIsActive,
  rescheduleRequiresScopeChoice,
  patchRescheduleIntentDoctorPims,
  resolveRescheduleIntentDoctorPimsId,
  rescheduleScopeTargets,
  rescheduleIntentUsesAlternateAddress,
  rescheduleIntentDefaultDateRange,
  routingAddressesMatch,
  routingClientPickWouldReplaceAlternate,
  ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT,
  ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT,
  writeRoutingRescheduleScope,
  type RoutingRescheduleScope,
} from '../utils/routingRescheduleIntent';
import {
  dismissRoutingForwardBookingWorkspace,
  forwardBookingRequiresScopeChoice,
  forwardBookingScopeTargets,
  markForwardBookingIntentAppliedToRoutingForm,
  readRoutingForwardBookingIntent,
  ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT,
  forwardBookingWorkspaceIsActive,
  writeRoutingForwardBookingScope,
  type RoutingForwardBookingScope,
} from '../utils/routingForwardBookingIntent';
import {
  formatForwardBookingIntervalLabel,
  forwardBookingRoutingSearchDateRange,
} from '../utils/forwardBookingFromAppointment';
import { careOutreachRoutingSearchDateRange } from '../utils/careOutreachForwardBooking';
import { returnFromAppointmentRequestWorkspace } from '../utils/routingAppointmentRequestIntent';
import {
  appointmentRequestRoutingSearchDateRange,
} from '../utils/appointmentRequestDisplay';
import {
  appointmentRequestWorkspaceIsActive,
  dismissRoutingAppointmentRequestWorkspace,
  markAppointmentRequestIntentAppliedToRoutingForm,
  readRoutingAppointmentRequestIntent,
  ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT,
  ROUTING_DISMISS_APPOINTMENT_REQUEST_EVENT,
} from '../utils/routingAppointmentRequestIntent';
import {
  appointmentTypeForRoutingStatsKey,
  defaultRoutingAppointmentTypeSelection,
  resolveRoutingChosenAppointmentTypeId,
} from '../utils/routingCalculateTimeType';
import {
  applyRoutingServiceMinuteBuffers,
  fetchAveragedApptLengthStatsForDoctors,
  resolveServiceMinutesAfterDoctorConfirm,
  shouldPreserveManualRoutingMinutes,
} from '../utils/routingServiceMinutes';
import {
  appointmentRequestUsesPerPetRouting,
  appointmentRequestRoutingPatientChips,
  buildRoutingVisitPetsFromAppointmentRequestIntent,
} from '../utils/routingAppointmentRequestVisitPets';
import { fetchRoutingServiceMinutes } from '../api/publicAppointments';
import {
  clearRoutingUiSnapshot,
  createDefaultRoutingForm,
  readRoutingUiBootstrap,
  ROUTING_DISMISS_RESCHEDULE_EVENT,
  ROUTING_DISMISS_FORWARD_BOOKING_EVENT,
  ROUTING_REQUEST_ID_SESSION_KEY,
  ROUTING_WORKSPACE_SCHEDULER_BOOKED_EVENT,
  writeAuthDoctorCache,
  writeRoutingUiSnapshot,
} from '../utils/routingUiSnapshot';
import {
  adjustRoutingSlotSearchDates,
  diffRoutingDaysInclusive,
  routingCalendarDatePart,
} from '../utils/routingSlotSearchDates';
import {
  resolveRoutingCandidateIndex,
  routingTopCandidatesFromResult,
} from '../utils/routingCandidates';
import { submitRoutingFeedback } from '../api/routingFeedback';
import { DEFAULT_PRACTICE_TIMEZONE } from '../utils/practiceTimezone';
import HouseholdScheduledVisitsWarningModal from '../components/HouseholdScheduledVisitsWarningModal';
import {
  buildBookingAppointmentTypeCatalog,
  dispatchRoutingFocusHouseholdVisit,
  findHouseholdScheduledVisitConflicts,
  resolveRoutingHouseholdVisitClientId,
  shouldWarnHouseholdVisitsOnRoutingSearch,
  unpinRoutingHouseholdVisitHighlight,
  type HouseholdScheduledVisitConflict,
} from '../utils/bookingHouseholdVisitWarning';
import { buildSchedulerFocusAppointmentUrl } from '../utils/schedulerFocusAppointment';
import {
  clearRoutingHouseholdVisitAck,
  isRoutingHouseholdVisitAcked,
  readRoutingHouseholdVisitAckClientId,
  writeRoutingHouseholdVisitAck,
} from '../utils/routingHouseholdVisitAck';
import {
  clearSchedulerHandoffPreferRoutingDoctor,
  readSchedulerCalendarHandoff,
  SCHEDULER_HANDOFF_ROUTING_DOCTOR_EVENT,
} from '../utils/schedulerCalendarHandoff';
import './Routing.css';

/** Yellow wrap when an optional routing preference is on—makes checked state obvious at a glance. */
const ROUTING_PREF_CHECKED_LABEL: CSSProperties = {
  backgroundColor: '#fef9c3',
  border: '1px solid #ca8a04',
  borderRadius: 8,
  padding: '6px 10px',
  boxSizing: 'border-box',
};

/** Preferred day chips (ISO weekday 1–7); labels are one-line abbreviations. */
const ROUTING_WEEKDAY_CHIPS: Array<{ n: number; label: string; title: string }> = [
  { n: 1, label: 'M', title: 'Monday' },
  { n: 2, label: 'T', title: 'Tuesday' },
  { n: 3, label: 'W', title: 'Wednesday' },
  { n: 4, label: 'Th', title: 'Thursday' },
  { n: 5, label: 'F', title: 'Friday' },
  { n: 6, label: 'Sa', title: 'Saturday' },
  { n: 7, label: 'Su', title: 'Sunday' },
];

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
    /** Sent to POST /routing/v2 when Calculate Time type is selected; omit for default ±60 window. */
    appointmentTypeId?: number;
  };
};

/**
 * Routing “Service minutes” from the same Appt lengths stats as the popover:
 * 1 pet → regular average; 2+ pets → multipet average × pet count when multipet data exists,
 * otherwise scales the regular average by pet count.
 */
/** When Calculate Time has no stats row and no type default duration. */
const ROUTING_FALLBACK_SERVICE_MINUTES = 45;
/** Minimum doctor-day visits of a type in the last 30 days before using historical averages. */
const ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS = 5;

/** Picker `<option value>` uses appointment type `name`, not `prettyName`. */
function routingPickerTypeNameForAppointmentType(
  types: readonly AppointmentType[],
  typeId: number | undefined | null,
  fallbackLabel?: string | null
): string | null {
  if (typeId != null && Number.isFinite(Number(typeId))) {
    const row = types.find((t) => Number(t.id) === Number(typeId));
    const name = String(row?.name ?? '').trim();
    if (name) return name;
  }
  const fb = (fallbackLabel ?? '').trim();
  if (!fb || types.length === 0) return null;
  const norm = normalizeAppointmentType(fb);
  const lower = fb.toLowerCase();
  const byLabel = types.find((t) => {
    const name = String(t.name ?? '').trim();
    const pretty = String(t.prettyName ?? '').trim();
    return (
      normalizeAppointmentType(name) === norm ||
      normalizeAppointmentType(pretty) === norm ||
      name.toLowerCase() === lower ||
      pretty.toLowerCase() === lower
    );
  });
  return byLabel ? String(byLabel.name ?? '').trim() || null : null;
}

function routingApptTypeStatsMeetMinInstances(
  row: AvgMinutesByTypeRow,
  minInstances = ROUTING_MIN_APPT_TYPE_INSTANCES_FOR_STATS
): boolean {
  return row.count + row.multipetCount >= minInstances;
}

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

function resolveRoutingApptStatsRow(
  typeKey: string,
  apptLengthsRows: AvgMinutesByTypeRow[],
  matchedType?: AppointmentType
): AvgMinutesByTypeRow | undefined {
  const key = typeKey.trim();
  if (!key) return undefined;
  const statsByNorm = new Map<string, AvgMinutesByTypeRow>();
  for (const row of apptLengthsRows) {
    const norm = normalizeAppointmentType(row.typeName);
    if (norm) statsByNorm.set(norm, row);
  }
  const norm = normalizeAppointmentType(key);
  const prettyNorm = matchedType?.prettyName
    ? normalizeAppointmentType(String(matchedType.prettyName))
    : '';
  return (
    statsByNorm.get(norm) ??
    (prettyNorm ? statsByNorm.get(prettyNorm) : undefined) ??
    apptLengthsRows.find((row) => {
      const rowNorm = normalizeAppointmentType(row.typeName);
      return rowNorm === norm || (prettyNorm !== '' && rowNorm === prettyNorm);
    })
  );
}

function defaultDurationMinutesForRoutingTypeSelection(
  matchedType: AppointmentType | undefined,
  pets: number
): number | null {
  const dur = matchedType?.defaultDuration != null ? Number(matchedType.defaultDuration) : NaN;
  if (!Number.isFinite(dur) || dur <= 0) return null;
  const petCount = Math.max(1, Math.floor(pets) || 1);
  return Math.round(dur * petCount);
}

/** 30-day doctor stats (≥5 visits), then type default duration, then {@link ROUTING_FALLBACK_SERVICE_MINUTES}. */
function estimateRoutingServiceMinutesForSelection(
  typeKey: string,
  pets: number,
  apptLengthsRows: AvgMinutesByTypeRow[],
  resolveType: (key: string) => AppointmentType | undefined
): number | null {
  const key = typeKey.trim();
  if (!key) return null;
  const matched = resolveType(key);
  const row = resolveRoutingApptStatsRow(key, apptLengthsRows, matched);
  let mins: number | null = null;
  if (row && routingApptTypeStatsMeetMinInstances(row)) {
    mins = estimatedServiceMinutesFromStatsRow(row, pets);
  }
  if (mins == null || mins < 1) {
    mins = defaultDurationMinutesForRoutingTypeSelection(matched, pets);
  }
  if (mins == null || mins < 1) {
    mins = ROUTING_FALLBACK_SERVICE_MINUTES;
  }
  return mins;
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
  workEndLocal?: string; // "HH:mm" or "HH:mm:ss"
  effectiveEndLocal?: string; // "HH:mm" or "HH:mm:ss"
  /** Scheduled depot / workday end ("HH:mm"), same clock as the calendar red line. */
  depotEndLocal?: string;
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
  scoreBreakdown?: {
    downstreamWindowEdge?: number;
  };
  /** @deprecated Prefer scoreBreakdown — kept for older API responses */
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
  displayInsertionIndex?: number;
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
  /** v2 ordered candidates (winner is typically index 0). */
  top?: Winner[];

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
  /** Present when slot search used `rescheduleContext` and feedback snapshot exists. */
  rescheduleOriginalBooking?: RescheduleOriginalBooking;
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

const ROUTING_DEFAULT_ARRIVAL_WINDOW_MINUTES = 60;
const ROUTING_ARRIVAL_WINDOW_TOLERANCE_MINUTES = 2;

/** True when backend window is not symmetric ±60 (standard 2-hour arrival window). */
function routingVisitWindowDiffersFromDefault60(opt: {
  suggestedStartIso?: string;
  arrivalWindow?: { windowStartIso?: string; windowEndIso?: string };
}): boolean {
  const startIso = opt.arrivalWindow?.windowStartIso;
  const endIso = opt.arrivalWindow?.windowEndIso;
  if (!startIso || !endIso) return false;

  // Intentional no-window types (HOLD – In Office / Fixed Time 0±0) — not a "weird" window.
  if (arrivalWindowIsZeroWidth(startIso, endIso)) return false;

  const winStart = DateTime.fromISO(startIso);
  const winEnd = DateTime.fromISO(endIso);
  if (!winStart.isValid || !winEnd.isValid) return false;

  const tol = ROUTING_ARRIVAL_WINDOW_TOLERANCE_MINUTES;
  const def = ROUTING_DEFAULT_ARRIVAL_WINDOW_MINUTES;

  const matchesDefaultSymmetric60 = (beforeMin: number, afterMin: number) =>
    Math.abs(beforeMin - def) <= tol && Math.abs(afterMin - def) <= tol;

  const apptIso = opt.suggestedStartIso;
  if (apptIso) {
    const appt = DateTime.fromISO(apptIso);
    if (appt.isValid) {
      const beforeMin = Math.round(appt.diff(winStart, 'minutes').minutes);
      const afterMin = Math.round(winEnd.diff(appt, 'minutes').minutes);
      if (matchesDefaultSymmetric60(beforeMin, afterMin)) return false;
    }
  }

  /** ±60 is a 2-hour window; routed start may sit early/late while the window stays symmetric. */
  const totalMin = Math.round(winEnd.diff(winStart, 'minutes').minutes);
  if (Math.abs(totalMin - def * 2) <= tol * 2) {
    const mid = DateTime.fromMillis((winStart.toMillis() + winEnd.toMillis()) / 2, {
      zone: winStart.zoneName,
    });
    const halfBefore = Math.round(mid.diff(winStart, 'minutes').minutes);
    const halfAfter = Math.round(winEnd.diff(mid, 'minutes').minutes);
    if (matchesDefaultSymmetric60(halfBefore, halfAfter)) return false;
  }

  if (!apptIso) return false;
  return true;
}

/** Result-card time range: real arrival windows as-is; zero-width → visit start + service minutes. */
function routingResultVisitTimeLabel(
  opt: {
    suggestedStartIso?: string;
    arrivalWindow?: { windowStartIso?: string; windowEndIso?: string };
  },
  serviceMinutes: number
): { label: string; timeText: string; zeroWidthWindow: boolean } {
  const awStart = opt.arrivalWindow?.windowStartIso;
  const awEnd = opt.arrivalWindow?.windowEndIso;
  const zeroWidth = Boolean(awStart && awEnd && arrivalWindowIsZeroWidth(awStart, awEnd));
  if (awStart && awEnd && !zeroWidth) {
    return {
      label: 'Arrival Window',
      timeText: `${isoToTime(awStart)} – ${isoToTime(awEnd)}`,
      zeroWidthWindow: false,
    };
  }
  const startIso = opt.suggestedStartIso?.trim() || awStart || '';
  if (!startIso) {
    return { label: 'Visit time', timeText: '-', zeroWidthWindow: zeroWidth };
  }
  const start = DateTime.fromISO(startIso);
  if (!start.isValid) {
    return { label: 'Visit time', timeText: isoToTime(startIso), zeroWidthWindow: zeroWidth };
  }
  const mins = Math.max(1, Math.floor(Number(serviceMinutes)) || 30);
  const endIso = start.plus({ minutes: mins }).toISO();
  return {
    label: 'Visit time',
    timeText: endIso ? `${isoToTime(startIso)} – ${isoToTime(endIso)}` : isoToTime(startIso),
    zeroWidthWindow: zeroWidth,
  };
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

function staffRecordToRoutingClient(raw: unknown): Client | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const id = o.id;
  if (id == null || String(id).trim() === '') return null;
  const zipRaw = o.zip ?? o.zipcode ?? o.zipCode;
  return {
    id: String(id),
    firstName: String(o.firstName ?? o.first_name ?? '').trim(),
    lastName: String(o.lastName ?? o.last_name ?? '').trim(),
    address1: o.address1 != null ? String(o.address1).trim() : o.address_1 != null ? String(o.address_1).trim() : undefined,
    city: o.city != null ? String(o.city).trim() : undefined,
    state: o.state != null ? String(o.state).trim() : undefined,
    zip: zipRaw != null ? String(zipRaw).trim() : undefined,
    lat: (o.lat ?? o.latitude) as number | string | undefined,
    lon: (o.lon ?? o.longitude) as number | string | undefined,
    alerts:
      o.alerts != null
        ? String(o.alerts)
        : o.clientAlerts != null
          ? String(o.clientAlerts)
          : null,
  };
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

const ROUTING_RESULT_FONT_SCALE = 0.75;
/** Scores at or above this threshold show a nudge to try other dates when possible. */
const ROUTING_HIGH_SCORE_WARNING_THRESHOLD = 225;
const ROUTING_HIGH_SCORE_WARNING_MESSAGE =
  '⚠ Not a strong fit. Try alternate dates if the client is flexible.';

const SCOUT_BADGE_CHIP_DENSE: CSSProperties = {
  ...SCOUT_BADGE_CHIP,
  fontSize: Math.round(11 * ROUTING_RESULT_FONT_SCALE),
  padding: '2px 6px',
};

const SCOUT_PRESERVED_DAY_CHIP_DENSE: CSSProperties = {
  ...SCOUT_PRESERVED_DAY_CHIP,
  fontSize: Math.round(11 * ROUTING_RESULT_FONT_SCALE),
  padding: '2px 6px',
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
  dense,
}: {
  row: ScoutZoneAwareDiagFields;
  /** When true, omit depot→candidate zone class (shown once in Results header for this search). */
  hideZoneClass?: boolean;
  /** `inline`: no outer margin—use inside a parent flex row with day stat badges. */
  variant?: 'block' | 'inline';
  /** Smaller chip + label text (routing result cards). */
  dense?: boolean;
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
  const chipStyle = dense ? SCOUT_BADGE_CHIP_DENSE : SCOUT_BADGE_CHIP;
  const preservedStyle = dense ? SCOUT_PRESERVED_DAY_CHIP_DENSE : SCOUT_PRESERVED_DAY_CHIP;
  const inner = (
    <>
      {zc ? (
        <span
          style={chipStyle}
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
        <span style={chipStyle} title={n9Copy.tooltip}>
          {n9Copy.label}
        </span>
      ) : null}
      {preservedShow ? (
        <span
          style={preservedStyle}
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
          fontSize: dense ? Math.round(11 * ROUTING_RESULT_FONT_SCALE) : 11,
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
        fontSize: dense ? Math.round(11 * ROUTING_RESULT_FONT_SCALE) : 11,
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
  dense,
}: {
  row: ScoutRoutingGapRow;
  /** When true, return chip nodes only (no wrapper) so they sit in a parent flex row. */
  embedded?: boolean;
  /** Smaller chip typography (routing result cards). */
  dense?: boolean;
}) {
  const chipStyle = dense ? SCOUT_BADGE_CHIP_DENSE : SCOUT_BADGE_CHIP;
  const chips: JSX.Element[] = [];
  if (row.dayIsEmpty === true) {
    chips.push(
      <span key="empty" style={chipStyle} title="No households or patients scheduled this day (scout).">
        Empty day
      </span>
    );
  }
  if (row.dayIsStrategicLight === true) {
    chips.push(
      <span
        key="strategic"
        style={chipStyle}
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
      <span key="hhpt" style={chipStyle} title={title}>
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
        fontSize: Math.round(12 * ROUTING_RESULT_FONT_SCALE),
        fontWeight: 600,
      }}
    >
      {text}
    </span>
  );
}

/** Reschedule / Alternatives: badge when the candidate is on the original appointment's calendar day. */
function SameDayChip() {
  return (
    <span
      style={{
        background: '#dbeafe',
        color: '#1d4ed8',
        padding: '2px 8px',
        borderRadius: 999,
        fontSize: Math.round(12 * ROUTING_RESULT_FONT_SCALE),
        fontWeight: 700,
        letterSpacing: 0.3,
      }}
      title="Same calendar day as the original appointment"
    >
      SAME DAY
    </span>
  );
}

function routingOptionIsSameDayAsReschedule(
  optDate: string | undefined,
  intent: { practiceDateKey?: string; originalStartIso?: string } | null | undefined,
  practiceTz: string
): boolean {
  const optKey = String(optDate ?? '').trim().slice(0, 10);
  if (!optKey || !intent) return false;
  let originalKey = intent.practiceDateKey?.trim().slice(0, 10) || '';
  if (!originalKey && intent.originalStartIso?.trim()) {
    const local = DateTime.fromISO(intent.originalStartIso.trim(), { zone: 'utc' }).setZone(
      practiceTz
    );
    if (local.isValid) originalKey = local.toISODate() ?? '';
  }
  return Boolean(originalKey && optKey === originalKey);
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

const SELECTED_DOCTORS_STORAGE_KEY = 'routing:selected-doctors';

type StoredDoctorSelection = {
  doctorIds: string[];
  zoneLabel?: string | null;
  appointmentTypeId?: number | null;
};

function readStoredDoctorSelection(): StoredDoctorSelection | null {
  try {
    const raw = localStorage.getItem(SELECTED_DOCTORS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return {
        doctorIds: parsed.filter((id): id is string => typeof id === 'string'),
      };
    }
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as StoredDoctorSelection).doctorIds)) {
      const stored = parsed as StoredDoctorSelection;
      return {
        doctorIds: stored.doctorIds.filter((id): id is string => typeof id === 'string'),
        zoneLabel: stored.zoneLabel ?? null,
        appointmentTypeId: stored.appointmentTypeId ?? null,
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function storedDoctorSelectionMatchesContext(
  stored: StoredDoctorSelection,
  zoneLabel: string | null,
  appointmentTypeId: number | null,
): boolean {
  if (stored.zoneLabel == null && stored.appointmentTypeId == null) return false;
  const zoneOk = (stored.zoneLabel ?? null) === zoneLabel;
  const typeOk = (stored.appointmentTypeId ?? null) === appointmentTypeId;
  return zoneOk && typeOk;
}

type RoutingDoctorPick = {
  id: string | number;
  name: string;
  email: string;
  pimsId: string;
  seeingClients?: boolean;
  acceptingNewPatients?: boolean;
  transitioningOutOfClientZone?: boolean;
  acceptsAppointmentType?: boolean;
};

/** Pre-check in-zone doctors who accept the selected appointment type (not transitioning out). */
function isDefaultDoctorSelectChecked(provider: RoutingDoctorPick): boolean {
  if (provider.seeingClients !== true || provider.transitioningOutOfClientZone === true) {
    return false;
  }
  return provider.acceptsAppointmentType !== false;
}

function sortDoctorSelectProviders(providers: RoutingDoctorPick[]): RoutingDoctorPick[] {
  return [...providers].sort((a, b) => {
    const aChecked = isDefaultDoctorSelectChecked(a);
    const bChecked = isDefaultDoctorSelectChecked(b);
    if (aChecked !== bChecked) return aChecked ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

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

/** Results stack under Get Best Route when the routing pane is narrower than this share of the viewport. */
const ROUTING_STACK_COLUMNS_MAX_SCREEN_SHARE = 0.35;
const ROUTING_MOBILE_MQ = '(max-width: 900px)';

function routingShouldStackFormAndResults(paneWidthPx: number, screenWidthPx: number): boolean {
  if (screenWidthPx <= 0) {
    return typeof window !== 'undefined' && window.matchMedia(ROUTING_MOBILE_MQ).matches;
  }
  if (typeof window !== 'undefined' && window.matchMedia(ROUTING_MOBILE_MQ).matches) {
    return true;
  }
  return paneWidthPx / screenWidthPx < ROUTING_STACK_COLUMNS_MAX_SCREEN_SHARE;
}

type RoutingProps = {
  /** When true, "Book appointment" updates the embedded calendar via event instead of navigating to `/schedule/scheduler`. */
  calendarWorkspaceMode?: boolean;
};

type RoutingPrefillFlashField = 'doctor' | 'client' | 'address' | 'minutes' | 'apptType' | 'pets';

export default function Routing({ calendarWorkspaceMode = false }: RoutingProps) {
  const { token: authToken, userId: authUserId, doctorId: authDoctorInternalId } = useAuth();
  const bootstrap = useMemo(() => readRoutingUiBootstrap(), []);

  const routingPageRootRef = useRef<HTMLDivElement>(null);
  const [stackFormAndResults, setStackFormAndResults] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(ROUTING_MOBILE_MQ).matches : false
  );
  const [calendarPreviewTick, setCalendarPreviewTick] = useState(0);
  const [sourceScoreTick, setSourceScoreTick] = useState(0);

  useEffect(() => {
    const mq = window.matchMedia(ROUTING_MOBILE_MQ);
    const onMq = () => {
      setStackFormAndResults((prev) => {
        if (mq.matches) return true;
        const el = routingPageRootRef.current;
        if (!el) return prev;
        const paneW = el.getBoundingClientRect().width;
        const screenW = window.innerWidth || document.documentElement.clientWidth;
        return routingShouldStackFormAndResults(paneW, screenW);
      });
    };
    onMq();
    mq.addEventListener('change', onMq);
    return () => mq.removeEventListener('change', onMq);
  }, []);

  useEffect(() => {
    const el = routingPageRootRef.current;
    if (!el) return;
    const update = () => {
      if (window.matchMedia(ROUTING_MOBILE_MQ).matches) {
        setStackFormAndResults(true);
        return;
      }
      const paneW = el.getBoundingClientRect().width;
      const screenW = window.innerWidth || document.documentElement.clientWidth;
      setStackFormAndResults(routingShouldStackFormAndResults(paneW, screenW));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    update();
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

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
    () =>
      bootstrap.asapAllDoctorSearch && bootstrap.reserveOption === null
        ? 'reserve-only'
        : bootstrap.reserveOption
  );
  const [asapAllDoctorSearch, setAsapAllDoctorSearch] = useState(() => bootstrap.asapAllDoctorSearch);
  const [resultsSortedByDateTime, setResultsSortedByDateTime] = useState(false);
  const [asapResultsSortMode, setAsapResultsSortMode] = useState<'datetime' | 'score'>('datetime');
  /** Last committed client — prefs reset when routing for a different household. */
  const lastRoutingClientIdRef = useRef<string | null>(
    bootstrap.form.newAppt.clientId?.trim() || null
  );
  /** Client home address when a household is linked — used to detect alternate visit stops. */
  const linkedClientHomeAddressRef = useRef<string | null>(null);

  const resetRoutingSchedulePrefs = useCallback(() => {
    setPreferredWeekday([]);
    setPreferredTimeOfDay(null);
    setPreferEarliestFeasibleStart(false);
    setEdgeFirst(false);
    setEdgeLast(false);
    setMultiDoctor(false);
  }, []);

  // -------- UX state --------
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(() => (bootstrap.result as Result | null) ?? null);
  const [addressError, setAddressError] = useState<string | null>(null);
  const [routingAddressFields, setRoutingAddressFields] = useState<AddressFields>(() =>
    addressFieldsFromRoutingCoords(
      bootstrap.form.newAppt.address?.trim() ?? '',
      bootstrap.form.newAppt.lat,
      bootstrap.form.newAppt.lon
    )
  );
  const routingAddressGeocodeKeyRef = useRef<string | null>(null);
  const [addressZone, setAddressZone] = useState<ClientZoneLookupResult | null>(null);
  const [addressZoneLoading, setAddressZoneLoading] = useState(false);
  const [doctorZoneWarning, setDoctorZoneWarning] = useState<{
    status: 'not_assigned' | 'transitioning_out';
    lastName: string | null;
  } | null>(null);
  const addressZoneRef = useRef<ClientZoneLookupResult | null>(null);
  const [doctorRequiredBeforeApptType, setDoctorRequiredBeforeApptType] = useState(false);
  const [schedulingPrefsOpen, setSchedulingPrefsOpen] = useState(false);
  const [routingMinutesPulse, setRoutingMinutesPulse] = useState(false);
  const routingMinutesPulseClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Last type|pets combo applied by the auto-minutes effect (flash when combo changes even if minutes stay the same). */
  const routingCalcComboKeyRef = useRef<string | null>(null);
  /** User typed Minutes — block passive stats sync and ASAP/multi-doctor re-average overwrites. */
  const routingMinutesManualOverrideRef = useRef(false);

  const [routingPrefillFlash, setRoutingPrefillFlash] = useState<
    Partial<Record<RoutingPrefillFlashField, true>>
  >({});
  const routingPrefillFlashClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const routingPrefillFlashClass = useCallback(
    (field: RoutingPrefillFlashField) =>
      routingPrefillFlash[field] ? ' routing-prefill-flash--active' : '',
    [routingPrefillFlash]
  );

  const triggerRoutingPrefillFlash = useCallback((fields: RoutingPrefillFlashField[]) => {
    if (fields.length === 0) return;
    if (routingPrefillFlashClearRef.current) {
      clearTimeout(routingPrefillFlashClearRef.current);
      routingPrefillFlashClearRef.current = null;
    }
    setRoutingPrefillFlash({});
    requestAnimationFrame(() => {
      const next = Object.fromEntries(fields.map((f) => [f, true as const])) as Partial<
        Record<RoutingPrefillFlashField, true>
      >;
      setRoutingPrefillFlash(next);
      routingPrefillFlashClearRef.current = setTimeout(() => {
        routingPrefillFlashClearRef.current = null;
        setRoutingPrefillFlash({});
      }, 1200);
    });
  }, []);

  const applyCalendarHandoffDoctor = useCallback(async () => {
    const handoff = readSchedulerCalendarHandoff();
    if (!handoff?.preferRoutingDoctor) return;
    if (readRoutingRescheduleIntent()) {
      clearSchedulerHandoffPreferRoutingDoctor();
      return;
    }

    let pimsId = handoff.routingDoctorPimsId?.trim() ?? '';
    let label = handoff.routingDoctorLabel?.trim() ?? '';

    if (!pimsId && handoff.providerFilter) {
      const internalId = Number(handoff.providerFilter);
      if (Number.isFinite(internalId)) {
        try {
          const emp = await fetchEmployee(internalId);
          pimsId =
            emp?.pimsId != null ? String(emp.pimsId).trim() : '';
          if (!label) label = buildDoctorName(emp, pimsId ? `Doctor ${pimsId}` : 'Doctor');
        } catch {
          /* ignore */
        }
      }
    }

    clearSchedulerHandoffPreferRoutingDoctor();
    if (!pimsId) return;

    setDoctorRequiredBeforeApptType(false);
    setForm((f) => ({ ...f, doctorId: pimsId }));
    setDoctorQuery(label || `Doctor ${pimsId}`);
    triggerRoutingPrefillFlash(['doctor']);
  }, [triggerRoutingPrefillFlash]);

  useEffect(() => {
    void applyCalendarHandoffDoctor();
  }, [applyCalendarHandoffDoctor]);

  useEffect(() => {
    const onHandoffDoctor = () => {
      void applyCalendarHandoffDoctor();
    };
    window.addEventListener(SCHEDULER_HANDOFF_ROUTING_DOCTOR_EVENT, onHandoffDoctor);
    return () => window.removeEventListener(SCHEDULER_HANDOFF_ROUTING_DOCTOR_EVENT, onHandoffDoctor);
  }, [applyCalendarHandoffDoctor]);

  const triggerRoutingMinutesPulse = useCallback(() => {
    if (routingMinutesPulseClearRef.current) {
      clearTimeout(routingMinutesPulseClearRef.current);
      routingMinutesPulseClearRef.current = null;
    }
    setRoutingMinutesPulse(false);
    requestAnimationFrame(() => {
      setRoutingMinutesPulse(true);
      routingMinutesPulseClearRef.current = setTimeout(() => {
        routingMinutesPulseClearRef.current = null;
        setRoutingMinutesPulse(false);
      }, 900);
    });
  }, []);

  useEffect(
    () => () => {
      if (routingMinutesPulseClearRef.current) {
        clearTimeout(routingMinutesPulseClearRef.current);
        routingMinutesPulseClearRef.current = null;
      }
      if (routingPrefillFlashClearRef.current) {
        clearTimeout(routingPrefillFlashClearRef.current);
        routingPrefillFlashClearRef.current = null;
      }
    },
    []
  );

  // -------- Client search --------
  const [clientQuery, setClientQuery] = useState(() => bootstrap.clientQuery);
  const [clientResults, setClientResults] = useState<Client[]>([]);
  const [clientSearching, setClientSearching] = useState(false);
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const clientBoxRef = useRef<HTMLDivElement | null>(null);
  const pickClientRef = useRef<
    (c: Client, opts?: { alternateAddress?: string | null; skipAlternateConfirm?: boolean }) => void
  >(() => {});
  const latestClientQueryRef = useRef('');
  const [clientPickAlternateConfirm, setClientPickAlternateConfirm] = useState<{
    client: Client;
    alternateAddress: string;
    clientHomeAddress: string;
  } | null>(null);
  const [zoneWorkConfirm, setZoneWorkConfirm] = useState<{
    proceed: () => void;
    message: string;
  } | null>(null);
  const [householdVisitConfirm, setHouseholdVisitConfirm] = useState<{
    conflicts: HouseholdScheduledVisitConflict[];
    blocking: boolean;
    proceed?: () => void;
  } | null>(null);
  const [householdVisitBanner, setHouseholdVisitBanner] = useState<{
    clientId: string;
    conflicts: HouseholdScheduledVisitConflict[];
  } | null>(null);
  const [checkingHouseholdVisits, setCheckingHouseholdVisits] = useState(false);
  const householdVisitLastFocusRef = useRef<HouseholdScheduledVisitConflict | null>(null);

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
  const [routingApptStatsTypeKey, setRoutingApptStatsTypeKey] = useState(
    () => bootstrap.routingApptStatsTypeKey ?? ''
  );
  const [routingPetCount, setRoutingPetCount] = useState(1);
  const [routingClientPatients, setRoutingClientPatients] = useState<RoutingPatientChipRow[]>([]);
  const [selectedRoutingPatientIds, setSelectedRoutingPatientIds] = useState<string[]>([]);
  const routingPatientSelectionClientRef = useRef<string | null>(null);
  const selectedRoutingPatientIdSet = useMemo(
    () => new Set(selectedRoutingPatientIds.map(String)),
    [selectedRoutingPatientIds]
  );
  const patientsDrivePetCount =
    routingClientPatients.length > 0 && selectedRoutingPatientIds.length > 0;
  const latestDoctorQueryRef = useRef('');
  const [doctorActiveIdx, setDoctorActiveIdx] = useState<number>(-1);
  const [clientActiveIdx, setClientActiveIdx] = useState<number>(-1);

  // -------- Doctor selection modal (Best fit across doctors) --------
  const [showDoctorSelectionModal, setShowDoctorSelectionModal] = useState(false);
  const [allProviders, setAllProviders] = useState<RoutingDoctorPick[]>([]);
  const [doctorSelectClientZoneLabel, setDoctorSelectClientZoneLabel] = useState<string | null>(null);
  const [doctorSelectNearestZoneNote, setDoctorSelectNearestZoneNote] = useState<string | null>(null);
  const [selectedDoctorIds, setSelectedDoctorIds] = useState<string[]>([]);
  const [providersLoading, setProvidersLoading] = useState(false);
  const [pendingEndpoint, setPendingEndpoint] = useState<string | null>(null);
  const [pendingAsapAllDoctorSearch, setPendingAsapAllDoctorSearch] = useState(false);

  // -------- Winner doctor name cache --------
  const [doctorNames, setDoctorNames] = useState<Record<string, string>>(() => ({ ...bootstrap.doctorNames }));
  const doctorNameReqs = useRef<Record<string, Promise<string>>>({});

  const [doctorIdByPims, setDoctorIdByPims] = useState<Record<string, string>>({});

  const activeCalendarPreviewOptionKey = useMemo(() => {
    const preview = readRoutingCalendarPreview();
    if (!preview) return null;
    if (preview.listOptionKey?.trim()) return preview.listOptionKey.trim();
    const o = preview.option;
    const cand =
      preview.candidateIndex ??
      (typeof o.candidateIndex === 'number' ? o.candidateIndex : undefined);
    const internalDoctor = String(o.doctorPimsId ?? '').trim();
    const pimsFromMap = Object.entries(doctorIdByPims).find(([, id]) => id === internalDoctor)?.[0];
    if (pimsFromMap) {
      return `${pimsFromMap}-${String(o.date ?? '')}-${String(o.insertionIndex ?? '')}-${cand ?? ''}`;
    }
    return routingCalendarPreviewOptionKey(preview);
  }, [calendarPreviewTick, doctorIdByPims]);

  const [etaWindowWarningsByOptionKey, setEtaWindowWarningsByOptionKey] = useState<
    Record<string, RoutingPreviewEtaWindowWarningsDetail>
  >({});
  /** Calendar red-line end ("HH:mm") by `pimsId:YYYY-MM-DD` from GET /appointments/doctor. */
  const [endDepotByDoctorDate, setEndDepotByDoctorDate] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!calendarWorkspaceMode) return;
    const bump = () => setCalendarPreviewTick((n) => n + 1);
    bump();
    window.addEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, bump);
    return () => window.removeEventListener(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT, bump);
  }, [calendarWorkspaceMode]);

  useEffect(() => {
    const onEtaWindowWarnings = (ev: Event) => {
      const detail = (ev as CustomEvent<RoutingPreviewEtaWindowWarningsDetail>).detail;
      if (!detail?.optionKey) return;
      setEtaWindowWarningsByOptionKey((prev) => ({ ...prev, [detail.optionKey]: detail }));
    };
    window.addEventListener(ROUTING_PREVIEW_ETA_WINDOW_WARNINGS_EVENT, onEtaWindowWarnings);
    return () =>
      window.removeEventListener(ROUTING_PREVIEW_ETA_WINDOW_WARNINGS_EVENT, onEtaWindowWarnings);
  }, []);

  useEffect(() => {
    if (!calendarWorkspaceMode || !activeCalendarPreviewOptionKey) return;
    const root = routingPageRootRef.current;
    const el = root?.querySelector(
      `[data-routing-calendar-preview-card="${CSS.escape(activeCalendarPreviewOptionKey)}"]`
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [calendarWorkspaceMode, activeCalendarPreviewOptionKey]);

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
  const [routingAppointmentTypes, setRoutingAppointmentTypes] = useState<AppointmentType[]>([]);
  const rescheduleTypeSyncedForApptRef = useRef<number | null>(null);
  const appointmentRequestTypeSyncedRef = useRef<number | null>(null);
  /** Option keys for which POST /appointments succeeded (calendar book flow). */
  const [scheduleBookedKeys, setScheduleBookedKeys] = useState<Record<string, true>>(
    () => ({ ...bootstrap.scheduleBookedKeys })
  );

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [hasActiveRescheduleIntent, setHasActiveRescheduleIntent] = useState(() =>
    rescheduleIntentIsActive()
  );
  const [hasActiveForwardBookingWorkspace, setHasActiveForwardBookingWorkspace] = useState(() =>
    forwardBookingWorkspaceIsActive()
  );
  const [hasActiveAppointmentRequestWorkspace, setHasActiveAppointmentRequestWorkspace] = useState(
    () => appointmentRequestWorkspaceIsActive()
  );
  const [rescheduleScope, setRescheduleScope] = useState<RoutingRescheduleScope | ''>(() => {
    const ri = readRoutingRescheduleIntent();
    if (!ri) return '';
    if (!rescheduleRequiresScopeChoice(ri)) return 'selected_pet';
    return ri.rescheduleScope ?? '';
  });
  const [forwardBookingScope, setForwardBookingScope] = useState<RoutingForwardBookingScope | ''>(() => {
    const intent = readRoutingForwardBookingIntent();
    if (!intent || !forwardBookingRequiresScopeChoice(intent)) return '';
    return intent.householdScope ?? '';
  });
  const activeForwardBookingIntent = useMemo(
    () => (hasActiveForwardBookingWorkspace ? readRoutingForwardBookingIntent() : null),
    [hasActiveForwardBookingWorkspace]
  );

  const lockForwardBookingClient = hasActiveForwardBookingWorkspace;

  const showForwardBookingScopeField = useMemo(
    () => hasActiveForwardBookingWorkspace && forwardBookingRequiresScopeChoice(activeForwardBookingIntent),
    [hasActiveForwardBookingWorkspace, activeForwardBookingIntent]
  );

  const activeAppointmentRequestIntent = useMemo(
    () => (hasActiveAppointmentRequestWorkspace ? readRoutingAppointmentRequestIntent() : null),
    [hasActiveAppointmentRequestWorkspace]
  );

  const appointmentRequestPerPetRouting =
    hasActiveAppointmentRequestWorkspace &&
    appointmentRequestUsesPerPetRouting(activeAppointmentRequestIntent);

  const appointmentRequestStaticPatients = useMemo(() => {
    if (!appointmentRequestPerPetRouting || !activeAppointmentRequestIntent) return undefined;
    if (
      activeAppointmentRequestIntent.isAlternateStop
    ) {
      return appointmentRequestRoutingPatientChips(activeAppointmentRequestIntent);
    }
    return undefined;
  }, [appointmentRequestPerPetRouting, activeAppointmentRequestIntent]);

  const lockAppointmentRequestClient =
    hasActiveAppointmentRequestWorkspace &&
    Boolean(activeAppointmentRequestIntent?.clientId?.trim()) &&
    !activeAppointmentRequestIntent?.isAlternateStop;
  const lockQueueClient = lockForwardBookingClient || lockAppointmentRequestClient;

  const householdVisitClientId = useMemo(
    () =>
      resolveRoutingHouseholdVisitClientId({
        routingFormClientId: form.newAppt.clientId,
        appointmentRequestClientId: activeAppointmentRequestIntent?.clientId,
      }),
    [form.newAppt.clientId, activeAppointmentRequestIntent?.clientId],
  );

  const activeRescheduleIntent = useMemo(
    () => readRoutingRescheduleIntent(),
    [hasActiveRescheduleIntent, rescheduleScope, sourceScoreTick]
  );
  const showRescheduleScopeField = useMemo(
    () => hasActiveRescheduleIntent && rescheduleRequiresScopeChoice(activeRescheduleIntent),
    [hasActiveRescheduleIntent, activeRescheduleIntent]
  );

  const routingRescheduleHighlightClass = useCallback(
    (field: RoutingPrefillFlashField | 'scope') => {
      if (!hasActiveRescheduleIntent) return '';
      const ri = activeRescheduleIntent;
      if (!ri) return '';
      if (field === 'scope') {
        return showRescheduleScopeField ? ' routing-reschedule-prefill-highlight' : '';
      }
      if (field === 'doctor' && !ri.primaryDoctorPimsId?.trim()) return '';
      if (field === 'client' && !ri.clientId?.trim()) return '';
      if (field === 'address' && !ri.address?.trim()) return '';
      if (field === 'minutes' && !(ri.serviceMinutes > 0)) return '';
      if (
        field === 'apptType' &&
        !ri.appointmentTypeName?.trim() &&
        (ri.appointmentTypeId == null || !Number.isFinite(Number(ri.appointmentTypeId)))
      ) {
        return '';
      }
      return ' routing-reschedule-prefill-highlight';
    },
    [hasActiveRescheduleIntent, activeRescheduleIntent, showRescheduleScopeField]
  );

  const routingForwardBookingHighlightClass = useCallback(
    (field: RoutingPrefillFlashField | 'scope') => {
      if (!hasActiveForwardBookingWorkspace) return '';
      const intent = activeForwardBookingIntent;
      if (!intent) return '';
      if (field === 'scope') {
        return showForwardBookingScopeField ? ' routing-reschedule-prefill-highlight' : '';
      }
      if (field === 'doctor' && !intent.primaryDoctorPimsId?.trim()) return '';
      if (field === 'client' && !intent.clientId?.trim()) return '';
      if (field === 'address' && !intent.address?.trim()) return '';
      if (field === 'minutes' && !(intent.serviceMinutes > 0)) return '';
      if (
        field === 'apptType' &&
        !intent.appointmentTypeName?.trim() &&
        (intent.appointmentTypeId == null || !Number.isFinite(Number(intent.appointmentTypeId)))
      ) {
        return '';
      }
      return ' routing-reschedule-prefill-highlight';
    },
    [hasActiveForwardBookingWorkspace, activeForwardBookingIntent, showForwardBookingScopeField]
  );

  const routingWorkspaceHighlightClass = useCallback(
    (field: RoutingPrefillFlashField | 'scope') => {
      if (hasActiveRescheduleIntent) return routingRescheduleHighlightClass(field);
      if (hasActiveForwardBookingWorkspace) return routingForwardBookingHighlightClass(field);
      return '';
    },
    [
      hasActiveRescheduleIntent,
      hasActiveForwardBookingWorkspace,
      routingForwardBookingHighlightClass,
      routingRescheduleHighlightClass,
    ]
  );

  const exitRescheduleMode = useCallback(() => {
    clearRoutingRescheduleIntent();
    setRescheduleScope('');
  }, []);

  const resetRoutingFormAfterForwardBookingDismiss = useCallback(() => {
    setForm((f) => {
      const empty = createDefaultRoutingForm();
      const keepDoctorId = f.doctorId.trim();
      return {
        ...empty,
        doctorId: keepDoctorId || empty.doctorId,
      };
    });
    setClientQuery('');
    setSelectedClientAlerts(null);
    setRoutingApptStatsTypeKey('');
    setScheduleBookTypeId(null);
    routingMinutesManualOverrideRef.current = false;
    setResult(null);
    setFeedbackError(null);
    setFeedbackToast(null);
  }, []);

  const exitAppointmentRequestWorkspace = useCallback(() => {
    const intent = readRoutingAppointmentRequestIntent();
    dismissRoutingAppointmentRequestWorkspace();
    returnFromAppointmentRequestWorkspace(navigate, intent);
  }, [navigate]);

  const resetRoutingFormAfterRescheduleDismiss = useCallback(() => {
    setForm((f) => {
      const empty = createDefaultRoutingForm();
      const keepDoctorId = f.doctorId.trim();
      return {
        ...empty,
        doctorId: keepDoctorId || empty.doctorId,
      };
    });
    setClientQuery('');
    setSelectedClientAlerts(null);
    setRoutingApptStatsTypeKey('');
    setScheduleBookTypeId(null);
    routingMinutesManualOverrideRef.current = false;
    setRescheduleScope('');
    setResult(null);
    setFeedbackError(null);
    setFeedbackToast(null);
  }, []);

  const rescheduleOriginalVisitForCompare = useMemo(() => {
    if (!hasActiveRescheduleIntent) return null;
    return resolveRescheduleOriginalVisitForCompare(
      result?.rescheduleOriginalBooking,
      activeRescheduleIntent?.appointmentId,
      activeRescheduleIntent
    );
  }, [
    hasActiveRescheduleIntent,
    result?.rescheduleOriginalBooking,
    activeRescheduleIntent,
    sourceScoreTick,
  ]);

  const rescheduleOriginalScoreSummaryLine = useMemo(
    () =>
      hasActiveRescheduleIntent
        ? rescheduleOriginalScoreSummary(rescheduleOriginalVisitForCompare)
        : null,
    [hasActiveRescheduleIntent, rescheduleOriginalVisitForCompare]
  );

  const exploreAlternativesMode = Boolean(activeRescheduleIntent?.exploreAlternatives);

  const rescheduleModeSummary = useMemo(() => {
    const ri = activeRescheduleIntent;
    if (!ri) return null;
    const explore = Boolean(ri.exploreAlternatives);
    const client = ri.clientDisplayLabel?.trim() || 'this household';
    const lookingFor = (who: string) =>
      explore ? `Looking for other appointments for ${who}` : `Moving ${who}`;
    if (selectedRoutingPatientIds.length > 0 && routingClientPatients.length > 0) {
      const names = routingClientPatients
        .filter((p) => selectedRoutingPatientIdSet.has(String(p.id)))
        .map((p) => p.name);
      if (names.length === 1) return lookingFor(`${names[0]} (${client})`);
      if (names.length > 1) return lookingFor(`${names.join(', ')} (${client})`);
    }
    if (rescheduleScope === 'household_day') {
      const n = ri.sameDayVisits?.length ?? 0;
      if (explore) {
        return n > 1
          ? `Looking for other appointments for all ${n} pets at ${client} scheduled today`
          : lookingFor(client);
      }
      return n > 1
        ? `Moving all ${n} pets at ${client} scheduled today`
        : `Moving ${client}`;
    }
    if (rescheduleScope === 'selected_pet') {
      const visit = ri.sameDayVisits?.find((v) => v.patientId === ri.patientId);
      const pet = visit?.patientName?.trim();
      if (explore) {
        return pet
          ? lookingFor(`${pet} (${client})`)
          : `Looking for other appointments for one pet at ${client}`;
      }
      return pet ? `Moving ${pet} (${client})` : `Moving one pet at ${client}`;
    }
    if (showRescheduleScopeField && selectedRoutingPatientIds.length === 0) {
      return explore
        ? `Looking for other appointments for ${client} — click the pets below`
        : `Moving ${client} — click the pets to reschedule below`;
    }
    return explore
      ? `Looking for other appointments for ${client}`
      : `Moving a visit for ${client}`;
  }, [
    activeRescheduleIntent,
    rescheduleScope,
    showRescheduleScopeField,
    selectedRoutingPatientIds,
    selectedRoutingPatientIdSet,
    routingClientPatients,
  ]);

  useEffect(() => {
    function syncRescheduleIntentFlag() {
      const active = rescheduleIntentIsActive();
      setHasActiveRescheduleIntent(active);
      const ri = readRoutingRescheduleIntent();
      if (!ri) {
        setRescheduleScope('');
        return;
      }
      if (!rescheduleRequiresScopeChoice(ri)) {
        setRescheduleScope('selected_pet');
        return;
      }
      setRescheduleScope(ri.rescheduleScope ?? '');
    }
    syncRescheduleIntentFlag();
    window.addEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, syncRescheduleIntentFlag);
    return () =>
      window.removeEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, syncRescheduleIntentFlag);
  }, []);

  useEffect(() => {
    function syncForwardBookingWorkspaceFlag() {
      setHasActiveForwardBookingWorkspace(forwardBookingWorkspaceIsActive());
      const intent = readRoutingForwardBookingIntent();
      if (!intent) {
        setForwardBookingScope('');
        return;
      }
      if (!forwardBookingRequiresScopeChoice(intent)) {
        setForwardBookingScope('selected_pet');
        return;
      }
      setForwardBookingScope(intent.householdScope ?? '');
    }
    syncForwardBookingWorkspaceFlag();
    window.addEventListener(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT, syncForwardBookingWorkspaceFlag);
    return () =>
      window.removeEventListener(
        ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT,
        syncForwardBookingWorkspaceFlag
      );
  }, []);

  useEffect(() => {
    function syncAppointmentRequestWorkspaceFlag() {
      setHasActiveAppointmentRequestWorkspace(appointmentRequestWorkspaceIsActive());
    }
    syncAppointmentRequestWorkspaceFlag();
    window.addEventListener(
      ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT,
      syncAppointmentRequestWorkspaceFlag
    );
    return () =>
      window.removeEventListener(
        ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT,
        syncAppointmentRequestWorkspaceFlag
      );
  }, []);

  useEffect(() => {
    const onSourceScore = () => setSourceScoreTick((n) => n + 1);
    window.addEventListener(ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT, onSourceScore);
    return () =>
      window.removeEventListener(ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT, onSourceScore);
  }, []);

  /** Calendar “Reschedule…” → hydrate Routing form once per intent row. */
  useEffect(() => {
    let cancelled = false;

    async function mergeRescheduleIntentFromCalendar() {
      const intent = readRoutingRescheduleIntent();
      if (!intent || intent.appliedToRoutingForm) return;
      routingMinutesManualOverrideRef.current = false;

      let resolvedDoctor = resolveRescheduleIntentDoctorPimsId(intent, []);
      if (!resolvedDoctor) {
        try {
          const providerRows = await fetchPrimaryProviders();
          if (cancelled) return;
          resolvedDoctor = resolveRescheduleIntentDoctorPimsId(intent, providerRows);
        } catch {
          /* routing form can still be filled without doctor */
        }
      }

      const pimsDoc = resolvedDoctor?.pimsId ?? intent.primaryDoctorPimsId?.trim() ?? '';
      const doctorDisplayName =
        resolvedDoctor?.displayName?.trim() || intent.primaryDoctorDisplayName?.trim() || '';

      if (pimsDoc) {
        patchRescheduleIntentDoctorPims(pimsDoc, doctorDisplayName, { notify: false });
      }

      setForm((f) => ({
        ...f,
        ...(pimsDoc ? { doctorId: pimsDoc } : {}),
        ...(() => {
          const range = rescheduleIntentDefaultDateRange(
            intent,
            DEFAULT_PRACTICE_TIMEZONE
          );
          return range
            ? { startDate: range.startDate, endDate: range.endDate }
            : {};
        })(),
        newAppt: {
          ...f.newAppt,
          serviceMinutes:
            intent.serviceMinutes > 0 ? intent.serviceMinutes : Math.max(15, f.newAppt.serviceMinutes || 45),
        },
      }));

      const rescheduleClientId = intent.clientId?.trim();
      const rescheduleAddressOnly =
        !rescheduleClientId && rescheduleIntentUsesAlternateAddress(intent);

      let syncedClient: Client | null = null;
      if (rescheduleAddressOnly) {
        const addr = intent.alternateAddressText?.trim() || intent.address?.trim() || '';
        if (addr) {
          setForm((f) => ({
            ...f,
            newAppt: {
              ...f.newAppt,
              address: addr,
              clientId: undefined,
              lat: undefined,
              lon: undefined,
            },
          }));
          setRoutingAddressFields(addressFieldsFromFreeText(addr));
          setAddressError(null);
          linkedClientHomeAddressRef.current = null;
          // Address-only holds have no client — do not put description/notes in Client.
          setClientQuery(intent.clientDisplayLabel?.trim() || '');
          try {
            const geo = await geocodeRoutingAddressText(addr);
            if (!cancelled && geo.ok) {
              setForm((f) => ({
                ...f,
                newAppt: { ...f.newAppt, address: geo.address, lat: geo.lat, lon: geo.lon },
              }));
              setRoutingAddressFields(addressFieldsFromRoutingCoords(geo.address, geo.lat, geo.lon));
              setAddressError(null);
            }
          } catch {
            /* user can pick from autocomplete */
          }
        }
      } else {
        try {
          const raw = await fetchClientByIdStaff(intent.clientId);
          if (cancelled) return;
          syncedClient = staffRecordToRoutingClient(raw);
          if (syncedClient) {
            const alt = intent.isAlternateStop
              ? intent.alternateAddressText?.trim() || intent.address?.trim() || ''
              : '';
            pickClientRef.current(syncedClient, alt ? { alternateAddress: alt } : undefined);
          }
        } catch {
          /* fall back to label only */
        }

        if (!syncedClient && !cancelled) {
          const label = intent.clientDisplayLabel?.trim();
          if (label) {
            setClientQuery(label);
            setForm((f) => ({
              ...f,
              newAppt: { ...f.newAppt, clientId: intent.clientId },
            }));
          }
        }
      }

      const tid = intent.appointmentTypeId;
      if (tid != null && Number.isFinite(Number(tid))) setScheduleBookTypeId(Number(tid));

      const pickerTypeName = routingPickerTypeNameForAppointmentType(
        routingAppointmentTypes,
        tid,
        intent.appointmentTypeName
      );
      if (pickerTypeName) {
        setRoutingApptStatsTypeKey(pickerTypeName);
        rescheduleTypeSyncedForApptRef.current = intent.appointmentId;
      } else if (intent.appointmentTypeName?.trim()) {
        setRoutingApptStatsTypeKey(intent.appointmentTypeName.trim());
      }

      const typeName = pickerTypeName ?? intent.appointmentTypeName?.trim();

      if (!syncedClient) {
        const alerts = intent.clientAlerts;
        if (alerts !== undefined && alerts !== null) setSelectedClientAlerts(alerts);
      }

      if (pimsDoc) {
        setDoctorQuery(doctorDisplayName || `Doctor ${pimsDoc}`);
      }

      const flashFields: RoutingPrefillFlashField[] = [];
      if (pimsDoc) flashFields.push('doctor');
      if (!rescheduleAddressOnly && (syncedClient || intent.clientDisplayLabel?.trim()))
        flashFields.push('client');
      if (rescheduleAddressOnly || (intent.isAlternateStop && intent.alternateAddressText?.trim()))
        flashFields.push('address');
      if (intent.serviceMinutes > 0) flashFields.push('minutes');
      if (typeName || (tid != null && Number.isFinite(Number(tid)))) flashFields.push('apptType');
      if (flashFields.length > 0) triggerRoutingPrefillFlash(flashFields);

      if (!rescheduleRequiresScopeChoice(intent)) {
        setRescheduleScope('selected_pet');
      } else {
        setRescheduleScope(intent.rescheduleScope ?? '');
      }

      setResult(null);
      setFeedbackError(null);
      setFeedbackToast(
        intent.exploreAlternatives
          ? rescheduleAddressOnly
            ? 'Alternatives: visit address loaded. Run routing, open My Week, then book another time — the current appointment stays.'
            : 'Alternatives: client loaded. Run routing, open My Week, then book another time — the current appointment stays.'
          : rescheduleAddressOnly
            ? 'Reschedule: visit address loaded (no client linked). Run routing, open My Week, then confirm the new time.'
            : 'Reschedule: client loaded. Run routing, open My Week, then confirm the new time.'
      );
      markRescheduleIntentAppliedToRoutingForm();
      void fetchAndCacheRescheduleSourcePlacementSnapshot(intent).then(() => {
        if (!cancelled) setSourceScoreTick((n) => n + 1);
      });
    }

    void mergeRescheduleIntentFromCalendar();
    const onIntentUpdated = () => {
      void mergeRescheduleIntentFromCalendar();
    };
    window.addEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, onIntentUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT, onIntentUpdated);
    };
  }, [triggerRoutingPrefillFlash, routingAppointmentTypes]);

  /** Reschedule: hydrate Calculate Time type once doctor types load (picker uses `name`, not prettyName). */
  useEffect(() => {
    if (!hasActiveRescheduleIntent) {
      rescheduleTypeSyncedForApptRef.current = null;
      return;
    }
    const ri = readRoutingRescheduleIntent();
    if (!ri?.appointmentTypeId && !ri?.appointmentTypeName?.trim()) return;
    if (!form.doctorId.trim() || routingAppointmentTypes.length === 0) return;

    const needsSync =
      !routingApptStatsTypeKey.trim() ||
      rescheduleTypeSyncedForApptRef.current !== ri.appointmentId;
    if (!needsSync) return;

    const pickerTypeName = routingPickerTypeNameForAppointmentType(
      routingAppointmentTypes,
      ri.appointmentTypeId ?? scheduleBookTypeId,
      ri.appointmentTypeName
    );
    if (!pickerTypeName) return;

    setRoutingApptStatsTypeKey(pickerTypeName);
    const matched = routingAppointmentTypes.find(
      (t) => String(t.name ?? '').trim() === pickerTypeName
    );
    if (matched?.id != null) setScheduleBookTypeId(Number(matched.id));
    rescheduleTypeSyncedForApptRef.current = ri.appointmentId;
  }, [
    hasActiveRescheduleIntent,
    form.doctorId,
    routingAppointmentTypes,
    routingApptStatsTypeKey,
    scheduleBookTypeId,
  ]);

  /** Forward booking list → hydrate Routing form once per intent row. */
  useEffect(() => {
    let cancelled = false;

    async function mergeForwardBookingIntentFromList() {
      const intent = readRoutingForwardBookingIntent();
      if (!intent || !intent.workspaceActive || intent.appliedToRoutingForm) return;
      if (readRoutingRescheduleIntent()) return;
      routingMinutesManualOverrideRef.current = false;

      let resolvedDoctor = resolveRescheduleIntentDoctorPimsId(intent, []);
      if (!resolvedDoctor) {
        try {
          const providerRows = await fetchPrimaryProviders();
          if (cancelled) return;
          resolvedDoctor = resolveRescheduleIntentDoctorPimsId(intent, providerRows);
        } catch {
          /* optional */
        }
      }

      const pimsDoc = resolvedDoctor?.pimsId ?? intent.primaryDoctorPimsId?.trim() ?? '';
      const doctorDisplayName =
        resolvedDoctor?.displayName?.trim() || intent.primaryDoctorDisplayName?.trim() || '';

      const routingDates =
        intent.routingSearch?.startDate?.trim() && intent.routingSearch?.endDate?.trim()
          ? {
              startDate: intent.routingSearch.startDate.trim(),
              endDate: intent.routingSearch.endDate.trim(),
            }
          : intent.origin === 'care_outreach'
            ? careOutreachRoutingSearchDateRange(DEFAULT_PRACTICE_TIMEZONE)
            : forwardBookingRoutingSearchDateRange({
                intervalAmount: intent.intervalAmount,
                intervalUnit: intent.intervalUnit,
                targetDueDateIso: intent.targetDueDate,
                practiceTz: DEFAULT_PRACTICE_TIMEZONE,
              });

      setForm((f) => ({
        ...f,
        ...(pimsDoc ? { doctorId: pimsDoc } : {}),
        ...(routingDates
          ? { startDate: routingDates.startDate, endDate: routingDates.endDate }
          : {}),
        newAppt: {
          ...f.newAppt,
          serviceMinutes:
            intent.serviceMinutes > 0 ? intent.serviceMinutes : Math.max(15, f.newAppt.serviceMinutes || 45),
        },
      }));

      let syncedClient: Client | null = null;
      try {
        const raw = await fetchClientByIdStaff(intent.clientId);
        if (cancelled) return;
        syncedClient = staffRecordToRoutingClient(raw);
        if (syncedClient) {
          pickClientRef.current(syncedClient);
        }
      } catch {
        /* fall back to label only */
      }

      if (!syncedClient && !cancelled) {
        const label = intent.clientDisplayLabel?.trim();
        if (label) {
          setClientQuery(label);
          setForm((f) => ({
            ...f,
            newAppt: { ...f.newAppt, clientId: intent.clientId },
          }));
        }
      }

      const typeName = (() => {
        const fallback = defaultRoutingAppointmentTypeSelection(routingAppointmentTypes);
        if (fallback) {
          setScheduleBookTypeId(fallback.id);
          setRoutingApptStatsTypeKey(fallback.statsTypeKey);
          return fallback.statsTypeKey;
        }
        return null;
      })();

      if (!syncedClient) {
        const alerts = intent.clientAlerts;
        if (alerts !== undefined && alerts !== null) setSelectedClientAlerts(alerts);
      }

      if (pimsDoc) {
        setDoctorQuery(doctorDisplayName || `Doctor ${pimsDoc}`);
      }

      if (intent.reserveOption !== undefined) {
        setReserveOption(intent.reserveOption);
      }

      const flashFields: RoutingPrefillFlashField[] = [];
      if (pimsDoc) flashFields.push('doctor');
      if (syncedClient || intent.clientDisplayLabel?.trim()) flashFields.push('client');
      if (syncedClient && formatClientAddress(syncedClient)) flashFields.push('address');
      if (intent.serviceMinutes > 0) flashFields.push('minutes');
      if (typeName) flashFields.push('apptType');
      if (flashFields.length > 0) triggerRoutingPrefillFlash(flashFields);

      setResult(null);
      setFeedbackError(null);
      const intervalLabel = formatForwardBookingIntervalLabel({
        intervalAmount: intent.intervalAmount,
        intervalUnit: intent.intervalUnit,
      });
      const rangeHint = routingDates
        ? ` Search ${routingDates.startDate}–${routingDates.endDate}.`
        : '';
      const dueHint = intent.targetDueDate
        ? ` Target around ${intent.targetDueDate.slice(0, 10)} (${intervalLabel}).`
        : ` Book ${intervalLabel}.`;
      setFeedbackToast(
        `Follow-up booking: client loaded.${dueHint}${rangeHint} Run routing and preview a slot.`
      );
      markForwardBookingIntentAppliedToRoutingForm();
    }

    void mergeForwardBookingIntentFromList();
    const onIntentUpdated = () => {
      void mergeForwardBookingIntentFromList();
    };
    window.addEventListener(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT, onIntentUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(ROUTING_FORWARD_BOOKING_INTENT_UPDATED_EVENT, onIntentUpdated);
    };
  }, [triggerRoutingPrefillFlash, routingAppointmentTypes]);

  /** Forward booking: when types load after form hydrate, default Calculate Time if still empty. */
  useEffect(() => {
    if (!hasActiveForwardBookingWorkspace) return;
    if (!form.doctorId.trim() || routingAppointmentTypes.length === 0) return;
    if (routingApptStatsTypeKey.trim()) return;

    const intent = readRoutingForwardBookingIntent();
    if (!intent?.workspaceActive) return;

    const fallback = defaultRoutingAppointmentTypeSelection(routingAppointmentTypes);
    if (!fallback) return;

    setRoutingApptStatsTypeKey(fallback.statsTypeKey);
    setScheduleBookTypeId(fallback.id);
  }, [
    hasActiveForwardBookingWorkspace,
    form.doctorId,
    routingAppointmentTypes,
    routingApptStatsTypeKey,
  ]);

  /** Appointment request list → hydrate Routing form once per intent row. */
  useEffect(() => {
    let cancelled = false;

    async function mergeAppointmentRequestIntentFromList() {
      const intent = readRoutingAppointmentRequestIntent();
      if (!intent || !intent.workspaceActive || intent.appliedToRoutingForm) return;
      routingMinutesManualOverrideRef.current = false;
      // Appointment-request Book wins over leftover reschedule / forward-booking
      // session state (otherwise hydrate is skipped and Book becomes a PATCH).
      if (readRoutingRescheduleIntent()) {
        dismissRoutingRescheduleWorkspace();
      }
      if (readRoutingForwardBookingIntent()?.workspaceActive) {
        dismissRoutingForwardBookingWorkspace();
      }

      let pimsDoc = '';
      let doctorDisplayName = intent.preferredDoctorDisplayName?.trim() ?? '';
      const preferredId = intent.preferredDoctorId?.trim();
      if (preferredId) {
        try {
          const providerRows = await fetchPrimaryProviders();
          if (cancelled) return;
          const match = providerRows.find(
            (p) =>
              String(p.id) === preferredId ||
              String(p.pimsId ?? '') === preferredId ||
              String((p as { pimsId?: string }).pimsId ?? '') === preferredId
          );
          if (match?.pimsId) {
            pimsDoc = String(match.pimsId).trim();
            doctorDisplayName =
              doctorDisplayName ||
              match.name?.trim() ||
              [match.firstName, match.lastName].filter(Boolean).join(' ').trim();
          }
        } catch {
          /* optional */
        }
      }

      const routingDates = appointmentRequestRoutingSearchDateRange(
        intent.howSoon,
        DEFAULT_PRACTICE_TIMEZONE,
      );

      const alternateAddress = intent.isAlternateStop
        ? intent.alternateAddressText?.trim() || intent.address?.trim() || ''
        : '';

      setForm((f) => ({
        ...f,
        ...(pimsDoc ? { doctorId: pimsDoc } : {}),
        startDate: routingDates.startDate,
        endDate: routingDates.endDate,
        newAppt: {
          ...f.newAppt,
          serviceMinutes:
            intent.serviceMinutes > 0 ? intent.serviceMinutes : Math.max(15, f.newAppt.serviceMinutes || 45),
          ...(alternateAddress
            ? {
                address: alternateAddress,
                clientId: undefined,
                lat: undefined,
                lon: undefined,
              }
            : intent.address?.trim()
              ? { address: intent.address.trim() }
              : {}),
        },
      }));

      if (alternateAddress) {
        setRoutingAddressFields(addressFieldsFromFreeText(alternateAddress));
        setAddressError(null);
        linkedClientHomeAddressRef.current = null;
        const label = intent.clientDisplayLabel?.trim();
        if (label) {
          setClientQuery(label);
        }
      }

      let syncedClient: Client | null = null;
      const clientId = intent.clientId?.trim();
      if (!alternateAddress && clientId) {
        try {
          const raw = await fetchClientByIdStaff(clientId);
          if (cancelled) return;
          syncedClient = staffRecordToRoutingClient(raw);
          if (syncedClient) {
            pickClientRef.current(syncedClient);
          }
        } catch {
          /* fall back to label only */
        }
      }

      if (!syncedClient && !cancelled && !alternateAddress) {
        const label = intent.clientDisplayLabel?.trim();
        if (label) {
          setClientQuery(label);
          if (clientId) {
            setForm((f) => ({
              ...f,
              newAppt: { ...f.newAppt, clientId },
            }));
          }
        }
        const addrText = intent.address?.trim();
        if (addrText) {
          setRoutingAddressFields(addressFieldsFromFreeText(addrText));
        }
      }

      if (!cancelled) {
        const addrToVerify =
          alternateAddress ||
          (syncedClient ? formatClientAddress(syncedClient) : '') ||
          intent.address?.trim() ||
          '';
        const clientHasCoords =
          syncedClient != null &&
          parseCoordinate(syncedClient.lat) != null &&
          parseCoordinate(syncedClient.lon) != null;
        if (addrToVerify && !clientHasCoords) {
          try {
            const geo = await geocodeRoutingAddressText(addrToVerify);
            if (!cancelled && geo.ok) {
              setForm((f) => ({
                ...f,
                newAppt: {
                  ...f.newAppt,
                  address: geo.address,
                  lat: geo.lat,
                  lon: geo.lon,
                  ...(clientId && !alternateAddress ? { clientId } : {}),
                },
              }));
              setRoutingAddressFields(
                addressFieldsFromRoutingCoords(geo.address, geo.lat, geo.lon)
              );
              setAddressError(null);
            }
          } catch {
            /* user can pick from autocomplete */
          }
        }
      }

      const usesPerPetTypes = appointmentRequestUsesPerPetRouting(intent);

      if (usesPerPetTypes && (intent.pets?.length ?? 0) > 0) {
        setRoutingApptStatsTypeKey('');
        setScheduleBookTypeId(null);
        setRoutingPetCount(intent.pets!.length);
        appointmentRequestTypeSyncedRef.current = intent.appointmentRequestSubmissionId;
      }

      const typeName = (() => {
        if (usesPerPetTypes) return null;
        const pickerTypeName = routingPickerTypeNameForAppointmentType(
          routingAppointmentTypes,
          intent.appointmentTypeId ?? scheduleBookTypeId,
          intent.appointmentTypeName
        );
        if (pickerTypeName) {
          setRoutingApptStatsTypeKey(pickerTypeName);
          const matched = routingAppointmentTypes.find(
            (t) => String(t.name ?? '').trim() === pickerTypeName
          );
          if (matched?.id != null) setScheduleBookTypeId(Number(matched.id));
          appointmentRequestTypeSyncedRef.current = intent.appointmentRequestSubmissionId;
          return pickerTypeName;
        }
        const fallback = intent.appointmentTypeName?.trim();
        if (fallback) setRoutingApptStatsTypeKey(fallback);
        return fallback ?? null;
      })();

      if (pimsDoc) {
        setDoctorQuery(doctorDisplayName || `Doctor ${pimsDoc}`);
      }

      if (
        !cancelled &&
        usesPerPetTypes &&
        intent.isAlternateStop
      ) {
        const chips = appointmentRequestRoutingPatientChips(intent);
        if (chips.length > 0) {
          setRoutingClientPatients(chips);
          const ids = chips.map((p) => String(p.id));
          setSelectedRoutingPatientIds(ids);
          setRoutingPetCount(ids.length);
          routingPatientSelectionClientRef.current = null;
        }
      }

      const flashFields: RoutingPrefillFlashField[] = [];
      if (pimsDoc) flashFields.push('doctor');
      if (alternateAddress) {
        flashFields.push('address');
      } else {
        if (syncedClient || intent.clientDisplayLabel?.trim()) flashFields.push('client');
        if (intent.address?.trim() || (syncedClient && formatClientAddress(syncedClient)))
          flashFields.push('address');
      }
      if (intent.serviceMinutes > 0 && !usesPerPetTypes) flashFields.push('minutes');
      if (typeName) flashFields.push('apptType');
      if (usesPerPetTypes && (intent.pets?.length ?? 0) > 0) flashFields.push('pets');
      if (flashFields.length > 0) triggerRoutingPrefillFlash(flashFields);

      routingPatientSelectionClientRef.current = null;
      if (!(usesPerPetTypes && intent.isAlternateStop)) {
        setRoutingClientPatients((roster) => {
          if (roster.length === 0) return roster;
          const defaults = defaultAppointmentRequestSelectedPatientIds(intent, roster);
          if (defaults.length > 0) {
            setSelectedRoutingPatientIds(defaults);
            applyRoutingPatientChipSelection(defaults, { pulse: true });
            routingPatientSelectionClientRef.current = clientId?.trim() ?? null;
          }
          return roster;
        });
      }

      setResult(null);
      setFeedbackError(null);
      const howSoon = intent.howSoon?.trim();
      const altToast = alternateAddress ? ' Alternate visit address loaded (no client linked).' : '';
      setFeedbackToast(
        howSoon
          ? `Appointment request loaded (${howSoon}).${altToast}`
          : `Appointment request loaded.${altToast}`
      );
      markAppointmentRequestIntentAppliedToRoutingForm();
    }

    void mergeAppointmentRequestIntentFromList();
    const onIntentUpdated = () => {
      void mergeAppointmentRequestIntentFromList();
    };
    window.addEventListener(ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT, onIntentUpdated);
    return () => {
      cancelled = true;
      window.removeEventListener(ROUTING_APPOINTMENT_REQUEST_INTENT_UPDATED_EVENT, onIntentUpdated);
    };
  }, [triggerRoutingPrefillFlash, routingAppointmentTypes]);

  /** Appointment request: hydrate Calculate Time type once doctor types load. */
  useEffect(() => {
    if (!hasActiveAppointmentRequestWorkspace) {
      appointmentRequestTypeSyncedRef.current = null;
      return;
    }
    const intent = readRoutingAppointmentRequestIntent();
    if (!intent?.workspaceActive) return;
    if (appointmentRequestUsesPerPetRouting(intent)) return;
    if (!intent.appointmentTypeId && !intent.appointmentTypeName?.trim()) return;
    if (!form.doctorId.trim() || routingAppointmentTypes.length === 0) return;

    const pickerTypeName = routingPickerTypeNameForAppointmentType(
      routingAppointmentTypes,
      intent.appointmentTypeId ?? scheduleBookTypeId,
      intent.appointmentTypeName
    );
    if (!pickerTypeName) return;
    if (
      appointmentRequestTypeSyncedRef.current === intent.appointmentRequestSubmissionId &&
      routingApptStatsTypeKey.trim() === pickerTypeName
    ) {
      return;
    }

    setRoutingApptStatsTypeKey(pickerTypeName);
    const matched = routingAppointmentTypes.find(
      (t) => String(t.name ?? '').trim() === pickerTypeName
    );
    if (matched?.id != null) setScheduleBookTypeId(Number(matched.id));
    appointmentRequestTypeSyncedRef.current = intent.appointmentRequestSubmissionId;
  }, [
    hasActiveAppointmentRequestWorkspace,
    form.doctorId,
    routingAppointmentTypes,
    routingApptStatsTypeKey,
    scheduleBookTypeId,
  ]);

  useEffect(() => {
    if (!calendarWorkspaceMode) return;
    function onDismissReschedule() {
      setHasActiveRescheduleIntent(false);
      resetRoutingFormAfterRescheduleDismiss();
    }
    window.addEventListener(ROUTING_DISMISS_RESCHEDULE_EVENT, onDismissReschedule);
    return () => window.removeEventListener(ROUTING_DISMISS_RESCHEDULE_EVENT, onDismissReschedule);
  }, [calendarWorkspaceMode, resetRoutingFormAfterRescheduleDismiss]);

  useEffect(() => {
    if (!calendarWorkspaceMode) return;
    function onDismissForwardBooking() {
      setHasActiveForwardBookingWorkspace(false);
      resetRoutingFormAfterForwardBookingDismiss();
    }
    window.addEventListener(ROUTING_DISMISS_FORWARD_BOOKING_EVENT, onDismissForwardBooking);
    return () =>
      window.removeEventListener(ROUTING_DISMISS_FORWARD_BOOKING_EVENT, onDismissForwardBooking);
  }, [calendarWorkspaceMode, resetRoutingFormAfterForwardBookingDismiss]);

  useEffect(() => {
    if (!calendarWorkspaceMode) return;
    function onDismissAppointmentRequest() {
      setHasActiveAppointmentRequestWorkspace(false);
      resetRoutingFormAfterForwardBookingDismiss();
    }
    window.addEventListener(ROUTING_DISMISS_APPOINTMENT_REQUEST_EVENT, onDismissAppointmentRequest);
    return () =>
      window.removeEventListener(ROUTING_DISMISS_APPOINTMENT_REQUEST_EVENT, onDismissAppointmentRequest);
  }, [calendarWorkspaceMode, resetRoutingFormAfterForwardBookingDismiss]);

  /** Clear stale routing results when the search doctor changes; calendar stays on the source visit. */
  const prevRescheduleSearchDoctorRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasActiveRescheduleIntent) {
      prevRescheduleSearchDoctorRef.current = null;
      return;
    }
    const doc = form.doctorId.trim();
    const prev = prevRescheduleSearchDoctorRef.current;
    prevRescheduleSearchDoctorRef.current = doc;
    if (prev == null || prev === doc) return;
    setResult(null);
    setFeedbackError(null);
    setFeedbackToast(null);
    setScheduleBookedKeys({});
  }, [form.doctorId, hasActiveRescheduleIntent]);

  /** Leave reschedule mode when client changes on the routing form (not when dismissing a preview slot). */
  useEffect(() => {
    const ri = readRoutingRescheduleIntent();
    if (!ri?.appliedToRoutingForm) return;

    const anchorClient = ri.clientId?.trim();
    const currentClient = form.newAppt.clientId?.trim();
    if (anchorClient && currentClient && currentClient !== anchorClient) {
      exitRescheduleMode();
    }
  }, [form.newAppt.clientId, exitRescheduleMode]);

  useEffect(() => {
    if (!authToken) clearRoutingUiSnapshot();
  }, [authToken]);

  /** Practice calendar (embedded) completed a book/reschedule — drop routing candidates from the pane. */
  useEffect(() => {
    if (!calendarWorkspaceMode) return;
    function clearRoutingAfterCalendarBook() {
      setResult(null);
      setError(null);
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
    const pendingReschedule = readRoutingRescheduleIntent();
    if (pendingReschedule && !pendingReschedule.appliedToRoutingForm) return;
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
      asapAllDoctorSearch,
      clientQuery,
      doctorQuery,
      doctorNames,
      scheduleBookedKeys,
      feedbackSuccessKey,
      selectedClientAlerts,
      scheduleBookTypeId,
      routingApptStatsTypeKey,
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
    asapAllDoctorSearch,
    clientQuery,
    doctorQuery,
    doctorNames,
    scheduleBookedKeys,
    feedbackSuccessKey,
    selectedClientAlerts,
    scheduleBookTypeId,
    routingApptStatsTypeKey,
  ]);

  useEffect(() => {
    const b = searchParams.get('booked');
    if (!b) return;
    setScheduleBookedKeys((m) => ({ ...m, [b]: true }));
    setFeedbackToast('Appointment added to the schedule.');
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

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

    const hasCoords =
      Number.isFinite(form.newAppt.lat as number) && Number.isFinite(form.newAppt.lon as number);
    const hasAddress = (form.newAppt.address ?? '').trim().length > 0;
    if (!hasCoords) {
      setFeedbackError(
        hasAddress
          ? 'Verify the address before viewing placement on the calendar.'
          : 'Select a client or enter a valid street address.'
      );
      return;
    }
    const appointmentTypeId = resolveScheduleBookTypeId();
    if (appointmentTypeId == null) {
      setFeedbackError(
        routingAppointmentTypes.length === 0
          ? 'Appointment types are still loading. Try again in a moment.'
          : 'Could not determine an appointment type for calendar preview.'
      );
      return;
    }
    setScheduleBookTypeId(appointmentTypeId);
    if (!opt.suggestedStartIso) {
      setFeedbackError('This option has no suggested start time.');
      return;
    }

    setFeedbackError(null);
    const listOptionKey = routingOptionKey(opt);
    const merged = { ...opt, doctorPimsId: internalId } as UnifiedOption;
    const routingRequestId =
      opt.routingRequestId ?? latestRoutingRequestId ?? deriveRoutingRequestId(result) ?? undefined;
    const topForIndex = result ? routingTopCandidatesFromResult(result) : [];
    const candidateIndex = resolveRoutingCandidateIndex(opt, topForIndex);
    const rescheduleRow = readRoutingRescheduleIntent();

    const rescheduleUsesAlt =
      Boolean(rescheduleRow) &&
      rescheduleIntentUsesAlternateAddress(rescheduleRow) &&
      (form.newAppt.address ?? '').trim();
    const linkedClientUsesAlt = routingFormUsesAlternateClientAddress();

    const payload: RoutingCalendarPreviewPayloadV1 = {
      version: 1,
      listOptionKey,
      option: { ...(merged as unknown as Record<string, unknown>), doctorPimsId: internalId } as RoutingCalendarPreviewPayloadV1['option'],
      serviceMinutes: Math.max(1, Number(form.newAppt.serviceMinutes) || 30),
      newApptMeta: {
        ...(form.newAppt.clientId?.trim()
          ? { clientId: form.newAppt.clientId.trim() }
          : {}),
        address: form.newAppt.address,
        lat: form.newAppt.lat,
        lon: form.newAppt.lon,
      },
      ...(rescheduleUsesAlt || linkedClientUsesAlt ? { routingUsesAlternateAddress: true } : {}),
      appointmentTypeId,
      appointmentTypeChosenInRouting: Boolean(routingApptStatsTypeKey.trim()),
      ...(routingApptStatsTypeKey.trim()
        ? { routingStatsTypeKey: routingApptStatsTypeKey.trim() }
        : {}),
      clientDisplayLabel: form.newAppt.clientId?.trim() ? clientQuery.trim() || undefined : undefined,
      routingRequestId,
      candidateIndex,
      candidateId: opt.candidateId,
    };
    if (rescheduleRow) {
      const targets = rescheduleTargetsForChipSelection(
        rescheduleRow,
        selectedRoutingPatientIds
      );
      const scope = deriveRescheduleScopeFromChipSelection(
        rescheduleRow,
        selectedRoutingPatientIds
      );
      writeRoutingRescheduleScope(scope);
      setRescheduleScope(scope);
      payload.rescheduleAppointmentId = targets.appointmentIds[0];
      payload.rescheduleAppointmentIds =
        targets.appointmentIds.length > 0 ? targets.appointmentIds : [rescheduleRow.appointmentId];
      if (rescheduleRow.exploreAlternatives) {
        payload.exploreAlternatives = true;
      }
      payload.reschedulePatientId = targets.patientId;
      // Client-linked no-patient visits (ash drop-off) have a blank anchor patient — never
      // send it through as a preview chip or the calendar ghost renders an empty pet.
      const previewVisits = targets.visits.filter((v) => String(v.patientId ?? '').trim());
      if (previewVisits.length > 0) {
        payload.previewPatients = previewVisits.map((v) => ({
          id: v.patientId,
          name: v.patientName?.trim() || `Pet ${v.patientId}`,
        }));
      }
      let sourceSnapshot = resolveRescheduleOriginalVisitForCompare(
        result?.rescheduleOriginalBooking,
        rescheduleRow.appointmentId,
        rescheduleRow
      );
      if (!sourceSnapshot?.found) {
        sourceSnapshot = await fetchAndCacheRescheduleSourcePlacementSnapshot(rescheduleRow);
      }
      if (sourceSnapshot) {
        payload.rescheduleSourceVisitSnapshot = sourceSnapshot;
      }
    } else {
      const chipPreview = previewPatientsFromChipSelection(
        selectedRoutingPatientIds,
        routingClientPatients
      );
      if (chipPreview.length > 0) {
        payload.previewPatients = chipPreview;
      }
    }

    const forwardBookingIntent = readRoutingForwardBookingIntent();
    if (
      forwardBookingIntent?.origin === 'schedule_loader' &&
      forwardBookingIntent.scheduleLoaderReturn
    ) {
      payload.previewSource = 'schedule-loader';
      payload.scheduleLoaderReturn = forwardBookingIntent.scheduleLoaderReturn;
    }

    writeRoutingCalendarPreview(payload);
    if (calendarWorkspaceMode) {
      setCalendarPreviewTick((n) => n + 1);
    } else {
      navigate('/schedule/scheduler?routingPreview=1');
    }
  }

  function focusRescheduleSourceOnCalendar() {
    if (!calendarWorkspaceMode || !hasActiveRescheduleIntent) return;
    clearRoutingCalendarPreview();
    setCalendarPreviewTick((n) => n + 1);
    window.dispatchEvent(new Event(ROUTING_FOCUS_RESCHEDULE_SOURCE_EVENT));
  }

  const focusHouseholdConflictOnCalendar = useCallback(
    (conflict: HouseholdScheduledVisitConflict) => {
      if (calendarWorkspaceMode) {
        householdVisitLastFocusRef.current = conflict;
        dispatchRoutingFocusHouseholdVisit(conflict, { pinHighlight: true });
        return;
      }
      navigate(
        buildSchedulerFocusAppointmentUrl(conflict.appointmentId, {
          date: conflict.practiceDateKey,
          providerId: conflict.primaryProviderId,
        }),
      );
    },
    [calendarWorkspaceMode, navigate],
  );

  const dismissHouseholdVisitConfirm = useCallback(() => {
    if (calendarWorkspaceMode && householdVisitLastFocusRef.current) {
      dispatchRoutingFocusHouseholdVisit(householdVisitLastFocusRef.current);
    }
    unpinRoutingHouseholdVisitHighlight();
    const clientId = householdVisitClientId;
    if (clientId && (householdVisitConfirm?.conflicts.length ?? 0) > 0) {
      writeRoutingHouseholdVisitAck(clientId);
    }
    setHouseholdVisitConfirm(null);
  }, [calendarWorkspaceMode, householdVisitClientId, householdVisitConfirm?.conflicts.length]);

  const fetchRoutingHouseholdVisitConflicts = useCallback(
    async (searchStartDate: string, searchEndDate: string) => {
      const clientId = householdVisitClientId;
      if (!clientId) return [];
      if (!shouldWarnHouseholdVisitsOnRoutingSearch({ clientId })) return [];

      const ri = readRoutingRescheduleIntent();
      // Exclude every visit we're moving (all selected household pets), not just the anchor.
      const excludeAppointmentIds = (() => {
        if (!ri) return [] as number[];
        const targets = rescheduleTargetsForChipSelection(ri, selectedRoutingPatientIds);
        return [
          ...new Set(
            targets.appointmentIds.filter((id) => Number.isFinite(Number(id)) && Number(id) > 0),
          ),
        ];
      })();

      return findHouseholdScheduledVisitConflicts({
        practiceId: ROUTING_PRACTICE_ID,
        clientId,
        searchStartDate,
        searchEndDate,
        practiceTz: DEFAULT_PRACTICE_TIMEZONE,
        catalog: buildBookingAppointmentTypeCatalog(routingAppointmentTypes),
        excludeAppointmentIds,
      });
    },
    [householdVisitClientId, routingAppointmentTypes, selectedRoutingPatientIds],
  );

  const applyHouseholdVisitBanner = useCallback(
    (clientId: string, conflicts: HouseholdScheduledVisitConflict[]) => {
      if (conflicts.length === 0) {
        setHouseholdVisitBanner((prev) => (prev?.clientId === clientId ? null : prev));
        return;
      }
      setHouseholdVisitBanner({ clientId, conflicts });
    },
    [],
  );

  const openHouseholdVisitReview = useCallback(async () => {
    if (!form.startDate?.trim() || !form.endDate?.trim()) return;
    const { startDate, endDate } = adjustRoutingSlotSearchDates(
      form.startDate,
      form.endDate,
      DEFAULT_PRACTICE_TIMEZONE,
    );
    setCheckingHouseholdVisits(true);
    try {
      const conflicts = await fetchRoutingHouseholdVisitConflicts(startDate, endDate);
      const clientId = householdVisitClientId;
      if (!clientId) return;
      applyHouseholdVisitBanner(clientId, conflicts);
      if (conflicts.length > 0) {
        householdVisitLastFocusRef.current = null;
        setHouseholdVisitConfirm({ conflicts, blocking: false });
      }
    } catch (err) {
      console.warn('Routing household visit review failed', err);
    } finally {
      setCheckingHouseholdVisits(false);
    }
  }, [
    applyHouseholdVisitBanner,
    fetchRoutingHouseholdVisitConflicts,
    form.endDate,
    householdVisitClientId,
    form.startDate,
  ]);

  useEffect(() => {
    const clientId = householdVisitClientId ?? '';
    if (!clientId) {
      setHouseholdVisitBanner(null);
      setHouseholdVisitConfirm(null);
      return;
    }
    setHouseholdVisitBanner((prev) => (prev && prev.clientId !== clientId ? null : prev));
    setHouseholdVisitConfirm(null);
    const ackedClientId = readRoutingHouseholdVisitAckClientId();
    if (ackedClientId && ackedClientId !== clientId) {
      clearRoutingHouseholdVisitAck();
    }
  }, [householdVisitClientId]);

  function routingOptionKey(opt: UnifiedOption): string {
    return `${opt.doctorPimsId}-${opt.date}-${opt.insertionIndex}-${opt.candidateIndex ?? ''}`;
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
    if (Array.isArray(result?.top)) {
      for (const row of result.top) {
        if (row.doctorId) doctorIdsToFetch.add(row.doctorId);
      }
    }
    if (Array.isArray(result?.doctors)) {
      for (const d of result.doctors) {
        if (d.pimsId) doctorIdsToFetch.add(d.pimsId);
        for (const w of d.top ?? []) {
          if (w.doctorId) doctorIdsToFetch.add(w.doctorId);
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
    fetchAllAppointmentTypes(ROUTING_PRACTICE_ID, { activeOnly: true })
      .then((rows) => {
        if (cancelled) return;
        const active = rows
          .map((t) => normalizeAppointmentTypeFromApi(t))
          .filter((t) => appointmentTypeIncludedInRouting(t));
        setRoutingAppointmentTypes(active);
        const defaultSelection = defaultRoutingAppointmentTypeSelection(active);
        if (defaultSelection?.id != null) {
          setScheduleBookTypeId((cur) => (cur != null ? cur : defaultSelection.id));
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

  /** Drop stale clientId from session restore when the client field is empty (e.g. prior visit). */
  useEffect(() => {
    if (lockQueueClient) return;
    if (clientQuery.trim()) return;
    setForm((f) => {
      if (!f.newAppt.clientId?.trim()) return f;
      return { ...f, newAppt: { ...f.newAppt, clientId: undefined } };
    });
  }, []);

  /** Restore linked client home on session bootstrap so alternate detection works after refresh. */
  useEffect(() => {
    const cid = form.newAppt.clientId?.trim();
    if (!cid) {
      linkedClientHomeAddressRef.current = null;
      return;
    }
    let cancelled = false;
    void fetchClientByIdStaff(cid).then((payload) => {
      if (cancelled || !payload || typeof payload !== 'object') return;
      linkedClientHomeAddressRef.current = formatClientAddress(payload as Client);
    });
    return () => {
      cancelled = true;
    };
  }, [form.newAppt.clientId]);

  const routingFormUsesAlternateClientAddress = useCallback((): boolean => {
    const clientId = form.newAppt.clientId?.trim();
    const addr = (form.newAppt.address ?? '').trim();
    if (!clientId || !addr) return false;
    const home = linkedClientHomeAddressRef.current?.trim();
    // Until home is loaded, do not treat the form address as ALT (was sticky-flagging
    // leftover stops and PUTting them onto the visit after Get Best Route / book).
    if (!home) return false;
    return !routingAddressesMatch(addr, home);
  }, [form.newAppt.clientId, form.newAppt.address]);

  /** New client → clear scheduling prefs (not reserve handling); doctor, dates, and calculate-time stay. */
  useEffect(() => {
    const nextId = form.newAppt.clientId?.trim() || null;
    if (!nextId) return;
    const prevId = lastRoutingClientIdRef.current;
    if (prevId && prevId !== nextId) {
      resetRoutingSchedulePrefs();
    }
    lastRoutingClientIdRef.current = nextId;
  }, [form.newAppt.clientId, resetRoutingSchedulePrefs]);

  // Client search
  useEffect(() => {
    if (lockQueueClient) {
      setClientResults([]);
      setShowClientDropdown(false);
      return;
    }
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
  }, [clientQuery, lockQueueClient]);

  /** Keep queue client fixed to the list row that started this session. */
  useEffect(() => {
    if (!lockQueueClient) return;
    const anchorClientId =
      readRoutingForwardBookingIntent()?.clientId?.trim() ||
      readRoutingAppointmentRequestIntent()?.clientId?.trim();
    if (!anchorClientId) return;
    const currentClientId = form.newAppt.clientId?.trim();
    if (currentClientId === anchorClientId) return;

    let cancelled = false;
    void (async () => {
      try {
        const raw = await fetchClientByIdStaff(anchorClientId);
        if (cancelled) return;
        const syncedClient = staffRecordToRoutingClient(raw);
        if (syncedClient) {
          pickClientRef.current(syncedClient, { skipAlternateConfirm: true });
        } else {
          setForm((f) => ({
            ...f,
            newAppt: { ...f.newAppt, clientId: anchorClientId },
          }));
          const label =
            readRoutingForwardBookingIntent()?.clientDisplayLabel?.trim() ||
            readRoutingAppointmentRequestIntent()?.clientDisplayLabel?.trim();
          if (label) setClientQuery(label);
        }
      } catch {
        if (cancelled) return;
        setForm((f) => ({
          ...f,
          newAppt: { ...f.newAppt, clientId: anchorClientId },
        }));
        const label =
          readRoutingForwardBookingIntent()?.clientDisplayLabel?.trim() ||
          readRoutingAppointmentRequestIntent()?.clientDisplayLabel?.trim();
        if (label) setClientQuery(label);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lockQueueClient, form.newAppt.clientId]);

  const routingAddressVerified =
    !addressError &&
    Number.isFinite(form.newAppt.lat as number) &&
    Number.isFinite(form.newAppt.lon as number) &&
    (form.newAppt.address ?? '').trim().length > 0;

  // Resolve client zone as soon as the address is verified (client pick or geocode).
  useEffect(() => {
    const addr = (form.newAppt.address ?? '').trim();
    if (!routingAddressVerified || !addr) {
      setAddressZone(null);
      addressZoneRef.current = null;
      setAddressZoneLoading(false);
      return;
    }

    let alive = true;
    const lookupKey = `${addr}|${form.newAppt.lat}|${form.newAppt.lon}`;
    void (async () => {
      setAddressZoneLoading(true);
      try {
        const resolved = await lookupClientZoneForAddress(addr);
        if (!alive) return;
        if (
          lookupKey !==
          `${(form.newAppt.address ?? '').trim()}|${form.newAppt.lat}|${form.newAppt.lon}`
        ) {
          return;
        }
        setAddressZone(resolved);
        addressZoneRef.current = resolved;
      } catch {
        if (!alive) return;
        setAddressZone(null);
        addressZoneRef.current = null;
      } finally {
        if (alive) setAddressZoneLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [routingAddressVerified, form.newAppt.address, form.newAppt.lat, form.newAppt.lon, addressError]);

  // Geocode client-prefilled or restored addresses that lack coordinates.
  useEffect(() => {
    const addr = (form.newAppt.address ?? '').trim();
    const hasCoords =
      Number.isFinite(form.newAppt.lat as number) &&
      Number.isFinite(form.newAppt.lon as number);
    if (!addr || hasCoords) return;

    const key = `${addr}|${form.newAppt.clientId ?? ''}`;
    if (routingAddressGeocodeKeyRef.current === key) return;
    routingAddressGeocodeKeyRef.current = key;

    let cancelled = false;
    void geocodeRoutingAddressText(addr).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setForm((f) => ({
          ...f,
          newAppt: {
            ...f.newAppt,
            address: result.address,
            lat: result.lat,
            lon: result.lon,
          },
        }));
        setRoutingAddressFields(
          addressFieldsFromRoutingCoords(result.address, result.lat, result.lon)
        );
        setAddressError(null);
        return;
      }
      setAddressError(
        `${result.message} Select a matching address from the list or enter a complete street address.`
      );
    });
    return () => {
      cancelled = true;
    };
  }, [form.newAppt.address, form.newAppt.clientId, form.newAppt.lat, form.newAppt.lon]);

  const selectedDoctorDisplayName =
    doctorQuery.trim() ||
    doctorNames[form.doctorId.trim()] ||
    (form.doctorId.trim() ? `Doctor ${form.doctorId.trim()}` : '');

  const doctorZoneWarningMessage =
    doctorZoneWarning != null
      ? formatDoctorZoneInlineWarning({
          status: doctorZoneWarning.status,
          lastName: doctorZoneWarning.lastName,
          displayName: selectedDoctorDisplayName,
        })
      : null;

  // Warn when this-doctor-only routing uses a doctor not assigned to the address zone.
  useEffect(() => {
    const doctorPimsId = form.doctorId.trim();
    const zoneId = addressZone?.zoneId;

    if (multiDoctor || !doctorPimsId || zoneId == null) {
      setDoctorZoneWarning(null);
      return;
    }

    const daysOfWeek = distinctDaysOfWeekInDateRange(
      form.startDate,
      form.endDate,
      DEFAULT_PRACTICE_TIMEZONE
    );

    let alive = true;
    void (async () => {
      try {
        const status = await getDoctorClientZoneStatus(doctorPimsId, zoneId, {
          daysOfWeek: daysOfWeek.length ? daysOfWeek : null,
          zoneLabel: addressZone?.shortLabel ?? addressZone?.displayLabel ?? null,
        });
        if (!alive) return;
        if (status.kind === 'assigned') {
          setDoctorZoneWarning(null);
        } else {
          setDoctorZoneWarning({
            status: status.kind,
            lastName: status.lastName,
          });
        }
      } catch {
        if (alive) setDoctorZoneWarning(null);
      }
    })();

    return () => {
      alive = false;
    };
  }, [
    multiDoctor,
    form.doctorId,
    form.startDate,
    form.endDate,
    addressZone?.zoneId,
    addressZone?.shortLabel,
    addressZone?.displayLabel,
  ]);

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
    // Single-doctor mode: changing doctors resets Calculate Time. ASAP / multi-doctor keep
    // the type and re-average minutes from the multi-doctor stats loader instead.
    if (asapAllDoctorSearch || multiDoctor) return;
    setRoutingApptStatsTypeKey('');
    setRoutingPetCount(1);
    routingMinutesManualOverrideRef.current = false;
    if (!form.doctorId.trim()) {
      setApptLengthsRows([]);
    }
  }, [form.doctorId, asapAllDoctorSearch, multiDoctor]);

  const resolveDoctorIdsForMinutesAverage = useCallback(async (): Promise<string[]> => {
    const stored = readStoredDoctorSelection()?.doctorIds ?? [];
    if (!asapAllDoctorSearch && multiDoctor && stored.length > 0) {
      return [...new Set(stored.map((id) => String(id).trim()).filter(Boolean))];
    }
    try {
      const providers = await fetchPrimaryProviders();
      const ids = providers
        .map((p) => String(p.pimsId ?? p.id ?? '').trim())
        .filter(Boolean);
      return [...new Set(ids)];
    } catch {
      const fallback = form.doctorId.trim();
      return fallback ? [fallback] : [];
    }
  }, [asapAllDoctorSearch, multiDoctor, form.doctorId]);

  const loadApptLengthStats = useCallback(async () => {
    const useMultiDoctorAverage = asapAllDoctorSearch || multiDoctor;
    const doctorId = form.doctorId.trim();
    if (!useMultiDoctorAverage && !doctorId) return;
    setApptLengthsLoading(true);
    setApptLengthsError(null);
    try {
      if (useMultiDoctorAverage) {
        const doctorIds = await resolveDoctorIdsForMinutesAverage();
        const rows = await fetchAveragedApptLengthStatsForDoctors(doctorIds);
        setApptLengthsRows(rows);
        return;
      }
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
  }, [
    form.doctorId,
    asapAllDoctorSearch,
    multiDoctor,
    resolveDoctorIdsForMinutesAverage,
  ]);

  useEffect(() => {
    if (asapAllDoctorSearch || multiDoctor) {
      void loadApptLengthStats();
      return;
    }
    if (!form.doctorId.trim()) return;
    void loadApptLengthStats();
  }, [form.doctorId, asapAllDoctorSearch, multiDoctor, loadApptLengthStats]);

  function routingAppointmentTypeForStatsKey(typeKey: string): AppointmentType | undefined {
    return appointmentTypeForRoutingStatsKey(typeKey, routingAppointmentTypes);
  }

  /** Keep scheduleBookTypeId aligned when appointment types load after a Calculate Time pick. */
  useEffect(() => {
    const key = routingApptStatsTypeKey.trim();
    if (!key || routingAppointmentTypes.length === 0) return;
    const matched = routingAppointmentTypeForStatsKey(key);
    if (matched?.id != null) {
      setScheduleBookTypeId(Number(matched.id));
    }
  }, [routingApptStatsTypeKey, routingAppointmentTypes]);

  /** Keep calendar preview appointment type in sync when Calculate Time changes after View Placement. */
  useEffect(() => {
    const key = routingApptStatsTypeKey.trim();
    if (!key || routingAppointmentTypes.length === 0) return;
    const preview = readRoutingCalendarPreview();
    if (!preview) return;
    const typeId = resolveRoutingChosenAppointmentTypeId({
      statsTypeKey: key,
      scheduleBookTypeId,
      types: routingAppointmentTypes,
      previewTypeId: preview.appointmentTypeId,
      previewTypeChosenInRouting: preview.appointmentTypeChosenInRouting,
    });
    if (typeId == null) return;
    if (
      preview.appointmentTypeId === typeId &&
      preview.appointmentTypeChosenInRouting === true
    ) {
      return;
    }
    writeRoutingCalendarPreview({
      ...preview,
      appointmentTypeId: typeId,
      appointmentTypeChosenInRouting: true,
      routingStatsTypeKey: key,
    });
  }, [routingApptStatsTypeKey, scheduleBookTypeId, routingAppointmentTypes]);

  const routingApptTypePickerOptions = useMemo(() => {
    const statsByNorm = new Map<string, AvgMinutesByTypeRow>();
    for (const row of apptLengthsRows) {
      const norm = normalizeAppointmentType(row.typeName);
      if (norm) statsByNorm.set(norm, row);
    }
    return sortAppointmentTypesForPicker([...routingAppointmentTypes], {
      unrankedOrder: 'alphabetical',
    })
      .map((t) => {
        const typeName = String(t.name ?? '').trim();
        if (!typeName) return null;
        const norm = normalizeAppointmentType(typeName);
        const prettyNorm = normalizeAppointmentType(t.prettyName);
        const statsRow =
          statsByNorm.get(norm) ??
          (prettyNorm ? statsByNorm.get(prettyNorm) : undefined) ??
          apptLengthsRows.find((row) => {
            const rowNorm = normalizeAppointmentType(row.typeName);
            return rowNorm === norm || rowNorm === prettyNorm;
          });
        return { typeName, statsRow: statsRow ?? null };
      })
      .filter((o): o is { typeName: string; statsRow: AvgMinutesByTypeRow | null } => o != null);
  }, [apptLengthsRows, routingAppointmentTypes]);

  useEffect(() => {
    if (!routingApptStatsTypeKey.trim()) return;
    const stillValid = routingApptTypePickerOptions.some((o) => o.typeName === routingApptStatsTypeKey);
    if (stillValid) return;

    const remapFromId = (typeId: number | null | undefined) => {
      if (typeId == null || !Number.isFinite(Number(typeId))) return false;
      const key = routingPickerTypeNameForAppointmentType(routingAppointmentTypes, typeId);
      if (!key || !routingApptTypePickerOptions.some((o) => o.typeName === key)) return false;
      setRoutingApptStatsTypeKey(key);
      return true;
    };

    if (remapFromId(scheduleBookTypeId)) return;

    if (hasActiveRescheduleIntent) {
      const ri = readRoutingRescheduleIntent();
      if (remapFromId(ri?.appointmentTypeId)) return;
    }

    if (
      (form.doctorId.trim() || asapAllDoctorSearch || multiDoctor) &&
      (apptLengthsLoading || routingAppointmentTypes.length === 0)
    ) {
      return;
    }

    setRoutingApptStatsTypeKey('');
    setRoutingPetCount(1);
  }, [
    routingApptStatsTypeKey,
    routingApptTypePickerOptions,
    routingAppointmentTypes,
    scheduleBookTypeId,
    hasActiveRescheduleIntent,
    form.doctorId,
    asapAllDoctorSearch,
    multiDoctor,
    apptLengthsLoading,
  ]);

  function defaultDurationMinutesForRoutingType(typeKey: string, pets: number): number | null {
    return defaultDurationMinutesForRoutingTypeSelection(
      routingAppointmentTypeForStatsKey(typeKey),
      pets
    );
  }

  const applyRoutingServiceMinutes = useCallback(
    (typeKey: string, pets: number, opts?: { pulse?: boolean }) => {
      if (hasActiveRescheduleIntent) return;
      const baseMins = estimateRoutingServiceMinutesForSelection(
        typeKey,
        pets,
        apptLengthsRows,
        routingAppointmentTypeForStatsKey
      );
      if (baseMins == null) return;

      const newPatientCount =
        activeAppointmentRequestIntent?.pets?.filter((pet) => !pet.patientPimsId?.trim())
          .length ?? 0;
      const mins = applyRoutingServiceMinuteBuffers(baseMins, {
        newPatientCount,
        numPets: pets,
      });

      const comboKey = `${typeKey.trim()}|${pets}|${newPatientCount}|${mins}`;
      const comboChanged = routingCalcComboKeyRef.current !== comboKey;
      routingCalcComboKeyRef.current = comboKey;

      let didUpdateMinutes = false;
      setForm((f) => {
        if (f.newAppt.serviceMinutes === mins) return f;
        didUpdateMinutes = true;
        return { ...f, newAppt: { ...f.newAppt, serviceMinutes: mins } };
      });

      if (opts?.pulse !== false && (didUpdateMinutes || comboChanged)) {
        triggerRoutingMinutesPulse();
      }
    },
    [
      hasActiveRescheduleIntent,
      apptLengthsRows,
      routingAppointmentTypes,
      triggerRoutingMinutesPulse,
      activeAppointmentRequestIntent,
    ]
  );

  const applyRoutingPatientChipSelection = useCallback(
    (nextIds: readonly string[], opts?: { pulse?: boolean }) => {
      const count = nextIds.length;
      if (count > 0) {
        setRoutingPetCount(count);
        if (opts?.pulse !== false) {
          triggerRoutingPrefillFlash(['pets']);
        }
        if (routingApptStatsTypeKey.trim()) {
          // User-driven pet selection should refresh minutes from type stats.
          routingMinutesManualOverrideRef.current = false;
          applyRoutingServiceMinutes(routingApptStatsTypeKey, count, {
            pulse: opts?.pulse !== false,
          });
        }
      }

      const ri = readRoutingRescheduleIntent();
      if (ri && hasActiveRescheduleIntent) {
        const scope = deriveRescheduleScopeFromChipSelection(ri, nextIds);
        writeRoutingRescheduleScope(scope);
        setRescheduleScope(scope);
      }

      const fbi = readRoutingForwardBookingIntent();
      if (fbi?.workspaceActive && hasActiveForwardBookingWorkspace) {
        const scope = deriveForwardBookingScopeFromChipSelection(fbi, nextIds);
        writeRoutingForwardBookingScope(scope);
        setForwardBookingScope(scope);
      }
    },
    [
      hasActiveRescheduleIntent,
      hasActiveForwardBookingWorkspace,
      routingApptStatsTypeKey,
      applyRoutingServiceMinutes,
      triggerRoutingPrefillFlash,
    ]
  );

  const onRoutingClientPatientsLoaded = useCallback(
    (patients: RoutingPatientChipRow[]) => {
      setRoutingClientPatients(patients);
      const clientKey = form.newAppt.clientId?.trim() ?? '';
      if (!clientKey || routingPatientSelectionClientRef.current === clientKey) return;
      routingPatientSelectionClientRef.current = clientKey;

      if (patients.length === 0) {
        setSelectedRoutingPatientIds([]);
        return;
      }

      const ri = readRoutingRescheduleIntent();
      if (ri && hasActiveRescheduleIntent) {
        const defaults = defaultRescheduleSelectedPatientIds(ri).filter((id) =>
          patients.some((p) => String(p.id) === String(id))
        );
        if (defaults.length > 0) {
          setSelectedRoutingPatientIds(defaults);
          applyRoutingPatientChipSelection(defaults, { pulse: true });
          return;
        }
      }

      const fbi = readRoutingForwardBookingIntent();
      if (fbi?.workspaceActive && hasActiveForwardBookingWorkspace) {
        const defaults = defaultForwardBookingSelectedPatientIds(fbi).filter((id) =>
          patients.some((p) => String(p.id) === String(id))
        );
        if (defaults.length > 0) {
          setSelectedRoutingPatientIds(defaults);
          applyRoutingPatientChipSelection(defaults, { pulse: true });
          return;
        }
      }

      const ari = readRoutingAppointmentRequestIntent();
      if (ari?.workspaceActive && hasActiveAppointmentRequestWorkspace) {
        const defaults = defaultAppointmentRequestSelectedPatientIds(ari, patients);
        if (defaults.length > 0) {
          setSelectedRoutingPatientIds(defaults);
          applyRoutingPatientChipSelection(defaults, { pulse: true });
          return;
        }
      }

      setSelectedRoutingPatientIds([]);
    },
    [
      form.newAppt.clientId,
      hasActiveRescheduleIntent,
      hasActiveForwardBookingWorkspace,
      hasActiveAppointmentRequestWorkspace,
      applyRoutingPatientChipSelection,
    ]
  );

  const onToggleRoutingPatientSelect = useCallback(
    (patient: RoutingPatientChipRow) => {
      const id = String(patient.id);
      setSelectedRoutingPatientIds((prev) => {
        const set = new Set(prev.map(String));
        if (set.has(id)) set.delete(id);
        else set.add(id);
        const next = [...set];
        applyRoutingPatientChipSelection(next, { pulse: true });
        return next;
      });
    },
    [applyRoutingPatientChipSelection]
  );

  /** Keep calendar preview patient chips in sync when selection changes after a slot is chosen. */
  useEffect(() => {
    const preview = readRoutingCalendarPreview();
    if (!preview || routingClientPatients.length === 0) return;
    const chipPreview = previewPatientsFromChipSelection(
      selectedRoutingPatientIds,
      routingClientPatients
    );
    if (chipPreview.length === 0) return;
    const prev = preview.previewPatients ?? [];
    const same =
      prev.length === chipPreview.length &&
      chipPreview.every(
        (p, i) => String(prev[i]?.id) === String(p.id) && String(prev[i]?.name ?? '') === p.name
      );
    if (same) return;
    writeRoutingCalendarPreview({ ...preview, previewPatients: chipPreview });
    if (calendarWorkspaceMode) {
      setCalendarPreviewTick((n) => n + 1);
    }
  }, [
    selectedRoutingPatientIds,
    routingClientPatients,
    calendarWorkspaceMode,
  ]);

  /** Calendar preview book type — explicit Calculate Time pick, then stored id, then practice default. */
  function resolveScheduleBookTypeId(): number | null {
    if (appointmentRequestPerPetRouting && activeAppointmentRequestIntent) {
      const visitPets = buildRoutingVisitPetsFromAppointmentRequestIntent(
        activeAppointmentRequestIntent,
        {
          selectedPatientIds: selectedRoutingPatientIds,
          appointmentTypes: routingAppointmentTypes,
        },
      );
      if (visitPets.length > 0) return visitPets[0]!.appointmentTypeId;
    }
    const fromStatsKey = routingApptStatsTypeKey.trim();
    if (fromStatsKey) {
      const fromStats = routingAppointmentTypeForStatsKey(fromStatsKey);
      if (fromStats?.id != null) return Number(fromStats.id);
      if (scheduleBookTypeId != null && Number.isFinite(scheduleBookTypeId) && scheduleBookTypeId > 0) {
        return scheduleBookTypeId;
      }
      return null;
    }
    if (scheduleBookTypeId != null && Number.isFinite(scheduleBookTypeId) && scheduleBookTypeId > 0) {
      return scheduleBookTypeId;
    }
    const prefer =
      routingAppointmentTypes.find((t) =>
        /wellness|standard|check-up|checkup|office/i.test(String(t.prettyName || t.name || ''))
      ) ?? routingAppointmentTypes[0];
    if (prefer?.id != null) return Number(prefer.id);
    return null;
  }

  /** POST /routing/v2 `newAppt.appointmentTypeId` — when Calculate Time type is selected (or reschedule prefill). */
  function routingRequestAppointmentTypeId(): number | undefined {
    if (appointmentRequestPerPetRouting && activeAppointmentRequestIntent) {
      const visitPets = buildRoutingVisitPetsFromAppointmentRequestIntent(
        activeAppointmentRequestIntent,
        {
          selectedPatientIds: selectedRoutingPatientIds,
          appointmentTypes: routingAppointmentTypes,
        },
      );
      if (visitPets.length > 0) {
        // Mixed households: the calming / Pre-Meds type's window drives routing
        // even when other pets use different types (each keeps its own type on book).
        return preferCalmingPremedVisitTypeId(
          visitPets.map((p) => p.appointmentTypeId),
          routingAppointmentTypes,
        );
      }
    }
    const typeKey = routingApptStatsTypeKey.trim();
    if (typeKey) {
      const matched = routingAppointmentTypeForStatsKey(typeKey);
      const id = matched?.id != null ? Number(matched.id) : NaN;
      if (Number.isFinite(id) && id > 0) return id;
    }
    if (
      hasActiveRescheduleIntent &&
      scheduleBookTypeId != null &&
      Number.isFinite(scheduleBookTypeId) &&
      scheduleBookTypeId > 0
    ) {
      return scheduleBookTypeId;
    }
    return undefined;
  }

  /** Selected Calculate Time type forbids a client but the form still has one attached. */
  function getRoutingClientTypeConflictMessage(): string | null {
    if (!form.newAppt.clientId?.trim()) return null;
    const typeKey = routingApptStatsTypeKey.trim();
    if (!typeKey) return null;
    const matched = routingAppointmentTypeForStatsKey(typeKey);
    if (!matched || appointmentTypeAllowsClient(matched)) return null;
    const label = String(matched.prettyName || matched.name || 'This appointment type').trim();
    return `${label} does not allow a client. Clear the client field or choose a different appointment type.`;
  }

  useEffect(() => {
    if (hasActiveRescheduleIntent) return;
    if (appointmentRequestPerPetRouting) return;
    if (shouldPreserveManualRoutingMinutes(routingMinutesManualOverrideRef.current)) return;
    if (!routingApptStatsTypeKey.trim()) {
      routingCalcComboKeyRef.current = null;
      return;
    }
    applyRoutingServiceMinutes(routingApptStatsTypeKey, routingPetCount, { pulse: false });
  }, [
    hasActiveRescheduleIntent,
    appointmentRequestPerPetRouting,
    routingApptStatsTypeKey,
    routingPetCount,
    apptLengthsRows,
    applyRoutingServiceMinutes,
  ]);

  /** Appointment request with per-pet types — resolve minutes from doctor stats API. */
  useEffect(() => {
    if (!appointmentRequestPerPetRouting || !activeAppointmentRequestIntent) return;
    if (hasActiveRescheduleIntent) return;
    if (shouldPreserveManualRoutingMinutes(routingMinutesManualOverrideRef.current)) return;
    const doctorId = form.doctorId.trim();
    if (!doctorId || routingAppointmentTypes.length === 0) return;

    const visitPets = buildRoutingVisitPetsFromAppointmentRequestIntent(
      activeAppointmentRequestIntent,
      {
        selectedPatientIds: selectedRoutingPatientIds,
        appointmentTypes: routingAppointmentTypes,
      },
    );
    if (visitPets.length === 0) return;

    let cancelled = false;
    void fetchRoutingServiceMinutes({
      practiceId: ROUTING_PRACTICE_ID,
      doctorId,
      visitPets,
    })
      .then((result) => {
        if (cancelled) return;
        if (shouldPreserveManualRoutingMinutes(routingMinutesManualOverrideRef.current)) return;
        setForm((f) => {
          if (f.newAppt.serviceMinutes === result.serviceMinutes) return f;
          return { ...f, newAppt: { ...f.newAppt, serviceMinutes: result.serviceMinutes } };
        });
        triggerRoutingMinutesPulse();
      })
      .catch(() => {
        /* keep prior estimate */
      });

    return () => {
      cancelled = true;
    };
  }, [
    appointmentRequestPerPetRouting,
    activeAppointmentRequestIntent,
    hasActiveRescheduleIntent,
    form.doctorId,
    routingAppointmentTypes,
    selectedRoutingPatientIds,
    triggerRoutingMinutesPulse,
  ]);

  useEffect(() => {
    const cid = form.newAppt.clientId?.trim() ?? '';
    if (!cid) {
      routingPatientSelectionClientRef.current = null;
      setRoutingClientPatients([]);
      setSelectedRoutingPatientIds([]);
    } else if (routingPatientSelectionClientRef.current !== cid) {
      routingPatientSelectionClientRef.current = null;
      setRoutingClientPatients([]);
      setSelectedRoutingPatientIds([]);
    }
  }, [form.newAppt.clientId]);

  /** Calendar preview book type — explicit Calculate Time pick, then stored id, then practice default. */
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
    if (key === 'serviceMinutes') {
      routingMinutesManualOverrideRef.current = true;
    }
    setForm((f) => ({ ...f, newAppt: { ...f.newAppt, [key]: value } }));
  }

  const onRoutingAddressFieldsChange = useCallback((fields: AddressFields) => {
    routingAddressGeocodeKeyRef.current = null;
    setRoutingAddressFields(fields);
    setAddressError(null);
    const text = addressFieldsDisplayText(fields) || fields.line1?.trim() || '';
    setForm((f) => ({
      ...f,
      newAppt: {
        ...f.newAppt,
        address: text,
        lat:
          fields.lat != null && Number.isFinite(fields.lat) ? fields.lat : undefined,
        lon:
          fields.lon != null && Number.isFinite(fields.lon) ? fields.lon : undefined,
      },
    }));
  }, []);

  function applyVerifiedRoutingAddress(
    address: string,
    lat: number,
    lon: number,
    clientId?: string
  ) {
    setForm((f) => ({
      ...f,
      newAppt: {
        ...f.newAppt,
        address,
        lat,
        lon,
        ...(clientId ? { clientId } : {}),
      },
    }));
    setRoutingAddressFields(addressFieldsFromRoutingCoords(address, lat, lon));
    setAddressError(null);
  }

  function applyPickClient(c: Client, opts?: { alternateAddress?: string | null }) {
    const alt = opts?.alternateAddress?.trim();
    const addr = alt || formatClientAddress(c);
    linkedClientHomeAddressRef.current = formatClientAddress(c);
    const latNum = alt ? undefined : parseCoordinate(c.lat);
    const lonNum = alt ? undefined : parseCoordinate(c.lon);
    const clientId = String(c.id);

    const fields = alt ? addressFieldsFromFreeText(alt) : addressFieldsFromClient(c, addr);
    setRoutingAddressFields(fields);

    setClientQuery(`${c.lastName}, ${c.firstName}`);
    setClientResults([]);
    setShowClientDropdown(false);
    setSelectedClientAlerts((c as any).alerts ?? null);

    if (!addr.trim()) {
      setForm((f) => ({
        ...f,
        newAppt: {
          ...f.newAppt,
          clientId,
          address: '',
          lat: undefined,
          lon: undefined,
        },
      }));
      setAddressError(
        'This client has no address on file. Enter a routable visit address below.'
      );
      return;
    }

    if (!alt && latNum != null && lonNum != null) {
      applyVerifiedRoutingAddress(addr, latNum, lonNum, clientId);
      return;
    }

    setForm((f) => ({
      ...f,
      newAppt: {
        ...f.newAppt,
        clientId,
        address: addr,
        lat: undefined,
        lon: undefined,
      },
    }));
    setAddressError(null);
  }

  function pickClient(
    c: Client,
    opts?: { alternateAddress?: string | null; skipAlternateConfirm?: boolean }
  ) {
    if (lockQueueClient) {
      const anchorClientId =
        readRoutingForwardBookingIntent()?.clientId?.trim() ||
        readRoutingAppointmentRequestIntent()?.clientId?.trim();
      if (anchorClientId && String(c.id) !== anchorClientId) return;
    }
    if (!opts?.skipAlternateConfirm) {
      const clientHome = formatClientAddress(c);
      const alternateToPreserve = routingClientPickWouldReplaceAlternate({
        currentFormAddress: form.newAppt.address,
        intent: readRoutingRescheduleIntent(),
        clientHomeAddress: clientHome,
        explicitAlternateOpt: opts?.alternateAddress,
        pickingClientId: String(c.id),
      });
      if (alternateToPreserve && clientHome) {
        setClientPickAlternateConfirm({
          client: c,
          alternateAddress: alternateToPreserve,
          clientHomeAddress: clientHome,
        });
        setShowClientDropdown(false);
        return;
      }
    }
    applyPickClient(c, opts);
  }
  pickClientRef.current = pickClient;

  function pickDoctor(d: Doctor) {
    const pimsId = doctorPimsIdOf(d);
    if (!pimsId) {
      console.warn('No pimsId on doctor record', d);
      return;
    }
    setDoctorRequiredBeforeApptType(false);
    setForm((f) => ({ ...f, doctorId: pimsId }));
    setDoctorQuery(localDoctorDisplayName(d));
    setDoctorResults([]);
    setShowDoctorDropdown(false);
  }

  function requiresDoctorForCalculateTime(): boolean {
    // ASAP / multi-doctor Calculate Time averages across doctors — no single doctor required.
    return !asapAllDoctorSearch && !multiDoctor;
  }

  function promptDoctorBeforeApptType() {
    if (!requiresDoctorForCalculateTime()) return;
    setDoctorRequiredBeforeApptType(true);
    const input = doctorBoxRef.current?.querySelector('input');
    if (input instanceof HTMLInputElement) input.focus();
  }

  function diffDaysInclusive(aISO: string, bISO: string) {
    const a = new Date(aISO + 'T00:00:00');
    const b = new Date(bISO + 'T00:00:00');
    const ms = b.getTime() - a.getTime();
    const days = Math.floor(ms / (1000 * 60 * 60 * 24));
    return days + 1;
  }

    async function submitRoutingRequest(
    endpoint: string,
    doctorIdsArray?: string[],
    opts?: {
      skipZoneConfirm?: boolean;
      skipHouseholdConfirm?: boolean;
      asapAllDoctorSearch?: boolean;
      /** When set (e.g. after multi-doctor modal confirm), overrides form minutes for this search. */
      serviceMinutesOverride?: number;
    }
  ) {
    const isAsapSearch = asapAllDoctorSearch || opts?.asapAllDoctorSearch === true;
    setResultsSortedByDateTime(isAsapSearch);
    if (isAsapSearch) setAsapResultsSortMode('datetime');
    setError(null);
    setResult(null);
    setAddressError(null);
    setFeedbackSubmittingKey(null);
    setFeedbackSuccessKey(null);
    setFeedbackToast(null);
    setFeedbackError(null);
    setScheduleBookedKeys({});

    const clientTypeConflict = getRoutingClientTypeConflictMessage();
    if (clientTypeConflict) {
      setError(clientTypeConflict);
      return;
    }

    if (routingCalendarDatePart(form.endDate) < routingCalendarDatePart(form.startDate)) {
      setError('End date must be on or after the start date.');
      return;
    }

    // Ensure we have coords; if not, validate typed address to street-level.
    let newApptPayload = { ...form.newAppt };
    if (
      typeof opts?.serviceMinutesOverride === 'number' &&
      Number.isFinite(opts.serviceMinutesOverride) &&
      opts.serviceMinutesOverride >= 1
    ) {
      newApptPayload = {
        ...newApptPayload,
        serviceMinutes: Math.round(opts.serviceMinutesOverride),
      };
    }
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

    const routingTypeId = routingRequestAppointmentTypeId();
    if (routingTypeId != null) {
      newApptPayload = { ...newApptPayload, appointmentTypeId: routingTypeId };
    }

    let cachedZone = addressZoneRef.current;
    const lookupAddr = (newApptPayload.address ?? '').trim();
    if (lookupAddr && !cachedZone) {
      try {
        cachedZone = await lookupClientZoneForAddress(lookupAddr);
        addressZoneRef.current = cachedZone;
        setAddressZone(cachedZone);
      } catch {
        /* zone badge is optional */
      }
    }

    const doctorPimsIdsForZoneCheck =
      multiDoctor && doctorIdsArray && doctorIdsArray.length > 0
        ? doctorIdsArray
        : form.doctorId.trim()
          ? [form.doctorId.trim()]
          : [];

    if (!opts?.skipZoneConfirm && !isAsapSearch && doctorPimsIdsForZoneCheck.length > 0) {
      try {
        const zoneCheck = await findDoctorsNotAssignedToClientZone({
          address: lookupAddr,
          lat:
            typeof newApptPayload.lat === 'number' && Number.isFinite(newApptPayload.lat)
              ? newApptPayload.lat
              : undefined,
          lon:
            typeof newApptPayload.lon === 'number' && Number.isFinite(newApptPayload.lon)
              ? newApptPayload.lon
              : undefined,
          doctorPimsIds: doctorPimsIdsForZoneCheck,
          zoneId: cachedZone?.zoneId ?? undefined,
          zoneLabel: cachedZone?.shortLabel,
          startDate: form.startDate,
          endDate: form.endDate,
          practiceTz: DEFAULT_PRACTICE_TIMEZONE,
        });
        if (zoneCheck.issues.length > 0) {
          setZoneWorkConfirm({
            message: formatDoctorZoneConfirmMessage(zoneCheck.issues, doctorNames),
            proceed: () => {
              void submitRoutingRequest(endpoint, doctorIdsArray, { skipZoneConfirm: true });
            },
          });
          return;
        }
      } catch (zoneErr) {
        console.warn('Routing zone assignment check failed', zoneErr);
      }
    }

    const isV2 = endpoint.includes('/v2');
    const { startDate: routingStartDate, endDate: routingEndDate, numDays } =
      isV2
        ? adjustRoutingSlotSearchDates(
            form.startDate,
            form.endDate,
            DEFAULT_PRACTICE_TIMEZONE
          )
        : {
            startDate: form.startDate,
            endDate: form.endDate,
            numDays: diffRoutingDaysInclusive(
              form.startDate,
              form.endDate,
              DEFAULT_PRACTICE_TIMEZONE
            ),
          };

    if (!opts?.skipHouseholdConfirm) {
      const clientId = householdVisitClientId;
      if (clientId) {
        setCheckingHouseholdVisits(true);
        try {
          const conflicts = await fetchRoutingHouseholdVisitConflicts(
            routingStartDate,
            routingEndDate,
          );
          if (conflicts.length > 0) {
            applyHouseholdVisitBanner(clientId, conflicts);
            const alreadyAcked = isRoutingHouseholdVisitAcked(clientId);
            // Alternatives: staff already knows about the current booking — badge is enough.
            const skipBlockingModal =
              Boolean(readRoutingRescheduleIntent()?.exploreAlternatives);
            if (!alreadyAcked && !skipBlockingModal) {
              householdVisitLastFocusRef.current = null;
              setHouseholdVisitConfirm({
                conflicts,
                blocking: true,
                proceed: () => {
                  void submitRoutingRequest(endpoint, doctorIdsArray, {
                    skipZoneConfirm: opts?.skipZoneConfirm,
                    skipHouseholdConfirm: true,
                    asapAllDoctorSearch: opts?.asapAllDoctorSearch,
                  });
                },
              });
              return;
            }
          } else {
            setHouseholdVisitBanner((prev) => (prev?.clientId === clientId ? null : prev));
          }
        } catch (householdErr) {
          console.warn('Routing household visit check failed', householdErr);
        } finally {
          setCheckingHouseholdVisits(false);
        }
      }
    }

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
      startDate: routingStartDate,
      ...(isV2 ? { endDate: routingEndDate } : {}),
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

    let payload: any;
    if (isV2) {
      // v2 endpoint supports new multi-doctor format
      if (doctorIdsArray && doctorIdsArray.length > 0) {
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

    if (isV2) {
      const rescheduleContext = buildRoutingRescheduleContextForSlotSearch(
        readRoutingRescheduleIntent(),
        routingStartDate,
        routingEndDate
      );
      if (rescheduleContext) {
        payload = { ...payload, rescheduleContext };
      }
    }

    setLoading(true);
    try {
      const { data } = await http.post<Result>(endpoint, payload);
      const normalized = normalizeRoutingV2SlotSearchResponse(
        data as RoutingV2SlotSearchResult
      ) as Result;
      setResult(normalized);
      setEtaWindowWarningsByOptionKey({});
      setFeedbackSuccessKey(null);
      setScheduleBookedKeys({});
      setFeedbackError(null);
      setFeedbackToast(null);
      const rid = deriveRoutingRequestId(normalized);
      if (rid) rememberRoutingRequestId(rid);
      const ri = readRoutingRescheduleIntent();
      if (ri) {
        const baseline = resolveRescheduleOriginalVisitForCompare(
          normalized.rescheduleOriginalBooking,
          ri.appointmentId,
          ri
        );
        if (!baseline?.found) {
          void fetchAndCacheRescheduleSourcePlacementSnapshot(ri).then(() => {
            setSourceScoreTick((n) => n + 1);
          });
        }
      }
    } catch (err: unknown) {
      setError(extractErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  // Validate form before submission
  function validateForm(): { valid: boolean; error?: string } {
    if (!asapAllDoctorSearch && (!form.doctorId || !form.doctorId.trim())) {
      return { valid: false, error: 'Please select a doctor.' };
    }

    if (!form.startDate) {
      return { valid: false, error: 'Please select a start date.' };
    }

    if (!form.endDate) {
      return { valid: false, error: 'Please select an end date.' };
    }

    const startCal = routingCalendarDatePart(form.startDate);
    const endCal = routingCalendarDatePart(form.endDate);
    if (endCal < startCal) {
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

    const clientTypeConflict = getRoutingClientTypeConflictMessage();
    if (clientTypeConflict) {
      return { valid: false, error: clientTypeConflict };
    }

    return { valid: true };
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();

    if (hasActiveRoutingCalendarPreview()) {
      clearRoutingCalendarPreview();
      window.dispatchEvent(new Event(ROUTING_CALENDAR_PREVIEW_UPDATED_EVENT));
    }

    // Validate form first
    const validation = validateForm();
    if (!validation.valid) {
      setError(validation.error || 'Please fill in all required fields.');
      return;
    }

    const endpoint = '/routing/v2';

    if (asapAllDoctorSearch) {
      setPendingEndpoint(endpoint);
      setPendingAsapAllDoctorSearch(true);
      setShowDoctorSelectionModal(true);
      return;
    }

    if (multiDoctor) {
      setPendingEndpoint(endpoint);
      setShowDoctorSelectionModal(true);
      return;
    }
    await submitRoutingRequest(endpoint);
  }

  useEffect(() => {
    if (!showDoctorSelectionModal) return;

    let alive = true;
    void (async () => {
      setProvidersLoading(true);
      setDoctorSelectNearestZoneNote(null);
      try {
        const lat = form.newAppt.lat;
        const lon = form.newAppt.lon;
        const address = (form.newAppt.address ?? '').trim();
        const appointmentTypeId = resolveScheduleBookTypeId();
        const { providers: veterinarians, clientZoneLabel } =
          await fetchVeterinariansForDoctorSelect({
            address,
            lat: typeof lat === 'number' && Number.isFinite(lat) ? lat : undefined,
            lon: typeof lon === 'number' && Number.isFinite(lon) ? lon : undefined,
            appointmentTypeId: appointmentTypeId ?? undefined,
          });
        if (!alive) return;

        setDoctorSelectClientZoneLabel(clientZoneLabel);
        setDoctorSelectNearestZoneNote(null);

        const providersWithPims: RoutingDoctorPick[] = veterinarians.map((v) => {
          const pimsId = v.pimsId ? String(v.pimsId) : String(v.id);
          return {
            id: v.id,
            name: v.name?.trim() || buildDoctorName(v, `Veterinarian ${v.id ?? ''}`),
            email: v.email || '',
            pimsId,
            seeingClients: v.seeingClientsInClientZone === true,
            acceptingNewPatients: v.acceptingNewPatientsInClientZone === true,
            transitioningOutOfClientZone: v.transitioningOutOfClientZone === true,
            acceptsAppointmentType: v.acceptsSelectedAppointmentType !== false,
          };
        });

        const sorted = sortDoctorSelectProviders(providersWithPims);
        setAllProviders(sorted);

        const zoneDefaultIds = sorted
          .filter(isDefaultDoctorSelectChecked)
          .map((p) => p.pimsId)
          .filter(Boolean);

        let defaultSelectedIds = zoneDefaultIds;
        const stored = readStoredDoctorSelection();
        if (
          stored &&
          storedDoctorSelectionMatchesContext(stored, clientZoneLabel, appointmentTypeId)
        ) {
          const validPimsIds = sorted.map((p) => p.pimsId).filter(Boolean);
          const fromStorage = stored.doctorIds.filter((id) => validPimsIds.includes(id));
          if (fromStorage.length > 0) defaultSelectedIds = fromStorage;
        }

        setSelectedDoctorIds(defaultSelectedIds);
      } catch (err) {
        console.error('Failed to fetch providers:', err);
        if (!alive) return;
        setError('Failed to load doctors. Please try again.');
      } finally {
        if (alive) setProvidersLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [showDoctorSelectionModal]);

  function toggleDoctorSelection(doctorId: string) {
    setSelectedDoctorIds((prev) =>
      prev.includes(doctorId) ? prev.filter((id) => id !== doctorId) : [...prev, doctorId]
    );
  }

  function handleCancelDoctorSelection() {
    setShowDoctorSelectionModal(false);
    setPendingEndpoint(null);
    setPendingAsapAllDoctorSearch(false);
    setSelectedDoctorIds([]);
  }

  async function handleConfirmDoctorSelection() {
    if (selectedDoctorIds.length === 0) {
      setError('Please select at least one doctor.');
      return;
    }

    const validation = validateForm();
    if (!validation.valid) {
      setError(validation.error || 'Please fill in all required fields.');
      setShowDoctorSelectionModal(false);
      setPendingEndpoint(null);
      setPendingAsapAllDoctorSearch(false);
      return;
    }

    try {
      localStorage.setItem(
        SELECTED_DOCTORS_STORAGE_KEY,
        JSON.stringify({
          doctorIds: selectedDoctorIds,
          zoneLabel: doctorSelectClientZoneLabel,
          appointmentTypeId: resolveScheduleBookTypeId(),
        } satisfies StoredDoctorSelection),
      );
    } catch {
      /* ignore */
    }

    const wasAsap = pendingAsapAllDoctorSearch;
    setShowDoctorSelectionModal(false);
    const endpoint = pendingEndpoint || '/routing/v2';
    setPendingEndpoint(null);
    setPendingAsapAllDoctorSearch(false);

    // Re-average Calculate Time minutes across the doctors included in this search,
    // unless the user already typed a Minutes override (keep their value for the search).
    let serviceMinutesOverride: number | undefined;
    const typeKey = routingApptStatsTypeKey.trim();
    const preserveManualMinutes = shouldPreserveManualRoutingMinutes(
      routingMinutesManualOverrideRef.current
    );
    if (!preserveManualMinutes && typeKey && selectedDoctorIds.length > 0) {
      try {
        const rows = await fetchAveragedApptLengthStatsForDoctors(selectedDoctorIds);
        setApptLengthsRows(rows);
        const baseMins = estimateRoutingServiceMinutesForSelection(
          typeKey,
          routingPetCount,
          rows,
          routingAppointmentTypeForStatsKey
        );
        if (baseMins != null) {
          const newPatientCount =
            activeAppointmentRequestIntent?.pets?.filter((pet) => !pet.patientPimsId?.trim())
              .length ?? 0;
          const averaged = applyRoutingServiceMinuteBuffers(baseMins, {
            newPatientCount,
            numPets: routingPetCount,
          });
          serviceMinutesOverride = resolveServiceMinutesAfterDoctorConfirm({
            minutesManuallyOverridden: false,
            averagedServiceMinutes: averaged,
          });
          if (serviceMinutesOverride != null) {
            setForm((f) => ({
              ...f,
              newAppt: { ...f.newAppt, serviceMinutes: serviceMinutesOverride! },
            }));
          }
        }
      } catch {
        /* keep prior minutes */
      }
    }

    await submitRoutingRequest(endpoint, selectedDoctorIds, {
      skipZoneConfirm: wasAsap,
      asapAllDoctorSearch: wasAsap,
      serviceMinutesOverride,
    });
  }

  // =========================
  // Build unified options
  // =========================

  const displayOptions: UnifiedOption[] = useMemo(() => {
    const rows: UnifiedOption[] = [];
    const requestIdFromResult = result?.routingRequestId ?? latestRoutingRequestId ?? undefined;
    const topForSingleDoctor = result ? routingTopCandidatesFromResult(result) : [];

    // Helper for displayInsertionIndex calculation
    const isEmptyDay = (x: any) =>
      Boolean(x?.dayIsEmpty || x?._emptyDay || x?.flags?.includes?.('EMPTY'));

    // Sort function: by score (lowest first)
    const sortByScore = (a: UnifiedOption, b: UnifiedOption) => {
      const aScore = typeof a.score === 'number' ? a.score : Number.POSITIVE_INFINITY;
      const bScore = typeof b.score === 'number' ? b.score : Number.POSITIVE_INFINITY;
      return aScore - bScore;
    };

    const optionStartMs = (opt: UnifiedOption): number => {
      const iso = opt.suggestedStartIso ?? opt.arrivalWindow?.windowStartIso;
      if (!iso) return Number.POSITIVE_INFINITY;
      const dt = DateTime.fromISO(iso);
      return dt.isValid ? dt.toMillis() : Number.POSITIVE_INFINITY;
    };

    const sortByDateTime = (a: UnifiedOption, b: UnifiedOption) => {
      const diff = optionStartMs(a) - optionStartMs(b);
      if (diff !== 0) return diff;
      return sortByScore(a, b);
    };

    const sortRows =
      resultsSortedByDateTime && asapResultsSortMode === 'datetime' ? sortByDateTime : sortByScore;

    if (result?.doctors?.length) {
      // Multi-doctor mode: flatten all doctors' top slots
      for (const d of result.doctors) {
        const pid = d.pimsId;
        const name = d.name || doctorNames[pid] || `Doctor ${pid}`;
        const doctorTop = d.top || [];
        for (const w of doctorTop)
          rows.push({
            ...w,
            doctorPimsId: pid,
            doctorName: name,
            routingRequestId: w.routingRequestId ?? requestIdFromResult,
            candidateIndex: resolveRoutingCandidateIndex(w, doctorTop),
          });
      }
      rows.sort(sortRows);
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
          candidateIndex: resolveRoutingCandidateIndex(result.winner, topForSingleDoctor),
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
            candidateIndex: resolveRoutingCandidateIndex(w, topForSingleDoctor),
          });
        }
      }
      
      // Combine winner and alternates, then sort all by score (lowest first)
      if (winnerOption) {
        rows.push(winnerOption);
      }
      rows.push(...alternateOptions);

      if (rows.length === 0) {
        const flatCandidates = routingTopCandidatesFromResult(result);
        for (const w of flatCandidates) {
          const candidate = w as Winner;
          const docInfo = getDoctorInfo(candidate);
          rows.push({
            ...candidate,
            doctorPimsId: docInfo.pid,
            doctorName: docInfo.name,
            routingRequestId:
              (candidate as { routingRequestId?: string }).routingRequestId ?? requestIdFromResult,
            candidateIndex: resolveRoutingCandidateIndex(candidate, flatCandidates),
          });
        }
      }

      rows.sort(sortRows);
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
        candidateIndex:
          r.candidateIndex ?? resolveRoutingCandidateIndex(r, topForSingleDoctor),
      };
    });
  }, [
    multiDoctor,
    result,
    doctorNames,
    form.doctorId,
    latestRoutingRequestId,
    resultsSortedByDateTime,
    asapResultsSortMode,
  ]);

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

  const depotLookupKey = useMemo(
    () =>
      displayOptions
        .map((o) => `${String(o.doctorPimsId ?? '').trim()}:${String(o.date ?? '').slice(0, 10)}`)
        .filter((k) => !k.startsWith(':') && !k.endsWith(':'))
        .sort()
        .join('|'),
    [displayOptions]
  );

  useEffect(() => {
    if (!depotLookupKey) {
      setEndDepotByDoctorDate({});
      return;
    }
    let cancelled = false;
    const pairs = depotLookupKey.split('|').filter(Boolean);
    void (async () => {
      const next: Record<string, string> = {};
      for (const pair of pairs) {
        const sep = pair.lastIndexOf(':');
        const pims = pair.slice(0, sep);
        const date = pair.slice(sep + 1);
        if (!pims || !date) continue;
        try {
          let internalId = doctorIdByPims[pims];
          if (!internalId) {
            const { data } = await http.get(`/employees/pims/${encodeURIComponent(pims)}`);
            const resolved = data?.id != null ? String(data.id) : '';
            if (!resolved) continue;
            internalId = resolved;
            if (!cancelled) {
              setDoctorIdByPims((m) => (m[pims] ? m : { ...m, [pims]: resolved }));
            }
          }
          const day = await fetchDoctorDay(date, internalId);
          const end = typeof day.endDepotTime === 'string' ? day.endDepotTime.trim() : '';
          if (end) next[pair] = end;
        } catch {
          /* keep search results usable if doctor-day fails */
        }
      }
      if (!cancelled) setEndDepotByDoctorDate(next);
    })();
    return () => {
      cancelled = true;
    };
    // doctorIdByPims is read for cache only; listing it would refetch after each pims resolve.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [depotLookupKey]);

  // =========================
  // Render
  // =========================

  const routingClientTypeConflictMessage = getRoutingClientTypeConflictMessage();

  return (
    <div
      ref={routingPageRootRef}
      className={[
        'routing-page-root',
        stackFormAndResults ? 'routing-page-root--stack-columns' : '',
        calendarWorkspaceMode ? 'routing-page-root--calendar-workspace' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {/* ------- Form ------- */}
      <div className="card routing-route-form-card">
        <div className="routing-route-form-header">
          <h2 className="routing-route-form-title">Get Best Route</h2>
          {hasActiveRescheduleIntent ? (
            <span className="routing-reschedule-mode-badge">
              {exploreAlternativesMode ? 'Alternatives' : 'Rescheduling'}
            </span>
          ) : hasActiveForwardBookingWorkspace ? (
            <span className="routing-forward-booking-mode-badge">Forward booking</span>
          ) : hasActiveAppointmentRequestWorkspace ? (
            <span className="routing-forward-booking-mode-badge">Appointment request</span>
          ) : null}
        </div>
        {hasActiveRescheduleIntent && rescheduleModeSummary ? (
          <p className="routing-reschedule-mode-summary muted" role="status">
            {rescheduleModeSummary}
          </p>
        ) : null}
        {hasActiveForwardBookingWorkspace && activeForwardBookingIntent ? (
          <ForwardBookingWorkspaceContextPanel
            intent={activeForwardBookingIntent}
            practiceTz={DEFAULT_PRACTICE_TIMEZONE}
          />
        ) : null}
        {hasActiveAppointmentRequestWorkspace && activeAppointmentRequestIntent ? (
          <div className="routing-forward-booking-mode-summary">
            <AppointmentRequestRoutingSummary intent={activeAppointmentRequestIntent} />
            <div className="routing-forward-booking-mode-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={exitAppointmentRequestWorkspace}
              >
                Exit appointment request
              </button>
            </div>
          </div>
        ) : null}
        <form
          onSubmit={onSubmit}
          className={[
            'routing-form-stack',
            'routing-route-form-stack',
            calendarWorkspaceMode ? 'routing-route-form-stack--workspace' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <div
            className={[
              'routing-form-body',
              calendarWorkspaceMode ? '' : 'routing-form-body--inline',
            ]
              .filter(Boolean)
              .join(' ')}
          >
          {/* Date range — first so it stays visible on mobile (results stack below the full form). */}
          <Field label="Date">
            <div className="routing-date-range-row">
              <input
                className="date routing-date-input"
                type="date"
                value={form.startDate}
                onChange={(e) => onChange('startDate', e.target.value)}
                required
              />
              <span className="routing-date-range-sep" aria-hidden="true">
                →
              </span>
              <input
                className="date routing-date-input"
                type="date"
                value={form.endDate}
                onChange={(e) => onChange('endDate', e.target.value)}
                required
              />
            </div>
          </Field>

          <label className="routing-asap-all-doctor-search">
            <input
              type="checkbox"
              checked={asapAllDoctorSearch}
              onChange={(e) => {
                const checked = e.target.checked;
                setAsapAllDoctorSearch(checked);
                if (checked) setReserveOption('reserve-only');
              }}
            />
            <span>ASAP All Doctors In Zone Search</span>
          </label>
          {/* Doctor picker — hidden when searching all doctors */}
          {!asapAllDoctorSearch ? (
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
                    className={[
                      'input',
                      doctorRequiredBeforeApptType ? 'routing-input--error' : '',
                      routingPrefillFlashClass('doctor'),
                      routingWorkspaceHighlightClass('doctor'),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    style={{ width: '100%', boxSizing: 'border-box' }}
                    value={doctorQuery}
                    onChange={(e) => {
                      setDoctorQuery(e.target.value);
                      setDoctorActiveIdx(-1);
                      if (doctorRequiredBeforeApptType) setDoctorRequiredBeforeApptType(false);
                    }}
                    placeholder="Type doctor name..."
                    aria-invalid={doctorRequiredBeforeApptType}
                    aria-describedby={
                      doctorRequiredBeforeApptType ? 'routing-doctor-required-hint' : undefined
                    }
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
                    required={!asapAllDoctorSearch && !multiDoctor}
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
            {doctorRequiredBeforeApptType ? (
              <p
                id="routing-doctor-required-hint"
                className="routing-doctor-required-hint"
                role="alert"
              >
                You must pick a doctor first before picking an appointment type or number of pets.
              </p>
            ) : null}
          </div>
          ) : null}

          {/* Calculate time: bordered type + pets; minutes on next line */}
          <div className="routing-visit-field routing-calculate-time-field">
            <div id="routing-calculate-time-legend" className="routing-calculate-time-box-legend">
              Calculate Time (optional)
            </div>
            <div
              role="group"
              className="routing-calculate-time-box"
              aria-labelledby="routing-calculate-time-legend"
            >
              <div className="routing-calculate-time-box-inner">
                {appointmentRequestPerPetRouting ? (
                  <div className="routing-calculate-time-type-stack">
                    <span className="routing-visit-stack-label muted">Appointment types</span>
                    <p
                      className={`routing-calculate-time-per-pet-note muted${routingPrefillFlashClass('apptType')}${routingPrefillFlashClass('pets')}`}
                      role="status"
                    >
                      Per pet from request — see summary above.
                    </p>
                  </div>
                ) : (
                <label className="routing-calculate-time-type-stack" htmlFor="routing-visit-type-select">
                  <span className="routing-visit-stack-label muted">Appointment Type</span>
                  <select
                    id="routing-visit-type-select"
                    className={`input routing-input-compact routing-visit-type-select${routingPrefillFlashClass('apptType')}${routingWorkspaceHighlightClass('apptType')}${
                      routingClientTypeConflictMessage ? ' routing-input--error' : ''
                    }`}
                    disabled={apptLengthsLoading}
                    aria-invalid={Boolean(routingClientTypeConflictMessage)}
                    value={routingApptStatsTypeKey}
                    onMouseDown={(e) => {
                      if (requiresDoctorForCalculateTime() && !form.doctorId.trim()) {
                        e.preventDefault();
                        promptDoctorBeforeApptType();
                      }
                    }}
                    onFocus={() => {
                      if (requiresDoctorForCalculateTime() && !form.doctorId.trim()) {
                        promptDoctorBeforeApptType();
                      }
                    }}
                    onChange={(e) => {
                      if (requiresDoctorForCalculateTime() && !form.doctorId.trim()) {
                        promptDoctorBeforeApptType();
                        return;
                      }
                      const next = e.target.value;
                      // Changing type clears a typed Minutes override so autofill can run.
                      routingMinutesManualOverrideRef.current = false;
                      setRoutingApptStatsTypeKey(next);
                      if (!next.trim()) {
                        setRoutingPetCount(1);
                        setScheduleBookTypeId(null);
                        routingCalcComboKeyRef.current = null;
                      } else {
                        const matched = routingAppointmentTypeForStatsKey(next);
                        if (matched?.id != null) setScheduleBookTypeId(Number(matched.id));
                        applyRoutingServiceMinutes(next, routingPetCount, { pulse: true });
                      }
                    }}
                  >
                    <option value="">Select type…</option>
                    {routingApptTypePickerOptions.map((opt) => (
                      <option key={opt.typeName} value={opt.typeName}>
                        {opt.typeName}
                      </option>
                    ))}
                  </select>
                </label>
                )}
                <label className="routing-visit-stack" htmlFor="routing-visit-pets">
                  <span
                    className="routing-visit-stack-label muted"
                    title="Optional. Used with appointment type to estimate minutes."
                  >
                    Pets
                  </span>
                  <input
                    id="routing-visit-pets"
                    className={`input routing-input-compact routing-pet-input${routingPrefillFlashClass('pets')}`}
                    type="number"
                    min={1}
                    inputMode="numeric"
                    readOnly={patientsDrivePetCount}
                    disabled={
                      patientsDrivePetCount ||
                      (!appointmentRequestPerPetRouting &&
                        Boolean(form.doctorId.trim()) &&
                        !routingApptStatsTypeKey.trim())
                    }
                    title={
                      patientsDrivePetCount
                        ? 'Patient selection sets how many pets are included.'
                        : !form.doctorId.trim()
                          ? undefined
                          : appointmentRequestPerPetRouting || routingApptStatsTypeKey.trim()
                            ? undefined
                            : 'Select an appointment type to set the number of pets.'
                    }
                    value={
                      appointmentRequestPerPetRouting || routingApptStatsTypeKey.trim()
                        ? patientsDrivePetCount
                          ? selectedRoutingPatientIds.length
                          : routingPetCount
                        : ''
                    }
                    onMouseDown={(e) => {
                      if (patientsDrivePetCount) return;
                      if (requiresDoctorForCalculateTime() && !form.doctorId.trim()) {
                        e.preventDefault();
                        promptDoctorBeforeApptType();
                      }
                    }}
                    onFocus={() => {
                      if (patientsDrivePetCount) return;
                      if (requiresDoctorForCalculateTime() && !form.doctorId.trim()) {
                        promptDoctorBeforeApptType();
                      }
                    }}
                    onChange={(e) => {
                      if (patientsDrivePetCount) return;
                      if (requiresDoctorForCalculateTime() && !form.doctorId.trim()) {
                        promptDoctorBeforeApptType();
                        return;
                      }
                      // Changing pets clears a typed Minutes override so autofill can run.
                      routingMinutesManualOverrideRef.current = false;
                      const raw = e.target.value;
                      if (raw === '') {
                        setRoutingPetCount(1);
                        applyRoutingServiceMinutes(routingApptStatsTypeKey, 1, { pulse: true });
                        return;
                      }
                      const v = Math.floor(Number(raw));
                      const nextPets = Number.isFinite(v) && v >= 1 ? v : 1;
                      setRoutingPetCount(nextPets);
                      applyRoutingServiceMinutes(routingApptStatsTypeKey, nextPets, { pulse: true });
                    }}
                  />
                </label>
              </div>
            </div>
            <div className="routing-calculate-time-minutes-row">
              <label className="routing-calculate-time-minutes-stack" htmlFor="routing-visit-mins">
                <span
                  className="routing-calculate-time-minutes-heading muted"
                  title="Service length in minutes—auto-filled from type and pets, or type to override."
                >
                  Minutes
                </span>
                <input
                  id="routing-visit-mins"
                  className={`input routing-input-compact routing-mins-line-input${
                    routingMinutesPulse ? ' routing-minutes-flash--active' : ''
                  }${routingPrefillFlashClass('minutes')}${routingWorkspaceHighlightClass('minutes')}`}
                  aria-label="Service minutes"
                    title="Auto-filled when you pick a type and pets, or enter minutes here to override."
                    type="number"
                  min={1}
                  inputMode="numeric"
                  value={form.newAppt.serviceMinutes}
                  onChange={(e) => onNewApptChange('serviceMinutes', Number(e.target.value))}
                />
              </label>
            </div>
            {(form.doctorId.trim() || asapAllDoctorSearch || multiDoctor) &&
            routingAppointmentTypes.length === 0 ? (
              <div className="muted routing-route-hint">
                No routable appointment types are configured (client or alternate address allowed, not
                excluded from routing).
              </div>
            ) : (form.doctorId.trim() || asapAllDoctorSearch || multiDoctor) &&
              apptLengthsLoading &&
              routingApptTypePickerOptions.length === 0 ? (
              <div className="muted routing-route-hint">
                {asapAllDoctorSearch || multiDoctor
                  ? 'Loading average appointment times across doctors…'
                  : 'Loading appointment types…'}
              </div>
            ) : (form.doctorId.trim() || asapAllDoctorSearch || multiDoctor) && apptLengthsError ? (
              <div className="danger routing-route-hint">{apptLengthsError}</div>
            ) : null}
          </div>

          {/* Client */}
          <Field label="Client">
              <div ref={clientBoxRef} style={{ position: 'relative' }}>
                <input
                  className={`input${routingPrefillFlashClass('client')}${routingWorkspaceHighlightClass('client')}${
                    routingClientTypeConflictMessage ? ' routing-input--error' : ''
                  }${lockQueueClient ? ' routing-input--locked' : ''}`}
                  value={clientQuery}
                  aria-invalid={Boolean(routingClientTypeConflictMessage)}
                  readOnly={lockQueueClient}
                  disabled={lockQueueClient}
                  onChange={(e) => {
                    if (lockQueueClient) return;
                    const next = e.target.value;
                    setClientQuery(next);
                    setClientActiveIdx(-1);
                    setSelectedClientAlerts(null);
                    if (!next.trim()) {
                      linkedClientHomeAddressRef.current = null;
                      setRoutingAddressFields(EMPTY_ADDRESS_FIELDS);
                      setForm((f) => ({
                        ...f,
                        newAppt: {
                          ...f.newAppt,
                          clientId: undefined,
                          address: '',
                          lat: undefined,
                          lon: undefined,
                        },
                      }));
                    }
                  }}
                  placeholder={
                    lockForwardBookingClient
                      ? 'Client locked for forward booking'
                      : lockAppointmentRequestClient
                        ? 'Client locked for appointment request'
                        : 'Type last name...'
                  }
                  onFocus={() => {
                    if (lockQueueClient) return;
                    clientResults.length && setShowClientDropdown(true);
                  }}
                  onKeyDown={(e) => {
                    if (lockQueueClient) return;
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

                {clientSearching && !lockQueueClient && (
                  <div className="muted" style={{ marginTop: 6 }}>
                    Searching...
                  </div>
                )}

                {!lockQueueClient && showClientDropdown && clientResults.length > 0 && (
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
              {lockQueueClient ? (
                <p className="muted routing-route-hint routing-forward-booking-client-lock-hint">
                  {lockForwardBookingClient
                    ? 'Client is fixed for this forward booking. Use Exit forward booking to choose a different client.'
                    : 'Client is fixed for this appointment request. Use Exit appointment request to choose a different client.'}
                </p>
              ) : null}
            </Field>
            {form.newAppt.clientId ? (
              <RoutingClientPatientsList
                clientId={form.newAppt.clientId}
                practiceId={ROUTING_PRACTICE_ID}
                practiceTz={DEFAULT_PRACTICE_TIMEZONE}
                selectedPatientIds={selectedRoutingPatientIdSet}
                onTogglePatientSelect={onToggleRoutingPatientSelect}
                onPatientsLoaded={onRoutingClientPatientsLoaded}
              />
            ) : appointmentRequestStaticPatients?.length ? (
              <RoutingClientPatientsList
                clientId={null}
                staticPatients={appointmentRequestStaticPatients}
                practiceId={ROUTING_PRACTICE_ID}
                practiceTz={DEFAULT_PRACTICE_TIMEZONE}
                selectedPatientIds={selectedRoutingPatientIdSet}
                onTogglePatientSelect={onToggleRoutingPatientSelect}
                onPatientsLoaded={onRoutingClientPatientsLoaded}
              />
            ) : null}
            {routingClientTypeConflictMessage ? (
              <div className="danger routing-route-hint routing-span-full" role="alert">
                {routingClientTypeConflictMessage}
              </div>
            ) : null}

          <Field label="Address">
            <div className="routing-address-field">
              <div className="routing-address-row">
                <div
                  className={`routing-address-autocomplete-wrap${routingPrefillFlashClass('address')}${routingWorkspaceHighlightClass('address')}`}
                >
                  <AddressAutocomplete
                    value={routingAddressFields}
                    onChange={onRoutingAddressFieldsChange}
                    error={addressError ?? undefined}
                    placeholder="Start typing the visit address"
                    inputClassName="input routing-address-input routing-address-autocomplete-input"
                    showConfirmedMessage={false}
                    compact
                  />
                </div>
                {routingAddressVerified ? (
                  <span className="routing-address-inline-ok" title="Address verified">
                    ✓
                  </span>
                ) : null}
              </div>
              {!routingAddressVerified && (form.newAppt.address ?? '').trim() ? (
                <p className="routing-address-zone-line muted">
                  Pick an address from the list or fix the address so routing can find coordinates.
                </p>
              ) : null}
              {routingAddressVerified && addressZoneLoading ? (
                <p className="routing-address-zone-line routing-address-zone-line--loading muted">
                  Looking up zone…
                </p>
              ) : null}
              {routingAddressVerified && !addressZoneLoading && addressZone ? (
                <div
                  className={[
                    'routing-address-zone-line',
                    addressZone.isOutOfServiceArea ? 'routing-address-zone-line--oosa' : '',
                    doctorZoneWarning ? 'routing-address-zone-line--doctor-mismatch' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  title={
                    addressZone.isOutOfServiceArea
                      ? 'Out of service area — choose doctors manually via Best fit across doctors'
                      : doctorZoneWarning
                        ? doctorZoneWarning.status === 'transitioning_out'
                          ? `${doctorZoneWarningMessage} You can still route — you will be asked to confirm.`
                          : `${selectedDoctorDisplayName} is not assigned to this zone in Settings. You can still route — you will be asked to confirm.`
                        : 'Service zone for this address'
                  }
                >
                  <span className="routing-address-zone-label">{addressZone.displayLabel}</span>
                  {!addressZone.isOutOfServiceArea && doctorZoneWarning ? (
                    <span className="routing-address-zone-warn">{doctorZoneWarningMessage}</span>
                  ) : null}
                </div>
              ) : null}
              {routingAddressVerified &&
              !addressZoneLoading &&
              !addressZone &&
              !addressError ? (
                <p className="routing-address-zone-line muted">No zone found for this address.</p>
              ) : null}
            </div>
            {addressError ? <div className="danger routing-route-hint">{addressError}</div> : null}
          </Field>

          {!clientSearching && selectedClientAlerts && selectedClientAlerts.trim() && (
            <div className="routing-client-alert-banner">
              <strong>Client alert:</strong> {selectedClientAlerts}
            </div>
          )}

          <Field label="Reserve handling">
            <div className="routing-radio-stack">
              <label
                className={`routing-radio-row${reserveOption === null ? ' routing-radio-row--active' : ''}`}
              >
                <input
                  type="radio"
                  name="routing-reserve"
                  checked={reserveOption === null}
                  onChange={() => setReserveOption(null)}
                />
                <span>Protect reserve (default)</span>
              </label>
              <label
                className={`routing-radio-row routing-radio-row--caution${
                  reserveOption === 'reserve-only' ? ' routing-radio-row--active' : ''
                }`}
              >
                <input
                  type="radio"
                  name="routing-reserve"
                  checked={reserveOption === 'reserve-only'}
                  onChange={() => setReserveOption('reserve-only')}
                />
                <span>Use Reserve</span>
              </label>
              <label
                className={`routing-radio-row routing-radio-row--caution${
                  reserveOption === 'reserve-overflow' ? ' routing-radio-row--active' : ''
                }`}
              >
                <input
                  type="radio"
                  name="routing-reserve"
                  checked={reserveOption === 'reserve-overflow'}
                  onChange={() => setReserveOption('reserve-overflow')}
                />
                <span>Use Reserve and Allow Overflow</span>
              </label>
            </div>
          </Field>

          {/* Scheduling preferences (collapsed by default) */}
          <div className="routing-prefs-accordion">
            <button
              type="button"
              className="routing-prefs-accordion-trigger"
              aria-expanded={schedulingPrefsOpen}
              aria-controls="routing-scheduling-prefs-panel"
              id="routing-scheduling-prefs-heading"
              onClick={() => setSchedulingPrefsOpen((o) => !o)}
            >
              <span className="routing-prefs-accordion-title">Scheduling Preferences</span>
              <span className="routing-prefs-accordion-chevron" aria-hidden="true">
                {schedulingPrefsOpen ? '▾' : '▸'}
              </span>
            </button>

            <div
              id="routing-scheduling-prefs-panel"
              role="region"
              aria-labelledby="routing-scheduling-prefs-heading"
              className="routing-prefs-accordion-panel"
              hidden={!schedulingPrefsOpen}
            >
              <div className="routing-prefs-accordion-panel-inner">
                <div className="routing-prefs-block">
                  <div className="routing-field-label">Provider preference</div>
                  <div className="routing-radio-stack">
                    <label
                      className={`routing-radio-row${!multiDoctor ? ' routing-radio-row--active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="routing-provider-pref"
                        checked={!multiDoctor}
                        onChange={() => setMultiDoctor(false)}
                      />
                      <span>
                        {doctorQuery.trim()
                          ? `${doctorQuery.trim()} only`
                          : 'This doctor only'}
                      </span>
                    </label>
                    <label
                      className={`routing-radio-row${multiDoctor ? ' routing-radio-row--active' : ''}`}
                      style={multiDoctor ? ROUTING_PREF_CHECKED_LABEL : undefined}
                    >
                      <input
                        type="radio"
                        name="routing-provider-pref"
                        checked={multiDoctor}
                        onChange={() => setMultiDoctor(true)}
                      />
                      <span>Best fit across doctors</span>
                    </label>
                  </div>
                </div>

                <div className="routing-prefs-block">
                  <div className="routing-field-label">Preferred day</div>
                  <div className="routing-weekday-chips" role="group" aria-label="Preferred days">
                    {ROUTING_WEEKDAY_CHIPS.map(({ n, label, title }) => {
                      const on = preferredWeekday.includes(n);
                      return (
                        <button
                          key={n}
                          type="button"
                          title={title}
                          className={`routing-weekday-chip${on ? ' routing-weekday-chip--selected' : ''}`}
                          aria-pressed={on}
                          aria-label={title}
                          onClick={() => {
                            setPreferredWeekday((cur) => {
                              if (cur.includes(n)) return cur.filter((d) => d !== n);
                              return [...cur, n].sort((a, b) => a - b);
                            });
                          }}
                        >
                          {label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="muted routing-route-hint routing-route-hint--tight">
                    Optional. Pick one or more days.
                  </div>
                </div>

                <div className="routing-prefs-block">
                  <div className="routing-field-label">Preferred time</div>
                  <div className="routing-radio-stack">
                    <label
                      className={`routing-radio-row${
                        preferredTimeOfDay === null || preferredTimeOfDay === 'middle'
                          ? ' routing-radio-row--active'
                          : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="routing-time-pref"
                        checked={preferredTimeOfDay === null || preferredTimeOfDay === 'middle'}
                        onChange={() => setPreferredTimeOfDay(null)}
                      />
                      <span>Any</span>
                    </label>
                    <label
                      className={`routing-radio-row${
                        preferredTimeOfDay === 'first' ? ' routing-radio-row--active' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="routing-time-pref"
                        checked={preferredTimeOfDay === 'first'}
                        onChange={() => setPreferredTimeOfDay('first')}
                      />
                      <span>Early</span>
                    </label>
                    <label
                      className={`routing-radio-row${
                        preferredTimeOfDay === 'end' ? ' routing-radio-row--active' : ''
                      }`}
                    >
                      <input
                        type="radio"
                        name="routing-time-pref"
                        checked={preferredTimeOfDay === 'end'}
                        onChange={() => setPreferredTimeOfDay('end')}
                      />
                      <span>End of day</span>
                    </label>
                  </div>
                </div>

                <div className="routing-prefs-block routing-prefs-block--subtle">
                  <label className="routing-force-earliest">
                    <input
                      type="checkbox"
                      checked={preferEarliestFeasibleStart}
                      onChange={(e) => setPreferEarliestFeasibleStart(e.target.checked)}
                    />
                    <span>Force earliest available</span>
                  </label>
                  <div className="muted routing-route-hint routing-route-hint--tight">
                    May reduce routing efficiency.
                  </div>
                </div>
              </div>
            </div>
          </div>
          </div>

          {error && <div className="danger">{error}</div>}
          {householdVisitBanner &&
          householdVisitBanner.conflicts.length > 0 &&
          householdVisitBanner.clientId === householdVisitClientId ? (
            <button
              type="button"
              className="routing-household-visits-flag"
              disabled={checkingHouseholdVisits}
              onClick={() => void openHouseholdVisitReview()}
            >
              <span className="routing-household-visits-flag-icon" aria-hidden>
                ⚠
              </span>
              <span className="routing-household-visits-flag-text">
                {householdVisitBanner.conflicts.length === 1
                  ? '1 other household visit scheduled'
                  : `${householdVisitBanner.conflicts.length} other household visits scheduled`}
                {' — '}
                <span className="routing-household-visits-flag-link">Review</span>
              </span>
            </button>
          ) : null}
          <div className="routing-submit-row">
            <button
              className="btn routing-submit-btn"
              type="submit"
              disabled={loading || Boolean(routingClientTypeConflictMessage)}
              title={
                routingClientTypeConflictMessage
                  ? routingClientTypeConflictMessage
                  : undefined
              }
            >
              {loading ? 'Calculating…' : 'Get Best Route'}
            </button>
          </div>
        </form>
      </div>

      {/* ------- Results ------- */}
      <div className="card routing-results-card">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: result ? 6 : 0,
          }}
        >
          <h3 style={{ marginTop: 0, marginBottom: 0 }}>
            {result
              ? resultsSortedByDateTime
                ? asapResultsSortMode === 'datetime'
                  ? 'Results (earliest first)'
                  : 'Results (lower score is better)'
                : hasActiveRescheduleIntent
                  ? 'Results (lower score is better — vs. original booking)'
                  : 'Results (lower score is better)'
              : 'Results'}
          </h3>
          {result && resultsSortedByDateTime ? (
            <button
              type="button"
              className="btn secondary routing-asap-results-sort-btn"
              onClick={() =>
                setAsapResultsSortMode((mode) => (mode === 'datetime' ? 'score' : 'datetime'))
              }
            >
              {asapResultsSortMode === 'datetime'
                ? 'Sort by Score (Preferred)'
                : 'Sort by Date & Time'}
            </button>
          ) : null}
          {rescheduleOriginalScoreSummaryLine ? (
            <p className="routing-reschedule-original-score-summary muted" style={{ margin: 0, fontSize: 12 }}>
              {rescheduleOriginalScoreSummaryLine}
            </p>
          ) : null}
        </div>

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
                const apiOverrunSec = coerceOverrunSeconds(opt.overrunSeconds) ?? 0;
                const budgetOverrunSec =
                  endOfDayOverrunSeconds(
                    {
                      workStartLocal: opt.workStartLocal,
                      effectiveEndLocal: opt.effectiveEndLocal,
                      bookedServiceSeconds: opt.bookedServiceSeconds,
                      projectedDriveSeconds: opt.projectedDriveSeconds,
                      currentDriveSeconds: opt.currentDriveSeconds,
                      addedDriveSeconds: opt.addedDriveSeconds,
                    },
                    form.newAppt.serviceMinutes
                  ) ?? 0;
                const reconciledOverrunSec = coerceOverrunSeconds(
                  etaWindowWarningsByOptionKey[optionKey]?.reconciledOverrunSeconds
                ) ?? 0;
                const depotKey = `${String(opt.doctorPimsId ?? '').trim()}:${String(opt.date ?? '').slice(0, 10)}`;
                const calendarEndHms = endDepotByDoctorDate[depotKey];
                const apiEndHms = opt.effectiveEndLocal ?? opt.depotEndLocal ?? opt.workEndLocal;
                const startPastEndSec =
                  startPastWorkdayEndSeconds(
                    opt.suggestedStartIso,
                    calendarEndHms || apiEndHms
                  ) ?? 0;
                const shiftOverrunSec = Math.max(
                  apiOverrunSec,
                  budgetOverrunSec,
                  reconciledOverrunSec,
                  startPastEndSec
                );
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
                const visitTimeDisplay = routingResultVisitTimeLabel(
                  opt,
                  form.newAppt.serviceMinutes
                );
                const visitWindowNonDefault =
                  !visitTimeDisplay.zeroWidthWindow && routingVisitWindowDiffersFromDefault60(opt);

                const isCalendarPreviewCard =
                  calendarWorkspaceMode &&
                  activeCalendarPreviewOptionKey != null &&
                  activeCalendarPreviewOptionKey === optionKey;

                const hasRoutingPlacementTarget =
                  (Number.isFinite(form.newAppt.lat as number) &&
                    Number.isFinite(form.newAppt.lon as number)) ||
                  Boolean(form.newAppt.clientId?.trim());
                const appointmentTypesReady =
                  routingAppointmentTypes.length > 0 || scheduleBookTypeId != null;
                const patientsDrivePetCount =
                  routingClientPatients.length > 0 && selectedRoutingPatientIds.length > 0;
                const viewPlacementDisabled =
                  !hasRoutingPlacementTarget ||
                  !appointmentTypesReady;
                const viewPlacementTitle = !hasRoutingPlacementTarget
                  ? 'Enter and verify an address, or select a client'
                  : !appointmentTypesReady
                    ? 'Loading appointment types…'
                    : hasActiveRescheduleIntent
                      ? 'View placement on the practice calendar to reschedule this visit'
                      : 'View placement on the practice calendar';

                const scoreHeaderLabel =
                  typeof opt.score === 'number'
                    ? hasActiveRescheduleIntent
                      ? rescheduleScoreHeaderSuffix(opt.score, rescheduleOriginalVisitForCompare)
                      : `(Score: ${Number.isInteger(opt.score) ? String(opt.score) : opt.score.toFixed(2)})`
                    : null;
                const providerLabel = opt.doctorName?.trim() || null;
                const showHighScoreWarning =
                  typeof opt.score === 'number' &&
                  Number.isFinite(opt.score) &&
                  opt.score >= ROUTING_HIGH_SCORE_WARNING_THRESHOLD;

                return (
                  <button
                    key={`${opt.doctorPimsId}-${opt.date}-${opt.insertionIndex}-${idx}`}
                    type="button"
                    data-routing-calendar-preview-card={optionKey}
                    className={[
                      'card',
                      'routing-result-option-card',
                      isCalendarPreviewCard ? 'routing-result-option-card--calendar-preview' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    disabled={viewPlacementDisabled}
                    title={viewPlacementDisabled ? viewPlacementTitle : undefined}
                    aria-label={viewPlacementTitle}
                    onClick={() => {
                      void openMyWeek(opt);
                    }}
                    style={{
                      position: 'relative',
                      ...(isEarlierFeasibleEmptyDay && !isCalendarPreviewCard
                        ? {
                            backgroundColor: '#fefce8',
                            border: '1px solid #fde68a',
                            boxSizing: 'border-box',
                          }
                        : {}),
                    }}
                  >
                    {(providerLabel || scoreHeaderLabel) && (
                      <div
                        className="routing-result-option-card-header"
                        style={{
                          background: `linear-gradient(135deg, ${headerColor}, ${headerColor}cc)`,
                        }}
                      >
                        {providerLabel ? (
                          <div className="routing-result-option-card-header-provider">{providerLabel}</div>
                        ) : null}
                        {showHighScoreWarning ? (
                          <div
                            className="routing-result-option-card-header-warning"
                            role="status"
                          >
                            {ROUTING_HIGH_SCORE_WARNING_MESSAGE}
                          </div>
                        ) : null}
                        {(scoreHeaderLabel || providerLabel) && (
                          <div className="routing-result-option-card-header-meta">
                            {scoreHeaderLabel ? (
                              <span className="routing-result-option-card-header-score">{scoreHeaderLabel}</span>
                            ) : (
                              <span className="routing-result-option-card-header-score" aria-hidden="true" />
                            )}
                            <span className="routing-result-option-card-header-icon">
                              <DoctorIcon />
                            </span>
                          </div>
                        )}
                      </div>
                    )}

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
                          fontSize: Math.round(14 * ROUTING_RESULT_FONT_SCALE),
                          fontWeight: 700,
                        }}
                      >
                        Appointment booked
                      </div>
                    )}

                    <div style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      <SlotChip slot={opt.slot ?? null} />
                      {hasActiveRescheduleIntent &&
                      routingOptionIsSameDayAsReschedule(
                        opt.date,
                        activeRescheduleIntent,
                        DEFAULT_PRACTICE_TIMEZONE
                      ) ? (
                        <SameDayChip />
                      ) : null}
                      <EdgeChip first={opt.isFirstEdge} last={opt.isLastEdge} />
                    </div>

                    {(() => {
                      const etaRow = etaWindowWarningsByOptionKey[optionKey];
                      const etaReconciled = etaRow
                        ? {
                            hasAnyWarning: etaRow.hasWindowWarning,
                            warningStopCount: etaRow.warningStopCount,
                            candidateHasWarning: etaRow.candidateHasWarning,
                          }
                        : null;
                      const windowWarningMessage = routingCardWindowWarningMessage(
                        routingCardWindowWarningReasons(opt, etaReconciled)
                      );
                      if (!windowWarningMessage) return null;
                      return (
                        <div
                          style={{
                            marginBottom: 8,
                            padding: '8px 12px',
                            borderRadius: 8,
                            background: '#fef3c7',
                            border: '1px solid #f59e0b',
                            color: '#92400e',
                            fontSize: Math.round(13 * ROUTING_RESULT_FONT_SCALE),
                            fontWeight: 600,
                          }}
                        >
                          {windowWarningMessage}
                        </div>
                      );
                    })()}

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
                          <ScoutDayStatBadges row={metricsRow} embedded dense />
                          <ScoutZoneAwareDiagnosticsRow
                            row={opt}
                            hideZoneClass
                            variant="inline"
                            dense
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
                                <ScoutDayStatBadges row={gap} embedded dense />
                                <ScoutZoneAwareDiagnosticsRow
                                  row={gap}
                                  hideZoneClass={Boolean(
                                    routingZoneAwareResultsBanner?.zoneClassRaw
                                  )}
                                  variant="inline"
                                  dense
                                />
                              </div>
                              {scoutPreservedAnchorZonesStillNote(result?.scoutPreservedEmptyDayWeeks, {
                                scoutPreservedEmptyDayPenalty: gap.scoutPreservedEmptyDayPenalty,
                                doctorPimsId: opt.doctorPimsId,
                                date: opt.date,
                              })}
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
                        k={visitTimeDisplay.label}
                        v={
                          <strong
                            className={
                              visitWindowNonDefault
                                ? 'routing-visit-window--non-default'
                                : undefined
                            }
                          >
                            {visitTimeDisplay.timeText}
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

                    <div className="routing-result-option-card-placement-row">
                      <div className="routing-result-option-card-placement-actions">
                        {calendarWorkspaceMode &&
                        hasActiveRescheduleIntent &&
                        isCalendarPreviewCard ? (
                          <button
                            type="button"
                            className="btn secondary routing-result-option-card-placement-btn"
                            title="Back to where this visit is on the schedule now"
                            disabled={viewPlacementDisabled}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              focusRescheduleSourceOnCalendar();
                            }}
                          >
                            Back
                          </button>
                        ) : null}
                        <span className="btn secondary routing-result-option-card-placement-cta">
                          View Placement
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </Fragment>
        )}

      </div>

      {clientPickAlternateConfirm ? (
        <div
          className="routing-doctor-select-backdrop"
          role="presentation"
          onClick={() => setClientPickAlternateConfirm(null)}
        >
          <div
            className="routing-client-pick-alternate-modal"
            role="dialog"
            aria-modal
            aria-labelledby="routing-client-pick-alternate-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="routing-client-pick-alternate-title" className="routing-doctor-select-title">
              Change visit address?
            </h2>
            <p className="routing-client-pick-alternate-lead">
              Are you sure you want to change the address to the client&apos;s address, instead of
              using the alternate address &ldquo;{clientPickAlternateConfirm.alternateAddress}
              &rdquo;?
            </p>
            <p className="routing-client-pick-alternate-home muted">
              Client address: {clientPickAlternateConfirm.clientHomeAddress}
            </p>
            <div className="routing-doctor-select-actions">
              <button
                type="button"
                className="btn secondary"
                onClick={() => setClientPickAlternateConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  const pending = clientPickAlternateConfirm;
                  setClientPickAlternateConfirm(null);
                  if (pending) {
                    applyPickClient(pending.client, {
                      alternateAddress: pending.alternateAddress,
                    });
                  }
                }}
              >
                Keep alternate address
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => {
                  const pending = clientPickAlternateConfirm;
                  setClientPickAlternateConfirm(null);
                  if (pending) {
                    applyPickClient(pending.client);
                  }
                }}
              >
                Use client address
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <HouseholdScheduledVisitsWarningModal
        open={Boolean(householdVisitConfirm?.conflicts.length)}
        context="routing"
        reviewOnly={householdVisitConfirm?.blocking === false}
        clientLabel={clientQuery}
        conflicts={householdVisitConfirm?.conflicts ?? []}
        continuing={checkingHouseholdVisits || loading}
        dockInRoutingPanel={calendarWorkspaceMode}
        portalContainerRef={routingPageRootRef}
        onCancel={dismissHouseholdVisitConfirm}
        onPreviewPlacement={focusHouseholdConflictOnCalendar}
        onViewPlacement={focusHouseholdConflictOnCalendar}
        onContinue={
          householdVisitConfirm?.blocking
            ? () => {
                const pending = householdVisitConfirm;
                const clientId = householdVisitClientId;
                if (clientId) writeRoutingHouseholdVisitAck(clientId);
                unpinRoutingHouseholdVisitHighlight();
                setHouseholdVisitConfirm(null);
                pending?.proceed?.();
              }
            : undefined
        }
      />

      {zoneWorkConfirm ? (
        <div
          className="routing-doctor-select-backdrop"
          role="presentation"
          onClick={() => setZoneWorkConfirm(null)}
        >
          <div
            className="routing-client-pick-alternate-modal"
            role="dialog"
            aria-modal
            aria-labelledby="routing-zone-work-confirm-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="routing-zone-work-confirm-title" className="routing-doctor-select-title">
              Zone assignment
            </h2>
            <p className="routing-client-pick-alternate-lead">
              {zoneWorkConfirm.message}
            </p>
            <div className="routing-doctor-select-actions">
              <button type="button" className="btn secondary" onClick={() => setZoneWorkConfirm(null)}>
                No
              </button>
              <button
                type="button"
                className="btn routing-doctor-select-confirm"
                onClick={() => {
                  const pending = zoneWorkConfirm;
                  setZoneWorkConfirm(null);
                  pending?.proceed();
                }}
              >
                Yes
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showDoctorSelectionModal ? (
        <div
          className="routing-doctor-select-backdrop"
          role="presentation"
          onClick={handleCancelDoctorSelection}
        >
          <div
            className="routing-doctor-select-modal"
            role="dialog"
            aria-modal
            aria-labelledby="routing-doctor-select-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="routing-doctor-select-title" className="routing-doctor-select-title">
              Select Doctors
            </h2>
            <p className="routing-doctor-select-lead">
              Choose which doctors to include in the search. Your selections are saved for next time.
            </p>

            {doctorSelectNearestZoneNote ? (
              <p className="routing-doctor-select-nearest-zone" role="status">
                {doctorSelectNearestZoneNote}
              </p>
            ) : null}

            {providersLoading ? (
              <p className="routing-doctor-select-empty">Loading doctors…</p>
            ) : allProviders.length === 0 ? (
              <p className="routing-doctor-select-empty">
                {doctorSelectNearestZoneNote ?? 'No doctors found.'}
              </p>
            ) : (
              <div className="routing-doctor-select-list">
                {allProviders.map((provider) => {
                  const doctorId = provider.pimsId || String(provider.id);
                  const isSelected = selectedDoctorIds.includes(doctorId);
                  const inZoneSuffix = doctorSelectClientZoneLabel
                    ? ` in zone ${doctorSelectClientZoneLabel}`
                    : '';
                  return (
                    <label
                      key={doctorId}
                      className={`routing-doctor-select-row${
                        isSelected ? ' routing-doctor-select-row--selected' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleDoctorSelection(doctorId)}
                      />
                      <span className="routing-doctor-select-row-main">
                        <span className="routing-doctor-select-row-name">{provider.name}</span>
                        {provider.seeingClients ? (
                          <span className="routing-doctor-select-badge routing-doctor-select-badge--seeing">
                            {formatDoctorSelectSeeingClientsBadge({
                              zoneLabel: doctorSelectClientZoneLabel,
                              transitioningOut: provider.transitioningOutOfClientZone === true,
                            })}
                          </span>
                        ) : null}
                        {provider.acceptingNewPatients ? (
                          <span className="routing-doctor-select-badge routing-doctor-select-badge--accepting">
                            Accepting new patients{inZoneSuffix}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <div className="routing-doctor-select-actions">
              <button type="button" className="btn secondary" onClick={handleCancelDoctorSelection}>
                Cancel
              </button>
              <button
                type="button"
                className="btn routing-doctor-select-confirm"
                onClick={() => void handleConfirmDoctorSelection()}
                disabled={selectedDoctorIds.length === 0 || providersLoading}
              >
                Confirm ({selectedDoctorIds.length} selected)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
