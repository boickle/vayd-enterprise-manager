import { DateTime } from 'luxon';
import { truthyApiFlag } from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import { fetchPatientAppointmentsStaff } from '../api/pimsAppointments';
import { fetchPatientMedicalRecordStaff, fetchPatientProfileForRow } from '../api/patients';
import { fetchAllEmployees } from '../api/appointmentSettings';
import { listTasks } from '../api/tasks';
import type { MedicalRecordBundle } from './patientChartFromMedicalRecord';
import {
  parseDeclinedItems,
  type DeclinedTreatmentItem,
} from '../api/declinedTreatments';
import {
  appointmentNotesDisplay,
  appointmentTypeDisplayName,
  formatVisitHighlightsNextAppointmentLine,
} from './nextScheduledAppointmentForVisit';
import { primaryProviderFromPatientRecord } from './schedulerVisitDisplay';
import { formatEmployeeDisplayName } from './employeeDisplayName';

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
  /** yyyy-MM-dd in the practice timezone, when a due date is known. */
  dueDateInput: string | null;
  /** Raw `reminderType` (e.g. Callback, Wellness). */
  reminderType: string | null;
  /** Staff assigned to this reminder, when known. */
  assigneeName: string | null;
};

/**
 * Staff-only follow-ups (eVet Callback + ToDo). Merged with open Scout patient tasks
 * in the chart Callbacks & Tasks section — not client due notices.
 */
export function isCallbackReminderType(
  reminderType: string | null | undefined
): boolean {
  const type = (reminderType ?? '').trim().toLowerCase();
  return type === 'callback' || type === 'todo';
}

/** Open Scout task linked to a patient (kind callback or plain to-do). */
export type RoutingPatientStaffTaskLine = {
  id: number;
  title: string;
  assigneeName: string | null;
  dueMs: number | null;
  dueLabel: string | null;
  overdue: boolean;
};

function decodeReminderText(raw: string): string {
  return raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

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
  /** eVet Callback + ToDo reminder rows. */
  callbackReminders: RoutingPatientReminderLine[];
  /** Open Scout tasks for this patient (callbacks and plain to-dos). */
  staffTasks: RoutingPatientStaffTaskLine[];
  declinedItems: DeclinedTreatmentItem[];
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
  const title =
    pickStr(raw.description) ??
    pickStr(raw.title) ??
    pickStr(raw.name) ??
    pickStr(raw.serviceName) ??
    'Reminder';
  return decodeReminderText(title);
}

function formatReminderDueLabel(dueMs: number | null, practiceTz: string): string | null {
  if (dueMs == null) return null;
  const dt = DateTime.fromMillis(dueMs, { zone: practiceTz });
  if (!dt.isValid) return null;
  return dt.toFormat('M/d/yyyy');
}

function reminderDueDateInput(dueMs: number | null, practiceTz: string): string | null {
  if (dueMs == null) return null;
  const dt = DateTime.fromMillis(dueMs, { zone: practiceTz });
  if (!dt.isValid) return null;
  return dt.toFormat('yyyy-MM-dd');
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

function reminderAssigneeName(raw: Record<string, unknown>): string | null {
  const emp =
    raw.employee && typeof raw.employee === 'object' && !Array.isArray(raw.employee)
      ? (raw.employee as Record<string, unknown>)
      : null;
  if (!emp) return null;
  const name = [pickStr(emp.firstName), pickStr(emp.lastName)].filter(Boolean).join(' ').trim();
  return name || pickStr(emp.name) || pickStr(emp.displayName) || null;
}

function reminderTypeOf(raw: Record<string, unknown>): string | null {
  return pickStr(raw.reminderType) ?? pickStr(raw.type) ?? null;
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
      const reminderType = reminderTypeOf(o);
      const assigneeName = reminderAssigneeName(o);
      const parts = [title];
      if (duration) parts.push(duration);
      if (dueLabel) parts.push(dueLabel);
      return {
        id: String(o.id ?? `${title}-${dueMs ?? ''}`),
        label: parts.join(' - '),
        dueMs,
        dueDateInput: reminderDueDateInput(dueMs, practiceTz),
        reminderType,
        assigneeName,
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
): {
  active: RoutingPatientReminderLine[];
  overdue: RoutingPatientReminderLine[];
  callbacks: RoutingPatientReminderLine[];
} {
  const active: RoutingPatientReminderLine[] = [];
  const overdue: RoutingPatientReminderLine[] = [];
  const callbacks: RoutingPatientReminderLine[] = [];
  for (const r of reminders) {
    if (isCallbackReminderType(r.reminderType)) {
      callbacks.push(r);
      continue;
    }
    if (r.dueMs != null && r.dueMs < asOfMs) overdue.push(r);
    else active.push(r);
  }
  return { active, overdue, callbacks };
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

  const patientIdNum = Number(patientId);
  const [medicalRecord, appointments, patientProfile, tasksPage] = await Promise.all([
    fetchPatientMedicalRecordStaff(patientId).catch(() => null),
    fetchPatientAppointmentsStaff(patientId, { practiceId }).catch(() => [] as Appointment[]),
    fetchPatientProfileForRow({ id: patientId }).catch(() => null),
    Number.isFinite(patientIdNum) && patientIdNum > 0
      ? listTasks({ patientId: patientIdNum, includeDone: false, limit: 50 }).catch(() => ({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        }))
      : Promise.resolve({ items: [], total: 0, limit: 50, offset: 0 }),
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
  const { active, overdue, callbacks } = splitActiveAndOverdueReminders(parsedReminders, asOfMs);

  const openTasks = tasksPage.items.filter((t) => t.status !== 'done');
  let staffTasks: RoutingPatientStaffTaskLine[] = [];
  if (openTasks.length > 0) {
    const employees = await fetchAllEmployees().catch(() => []);
    const empById = new Map(
      employees.map((e) => [Number(e.id), e] as const).filter(([id]) => Number.isFinite(id))
    );
    staffTasks = openTasks.map((t) => {
      const dueMs = t.dueAt ? Date.parse(t.dueAt) : NaN;
      const assigneeId = t.assignedToEmployeeId ?? t.defaultAssigneeEmployeeId;
      const emp =
        assigneeId != null && Number.isFinite(Number(assigneeId))
          ? empById.get(Number(assigneeId))
          : undefined;
      return {
        id: t.id,
        title: t.title,
        assigneeName: emp ? formatEmployeeDisplayName(emp) : null,
        dueMs: Number.isFinite(dueMs) ? dueMs : null,
        dueLabel: t.dueAt
          ? DateTime.fromISO(t.dueAt, { zone: practiceTz }).toFormat('M/d/yyyy')
          : null,
        overdue: Number.isFinite(dueMs) && dueMs < asOfMs,
      };
    });
  }

  return {
    alerts,
    primaryProviderName,
    lastAppointmentLine: past ? formatPastAppointmentLine(past, practiceTz) : null,
    nextAppointmentLine: future
      ? formatVisitHighlightsNextAppointmentLine(future, practiceTz, providerLabelFromAppointment(future))
      : null,
    activeReminders: active,
    overdueReminders: overdue,
    callbackReminders: callbacks,
    staffTasks,
    declinedItems: parseDeclinedItems(
      (medicalRecord as MedicalRecordBundle | null)?.declinedItems
    ),
  };
}
