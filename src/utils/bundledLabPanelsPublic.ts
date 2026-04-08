import { DateTime } from 'luxon';
import type { TreatmentWithItems } from '../api/treatments';

/** Panels whose bundled components should not duplicate as separate lines on the client form. */
export const BUNDLED_LAB_PANEL_CODES = new Set(['FIL25659999', 'FIL45129999', 'FIL48719999', 'FIL48119999']);

const FECAL_CODES = new Set(['FIL24639', 'FIL5010']);

/** True if patient reminders or added items include this lab/inventory/procedure code (case-insensitive). */
export function patientVisitHasItemCode(patient: any, wantCode: string): boolean {
  const w = wantCode.trim().toUpperCase();
  const check = (raw: { code?: string; lab?: { code?: string }; procedure?: { code?: string }; inventoryItem?: { code?: string } } | null | undefined) => {
    const c = (raw?.code ?? raw?.lab?.code ?? raw?.procedure?.code ?? raw?.inventoryItem?.code ?? '').trim().toUpperCase();
    return c === w;
  };
  for (const r of patient?.reminders ?? []) {
    if (r?.item && check(r.item)) return true;
  }
  for (const item of patient?.addedItems ?? []) {
    if (check(item)) return true;
  }
  return false;
}

export function patientVisitHasAnyBundledPanelCode(patient: any): { caninePanel: boolean; felinePanel: boolean } {
  let caninePanel = false;
  let felinePanel = false;
  for (const code of BUNDLED_LAB_PANEL_CODES) {
    if (!patientVisitHasItemCode(patient, code)) continue;
    if (code === 'FIL25659999' || code === 'FIL48719999') caninePanel = true;
    if (code === 'FIL45129999' || code === 'FIL48119999') felinePanel = true;
  }
  return { caninePanel, felinePanel };
}

export function treatmentHistoryHadAnyCodeInLastMonths(
  history: TreatmentWithItems[],
  codes: string[],
  months: number,
  skipDeclined = true
): boolean {
  const want = new Set(codes.map((c) => c.trim().toUpperCase()).filter(Boolean));
  if (want.size === 0) return false;
  const cutoff = DateTime.now().minus({ months });
  for (const tx of history ?? []) {
    if ((tx as { isEstimate?: boolean }).isEstimate === true) continue;
    for (const item of tx.treatmentItems ?? []) {
      if (skipDeclined && item.isDeclined) continue;
      const code = (item.lab?.code ?? item.procedure?.code ?? item.inventoryItem?.code ?? '').trim().toUpperCase();
      if (!code || !want.has(code)) continue;
      const serviceDate = item.serviceDate ? DateTime.fromISO(item.serviceDate) : null;
      if (serviceDate && serviceDate.isValid && serviceDate >= cutoff) return true;
    }
  }
  return false;
}

/**
 * Reminder text/code matches `matcher` and due date is at least `minMonthsAhead` months after today
 * (client does not need that test soon).
 */
export function patientHasReminderDueAtLeastMonthsAhead(
  patient: any,
  matcher: (reminderText: string, itemName: string, itemCode: string) => boolean,
  minMonthsAhead: number,
  getReminderLine: (r: any) => { name: string; code: string; reminderText: string },
  getDueIso: (r: any) => string | null | undefined
): boolean {
  const threshold = DateTime.now().plus({ months: minMonthsAhead });
  for (const r of patient?.reminders ?? []) {
    const { name, code } = getReminderLine(r);
    const reminderText = String(r?.reminderText ?? r?.description ?? r?.reminder?.description ?? '');
    if (!matcher(reminderText, name, code)) continue;
    const dueStr = getDueIso(r);
    if (!dueStr) continue;
    const due = DateTime.fromISO(dueStr);
    if (!due.isValid) continue;
    if (due >= threshold) return true;
  }
  return false;
}

export function codeIsBundledFecal(code: string | null | undefined): boolean {
  return FECAL_CODES.has((code ?? '').trim().toUpperCase());
}
