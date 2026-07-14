/**
 * When the user chooses "Reschedule" from the practice calendar we stash client + appointment
 * metadata here so Routing can pre-fill the form and `/appointments/:id` is PATCHed after a new slot is chosen.
 */
import { DateTime } from 'luxon';
import type { NavigateFunction } from 'react-router-dom';
import type { RescheduleOriginalVisitSnapshot } from '../api/routing';
import type { Appointment, Client, Patient } from '../api/roomLoader';
import type { AppointmentType } from '../api/appointmentSettings';
import { buildGmailInboxReturnPath } from './routingAppointmentRequestIntent';
import {
  appointmentAlternateAddressText,
  appointmentHasAlternateLocation,
} from '../api/appointments';
import {
  appointmentTypeLabelFromRow as routingTypeLabelFromRow,
} from './routingCalculateTimeType';
import { practiceTimeZoneOrDefault } from './practiceTimezone';
import { ROUTING_DISMISS_RESCHEDULE_EVENT } from './routingUiSnapshot';
import { routingCalendarDatePart } from './routingSlotSearchDates';

/** POST `/routing/v2` — exclude slots near the visit being moved (server default ±120 min). */
export type RoutingRescheduleContextPayload = {
  appointmentIds: number[];
  originalStartIso: string;
  excludeWindowMinutes?: number;
};

export const ROUTING_RESCHEDULE_EXCLUDE_WINDOW_MINUTES_DEFAULT = 120;

export const ROUTING_RESCHEDULE_INTENT_STORAGE_KEY = 'vayd:routing-reschedule-intent-v1';

/** Same-tab notification (sessionStorage does not fire `storage`). */
export const ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT = 'vayd:routing-reschedule-intent-updated';

/** Source placement score cached on intent — does not refocus the calendar. */
export const ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT =
  'vayd:routing-reschedule-source-score-updated';

export type RoutingRescheduleScope = 'selected_pet' | 'household_day';

export type RescheduleSameDayVisit = {
  appointmentId: number;
  patientId: string;
  patientName?: string;
  appointmentTypeId?: number;
  appointmentTypeName?: string;
  description?: string | null;
};

/** Per-visit fields for the reschedule book modal (PATCH /appointments/:id). */
export type RescheduleVisitPatch = {
  appointmentId: number;
  patientId: string;
  patientName?: string;
  appointmentTypeId?: number;
  /** Display label from the visit row (not the routing settings type list). */
  appointmentTypeLabel?: string;
  /** Original scheduled slot on the practice calendar (date + time range, no "Was" prefix). */
  scheduledTimeLabel?: string;
  /** Original visit start (ISO) for staff-note audit on reschedule. */
  originalAppointmentStartIso?: string;
  description?: string | null;
  instructions?: string | null;
};

function appointmentTypeLabelFromRow(
  appt: Appointment | undefined,
  fallbackName?: string
): string {
  const at = appt?.appointmentType;
  return (
    pickStr(at?.prettyName) ??
    pickStr(at?.name) ??
    pickStr(fallbackName) ??
    '—'
  );
}

