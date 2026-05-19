/**
 * When the user chooses "Reschedule" from the practice calendar we stash client + appointment
 * metadata here so Routing can pre-fill the form and `/appointments/:id` is PATCHed after a new slot is chosen.
 */
import { DateTime } from 'luxon';
import type { Appointment, Client, Patient } from '../api/roomLoader';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

export const ROUTING_RESCHEDULE_INTENT_STORAGE_KEY = 'vayd:routing-reschedule-intent-v1';

/** Same-tab notification (sessionStorage does not fire `storage`). */
export const ROUTING_RESCHEDULE_INTENT_UPDATED_EVENT = 'vayd:routing-reschedule-intent-updated';

export type RoutingRescheduleScope = 'selected_pet' | 'household_day';

export type RescheduleSameDayVisit = {
  appointmentId: number;
  patientId: string;
  patientName?: string;
};

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
      byPatient.set(patientId, {
        appointmentId: a.id,
        patientId,
        patientName: patientDisplayName(p),
      });
    }
  }

  return [...byPatient.values()].sort((a, b) =>
    (a.patientName ?? a.patientId).localeCompare(b.patientName ?? b.patientId, undefined, {
      sensitivity: 'base',
    })
  );
}

export function rescheduleRequiresScopeChoice(intent: RoutingRescheduleIntentV1 | null): boolean {
  return (intent?.sameDayVisits?.length ?? 0) > 1;
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
};

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
  const primaryDoctorPimsId = pickStr(pp?.pimsId) ?? undefined;
  const primaryDoctorDisplayName =
    [pickStr(pp?.firstName), pickStr(pp?.lastName)].filter(Boolean).join(' ').trim() || undefined;

  const addressParts = [pickStr(c.address1), pickStr(c.city), pickStr(c.state), pickStr(c.zipcode)].filter(
    Boolean,
  );
  const address = addressParts.length ? addressParts.join(', ') : '';

  const lat = typeof c.lat === 'number' && Number.isFinite(c.lat) ? c.lat : null;
  const lon = typeof c.lon === 'number' && Number.isFinite(c.lon) ? c.lon : null;

  const practiceTz = opts?.practiceTz ?? practiceTimeZoneOrDefault(undefined);
  const sameDayVisits = collectSameDayHouseholdVisits(
    appt,
    opts?.sameCalendarDayAppointments ?? [],
    practiceTz
  );

  return {
    v: 1,
    appointmentId: appt.id,
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
