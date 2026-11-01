/** Display helpers for Active/Inactive + Scout patient status chips. */

function pickStr(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export type PatientChip = { label: string; tone: 'ok' | 'danger' | 'muted' };

export function patientActiveChip(p: Record<string, unknown>): PatientChip {
  if (!patientIsActiveInHousehold(p)) {
    return { label: 'Inactive', tone: 'muted' };
  }
  return { label: 'Active', tone: 'ok' };
}

/** Active pets only — euthanized / inactive pets stay on the client record, not quick household chips. */
export function patientIsActiveInHousehold(p: Record<string, unknown>): boolean {
  if (p.isActive === false || p.isActive === 0) return false;
  if (p.active === false) return false;
  return true;
}

export function patientStatusChip(p: Record<string, unknown>): PatientChip | null {
  const nested = p.patientStatus;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const name = pickStr((nested as Record<string, unknown>).name);
    if (name) {
      const lower = name.toLowerCase();
      if (lower.includes('euthan')) return { label: name, tone: 'danger' };
      return { label: name, tone: 'muted' };
    }
  }
  const legacy = pickStr(p.status) ?? pickStr(p.patientStatusName);
  if (!legacy) return null;
  const lower = legacy.toLowerCase();
  if (lower === 'active' || lower === 'inactive') return null;
  if (lower.includes('euthan')) return { label: 'Euthanized', tone: 'danger' };
  if (lower.includes('deceas') || lower.includes('died')) {
    return { label: 'Deceased', tone: 'muted' };
  }
  return { label: legacy, tone: 'muted' };
}

export type PatientInactiveBanner = {
  title: string;
  body: string;
  /** Passed away / euthanasia — warmer banner styling. */
  memorial: boolean;
};

/** Full-width callout on the patient chart when the pet is not active. */
export function patientInactiveBanner(p: Record<string, unknown>): PatientInactiveBanner | null {
  if (patientIsActiveInHousehold(p)) return null;
  const status = patientStatusChip(p);
  const statusName = status?.label ?? null;
  const memorial = Boolean(
    statusName && /euthan|deceas|passed away|hbc deceased/i.test(statusName),
  );
  const title = statusName ? `Inactive patient · ${statusName}` : 'Inactive patient';
  const body = memorial
    ? 'This pet is no longer on the active roster. Do not schedule visits or send reminders unless you reactivate them.'
    : statusName
      ? `Status: ${statusName}. They stay off reminders and scheduling until reactivated.`
      : 'This pet is off the active roster until you reactivate them.';
  return { title, body, memorial };
}