function scheduledTimeLabelFromAppt(appt: Appointment | undefined, practiceTz: string): string {
  if (!appt?.appointmentStart) return '—';
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return '—';
  const datePart = start.toFormat('EEEE, MMM d, yyyy');
  const end = appt.appointmentEnd
    ? DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(practiceTz)
    : null;
  if (end?.isValid) {
    return `${datePart} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
  }
  return `${datePart} · ${start.toFormat('h:mm a')}`;
}

export type RoutingRescheduleIntentV1 = {
  v: 1;
  /** After Routing merges client/visit into form, set true so we do not wipe user edits on re-render. */
  appliedToRoutingForm?: boolean;
  appointmentId: number;
  clientId: string;
  patientId: string;
  appointmentTypeId?: number;
  /** Display name for routing "Appointment Type" select (prettyName or name from PIMS). */
  appointmentTypeName?: string;
  /** Practice calendar day of the visit (`YYYY-MM-DD` in practice TZ). */
  practiceDateKey?: string;
  /** Anchor visit start in practice TZ (e.g. `2026-05-22T10:45:00.000-04:00`) for rescheduleContext. */
  originalStartIso?: string;
  /** Anchor visit end in practice TZ — used to score the visit at its current slot on the source doctor. */
  originalEndIso?: string;
  /** Score at the visit's current slot on the source doctor (for cross-doctor reschedule compare). */
  sourcePlacementVisitSnapshot?: RescheduleOriginalVisitSnapshot;
  /** Practice calendar provider dropdown (`Provider.id`) — routing search target; may differ from source while rescheduling. */
  primaryProviderInternalId?: string;
  /** Routing `form.doctorId` (doctor PIMS id) — search target while rescheduling. */
  primaryDoctorPimsId?: string;
  primaryDoctorDisplayName?: string;
  /** Original visit assignee — calendar stays here until a placement preview is opened. */
  sourceProviderInternalId?: string;
  sourceDoctorPimsId?: string;
  sourceDoctorDisplayName?: string;
  description?: string | null;
  instructions?: string | null;
  clientDisplayLabel?: string;
  serviceMinutes: number;
  /** Visit location when rescheduling a routing alternate stop (overrides client home). */
  address?: string;
  /** True when the visit being moved is at an alternate address, not client home. */
  isAlternateStop?: boolean;
  /** Stored alternate / routing stop text from the appointment row. */
  alternateAddressText?: string;
  lat?: number | null;
  lon?: number | null;
  /** Client alerts snippet for Routing hint row. */
  clientAlerts?: string | null;
  /** Pets on this household's calendar day (deduped by patient). */
  sameDayVisits?: RescheduleSameDayVisit[];
  /** Required on routing form when `sameDayVisits` has more than one patient. */
  rescheduleScope?: RoutingRescheduleScope;
  /** When set, exit navigates back to this Gmail thread instead of staying in routing. */
  returnToGmail?: {
    mailbox: string;
    threadId: string;
  };
  /** When set (e.g. reschedule opened from the Holds board), Dismiss returns here. */
  returnPath?: string;
  /**
   * "Explore alternatives" mode: keep the original appointment and CREATE a new one at the chosen
   * slot (instead of moving it). Search behaves like reschedule (score vs original + ±window
   * exclusion on the source provider), but confirming books a second appointment.
   */
  exploreAlternatives?: boolean;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function visitAddressFromAppointmentRow(appt: Appointment): string | null {
  const o = appt as Record<string, unknown>;
  const zip = pickStr(o.zip) ?? pickStr(o.zipcode);
  const parts = [
    pickStr(o.address1),
    [pickStr(o.city), pickStr(o.state)].filter(Boolean).join(', '),
    zip,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

/** Alternate visit text stored on reschedule intent (may differ from client home). */
export function rescheduleIntentAlternateAddress(
  intent: Pick<RoutingRescheduleIntentV1, 'isAlternateStop' | 'alternateAddressText' | 'address'> | null | undefined
): string | null {
  if (!intent?.isAlternateStop) return null;
  return intent.alternateAddressText?.trim() || intent.address?.trim() || null;
}

/** Alternate address to pass into the reschedule book modal from routing preview. */
export function resolveRoutingBookAlternateAddress(args: {
  hasLinkedClient: boolean;
  routingAddress?: string | null;
  intent?: RoutingRescheduleIntentV1 | null;
  previewUsesAlternateAddress?: boolean;
  sourceAppt?: Appointment | null;
}): string | undefined {
  const routingAddr = args.routingAddress?.trim();
  if (!args.hasLinkedClient) return routingAddr || undefined;

  const fromIntent = rescheduleIntentAlternateAddress(args.intent);
  if (fromIntent) return fromIntent;

  if (args.previewUsesAlternateAddress && routingAddr) return routingAddr;

  if (args.sourceAppt && appointmentHasAlternateLocation(args.sourceAppt)) {
    return (
      appointmentAlternateAddressText(args.sourceAppt)?.trim() ||
      visitAddressFromAppointmentRow(args.sourceAppt) ||
      routingAddr ||
      undefined
    );
  }

  return undefined;
}

export function rescheduleIntentUsesAlternateAddress(
  intent: Pick<RoutingRescheduleIntentV1, 'isAlternateStop' | 'alternateAddressText' | 'address'> | null | undefined
): boolean {
  return Boolean(intent?.isAlternateStop || rescheduleIntentAlternateAddress(intent));
}

function normalizeRoutingAddressForCompare(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/,\s*,+/g, ',')
    .replace(/\busa\b/gi, '')
    .replace(/[.,]/g, '')
    .trim();
}

export function routingAddressesMatch(a: string, b: string): boolean {
  const na = normalizeRoutingAddressForCompare(a);
  const nb = normalizeRoutingAddressForCompare(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/** Alternate routing stop currently on the form that should not be silently replaced by client home. */
export function routingFormAlternateAddressToPreserve(
  formAddress: string | undefined | null,
  intent: RoutingRescheduleIntentV1 | null | undefined
): string | null {
  const fromIntent = rescheduleIntentAlternateAddress(intent);
  if (fromIntent) return fromIntent;
  if (intent?.isAlternateStop && formAddress?.trim()) return formAddress.trim();
  return null;
}

/** When picking a client would overwrite an active alternate stop, return the alternate text to confirm. */
export function routingClientPickWouldReplaceAlternate(args: {
  currentFormAddress?: string | null;
  intent?: RoutingRescheduleIntentV1 | null;
  clientHomeAddress: string | null | undefined;
  explicitAlternateOpt?: string | null;
}): string | null {
  if (args.explicitAlternateOpt?.trim()) return null;
  const preserved = routingFormAlternateAddressToPreserve(args.currentFormAddress, args.intent);
  const home = args.clientHomeAddress?.trim();
  if (!preserved || !home) return null;
  if (routingAddressesMatch(preserved, home)) return null;
  return preserved;
}

export function rescheduleIntentIsActive(): boolean {
  return readRoutingRescheduleIntent() != null;
}

/** Full row for Routing prefill / book modal hydration. */
export function readRoutingRescheduleIntent(): RoutingRescheduleIntentV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(ROUTING_RESCHEDULE_INTENT_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as RoutingRescheduleIntentV1;
    if (o?.v !== 1 || typeof o.appointmentId !== 'number') return null;
    const hasClient = Boolean(o.clientId) && Boolean(o.patientId);
    const hasAddressOnly =
      Boolean(o.isAlternateStop) && Boolean(o.address?.trim() || o.alternateAddressText?.trim());
    if (!hasClient && !hasAddressOnly) return null;
    return o;
  } catch {
    return null;
  }
}

export function writeRoutingRescheduleIntent(
  next: Omit<RoutingRescheduleIntentV1, 'v' | 'appliedToRoutingForm'>
): void {
  if (typeof sessionStorage === 'undefined') return;
  const stored: RoutingRescheduleIntentV1 = {
    v: 1,
    appliedToRoutingForm: false,
    ...next,
  };
  try {
    sessionStorage.setItem(ROUTING_RESCHEDULE_INTENT_STORAGE_KEY, JSON.stringify(stored));
  } catch {
    /* quota */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT));
  }
}

/** Mark Routing form hydration done (intent row kept until successful PATCH). */
/** Cache source-doctor placement score without refocusing the practice calendar. */
export function patchRescheduleIntentSourcePlacementSnapshot(
  snapshot: RescheduleOriginalVisitSnapshot
): void {
  const cur = readRoutingRescheduleIntent();
  if (!cur) return;
  const next: RoutingRescheduleIntentV1 = { ...cur, sourcePlacementVisitSnapshot: snapshot };
  try {
    sessionStorage.setItem(ROUTING_RESCHEDULE_INTENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_RESCHEDULE_SOURCE_SCORE_UPDATED_EVENT));
  }
}

export function markRescheduleIntentAppliedToRoutingForm(): void {
  const cur = readRoutingRescheduleIntent();
  if (!cur) return;
  const next = { ...cur, appliedToRoutingForm: true };
  try {
    sessionStorage.setItem(ROUTING_RESCHEDULE_INTENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function writeRoutingRescheduleScope(scope: RoutingRescheduleScope): void {
  const cur = readRoutingRescheduleIntent();
  if (!cur) return;
  const next = { ...cur, rescheduleScope: scope };
  try {
    sessionStorage.setItem(ROUTING_RESCHEDULE_INTENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT));
  }
}

export function clearRoutingRescheduleIntent(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(ROUTING_RESCHEDULE_INTENT_STORAGE_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT));
  }
}

/** Exit reschedule mode from routing workspace calendar (clears highlight + routing form). */
export function dismissRoutingRescheduleWorkspace(): void {
  clearRoutingRescheduleIntent();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_DISMISS_RESCHEDULE_EVENT));
  }
}

export function returnFromRescheduleWorkspace(
  navigate: NavigateFunction,
  intent: RoutingRescheduleIntentV1 | null | undefined,
  opts?: { replace?: boolean },
): void {
  const gmail = intent?.returnToGmail;
  if (gmail?.mailbox?.trim() && gmail.threadId?.trim()) {
    navigate(buildGmailInboxReturnPath(gmail.mailbox, gmail.threadId), {
      replace: opts?.replace,
    });
    return;
  }
  const returnPath = intent?.returnPath?.trim();
  if (returnPath) {
    navigate(returnPath, { replace: opts?.replace });
    return;
  }
  navigate('/schedule/routing', { replace: opts?.replace });
}

function patientsForAppointment(a: Appointment): Patient[] {
  const multi = (a as { patients?: Patient[] }).patients;
  if (Array.isArray(multi) && multi.length > 0) return multi;
  return a.patient ? [a.patient] : [];
}

function patientDisplayName(p: Patient): string | undefined {
  const name = pickStr(p.name) ?? pickStr((p as { prettyName?: string }).prettyName);
  return name || (p.id != null ? `Pet #${p.id}` : undefined);
}

function isReschedulableCalendarRow(a: Appointment): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  if (a.allDay) return false;
  if ((a as { type?: string }).type === 'block') return false;
  if ((a as { isBlock?: boolean }).isBlock === true) return false;
  if ((a as { isPersonalBlock?: boolean }).isPersonalBlock === true) return false;
  const status = pickStr((a as { statusName?: string }).statusName)?.toLowerCase() ?? '';
  if (status === 'cancelled' || status === 'canceled') return false;
  return true;
}

