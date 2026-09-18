import { DateTime } from 'luxon';
import {
  cancelAppointment,
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
  normalizeRangeAppointment,
} from '../api/appointments';
import {
  fetchPatientByIdStaff,
  fetchPatientByPimsIdStaff,
  patchPatient,
} from '../api/patients';
import {
  appointmentMatchesPatientId,
  fetchPatientAppointmentsStaff,
  patientIdFromAppointment,
} from '../api/pimsAppointments';
import type { Appointment, Patient } from '../api/roomLoader';
import { practiceTimeZoneOrDefault } from './practiceTimezone';
import { patientsForAppointment } from './schedulerAddPet';

export const EUTHANASIA_FUTURE_CANCEL_REASON = 'Euthanasia — future appointment removed';

export type EuthanasiaFutureAppointmentRow = {
  appointmentId: number;
  patientId: string;
  patientName: string;
  scheduledLabel: string;
  appointmentTypeLabel: string;
  appointmentStartIso: string;
  /** Full appointment when available (for cancel / Scout-delete path). */
  appointment: Appointment;
};

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function patientDisplayName(p: Patient | null | undefined, fallbackId?: string): string {
  if (p) {
    return (
      pickStr(p.name) ??
      pickStr((p as { prettyName?: string }).prettyName) ??
      (p.id != null ? `Pet #${p.id}` : 'Pet')
    );
  }
  return fallbackId ? `Pet #${fallbackId}` : 'Pet';
}

function appointmentTypeLabel(appt: Appointment): string {
  const at = appt.appointmentType;
  return pickStr(at?.prettyName) ?? pickStr(at?.name) ?? 'Visit';
}

function formatScheduledLabel(appt: Appointment, practiceTz: string): string {
  if (!appt.appointmentStart) return '—';
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const start = DateTime.fromISO(appt.appointmentStart, { zone: 'utc' }).setZone(tz);
  if (!start.isValid) return '—';
  const datePart = start.toFormat('EEEE, MMM d, yyyy');
  const end = appt.appointmentEnd
    ? DateTime.fromISO(appt.appointmentEnd, { zone: 'utc' }).setZone(tz)
    : null;
  if (end?.isValid) {
    return `${datePart} · ${start.toFormat('h:mm a')} – ${end.toFormat('h:mm a')}`;
  }
  return `${datePart} · ${start.toFormat('h:mm a')}`;
}

/** True when appointment type name/prettyName indicates euthanasia / end-of-life. */
export function isEuthanasiaAppointmentTypeName(
  name?: string | null,
  prettyName?: string | null,
): boolean {
  const n = (name ?? '').trim().toLowerCase();
  const p = (prettyName ?? '').trim().toLowerCase();
  if (n === 'euthanasia' || p === 'euthanasia') return true;
  return n.includes('euthanasia') || p.includes('euthanasia');
}

export function isEuthanasiaAppointmentType(type: {
  name?: string | null;
  prettyName?: string | null;
} | null | undefined): boolean {
  if (!type) return false;
  return isEuthanasiaAppointmentTypeName(type.name, type.prettyName);
}

export function isEuthanasiaAppointment(appt: Appointment | null | undefined): boolean {
  if (!appt) return false;
  return isEuthanasiaAppointmentType(appt.appointmentType);
}

function isCountableFutureAppointment(a: Appointment, asOfMs: number): boolean {
  if (a.isDeleted) return false;
  if (a.isActive === false) return false;
  if (a.allDay) return false;
  if (isPracticeCalendarBlockAppointment(a)) return false;
  if ((a as { isPersonalBlock?: boolean }).isPersonalBlock === true) return false;
  if (isAppointmentCancelledOnPracticeCalendar(a)) return false;
  if (!a.appointmentStart?.trim()) return false;
  const startMs = Date.parse(a.appointmentStart);
  return Number.isFinite(startMs) && startMs > asOfMs;
}

/**
 * Multi-pet visits are separate appointment rows per pet. Only cancel rows whose
 * sole patient is the euthanasia patient (never drop a sibling pet's row).
 */
