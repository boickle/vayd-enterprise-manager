/** Display helpers for Active/Inactive + Scout patient status chips. */

function pickStr(v: unknown): string | null {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export type PatientChip = { label: string; tone: 'ok' | 'danger' | 'muted' };

export function patientActiveChip(p: Record<string, unknown>): PatientChip {
  if (p.isActive === false || p.active === false) {
    return { label: 'Inactive', tone: 'muted' };
  }
  return { label: 'Active', tone: 'ok' };
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
