import type { DoctorDayVisualPdfPatient } from '../pages/DoctorDayVisualPdf';
import { patientSexDisplayFromRecord } from './schedulerVisitDisplay';

export type MyDayVisualPatientBadge = {
  name: string;
  sourceApptId?: string | number | null;
  pimsId?: string | null;
  type?: string | null;
  /** @deprecated use appointmentNotes */
  desc?: string | null;
  appointmentNotes?: string | null;
  staffNotes?: string | null;
  sex?: string | null;
  petAlerts?: string | null;
  status?: string | null;
  recordStatus?: string | null;
  /** @deprecated use petAlerts */
  alerts?: string | null;
  isMember?: boolean;
  membershipName?: string | null;
};

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
  // Prefer nested patient alerts when present — row-level `alerts` is often duplicated
  // across co-located household appointments (first pet copied onto every row).
  if (pat) {
    const fromPatient =
      pickTrim(pat.alerts) ??
      pickTrim(pat.alert) ??
      pickTrim(pat.patientAlert) ??
      pickTrim(pat.patientAlerts) ??
      null;
    if (fromPatient) return fromPatient;
  }
  return (
    pickTrim(row.patientAlert) ??
    pickTrim(row.patientAlerts) ??
    pickTrim(row.alerts) ??
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

function strField(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
    if (v != null && typeof v !== 'object' && String(v).trim()) return String(v).trim();
  }
  return null;
}

/** Build one household pet badge from a doctor-day or range appointment row. */
export function makeMyDayVisualPatientBadge(a: unknown): MyDayVisualPatientBadge {
  const row = recordFromUnknown(a);
  const name =
    (row ? strField(row, 'patientName', 'petName', 'animalName', 'name') : null) ?? 'Patient';
  const pat = row ? recordFromUnknown(row.patient) : null;
  const typeObj = row?.appointmentType;
  const typeFromObj =
    typeObj != null && typeof typeObj === 'object' && !Array.isArray(typeObj)
      ? strField(typeObj as Record<string, unknown>, 'name', 'prettyName')
      : null;
  const type =
    (row ? strField(row, 'appointmentType', 'appointmentTypeName', 'serviceName') : null) ??
    typeFromObj;
  const appointmentNotes = appointmentNotesFromDoctorDayRow(a);
  const staffNotes = staffNotesFromDoctorDayRow(a);
  const petAlerts = petAlertsFromDoctorDayRow(a);
  const sex = sexFromDoctorDayRow(a);
  const status = row ? strField(row, 'confirmStatusName') : null;
  const recordStatus = row ? strField(row, 'statusName') : null;
  const isMember = Boolean(row?.isMember ?? pat?.isMember);
  const rawMem = row?.membershipName ?? pat?.membershipName;
  const membershipName =
    typeof rawMem === 'string' && rawMem.trim()
      ? rawMem.trim()
      : rawMem != null && String(rawMem).trim()
        ? String(rawMem).trim()
        : null;
  const sourceApptId = row?.id as string | number | null | undefined;
  return {
    name,
    sourceApptId: sourceApptId ?? null,
    pimsId: row ? strField(row, 'patientPimsId') : null,
    type,
    desc: appointmentNotes,
    appointmentNotes,
    staffNotes,
    sex,
    petAlerts,
    status,
    recordStatus,
    alerts: petAlerts,
    isMember,
    membershipName,
  };
}

export function buildPdfPatientFromBadgeAndSource(
  p: MyDayVisualPatientBadge,
  sourceAppt?: unknown
): DoctorDayVisualPdfPatient {
  const appointmentNotes =
    p.appointmentNotes?.trim() ||
    p.desc?.trim() ||
    (sourceAppt ? appointmentNotesFromDoctorDayRow(sourceAppt) : null) ||
    undefined;
  const staffNotes =
    p.staffNotes?.trim() ||
    (sourceAppt ? staffNotesFromDoctorDayRow(sourceAppt) : null) ||
    undefined;
  const sex =
    p.sex?.trim() || (sourceAppt ? sexFromDoctorDayRow(sourceAppt) : null) || undefined;
  const petAlerts =
    p.petAlerts?.trim() ||
    p.alerts?.trim() ||
    (sourceAppt ? petAlertsFromDoctorDayRow(sourceAppt) : null) ||
    undefined;
  return {
    name: p.name,
    type: p.type ?? undefined,
    desc: p.desc ?? undefined,
    appointmentNotes,
    staffNotes,
    sex,
    petAlerts,
    alerts: petAlerts ?? p.alerts ?? undefined,
    status: p.status ?? undefined,
    recordStatus: p.recordStatus ?? undefined,
    isMember: p.isMember,
    membershipName: p.membershipName,
  };
}

export function buildPdfPatientsFromBadges(
  patients: readonly MyDayVisualPatientBadge[],
  apptsById?: ReadonlyMap<string, unknown> | null
): DoctorDayVisualPdfPatient[] {
  return patients.map((p) => {
    const sourceAppt =
      p.sourceApptId != null ? apptsById?.get(String(p.sourceApptId)) : undefined;
    return buildPdfPatientFromBadgeAndSource(p, sourceAppt);
  });
}
