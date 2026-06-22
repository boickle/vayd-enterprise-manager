import type { UnscheduledReminder } from '../api/careOutreach';

function truthyHiddenFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  if (typeof v === 'string') {
    const t = v.trim().toLowerCase();
    return t === 'true' || t === '1' || t === 'yes';
  }
  return false;
}

export function careOutreachReminderIsHidden(r: UnscheduledReminder): boolean {
  const any = r as Record<string, unknown>;
  if (truthyHiddenFlag(any.is_hidden)) return true;
  if (truthyHiddenFlag(any.isHidden)) return true;
  if (truthyHiddenFlag(any.hidden)) return true;
  return false;
}

export function normalizeCareOutreachReminder(raw: unknown): UnscheduledReminder {
  const row = { ...(raw as UnscheduledReminder) };
  if (careOutreachReminderIsHidden(row)) {
    row.isHidden = true;
  }
  return row;
}