function isSolePatientAppointment(appt: Appointment, patientId: string): boolean {
  const patients = patientsForAppointment(appt);
  if (patients.length > 1) return false;
  if (patients.length === 1) {
    return patients[0]?.id != null && String(patients[0].id) === String(patientId);
  }
  return appointmentMatchesPatientId(appt, patientId);
}

export type FindEuthanasiaFutureAppointmentsArgs = {
  practiceId: number;
  practiceTz: string;
  /** Patients being booked/ended for euthanasia. */
  patients: readonly { patientId: string; patientName?: string | null }[];
  /** Exclude these appointment ids (the euthanasia visit itself, reschedule source, etc.). */
  excludeAppointmentIds?: readonly number[];
  /** Defaults to now. */
  asOfIso?: string;
  /** Lookahead years from asOf (default 2). */
  lookaheadYears?: number;
};

/** Future non-cancelled appointments for the given patients only (one row per appointment id). */
export async function findFutureAppointmentsForPatients(
  args: FindEuthanasiaFutureAppointmentsArgs,
): Promise<EuthanasiaFutureAppointmentRow[]> {
  const asOfIso = args.asOfIso?.trim() || new Date().toISOString();
  const asOfMs = Date.parse(asOfIso);
  if (!Number.isFinite(asOfMs)) return [];

  const years = args.lookaheadYears ?? 2;
  const rangeEnd = new Date(asOfIso);
  rangeEnd.setUTCFullYear(rangeEnd.getUTCFullYear() + years);

  const exclude = new Set(
    (args.excludeAppointmentIds ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0),
  );

  const byId = new Map<number, EuthanasiaFutureAppointmentRow>();

  await Promise.all(
    args.patients.map(async (patient) => {
      const patientId = String(patient.patientId).trim();
      if (!patientId) return;
      let rows: Appointment[] = [];
      try {
        rows = (
          await fetchPatientAppointmentsStaff(patientId, {
            practiceId: args.practiceId,
            start: asOfIso,
            end: rangeEnd.toISOString(),
          })
        ).map(normalizeRangeAppointment);
      } catch {
        return;
      }

      for (const appt of rows) {
        if (!isCountableFutureAppointment(appt, asOfMs)) continue;
        const apptId = Number(appt.id);
        if (!Number.isFinite(apptId) || apptId <= 0) continue;
        if (exclude.has(apptId) || byId.has(apptId)) continue;
        if (!isSolePatientAppointment(appt, patientId)) continue;

        const matchedPatient =
          patientsForAppointment(appt).find((p) => p.id != null && String(p.id) === patientId) ??
          appt.patient ??
          null;

        byId.set(apptId, {
          appointmentId: apptId,
          patientId,
          patientName:
            pickStr(patient.patientName) ?? patientDisplayName(matchedPatient, patientId),
          scheduledLabel: formatScheduledLabel(appt, args.practiceTz),
          appointmentTypeLabel: appointmentTypeLabel(appt),
          appointmentStartIso: appt.appointmentStart!,
          appointment: appt,
        });
      }
    }),
  );

  return [...byId.values()].sort((a, b) =>
    a.appointmentStartIso.localeCompare(b.appointmentStartIso),
  );
}

export async function cancelEuthanasiaFutureAppointments(args: {
  rows: readonly EuthanasiaFutureAppointmentRow[];
  practiceId: number | string;
  reason?: string;
}): Promise<{ cancelledIds: number[]; errors: string[] }> {
  const reason = args.reason?.trim() || EUTHANASIA_FUTURE_CANCEL_REASON;
  const cancelledIds: number[] = [];
  const errors: string[] = [];

  for (const row of args.rows) {
    try {
      await cancelAppointment(
        row.appointmentId,
        { cancellationFlag: true, cancellationReason: reason },
        { practiceId: args.practiceId, appt: row.appointment },
      );
      cancelledIds.push(row.appointmentId);
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string | string[] } }; message?: string };
      const m = ax?.response?.data?.message;
      const msg = Array.isArray(m)
        ? m.join(', ')
        : typeof m === 'string' && m.trim()
          ? m
          : ax?.message || `Could not cancel appointment #${row.appointmentId}`;
      errors.push(msg);
    }
  }

  return { cancelledIds, errors };
}