/** Unique patients for this client on the same practice-calendar day as `sourceAppt`. */
export function collectSameDayHouseholdVisits(
  sourceAppt: Appointment,
  appointments: Appointment[],
  practiceTz = practiceTimeZoneOrDefault(undefined)
): RescheduleSameDayVisit[] {
  const c = sourceAppt.client as Client | undefined;
  if (!c?.id) return [];
  const clientId = String(c.id);
  const dayKey = DateTime.fromISO(sourceAppt.appointmentStart, { zone: 'utc' })
    .setZone(practiceTz)
    .toISODate();
  if (!dayKey) return [];

  const byPatient = new Map<string, RescheduleSameDayVisit>();

  for (const a of appointments) {
    if (!isReschedulableCalendarRow(a)) continue;
    if (a.client?.id == null || String(a.client.id) !== clientId) continue;
    const aDay = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz).toISODate();
    if (aDay !== dayKey) continue;
    if (typeof a.id !== 'number') continue;

    for (const p of patientsForAppointment(a)) {
      if (p.id == null) continue;
      const patientId = String(p.id);
      if (byPatient.has(patientId)) continue;
      const at = a.appointmentType;
      const rawTypeId = at?.id;
      const appointmentTypeId =
        rawTypeId != null && (typeof rawTypeId === 'number' || typeof rawTypeId === 'string')
          ? Number(rawTypeId)
          : undefined;
      byPatient.set(patientId, {
        appointmentId: a.id,
        patientId,
        patientName: patientDisplayName(p),
        appointmentTypeId: Number.isFinite(appointmentTypeId) ? appointmentTypeId : undefined,
        appointmentTypeName: appointmentTypeLabelFromRow(a),
        description: a.description ?? null,
      });
    }
  }

  return [...byPatient.values()].sort((a, b) =>
    (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    })
  );
}

