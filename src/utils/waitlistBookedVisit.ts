import { DateTime } from 'luxon';
import {
  isAppointmentCancelledOnPracticeCalendar,
  isPracticeCalendarBlockAppointment,
} from '../api/appointments';
import type { Appointment } from '../api/roomLoader';
import type { WaitlistEntry } from '../api/waitlist';
import { patientsForAppointment } from './schedulerAddPet';

function pickIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}

export function appointmentStartIso(appt: Appointment): string | null {
  const row = appt as Appointment & Record<string, unknown>;
  return (
    pickIso(appt.appointmentStart) ??
    pickIso(row.startIso) ??
    pickIso(row.scheduledStartIso) ??
    pickIso(row.start)
  );
}

function appointmentPatientIds(appt: Appointment): number[] {
  return patientsForAppointment(appt)
    .map((p) => Number(p.id))
    .filter((id) => Number.isFinite(id) && id > 0);
}

function isUsableFutureVisit(appt: Appointment, practiceTz: string, nowMs: number): boolean {
  if (appt.isDeleted) return false;
  if (appt.isActive === false) return false;
  if (appt.allDay) return false;
  if (isPracticeCalendarBlockAppointment(appt)) return false;
  if (isAppointmentCancelledOnPracticeCalendar(appt)) return false;
  const startIso = appointmentStartIso(appt);
  if (!startIso) return false;
  const start = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(practiceTz);
  if (!start.isValid) return false;
  // Include same-day visits that started earlier today.
  return start.toMillis() >= nowMs - 12 * 60 * 60 * 1000;
}

/** Soonest future visit start for a waitlist household (patient overlap when known). */
export function pickSoonestFutureVisitStartIso(args: {
  appointments: Appointment[];
  waitlistPatientIds: number[];
  practiceTz: string;
  nowMs?: number;
}): string | null {
  const nowMs = args.nowMs ?? Date.now();
  const want = new Set(
    (args.waitlistPatientIds ?? []).filter((id) => Number.isFinite(id) && id > 0),
  );
  let best: { ms: number; iso: string } | null = null;
  for (const appt of args.appointments) {
    if (!isUsableFutureVisit(appt, args.practiceTz, nowMs)) continue;
    const startIso = appointmentStartIso(appt);
    if (!startIso) continue;
    if (want.size > 0) {
      const apptPatients = appointmentPatientIds(appt);
      if (apptPatients.length > 0 && !apptPatients.some((id) => want.has(id))) continue;
    }
    const ms = DateTime.fromISO(startIso, { zone: 'utc' }).setZone(args.practiceTz).toMillis();
    if (!Number.isFinite(ms)) continue;
    if (!best || ms < best.ms) best = { ms, iso: startIso };
  }
  return best?.iso ?? null;
}

export function waitlistEffectiveBookedStartIso(
  entry: Pick<WaitlistEntry, 'bookedAppointmentStart'>,
  enrichedStartIso?: string | null,
): string | null {
  const fromEntry = entry.bookedAppointmentStart?.trim() || null;
  if (fromEntry) return fromEntry;
  return enrichedStartIso?.trim() || null;
}

export function waitlistWantsSoonerBadgeText(
  bookedStartIso: string | null | undefined,
  practiceTz: string,
): string {
  if (!bookedStartIso?.trim()) return 'Wants sooner';
  const dt = DateTime.fromISO(bookedStartIso, { zone: 'utc' }).setZone(practiceTz);
  if (!dt.isValid) return 'Wants sooner';
  return `Has ${dt.toFormat('ccc, LLL d')} — wants sooner`;
}

export function waitlistShouldShowWantsSoonerBadge(
  entry: Pick<WaitlistEntry, 'status' | 'createdVia' | 'bookedAppointmentStart'>,
  enrichedStartIso?: string | null,
): boolean {
  if (entry.status !== 'waiting') return false;
  if (entry.createdVia === 'online_booking') return true;
  return Boolean(waitlistEffectiveBookedStartIso(entry, enrichedStartIso));
}
