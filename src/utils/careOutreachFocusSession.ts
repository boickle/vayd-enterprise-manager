export const CARE_OUTREACH_FOCUS_SESSION_KEY = 'vayd:care-outreach-focus-client-v1';

/**
 * After routing/offering from Care Outreach, remember which client row to scroll back to so the
 * list re-focuses that client instead of jumping to the top. Cleared once consumed.
 */
export function writeCareOutreachFocusClient(clientKey: string): void {
  if (typeof sessionStorage === 'undefined') return;
  const trimmed = clientKey.trim();
  if (!trimmed) return;
  try {
    sessionStorage.setItem(CARE_OUTREACH_FOCUS_SESSION_KEY, trimmed);
  } catch {
    /* quota */
  }
}

export function readCareOutreachFocusClient(): string | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CARE_OUTREACH_FOCUS_SESSION_KEY);
    const trimmed = raw?.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

export function clearCareOutreachFocusClient(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(CARE_OUTREACH_FOCUS_SESSION_KEY);
  } catch {
    /* ignore */
  }
}