/** Hydrate visit patches from calendar rows (type + description per pet). */
export function buildRescheduleVisitPatches(
  visits: RescheduleSameDayVisit[],
  rawAppointments: ReadonlyArray<Appointment>,
  practiceTz: string,
  overrideAppointmentTypeId?: number,
  appointmentTypesForLabel?: readonly AppointmentType[]
): RescheduleVisitPatch[] {
  const overrideTypeId =
    overrideAppointmentTypeId != null &&
    Number.isFinite(Number(overrideAppointmentTypeId)) &&
    visits.length <= 1
      ? Number(overrideAppointmentTypeId)
      : undefined;
  const overrideTypeLabel =
    overrideTypeId != null && appointmentTypesForLabel?.length
      ? routingTypeLabelFromRow(
          appointmentTypesForLabel.find((t) => Number(t.id) === overrideTypeId)
        )
      : null;
  return visits.map((v) => {
    const appt = rawAppointments.find((a) => a.id === v.appointmentId);
    const fromAppt = appt?.appointmentType?.id;
    const typeRaw = overrideTypeId ?? fromAppt ?? v.appointmentTypeId;
    const appointmentTypeId =
      typeRaw != null && (typeof typeRaw === 'number' || typeof typeRaw === 'string')
        ? Number(typeRaw)
        : undefined;
    return {
      appointmentId: v.appointmentId,
      patientId: v.patientId,
      patientName: v.patientName,
      appointmentTypeId: Number.isFinite(appointmentTypeId) ? appointmentTypeId : undefined,
      appointmentTypeLabel:
        (overrideTypeLabel ?? appointmentTypeLabelFromRow(appt, v.appointmentTypeName)) || '—',
      scheduledTimeLabel: scheduledTimeLabelFromAppt(appt, practiceTz),
      originalAppointmentStartIso: appt?.appointmentStart ?? undefined,
      description: appt?.description ?? v.description ?? null,
      instructions: appt?.instructions ?? null,
    };
  });
}

