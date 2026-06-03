import { patientSexDisplayFromRecord } from './schedulerVisitDisplay';

function pickTrim(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
}

function recordFromUnknown(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Pet-level alerts from doctor-day appointment row (appointment or nested patient). */
export function petAlertsFromDoctorDayRow(a: unknown): string | null {
  const row = recordFromUnknown(a);
  if (!row) return null;
  const pat = recordFromUnknown(row.patient);
  return (
    pickTrim(row.alerts) ??
    pickTrim(pat?.alerts) ??
    pickTrim(pat?.alert) ??
    pickTrim(row.patientAlert) ??
    pickTrim(row.patientAlerts) ??
    null
  );
}

export function sexFromDoctorDayRow(a: unknown): string | null {
  const row = recordFromUnknown(a);
  if (!row) return null;
  const pat = recordFromUnknown(row.patient);
  if (pat) {
    const fromPat = patientSexDisplayFromRecord(pat);
    if (fromPat) return fromPat;
  }
  return patientSexDisplayFromRecord(row);
}

export function appointmentNotesFromDoctorDayRow(a: unknown): string | null {
  const row = recordFromUnknown(a);
  if (!row) return null;
  return pickTrim(row.description) ?? pickTrim(row.visitReason) ?? null;
}

export function staffNotesFromDoctorDayRow(a: unknown): string | null {
  const row = recordFromUnknown(a);
  if (!row) return null;
  return pickTrim(row.instructions) ?? pickTrim(row.staffNotes) ?? null;
}
