import { DateTime } from 'luxon';
import { truthyApiFlag } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { fetchPatientAppointmentsStaff } from '../api/pimsAppointments';
import { fetchPatientMedicalRecordStaff, fetchPatientProfileForRow } from '../api/patients';
import type { MedicalRecordBundle } from './patientChartFromMedicalRecord';
import {
  appointmentNotesDisplay,
  appointmentTypeDisplayName,
  formatVisitHighlightsNextAppointmentLine,
} from './nextScheduledAppointmentForVisit';
import { primaryProviderFromPatientRecord } from './schedulerVisitDisplay';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function alertsTextFromValue(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    return s || null;
  }
  if (Array.isArray(v) && v.length) {
    const joined = v
      .map((a) => (typeof a === 'string' ? a : pickStr((a as Record<string, unknown>)?.message)))
      .filter(Boolean)
      .join(' ');
    return joined || null;
  }
  return null;
}

export function patientAlertsFromRecord(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const nested =
    o.patient && typeof o.patient === 'object' && !Array.isArray(o.patient)
      ? (o.patient as Record<string, unknown>)
      : null;
  if (nested) {
    const fromNested =
      alertsTextFromValue(nested.alerts) ??
      pickStr(nested.alert) ??
      pickStr(nested.patientAlert) ??
      pickStr(nested.patientAlerts);
    if (fromNested) return fromNested;
  }
  return (
    alertsTextFromValue(o.alerts) ??
    pickStr(o.alert) ??
    pickStr(o.patientAlert) ??
    pickStr(o.patientAlerts) ??
    null
  );
}

export type RoutingPatientReminderLine = {
  id: string;
  label: string;
  dueMs: number | null;
};

export type RoutingClientPatientRow = {
  id: string;
  name: string;
  alerts?: string | null;
  isMember?: boolean;
  membershipName?: string | null;
};

export function patientMembershipFromRecord(raw: unknown): {
  isMember: boolean;
  membershipName: string | null;
} {
  if (!raw || typeof raw !== 'object') return { isMember: false, membershipName: null };
  const o = raw as Record<string, unknown>;
  const nested =
    o.patient && typeof o.patient === 'object' && !Array.isArray(o.patient)
      ? (o.patient as Record<string, unknown>)
      : null;

  let isMember = false;
  let membershipName: string | null = null;
  const consider = (flag: unknown, rawName: unknown) => {
    if (truthyApiFlag(flag)) isMember = true;
    const name = pickStr(rawName);
    if (name) {
      isMember = true;
      if (!membershipName) membershipName = name;
    }
  };

  consider(o.isMember, o.membershipName);
  if (nested) consider(nested.isMember, nested.membershipName);
  return { isMember, membershipName };
}