export function rescheduleRequiresScopeChoice(intent: RoutingRescheduleIntentV1 | null): boolean {
  return (intent?.sameDayVisits?.length ?? 0) > 1;
}

/** True when the slot-search date range includes the original visit calendar day. */
export function routingSlotSearchIncludesRescheduleDay(
  searchStartDate: string,
  searchEndDate: string,
  practiceDateKey: string | undefined
): boolean {
  const dayKey = practiceDateKey?.trim();
  if (!dayKey) return false;
  const startCal = routingCalendarDatePart(searchStartDate);
  const endCal = routingCalendarDatePart(searchEndDate);
  return dayKey >= startCal && dayKey <= endCal;
}

/**
 * Reschedule / Alternatives: default Get Best Route to ±7 days around the original visit day.
 * Clamps the start to today in practice TZ so past calendar days aren't searched.
 */
export function rescheduleIntentDefaultDateRange(
  intent: Pick<RoutingRescheduleIntentV1, 'practiceDateKey' | 'originalStartIso'>,
  practiceTz: string
): { startDate: string; endDate: string } | null {
  const fromKey = intent.practiceDateKey?.trim();
  const fromStart = intent.originalStartIso?.trim();
  let anchorIso: string | null = fromKey || null;
  if (!anchorIso && fromStart) {
    const local = DateTime.fromISO(fromStart, { zone: 'utc' }).setZone(practiceTz);
    if (local.isValid) anchorIso = local.toISODate();
  }
  if (!anchorIso) return null;
  const day = DateTime.fromISO(anchorIso, { zone: practiceTz }).startOf('day');
  if (!day.isValid) return null;
  const today = DateTime.now().setZone(practiceTz).startOf('day');
  if (!today.isValid) return null;
  const startCandidate = day.minus({ days: 7 });
  const start = startCandidate < today ? today : startCandidate;
  const end = day.plus({ days: 7 });
  const startDate = start.toISODate();
  const endDate = end.toISODate();
  if (!startDate || !endDate) return null;
  return { startDate, endDate };
}

/**
 * Build `rescheduleContext` for POST `/routing/v2` when moving existing visits.
 * Omit when the search range does not include the original appointment day.
 */
export function buildRoutingRescheduleContextForSlotSearch(
  intent: RoutingRescheduleIntentV1 | null,
  searchStartDate: string,
  searchEndDate: string
): RoutingRescheduleContextPayload | undefined {
  if (!intent) return undefined;
  const originalStartIso = intent.originalStartIso?.trim();
  if (!originalStartIso) return undefined;
  if (!routingSlotSearchIncludesRescheduleDay(searchStartDate, searchEndDate, intent.practiceDateKey)) {
    return undefined;
  }
  const { appointmentIds } = rescheduleScopeTargets(intent);
  if (appointmentIds.length === 0) return undefined;
  return {
    appointmentIds,
    originalStartIso,
  };
}

export function rescheduleScopeTargets(intent: RoutingRescheduleIntentV1): {
  appointmentIds: number[];
  patientId: string;
  visits: RescheduleSameDayVisit[];
} {
  const scope = intent.rescheduleScope ?? 'selected_pet';
  const visits = intent.sameDayVisits ?? [];
  if (scope === 'household_day' && visits.length > 0) {
    const appointmentIds = [...new Set(visits.map((v) => v.appointmentId))];
    return { appointmentIds, patientId: intent.patientId, visits };
  }
  const anchor =
    visits.find((v) => v.appointmentId === intent.appointmentId && v.patientId === intent.patientId) ??
    ({
      appointmentId: intent.appointmentId,
      patientId: intent.patientId,
    } satisfies RescheduleSameDayVisit);
  return {
    appointmentIds: [intent.appointmentId],
    patientId: intent.patientId,
    visits: [anchor],
  };
}

