import { DateTime } from 'luxon';
import type { Appointment } from '../api/roomLoader';
import { practiceTimeZoneOrDefault } from './practiceTimezone';

function pickStr(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function employeeLooksLikeTechnician(emp: {
  isProvider?: boolean;
  title?: string | null;
  designation?: string | null;
}): boolean {
  if (emp.isProvider === true) return false;
  if (emp.isProvider === false) return true;
  const hay = [emp.title, emp.designation].filter(Boolean).join(' ').toLowerCase();
  if (hay.includes('dvm') || hay.includes('veterinar') || hay.includes('doctor')) return false;
  return (
    hay.includes('technician') ||
    hay.includes('lvt') ||
    hay.includes('cvt') ||
    hay.includes('veterinary nurse') ||
    /\btech\b/.test(hay)
  );
}

/** First name of the technician on the visit (additional employees), when present. */
export function resolveTechnicianFirstNameForAppointment(appt: Appointment): string {
  const additional = appt.additionalEmployees ?? [];
  const tech =
    additional.find(employeeLooksLikeTechnician) ??
    additional.find((emp) => emp.isProvider === false) ??
    additional[0];
  return pickStr(tech?.firstName) ?? '';
}

export function buildOnMyWaySmsMessage(technicianFirstName: string, minutes: number): string {
  const name = technicianFirstName.trim() || 'your VAYD team';
  const m = Math.max(1, Math.round(minutes));
  return `Hi it's ${name} with Vet At Your Door. I wanted to let you know we are ${m} minutes away!`;
}

export function etaMinutesAwayFromNow(
  etaIso: string | null | undefined,
  practiceTz: string,
  now: DateTime = DateTime.now()
): number | null {
  if (!etaIso?.trim()) return null;
  const tz = practiceTimeZoneOrDefault(practiceTz);
  const eta = DateTime.fromISO(etaIso, { zone: 'utc' }).setZone(tz);
  if (!eta.isValid) return null;
  const mins = Math.round(eta.diff(now.setZone(tz), 'minutes').minutes);
  if (!Number.isFinite(mins)) return null;
  return Math.max(1, mins);
}

export const ON_MY_WAY_SMS_DEFAULT_MINUTES = 15;