export function extractActivePatientsFromClientStaffRecord(raw: unknown): RoutingClientPatientRow[] {
  if (!raw || typeof raw !== 'object') return [];
  const p = raw as Record<string, unknown>;
  const list =
    p.patients ??
    p.patientList ??
    p.pets ??
    (Array.isArray(p.patient) ? p.patient : null);
  if (!Array.isArray(list)) return [];

  const out: RoutingClientPatientRow[] = [];
  for (const row of list) {
    if (!row || typeof row !== 'object') continue;
    const o = row as Record<string, unknown>;
    const idRaw = o.id ?? o.patientId;
    if (idRaw == null) continue;
    const isDeleted = o.isDeleted === true || o.isDeleted === 1;
    const isActive = o.isActive === false || o.isActive === 0 ? false : true;
    if (isDeleted || !isActive) continue;
    const joined = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
    const name = pickStr(o.name) ?? (joined || 'Patient');
    const membership = patientMembershipFromRecord(o);
    out.push({
      id: String(idRaw),
      name,
      alerts: patientAlertsFromRecord(o),
      isMember: membership.isMember,
      membershipName: membership.membershipName,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}

/** Client staff payloads often omit membership; load from GET /patients/:id when needed. */
export async function enrichRoutingClientPatientsMembership(
  rows: readonly RoutingClientPatientRow[]
): Promise<RoutingClientPatientRow[]> {
  if (rows.length === 0) return [];

  return Promise.all(
    rows.map(async (row) => {
      if (row.isMember) return row;
      try {
        const profile = await fetchPatientProfileForRow({ id: row.id });
        const membership = patientMembershipFromRecord(profile);
        if (!membership.isMember) return row;
        return {
          ...row,
          isMember: true,
          membershipName: membership.membershipName,
        };
      } catch {
        return row;
      }
    })
  );
}

export type RoutingPatientHoverSummary = {
  alerts: string | null;
  primaryProviderName: string | null;
  lastAppointmentLine: string | null;
  nextAppointmentLine: string | null;
  activeReminders: RoutingPatientReminderLine[];
  overdueReminders: RoutingPatientReminderLine[];
};

function providerLabelFromAppointment(a: Appointment): string {
  const p = a.primaryProvider;
  if (!p || typeof p !== 'object') return '—';
  const o = p as { firstName?: unknown; lastName?: unknown; name?: unknown; designation?: unknown };
  const name = [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim();
  if (name) {
    const suffix = pickStr(o.designation);
    return suffix ? `${name}, ${suffix}` : name;
  }
  return pickStr(o.name) ?? '—';
}

function formatPastAppointmentLine(a: Appointment, practiceTz: string): string {
  const notes = appointmentNotesDisplay(a) ?? appointmentTypeDisplayName(a);
  const start = DateTime.fromISO(a.appointmentStart, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return notes;
  return `${notes} - ${start.toFormat('M/d/yyyy h:mm a')}`;
}

function reminderDueMs(raw: Record<string, unknown>): number | null {
  const iso =
    pickStr(raw.dueDate) ??
    pickStr(raw.reminderDate) ??
    pickStr(raw.serviceDate) ??
    pickStr(raw.createdAt);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function reminderDurationLabel(raw: Record<string, unknown>): string | null {
  return (
    pickStr(raw.intervalDescription) ??
    pickStr(raw.interval) ??
    pickStr(raw.duration) ??
    pickStr(raw.frequency) ??
    null
  );
}

function reminderTitle(raw: Record<string, unknown>): string {
  return (
    pickStr(raw.description) ??
    pickStr(raw.title) ??
    pickStr(raw.name) ??
    pickStr(raw.serviceName) ??
    'Reminder'
  );
}

function formatReminderDueLabel(dueMs: number | null, practiceTz: string): string | null {
  if (dueMs == null) return null;
  const dt = DateTime.fromMillis(dueMs, { zone: practiceTz });
  if (!dt.isValid) return null;
  return dt.toFormat('M/d/yyyy');
}

function reminderIsHidden(o: Record<string, unknown>): boolean {
  const v = o.isHidden ?? o.is_hidden ?? o.hidden;
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

export function parseRemindersFromMedicalRecord(
  raw: MedicalRecordBundle | null | undefined,
  practiceTz: string
): RoutingPatientReminderLine[] {
  const list = raw?.reminders;
  if (!Array.isArray(list)) return [];
  const rows = list
    .filter((r) => r && typeof r === 'object')
    .filter((r) => !reminderIsHidden(r as Record<string, unknown>))
    .map((r) => {
      const o = r as Record<string, unknown>;
      const dueMs = reminderDueMs(o);
      const title = reminderTitle(o);
      const duration = reminderDurationLabel(o);
      const dueLabel = formatReminderDueLabel(dueMs, practiceTz);
      const parts = [title];
      if (duration) parts.push(duration);
      if (dueLabel) parts.push(dueLabel);
      return {
        id: String(o.id ?? `${title}-${dueMs ?? ''}`),
        label: parts.join(' - '),
        dueMs,
      };
    })
    .sort((a, b) => {
      const ta = a.dueMs ?? Number.MAX_SAFE_INTEGER;
      const tb = b.dueMs ?? Number.MAX_SAFE_INTEGER;
      return ta - tb;
    });
  return rows;
}

export function splitActiveAndOverdueReminders(
  reminders: RoutingPatientReminderLine[],
  asOfMs = Date.now()
): { active: RoutingPatientReminderLine[]; overdue: RoutingPatientReminderLine[] } {
  const active: RoutingPatientReminderLine[] = [];
  const overdue: RoutingPatientReminderLine[] = [];
  for (const r of reminders) {
    if (r.dueMs != null && r.dueMs < asOfMs) overdue.push(r);
    else active.push(r);
  }
  return { active, overdue };
}

function isBookablePastAppointment(a: Appointment, asOfMs: number): boolean {
  if (a.isDeleted === true) return false;
  const startMs = Date.parse(a.appointmentStart);
  return Number.isFinite(startMs) && startMs <= asOfMs;
}

function isFutureAppointment(a: Appointment, asOfMs: number): boolean {
  if (a.isDeleted === true) return false;
  const startMs = Date.parse(a.appointmentStart);
  return Number.isFinite(startMs) && startMs > asOfMs;
}

function matchesExcludedAppointment(
  a: Appointment,
  excludeAppointmentId: string | number | null | undefined
): boolean {
  if (excludeAppointmentId == null || excludeAppointmentId === '') return false;
  return String(a.id) === String(excludeAppointmentId);
}

export async function loadRoutingPatientHoverSummary(
  patientId: string,
  practiceId: number,
  practiceTz: string,
  opts?: {
    alerts?: string | null;
    /** Omit this visit from last/next appointment (e.g. the appointment being edited). */
    excludeAppointmentId?: string | number | null;
  }
): Promise<RoutingPatientHoverSummary> {
  const asOfMs = Date.now();
  const excludeAppointmentId = opts?.excludeAppointmentId;

  const [medicalRecord, appointments, patientProfile] = await Promise.all([
    fetchPatientMedicalRecordStaff(patientId).catch(() => null),
    fetchPatientAppointmentsStaff(patientId, { practiceId }).catch(() => [] as Appointment[]),
    fetchPatientProfileForRow({ id: patientId }).catch(() => null),
  ]);

  const alerts = opts?.alerts?.trim() || patientAlertsFromRecord(patientProfile) || null;
  const primaryProviderName = primaryProviderFromPatientRecord(patientProfile);

  const past = appointments
    .filter(
      (a) =>
        isBookablePastAppointment(a, asOfMs) &&
        !matchesExcludedAppointment(a, excludeAppointmentId)
    )
    .sort((a, b) => Date.parse(b.appointmentStart) - Date.parse(a.appointmentStart))[0];

  const future = appointments
    .filter(
      (a) =>
        isFutureAppointment(a, asOfMs) && !matchesExcludedAppointment(a, excludeAppointmentId)
    )
    .sort((a, b) => Date.parse(a.appointmentStart) - Date.parse(b.appointmentStart))[0];

  const parsedReminders = parseRemindersFromMedicalRecord(medicalRecord, practiceTz);
  const { active, overdue } = splitActiveAndOverdueReminders(parsedReminders, asOfMs);

  return {
    alerts,
    primaryProviderName,
    lastAppointmentLine: past ? formatPastAppointmentLine(past, practiceTz) : null,
    nextAppointmentLine: future
      ? formatVisitHighlightsNextAppointmentLine(future, practiceTz, providerLabelFromAppointment(future))
      : null,
    activeReminders: active,
    overdueReminders: overdue,
  };
}
