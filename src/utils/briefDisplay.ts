import { DateTime } from 'luxon';
import type { PatientSearchRow } from '../api/patients';
import type { Appointment } from '../api/roomLoader';
import type { DoctorDayAppt } from '../api/appointments';

export function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

export function patientDisplayName(row: PatientSearchRow | Record<string, unknown>): string {
  const r = row as Record<string, unknown>;
  const joined = [pickStr(r.firstName), pickStr(r.lastName)].filter(Boolean).join(' ').trim();
  return (pickStr(r.name) ?? pickStr(r.patientName) ?? joined) || 'Patient';
}

export function clientNameFromPatientRow(
  row: PatientSearchRow | Record<string, unknown>
): string | null {
  const r = row as Record<string, unknown>;
  const owners = r.owners ?? r.clients ?? r.clientOwners;
  if (Array.isArray(owners) && owners[0] && typeof owners[0] === 'object') {
    const c = owners[0] as Record<string, unknown>;
    const name =
      [pickStr(c.firstName), pickStr(c.lastName)].filter(Boolean).join(' ').trim() ||
      pickStr(c.name);
    if (name) return name;
  }
  const c = r.client;
  if (c && typeof c === 'object') {
    const o = c as Record<string, unknown>;
    const name =
      [pickStr(o.firstName), pickStr(o.lastName)].filter(Boolean).join(' ').trim() ||
      pickStr(o.name);
    if (name) return name;
  }
  const ownerJoined = [pickStr(r.clientFirstName), pickStr(r.clientLastName)]
    .filter(Boolean)
    .join(' ')
    .trim();
  return pickStr(r.clientName) ?? pickStr(r.ownerName) ?? (ownerJoined || null);
}

export function clientIdFromPatientRow(
  row: PatientSearchRow | Record<string, unknown>
): string | number | null {
  const r = row as Record<string, unknown>;
  const owners = r.owners ?? r.clients ?? r.clientOwners;
  if (Array.isArray(owners) && owners[0] && typeof owners[0] === 'object') {
    const c = owners[0] as Record<string, unknown>;
    const id = c.id ?? c.clientId;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  const c = r.client;
  if (c && typeof c === 'object') {
    const id = (c as Record<string, unknown>).id ?? r.clientId;
    if (typeof id === 'string' || typeof id === 'number') return id;
  }
  const cid = r.clientId;
  return typeof cid === 'string' || typeof cid === 'number' ? cid : null;
}

export function clientPhoneFromRecord(
  row: Record<string, unknown> | null | undefined
): string | null {
  if (!row) return null;
  const client =
    row.client && typeof row.client === 'object' ? (row.client as Record<string, unknown>) : row;
  return (
    pickStr(client.phone) ??
    pickStr(client.phone1) ??
    pickStr(client.mobilePhone) ??
    pickStr(client.homePhone) ??
    pickStr(row.clientPhone) ??
    null
  );
}

export function patientIdFromDoctorDay(appt: DoctorDayAppt): string | null {
  const p = appt.patient;
  if (p && typeof p === 'object') {
    const id = (p as Record<string, unknown>).id;
    if (id != null && String(id).trim()) return String(id);
  }
  return pickStr(appt.patientPimsId);
}

export function formatBriefWhen(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const d = DateTime.fromISO(iso).setZone(tz);
  if (!d.isValid) return iso;
  return d.toFormat('h:mm a');
}

export function formatBriefDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return '';
  const d = DateTime.fromISO(iso).setZone(tz);
  if (!d.isValid) return iso;
  return d.toFormat('LLL d, yyyy · h:mm a');
}

export function appointmentIsOpen(appt: Appointment): boolean {
  if (appt.isComplete === true) return false;
  const status = (appt.statusName ?? appt.confirmStatusName ?? '').toLowerCase();
  if (status.includes('cancel') || status.includes('euthan')) return false;
  return true;
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase();
}