export type BuildRoutingRescheduleIntentOpts = {
  sameCalendarDayAppointments?: Appointment[];
  practiceTz?: string;
  /** Practice calendar providers (`/employees/providers`) — resolves routing `doctorId` when visit row omits `primaryProvider.pimsId`. */
  providers?: ReadonlyArray<{
    id: number | string;
    pimsId?: string | number | null;
    name?: string;
    firstName?: string | null;
    lastName?: string | null;
  }>;
  /**
   * Allow an address-only reschedule intent (empty client/patient) when the visit has no
   * linked client but carries a routing/alternate address — e.g. an on-hold visit placed by
   * address. Routing then searches by that address instead of a client home.
   */
  allowAddressOnly?: boolean;
  /** Build an "explore alternatives" intent — keep the original, create a new appointment. */
  exploreAlternatives?: boolean;
};

export type RescheduleIntentDoctorPims = {
  pimsId: string;
  displayName?: string;
};

function findRescheduleProviderRow(
  providers: ReadonlyArray<{
    id: number | string;
    pimsId?: string | number | null;
    name?: string;
    firstName?: string | null;
    lastName?: string | null;
  }>,
  internalId: string | undefined,
  pimsHint: string | undefined
) {
  const internal = internalId?.trim();
  if (internal) {
    const byInternal = providers.find((p) => String(p.id).trim() === internal);
    if (byInternal) return byInternal;
  }
  const pims = pimsHint?.trim();
  if (pims) {
    const byPims = providers.find((p) => String(p.pimsId ?? '').trim() === pims);
    if (byPims) return byPims;
    const byIdAsPims = providers.find((p) => String(p.id).trim() === pims);
    if (byIdAsPims) return byIdAsPims;
  }
  return null;
}

function displayNameFromProviderRow(
  intentDisplayName: string | undefined,
  match: {
    name?: string;
    firstName?: string | null;
    lastName?: string | null;
  }
): string | undefined {
  return (
    intentDisplayName?.trim() ||
    pickStr(match.name) ||
    [pickStr(match.firstName), pickStr(match.lastName)].filter(Boolean).join(' ').trim() ||
    undefined
  );
}

/**
 * Routing form `doctorId` (PIMS id) for the visit assignee.
 * Prefer practice-calendar provider row by internal assignee id — appointment `primaryProvider.pimsId` is often wrong.
 */
export function resolveRescheduleIntentDoctorPimsId(
  intent: Pick<
    RoutingRescheduleIntentV1,
    'primaryDoctorPimsId' | 'primaryProviderInternalId' | 'primaryDoctorDisplayName'
  >,
  providers: ReadonlyArray<{
    id: number | string;
    pimsId?: string | number | null;
    name?: string;
    firstName?: string | null;
    lastName?: string | null;
  }>
): RescheduleIntentDoctorPims | null {
  const intentDisplayName = intent.primaryDoctorDisplayName?.trim() || undefined;
  if (providers.length > 0) {
    const match = findRescheduleProviderRow(
      providers,
      intent.primaryProviderInternalId,
      intent.primaryDoctorPimsId
    );
    if (match) {
      const pimsId = pickStr(match.pimsId) ?? pickStr(match.id);
      if (pimsId) {
        return {
          pimsId,
          displayName: displayNameFromProviderRow(intentDisplayName, match),
        };
      }
    }
  }
  const direct = intent.primaryDoctorPimsId?.trim();
  if (direct) {
    return { pimsId: direct, displayName: intentDisplayName };
  }
  return null;
}

