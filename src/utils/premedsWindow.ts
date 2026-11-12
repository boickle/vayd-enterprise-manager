import { useSyncExternalStore } from 'react';
import { getPracticeSettings } from '../api/practiceSettings';
import {
  isFixedTimeAppointmentTypeName,
  type AppointmentTypeWindowSource,
} from './appointmentArrivalWindow';

/** Practice setting: ± minutes of the arrival window for pre-meds visits. */
export const PREMEDS_WINDOW_MINUTES_KEY = 'scheduling.premedsWindowMinutes' as const;

/** Pre-meds arrival band when the practice setting is unset (±30 = 1 hour). */
export const DEFAULT_PREMEDS_WINDOW_MINUTES = 30;

export function parsePremedsWindowMinutes(raw: unknown): number {
  if (raw == null || String(raw).trim() === '') return DEFAULT_PREMEDS_WINDOW_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_PREMEDS_WINDOW_MINUTES;
  return Math.round(n);
}

let practicePremedsMinutes = DEFAULT_PREMEDS_WINDOW_MINUTES;
let loadPromise: Promise<number> | null = null;
const listeners = new Set<() => void>();

/** Current practice pre-meds ± minutes (default 30 until settings load). */
export function practicePremedsWindowMinutes(): number {
  return practicePremedsMinutes;
}

export function setPracticePremedsWindowMinutes(minutes: unknown): void {
  const next = parsePremedsWindowMinutes(minutes);
  if (next === practicePremedsMinutes) return;
  practicePremedsMinutes = next;
  for (const l of listeners) l();
}

/** Load the practice pre-meds window once per session (Settings saves update it directly). */
export function ensurePracticePremedsWindowLoaded(practiceId: number): Promise<number> {
  if (!loadPromise) {
    loadPromise = getPracticeSettings(practiceId)
      .then((s) => {
        setPracticePremedsWindowMinutes((s as Record<string, unknown>)[PREMEDS_WINDOW_MINUTES_KEY]);
        return practicePremedsMinutes;
      })
      .catch(() => {
        loadPromise = null;
        return practicePremedsMinutes;
      });
  }
  return loadPromise;
}

export function usePracticePremedsWindowMinutes(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => practicePremedsMinutes
  );
}

/** Pre-meds window (±practice minutes) as a window source. */
export function premedsWindowSource(
  minutes: number = practicePremedsMinutes
): AppointmentTypeWindowSource {
  return {
    name: 'Pre-Meds',
    prettyName: 'Pre-Meds',
    windowBeforeMinutes: minutes,
    windowAfterMinutes: minutes,
  };
}

function resolvedSides(type: AppointmentTypeWindowSource | undefined): {
  before: number;
  after: number;
} {
  const name = (type?.prettyName || type?.name || '').trim();
  const b = type?.windowBeforeMinutes != null ? Number(type.windowBeforeMinutes) : NaN;
  const a = type?.windowAfterMinutes != null ? Number(type.windowAfterMinutes) : NaN;
  if (Number.isFinite(b) && Number.isFinite(a) && b >= 0 && a >= 0) return { before: b, after: a };
  if (name && isFixedTimeAppointmentTypeName(name)) return { before: 0, after: 0 };
  return {
    before: Number.isFinite(b) && b >= 0 ? b : 60,
    after: Number.isFinite(a) && a >= 0 ? a : 60,
  };
}

/**
 * The visit type's window narrowed by the pre-meds window — each side is the
 * smaller of the two, so pre-meds only tightens (a 0/0 in-office visit stays 0/0).
 * Matches the API's `tightenWindowTypeForPremeds`.
 */
export function tightenWindowSourceForPremeds<T extends AppointmentTypeWindowSource>(
  type: T | undefined,
  minutes: number = practicePremedsMinutes
): T | AppointmentTypeWindowSource {
  const own = resolvedSides(type);
  return {
    ...(type ?? {}),
    windowBeforeMinutes: Math.min(own.before, minutes),
    windowAfterMinutes: Math.min(own.after, minutes),
  };
}

/** Narrow the visit type's window by the pre-meds window when the visit is flagged. */
export function windowSourceForVisit<T extends AppointmentTypeWindowSource>(
  type: T | undefined,
  needsPremeds: boolean | null | undefined
): T | AppointmentTypeWindowSource | undefined {
  if (needsPremeds !== true) return type;
  return tightenWindowSourceForPremeds(type);
}

/** "1-hour" / "90-minute" label for the pre-meds window (at most this wide). */
export function premedsWindowSpanLabel(minutes: number = practicePremedsMinutes): string {
  const total = minutes * 2;
  if (total > 0 && total % 60 === 0) return `${total / 60}-hour`;
  return `${total}-minute`;
}
