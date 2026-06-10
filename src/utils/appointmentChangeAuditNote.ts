import { DateTime } from 'luxon';
import type { Provider } from '../api/employee';
import { decodeJwtPayload, resolveEmployeeIdFromToken } from './practiceIdFromToken';

export type AppointmentChangeActor = {
  firstName?: string | null;
  lastName?: string | null;
  /** When first/last name are unavailable. */
  fallbackLabel?: string | null;
};

export function formatEmployeeFirstNameLastInitial(actor: AppointmentChangeActor): string {
  const first = (actor.firstName ?? '').trim();
  const last = (actor.lastName ?? '').trim();
  if (first && last) {
    return `${first} ${last.charAt(0).toUpperCase()}.`;
  }
  if (first) return first;
  const fb = (actor.fallbackLabel ?? '').trim();
  if (fb) return fb;
  return 'Staff';
}

export function appointmentChangeDateLabel(practiceTz: string): string {
  const today = DateTime.now().setZone(practiceTz);
  return today.isValid ? today.toFormat('MM/dd/yyyy') : DateTime.now().toFormat('MM/dd/yyyy');
}

function formatOriginalAppointmentStartLabels(
  originalAppointmentStartIso: string | null | undefined,
  practiceTz: string
): { dateLabel: string; timeLabel: string } | null {
  const raw = originalAppointmentStartIso?.trim();
  if (!raw) return null;
  const dt = DateTime.fromISO(raw, { zone: 'utc' }).setZone(practiceTz);
  const resolved = dt.isValid ? dt : DateTime.fromISO(raw);
  if (!resolved.isValid) return null;
  return {
    dateLabel: resolved.toFormat('MM/dd/yyyy'),
    timeLabel: resolved.toFormat('h:mm a'),
  };
}

export function appendStaffNoteLine(existing: string | null | undefined, line: string): string {
  const base = (existing ?? '').trim();
  if (!base) return line;
  return `${base}\n${line}`;
}

export type EditVisitChangeKind = 'description' | 'staff_notes' | 'appt_type' | 'appt_time';

const EDIT_VISIT_CHANGE_LABEL: Record<EditVisitChangeKind, string> = {
  description: 'Edited appointment description',
  staff_notes: 'Edited staff notes',
  appt_type: 'Edited appt type',
  appt_time: 'Edited appt time',
};

export type EditVisitChangeBaseline = {
  description?: string | null;
  instructions?: string | null;
  appointmentTypeId?: number | string | null;
  appointmentStart?: string | null;
  appointmentEnd?: string | null;
};

function normNoteText(v: string | null | undefined): string {
  return (v ?? '').trim();
}

function appointmentTimesEqual(
  a: string | null | undefined,
  b: string | null | undefined
): boolean {
  const aa = normNoteText(a);
  const bb = normNoteText(b);
  if (!aa && !bb) return true;
  if (!aa || !bb) return false;
  const da = DateTime.fromISO(aa);
  const db = DateTime.fromISO(bb);
  if (da.isValid && db.isValid) return da.toMillis() === db.toMillis();
  return aa === bb;
}

/** Which visit fields changed — drives staff-note audit lines on save. */
export function detectEditVisitChanges(
  baseline: EditVisitChangeBaseline,
  updated: {
    description: string;
    instructions: string;
    appointmentTypeId: number;
    appointmentStart: string;
    appointmentEnd: string;
  }
): EditVisitChangeKind[] {
  const changes: EditVisitChangeKind[] = [];
  if (normNoteText(baseline.description) !== normNoteText(updated.description)) {
    changes.push('description');
  }
  if (normNoteText(baseline.instructions) !== normNoteText(updated.instructions)) {
    changes.push('staff_notes');
  }
  const baseType = Number(baseline.appointmentTypeId);
  if (Number.isFinite(baseType) && baseType > 0 && baseType !== updated.appointmentTypeId) {
    changes.push('appt_type');
  }
  if (
    !appointmentTimesEqual(baseline.appointmentStart, updated.appointmentStart) ||
    !appointmentTimesEqual(baseline.appointmentEnd, updated.appointmentEnd)
  ) {
    changes.push('appt_time');
  }
  return changes;
}

export function appendEditedByStaffNote(
  existing: string | null | undefined,
  actor: AppointmentChangeActor,
  practiceTz: string,
  changes: EditVisitChangeKind[]
): string {
  if (changes.length === 0) return (existing ?? '').trim();
  const name = formatEmployeeFirstNameLastInitial(actor);
  const date = appointmentChangeDateLabel(practiceTz);
  let out = (existing ?? '').trim();
  for (const kind of changes) {
    out = appendStaffNoteLine(out, `${EDIT_VISIT_CHANGE_LABEL[kind]} by ${name} on ${date}`);
  }
  return out;
}

