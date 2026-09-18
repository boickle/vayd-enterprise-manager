import type { WaitlistCreatedVia, WaitlistEntry } from '../api/waitlist';

function pickIso(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  return v.trim();
}

function pickNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeCreatedVia(raw: unknown): WaitlistCreatedVia | null {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (s === 'staff') return 'staff';
  if (s === 'online_booking' || s === 'onlinebooking' || s === 'online-booking') {
    return 'online_booking';
  }
  return null;
}

/**
 * Map nested / snake_case waitlist API shapes onto flat entry fields.
 * Mirrors forward-booking normalization so "Has … — wants sooner" sees booked starts.
 */
export function normalizeWaitlistEntry(raw: unknown): WaitlistEntry {
  const row = { ...(raw as WaitlistEntry) };
  if (!raw || typeof raw !== 'object') return row;
  const o = raw as Record<string, unknown>;

  const createdVia = normalizeCreatedVia(o.createdVia ?? o.created_via ?? row.createdVia);
  if (createdVia) row.createdVia = createdVia;

  if (row.bookedAppointmentId == null) {
    const id = pickNum(o.bookedAppointmentId ?? o.booked_appointment_id);
    if (id != null) row.bookedAppointmentId = id;
  }

  if (!row.bookedAppointmentStart) {
    row.bookedAppointmentStart =
      pickIso(o.bookedAppointmentStart) ??
      pickIso(o.booked_appointment_start) ??
      row.bookedAppointmentStart ??
      null;
  }

  const booked = o.bookedAppointment ?? o.booked_appointment;
  if (booked && typeof booked === 'object') {
    const b = booked as Record<string, unknown>;
    if (row.bookedAppointmentId == null) {
      const bid = pickNum(b.id ?? b.appointmentId ?? b.appointment_id);
      if (bid != null) row.bookedAppointmentId = bid;
    }
    if (!row.bookedAppointmentStart) {
      row.bookedAppointmentStart =
        pickIso(b.appointmentStart) ??
        pickIso(b.appointment_start) ??
        pickIso(b.start) ??
        pickIso(b.startIso) ??
        null;
    }
  }

  return row;
}
