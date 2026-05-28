/**
 * When the user chooses "Reschedule" from the practice calendar we stash client + appointment
 * metadata here so Routing can pre-fill the form and `/appointments/:id` is PATCHed after a new slot is chosen.
 */
import { DateTime } from 'luxon';
import type { Appointment, Client, Patient } from '../api/roomLoader';
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
  description?: string | null;
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
  /** Practice calendar provider dropdown (`Provider.id`). */
  primaryProviderInternalId?: string;
  /** Routing `form.doctorId` (doctor PIMS id). */
  primaryDoctorPimsId?: string;
  primaryDoctorDisplayName?: string;
  description?: string | null;
  instructions?: string | null;
  clientDisplayLabel?: string;
  serviceMinutes: number;
  address?: string;
  lat?: number | null;
  lon?: number | null;
  /** Client alerts snippet for Routing hint row. */
  clientAlerts?: string | null;
  /** Pets on this household's calendar day (deduped by patient). */
  sameDayVisits?: RescheduleSameDayVisit[];
  /** Required on routing form when `sameDayVisits` has more than one patient. */
  rescheduleScope?: RoutingRescheduleScope;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
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
    if (o?.v !== 1 || typeof o.appointmentId !== 'number' || !o.clientId || !o.patientId) return null;
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
  practiceTz: string
): RescheduleVisitPatch[] {
  return visits.map((v) => {
    const appt = rawAppointments.find((a) => a.id === v.appointmentId);
    const fromAppt = appt?.appointmentType?.id;
    const typeRaw = fromAppt ?? v.appointmentTypeId;
    const appointmentTypeId =
      typeRaw != null && (typeof typeRaw === 'number' || typeof typeRaw === 'string')
        ? Number(typeRaw)
        : undefined;
    return {
      appointmentId: v.appointmentId,
      patientId: v.patientId,
      patientName: v.patientName,
      appointmentTypeId: Number.isFinite(appointmentTypeId) ? appointmentTypeId : undefined,
      appointmentTypeLabel: appointmentTypeLabelFromRow(appt, v.appointmentTypeName),
      scheduledTimeLabel: scheduledTimeLabelFromAppt(appt, practiceTz),
      description: appt?.description ?? v.description ?? null,
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

/** Align embedded practice calendar with the visit being rescheduled. */
export function rescheduleCalendarFocusFromIntent(
  intent: RoutingRescheduleIntentV1,
  providers: ReadonlyArray<{ id: number | string; pimsId?: string | number | null | undefined }>
): RescheduleCalendarFocus | null {
  const anchorDate = intent.practiceDateKey?.trim();
  if (!anchorDate) return null;

  let providerFilter = '';
  const internal = intent.primaryProviderInternalId?.trim();
  if (internal && providers.some((p) => String(p.id) === internal)) {
    providerFilter = internal;
  } else {
    const pims = intent.primaryDoctorPimsId?.trim();
    if (pims) {
      const match = providers.find((p) => String(p.pimsId ?? '').trim() === pims);
      if (match) providerFilter = String(match.id);
    }
  }

  return { anchorDate, providerFilter, viewMode: 'week' };
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
  if (!c || c.id == null) return null;
  const patients = patientsForAppointment(appt);
  const p0 = patients[0];
  if (!p0 || p0.id == null) return null;

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

  const addressParts = [pickStr(c.address1), pickStr(c.city), pickStr(c.state), pickStr(c.zipcode)].filter(
    Boolean,
  );
  const address = addressParts.length ? addressParts.join(', ') : '';

  const lat = typeof c.lat === 'number' && Number.isFinite(c.lat) ? c.lat : null;
  const lon = typeof c.lon === 'number' && Number.isFinite(c.lon) ? c.lon : null;

  const practiceTz = opts?.practiceTz ?? practiceTimeZoneOrDefault(undefined);
  const startLocal = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  const practiceDateKey = startLocal.isValid ? startLocal.toISODate() ?? undefined : undefined;
  const originalStartIso =
    startLocal.isValid ? startLocal.toISO({ includeOffset: true }) ?? undefined : undefined;
  const sameDayVisits = collectSameDayHouseholdVisits(
    appt,
    opts?.sameCalendarDayAppointments ?? [],
    practiceTz
  );

  return {
    v: 1,
    appointmentId: appt.id,
    practiceDateKey,
    originalStartIso,
    clientId: String(c.id),
    patientId: String(p0.id),
    appointmentTypeId: Number.isFinite(appointmentTypeId) ? appointmentTypeId : undefined,
    appointmentTypeName,
    primaryProviderInternalId,
    primaryDoctorPimsId,
    primaryDoctorDisplayName,
    description: appt.description ?? null,
    instructions: appt.instructions ?? null,
    clientDisplayLabel,
    serviceMinutes: minutes,
    address: address || undefined,
    lat,
    lon,
    clientAlerts: pickStr(c.alerts),
    sameDayVisits,
    rescheduleScope: sameDayVisits.length > 1 ? undefined : 'selected_pet',
  };
}