export function appendLinkedClientStaffNote(
  existing: string | null | undefined,
  actor: AppointmentChangeActor,
  practiceTz: string,
  clientLabel: string,
  patientLabel?: string | null
): string {
  const name = formatEmployeeFirstNameLastInitial(actor);
  const date = appointmentChangeDateLabel(practiceTz);
  const who = patientLabel?.trim()
    ? `${clientLabel.trim()} / ${patientLabel.trim()}`
    : clientLabel.trim();
  return appendStaffNoteLine(existing, `Linked to ${who} by ${name} on ${date}`);
}

export function appendRescheduledByStaffNote(
  existing: string | null | undefined,
  actor: AppointmentChangeActor,
  practiceTz: string,
  originalAppointmentStartIso?: string | null
): string {
  const name = formatEmployeeFirstNameLastInitial(actor);
  const date = appointmentChangeDateLabel(practiceTz);
  const from = formatOriginalAppointmentStartLabels(originalAppointmentStartIso, practiceTz);
  const line = from
    ? `Rescheduled by ${name} on ${date} from ${from.dateLabel} at ${from.timeLabel}`
    : `Rescheduled by ${name} on ${date}`;
  return appendStaffNoteLine(existing, line);
}

/** @deprecated Use {@link appendEditedByStaffNote} — audit lines belong on staff notes (`instructions`). */
export const appendEditedByAppointmentNote = appendEditedByStaffNote;

/** @deprecated Use {@link appendRescheduledByStaffNote} — audit lines belong on staff notes (`instructions`). */
export const appendRescheduledByAppointmentNote = appendRescheduledByStaffNote;

function pickActorStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

/** Names embedded on the staff JWT — preferred over assigned-doctor calendar scope. */
function resolveActorFromJwtToken(token: string | null): AppointmentChangeActor | null {
  if (!token) return null;
  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const employee = payload.employee;
  if (employee && typeof employee === 'object' && !Array.isArray(employee)) {
    const row = employee as Record<string, unknown>;
    const firstName = pickActorStr(row.firstName);
    const lastName = pickActorStr(row.lastName);
    if (firstName || lastName) return { firstName, lastName };
    const full = pickActorStr(row.fullName) ?? pickActorStr(row.name);
    if (full) return { fallbackLabel: full };
  }

  const firstName = pickActorStr(payload.firstName) ?? pickActorStr(payload.given_name);
  const lastName = pickActorStr(payload.lastName) ?? pickActorStr(payload.family_name);
  if (firstName || lastName) return { firstName, lastName };

  const display = pickActorStr(payload.name) ?? pickActorStr(payload.displayName);
  if (display) return { fallbackLabel: display };

  return null;
}

function actorFromProviderRow(row: Provider): AppointmentChangeActor {
  return {
    firstName: row.firstName,
    lastName: row.lastName,
    fallbackLabel: row.name?.trim() || null,
  };
}

/** Resolve the logged-in staff member for audit notes on appointment description. */
export function resolveAppointmentChangeActorFromAuth(args: {
  token?: string | null;
  userEmail?: string | null;
  /**
   * Assigned/default doctor for calendar scoping — not used for audit actor name
   * (CLs share their doctor's id here but should sign notes with their own name).
   */
  doctorId?: string | null;
  providers?: readonly Provider[];
}): AppointmentChangeActor {
  const providers = args.providers ?? [];

  const fromJwt = resolveActorFromJwtToken(args.token ?? null);
  if (fromJwt && (fromJwt.firstName || fromJwt.lastName || fromJwt.fallbackLabel)) {
    return fromJwt;
  }

  const jwtEmpId = resolveEmployeeIdFromToken(args.token ?? null);
  if (jwtEmpId != null) {
    const row = providers.find((p) => Number(p.id) === jwtEmpId);
    if (row) return actorFromProviderRow(row);
  }

  const email = args.userEmail?.trim();
  if (email && providers.length > 0) {
    const row = providers.find((p) => p.email?.trim().toLowerCase() === email.toLowerCase());
    if (row) return actorFromProviderRow(row);
  }

  if (email) {
    const local = email.split('@')[0]?.replace(/[._+-]/g, ' ').trim();
    if (local) return { fallbackLabel: local };
  }

  // Legacy doctor login with no employee id on JWT — only then use assigned doctor id.
  if (jwtEmpId == null) {
    const doctorId = args.doctorId?.trim();
    if (doctorId) {
      const row = providers.find((p) => String(p.id) === doctorId);
      if (row) return actorFromProviderRow(row);
    }
  }

  return { fallbackLabel: 'Staff' };
}
