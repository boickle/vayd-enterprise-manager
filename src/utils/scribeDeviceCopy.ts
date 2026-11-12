/**
 * SCR-A15: the device copy of each visit transcript (`scout.scribe.liveTranscript:<id>`) and the
 * SCR-04 "already applied" marker (`scout.scribe.appliedSuggestion:<id>`). Cleared when the chart
 * is signed and on sign-out, so visit conversations are not left on a shared device.
 */
const PREFIXES = ['scout.scribe.liveTranscript:', 'scout.scribe.appliedSuggestion:'];

/** Removes this chart's device copies. */
export function clearScribeDeviceCopy(soapEncounterId: string): void {
  try {
    PREFIXES.forEach((p) => localStorage.removeItem(`${p}${soapEncounterId}`));
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

/** Removes every chart's device copies (sign-out). */
export function clearAllScribeDeviceCopies(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && PREFIXES.some((p) => k.startsWith(p))) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* storage unavailable: nothing to clear */
  }
}