/** True when a patient payload already looks inactive. */
export function isPatientRecordInactive(record: Record<string, unknown> | null | undefined): boolean {
  if (!record) return false;
  if (record.isActive === false || record.active === false) return true;
  const st = String(record.status ?? record.patientStatus ?? '')
    .trim()
    .toLowerCase();
  return st.includes('inactive');
}

/** NestJS 404/405 when Scout patient write routes are not deployed yet. */
export function isPatientPatchUnavailableError(err: unknown): boolean {
  const ax = err as {
    response?: { status?: number; data?: { message?: unknown; error?: unknown } };
    message?: string;
  };
  const status = ax.response?.status;
  if (status === 404 || status === 405) return true;
  const raw = ax.response?.data?.message ?? ax.response?.data?.error ?? ax.message ?? '';
  const msg = Array.isArray(raw) ? raw.join(' ') : String(raw);
  return /^Cannot\s+(PATCH|PUT)\s+\/patients\//i.test(msg.trim());
}

function extractPatientMutationErrorMessage(err: unknown, patientId: string): string {
  const ax = err as { response?: { data?: { message?: string | string[] } }; message?: string };
  const m = ax?.response?.data?.message;
  if (Array.isArray(m)) return m.join(', ');
  if (typeof m === 'string' && m.trim()) return m.trim();
  if (ax?.message?.trim()) return ax.message.trim();
  return `Could not inactivate patient #${patientId}`;
}

function looksAlreadyInactiveMessage(message: string): boolean {
  return /already\s+inactive|patient\s+is\s+inactive|not\s+active/i.test(message);
}

async function loadPatientRecordForInactivation(
  patientId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const data = await fetchPatientByIdStaff(patientId);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    /* try PIMS id lookup below */
  }
  try {
    const data = await fetchPatientByPimsIdStaff(patientId);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return data as Record<string, unknown>;
    }
  } catch {
    /* best-effort only */
  }
  return null;
}

function resolvePatientWriteId(
  record: Record<string, unknown> | null,
  fallbackId: string,
): string {
  if (record?.id != null) {
    const resolved = String(record.id).trim();
    if (resolved) return resolved;
  }
  return fallbackId;
}

export type InactivateEuthanasiaPatientsResult = {
  inactivatedIds: string[];
  alreadyInactiveIds: string[];
  /**
   * Soft failures (missing PATCH route, already inactive via eVet, etc.).
   * End Visit should still close — do not surface these as hard errors.
   */
  softErrors: string[];
  /** Unexpected failures; still best-effort (do not block End Visit). */
  errors: string[];
};

/**
 * Best-effort patient inactivation after euthanasia.
 * Scout `PATCH /patients/:id` may be unavailable; eVet often already marks the pet inactive.
 */
export async function inactivateEuthanasiaPatients(
  patientIds: readonly string[],
): Promise<InactivateEuthanasiaPatientsResult> {
  const inactivatedIds: string[] = [];
  const alreadyInactiveIds: string[] = [];
  const softErrors: string[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const raw of patientIds) {
    const id = String(raw).trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const record = await loadPatientRecordForInactivation(id);
    if (isPatientRecordInactive(record)) {
      alreadyInactiveIds.push(id);
      continue;
    }

    const writeId = resolvePatientWriteId(record, id);
    try {
      await patchPatient(writeId, { isActive: false });
      inactivatedIds.push(writeId);
    } catch (e: unknown) {
      const msg = extractPatientMutationErrorMessage(e, writeId);
      if (looksAlreadyInactiveMessage(msg)) {
        alreadyInactiveIds.push(writeId);
        continue;
      }
      if (isPatientPatchUnavailableError(e)) {
        softErrors.push(msg);
        continue;
      }
      errors.push(msg);
    }
  }

  return { inactivatedIds, alreadyInactiveIds, softErrors, errors };
}

export function patientIdsFromEuthanasiaAppointments(
  appointments: readonly Appointment[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const appt of appointments) {
    if (!isEuthanasiaAppointment(appt)) continue;
    const pid = patientIdFromAppointment(appt);
    if (!pid || seen.has(pid)) continue;
    seen.add(pid);
    ids.push(pid);
  }
  return ids;
}