/** After resolving assignee doctor, persist corrected PIMS id on the intent row. */
export function patchRescheduleIntentDoctorPims(
  pimsId: string,
  displayName?: string,
  opts?: { notify?: boolean }
): void {
  const cur = readRoutingRescheduleIntent();
  if (!cur) return;
  const next: RoutingRescheduleIntentV1 = {
    ...cur,
    primaryDoctorPimsId: pimsId.trim(),
    ...(displayName?.trim() ? { primaryDoctorDisplayName: displayName.trim() } : {}),
  };
  try {
    sessionStorage.setItem(ROUTING_RESCHEDULE_INTENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  if (opts?.notify !== false && typeof window !== 'undefined') {
    window.dispatchEvent(new Event(ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT));
  }
}

export type RescheduleCalendarFocus = {
  anchorDate: string;
  providerFilter: string;
  viewMode: 'week';
};

/** Align embedded practice calendar with the visit being rescheduled (source doctor, not routing search target). */
export function rescheduleCalendarFocusFromIntent(
  intent: RoutingRescheduleIntentV1,
  providers: ReadonlyArray<{ id: number | string; pimsId?: string | number | null | undefined }>
): RescheduleCalendarFocus | null {
  const anchorDate = intent.practiceDateKey?.trim();
  if (!anchorDate) return null;

  let providerFilter = '';
  const internal =
    intent.sourceProviderInternalId?.trim() ?? intent.primaryProviderInternalId?.trim();
  if (internal && providers.some((p) => String(p.id) === internal)) {
    providerFilter = internal;
  } else {
    const pims = intent.sourceDoctorPimsId?.trim() ?? intent.primaryDoctorPimsId?.trim();
    if (pims) {
      const match = providers.find((p) => String(p.pimsId ?? '').trim() === pims);
      if (match) providerFilter = String(match.id);
    }
  }

  return { anchorDate, providerFilter, viewMode: 'week' };
}

/**
 * Address-only reschedule intent (no linked client/patient). Used for on-hold visits placed by
 * routing address — Routing searches by the visit address instead of a client home.
 */
function buildAddressOnlyRescheduleIntent(
  appt: Appointment,
  opts?: BuildRoutingRescheduleIntentOpts
): RoutingRescheduleIntentV1 | null {
  const addressText =
    appointmentAlternateAddressText(appt) ?? visitAddressFromAppointmentRow(appt);
  if (!addressText) return null;

  const start = DateTime.fromISO(appt.appointmentStart);
  const end = DateTime.fromISO(appt.appointmentEnd);
  const minutes =
    start.isValid && end.isValid ? Math.max(15, Math.round(end.diff(start, 'minutes').minutes)) : 45;

  const at = appt.appointmentType;
  const typeId = at?.id;
  const appointmentTypeId =
    typeId != null && (typeof typeId === 'number' || typeof typeId === 'string')
      ? Number(typeId)
      : undefined;
  const appointmentTypeName = pickStr(at?.prettyName) ?? pickStr(at?.name) ?? undefined;

  const pp = appt.primaryProvider;
  const pi = pp?.id;
  const primaryProviderInternalId =
    pi != null && Number.isFinite(Number(pi)) ? String(pi) : undefined;
  let primaryDoctorDisplayName =
    [pickStr(pp?.firstName), pickStr(pp?.lastName)].filter(Boolean).join(' ').trim() || undefined;
  let primaryDoctorPimsId = pickStr(pp?.pimsId) ?? undefined;
  if (opts?.providers?.length) {
    const resolved = resolveRescheduleIntentDoctorPimsId(
      { primaryDoctorPimsId, primaryProviderInternalId, primaryDoctorDisplayName },
      opts.providers
    );
    if (resolved) {
      primaryDoctorPimsId = resolved.pimsId;
      primaryDoctorDisplayName = resolved.displayName ?? primaryDoctorDisplayName;
    }
  }

  const practiceTz = opts?.practiceTz ?? practiceTimeZoneOrDefault(undefined);
  const startLocal = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const endLocal = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  const practiceDateKey = startLocal.isValid ? startLocal.toISODate() ?? undefined : undefined;
  const originalStartIso =
    startLocal.isValid ? startLocal.toISO({ includeOffset: true }) ?? undefined : undefined;
  const originalEndIso =
    endLocal.isValid ? endLocal.toISO({ includeOffset: true }) ?? undefined : undefined;

  const clientDisplayLabel = pickStr(appt.description) ?? undefined;

  return {
    v: 1,
    appointmentId: appt.id,
    practiceDateKey,
    originalStartIso,
    originalEndIso,
    clientId: '',
    patientId: '',
    appointmentTypeId: Number.isFinite(appointmentTypeId) ? appointmentTypeId : undefined,
    appointmentTypeName,
    primaryProviderInternalId,
    primaryDoctorPimsId,
    primaryDoctorDisplayName,
    sourceProviderInternalId: primaryProviderInternalId,
    sourceDoctorPimsId: primaryDoctorPimsId,
    sourceDoctorDisplayName: primaryDoctorDisplayName,
    description: appt.description ?? null,
    instructions: appt.instructions ?? null,
    clientDisplayLabel,
    serviceMinutes: minutes,
    isAlternateStop: true,
    alternateAddressText: addressText,
    address: addressText,
    rescheduleScope: 'selected_pet',
    ...(opts?.exploreAlternatives ? { exploreAlternatives: true } : {}),
  };
}

/** Build intent from scheduler appointment row + client for Routing + reschedule PATCH flow. */
export function buildRoutingRescheduleIntentFromAppointment(
  appt: Appointment,
  opts?: BuildRoutingRescheduleIntentOpts
): RoutingRescheduleIntentV1 | null {
  if (!appt || typeof appt.id !== 'number') return null;
  if ((appt as { type?: string }).type === 'block') return null;
  if ((appt as { isBlock?: boolean }).isBlock === true || (appt as { isPersonalBlock?: boolean }).isPersonalBlock === true)
    return null;

  const c = appt.client as Client | undefined;
  const patients = patientsForAppointment(appt);
  const p0 = patients[0];
  if (!c || c.id == null || !p0 || p0.id == null) {
    if (!opts?.allowAddressOnly) return null;
    return buildAddressOnlyRescheduleIntent(appt, opts);
  }

  const fn = pickStr(c.firstName) ?? '';
  const ln = pickStr(c.lastName) ?? '';
  const clientDisplayLabel = [fn, ln].filter(Boolean).join(' ').trim() || undefined;

  const start = DateTime.fromISO(appt.appointmentStart);
  const end = DateTime.fromISO(appt.appointmentEnd);
  const minutes =
    start.isValid && end.isValid ? Math.max(15, Math.round(end.diff(start, 'minutes').minutes)) : 45;

  const at = appt.appointmentType;
  const typeId = at?.id;
  const appointmentTypeId =
    typeId != null && (typeof typeId === 'number' || typeof typeId === 'string')
      ? Number(typeId)
      : undefined;
  const appointmentTypeName =
    pickStr(at?.prettyName) ?? pickStr(at?.name) ?? undefined;

  const pp = appt.primaryProvider;
  const pi = pp?.id;
  const primaryProviderInternalId =
    pi != null && Number.isFinite(Number(pi)) ? String(pi) : undefined;
  let primaryDoctorDisplayName =
    [pickStr(pp?.firstName), pickStr(pp?.lastName)].filter(Boolean).join(' ').trim() || undefined;
  let primaryDoctorPimsId = pickStr(pp?.pimsId) ?? undefined;
  if (opts?.providers?.length) {
    const resolved = resolveRescheduleIntentDoctorPimsId(
      {
        primaryDoctorPimsId,
        primaryProviderInternalId,
        primaryDoctorDisplayName,
      },
      opts.providers
    );
    if (resolved) {
      primaryDoctorPimsId = resolved.pimsId;
      primaryDoctorDisplayName = resolved.displayName ?? primaryDoctorDisplayName;
    }
  }

  const practiceTz = opts?.practiceTz ?? practiceTimeZoneOrDefault(undefined);
  const startLocal = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const endLocal = DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(practiceTz);
  const practiceDateKey = startLocal.isValid ? startLocal.toISODate() ?? undefined : undefined;
  const originalStartIso =
    startLocal.isValid ? startLocal.toISO({ includeOffset: true }) ?? undefined : undefined;
  const originalEndIso =
    endLocal.isValid ? endLocal.toISO({ includeOffset: true }) ?? undefined : undefined;
  const sameDayVisits = collectSameDayHouseholdVisits(
    appt,
    opts?.sameCalendarDayAppointments ?? [],
    practiceTz
  );

  const alternateAddressText =
    appointmentAlternateAddressText(appt) ?? visitAddressFromAppointmentRow(appt);
  const isAlternateStop = appointmentHasAlternateLocation(appt);

  return {
    v: 1,
    appointmentId: appt.id,
    practiceDateKey,
    originalStartIso,
    originalEndIso,
    clientId: String(c.id),
    patientId: String(p0.id),
    appointmentTypeId: Number.isFinite(appointmentTypeId) ? appointmentTypeId : undefined,
    appointmentTypeName,
    primaryProviderInternalId,
    primaryDoctorPimsId,
    primaryDoctorDisplayName,
    sourceProviderInternalId: primaryProviderInternalId,
    sourceDoctorPimsId: primaryDoctorPimsId,
    sourceDoctorDisplayName: primaryDoctorDisplayName,
    description: appt.description ?? null,
    instructions: appt.instructions ?? null,
    clientDisplayLabel,
    serviceMinutes: minutes,
    clientAlerts: pickStr(c.alerts),
    ...(isAlternateStop
      ? {
          isAlternateStop: true,
          ...(alternateAddressText
            ? { alternateAddressText, address: alternateAddressText }
            : {}),
        }
      : {}),
    sameDayVisits,
    rescheduleScope: sameDayVisits.length > 1 ? undefined : 'selected_pet',
    ...(opts?.exploreAlternatives ? { exploreAlternatives: true } : {}),
  };
}
