// utils/statsFormat.ts
import { DateTime } from 'luxon';

/**
 * Drive duration for a leg after a personal block: use API `driveSeconds` / `byIndex.driveFromPrevSec` only.
 * We do not infer drive from ETA gaps — large gaps often include off-duty time, and `driveFromPrevMinutes: 0`
 * means "no driving leg to paint" (e.g. Monday block → Amber). The backend must send non-zero drive when it should show.
 */
export function inferredDriveSecAfterPersonalBlockGap(
  _prevEtdIso: string,
  _nextEtaIso: string,
  _bufferMinutes: number,
  reportedDriveSec: number
): number {
  return reportedDriveSec > 0 ? reportedDriveSec : 0;
}

export type DriveAfterPersonalBlockPlacement =
  | 'hug-before-eta'
  | 'hug-after-etd'
  | 'before-block'
  | 'after-block';

/**
 * Drive leg between a personal/noloc block and the adjacent visit:
 * 1) Prefer the side of the appointment closest to the block (between block and appt when possible).
 * 2) If that would overlap the block, put the drive on the far side of the block (before b0 if appt is after the block, after b1 if appt is before the block).
 * Never prefer the far side of the appointment alone — only move past the block.
 */
export function driveSegmentPlacementAfterPersonalBlock(args: {
  blockStartIso: string;
  blockEndIso: string;
  nextEtaIso: string;
  nextEtdIso: string;
  driveMinutes: number;
}): { segmentStartIso: string; placement: DriveAfterPersonalBlockPlacement } | null {
  const D = args.driveMinutes;
  if (!Number.isFinite(D) || D <= 0) return null;
  const b0 = DateTime.fromISO(args.blockStartIso);
  const b1 = DateTime.fromISO(args.blockEndIso);
  const n0 = DateTime.fromISO(args.nextEtaIso);
  const n1 = DateTime.fromISO(args.nextEtdIso);
  if (!b0.isValid || !b1.isValid || !n0.isValid || !n1.isValid) return null;

  const overlapsBlock = (segStart: DateTime, segEnd: DateTime) => segStart < b1 && b0 < segEnd;

  // Appointment starts at/after block ends — closest side of appt to block is before its ETA
  if (n0 >= b1) {
    const segStart = n0.minus({ minutes: D });
    const segEnd = n0;
    if (!overlapsBlock(segStart, segEnd)) {
      return { segmentStartIso: segStart.toISO()!, placement: 'hug-before-eta' };
    }
    return { segmentStartIso: b0.minus({ minutes: D }).toISO()!, placement: 'before-block' };
  }

  // Appointment ends at/before block starts — closest side of appt to block is after its ETD
  if (n1 <= b0) {
    const segStart = n1;
    const segEnd = n1.plus({ minutes: D });
    if (!overlapsBlock(segStart, segEnd)) {
      return { segmentStartIso: segStart.toISO()!, placement: 'hug-after-etd' };
    }
    return { segmentStartIso: b1.toISO()!, placement: 'after-block' };
  }

  // Timelines overlap — try hug before ETA, else before block
  {
    const segStart = n0.minus({ minutes: D });
    const segEnd = n0;
    if (!overlapsBlock(segStart, segEnd)) {
      return { segmentStartIso: segStart.toISO()!, placement: 'hug-before-eta' };
    }
    return { segmentStartIso: b0.minus({ minutes: D }).toISO()!, placement: 'before-block' };
  }
}

export function driveSegmentStartIsoAfterPersonalBlock(args: {
  blockStartIso: string;
  blockEndIso: string;
  nextEtaIso: string;
  nextEtdIso: string;
  driveMinutes: number;
}): string | null {
  return driveSegmentPlacementAfterPersonalBlock(args)?.segmentStartIso ?? null;
}

export const formatHM = (mins: number) => {
  if (!Number.isFinite(mins)) return '—';
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

export const colorForWhitespace = (pct: number) => {
  if (!Number.isFinite(pct)) return undefined;
  if (pct <= 5) return 'var(--ok)'; // green
  if (pct <= 15) return 'orange'; // yellow
  return 'var(--bad)'; // red
};

export const colorForHDRatio = (ratio: number) => {
  if (!Number.isFinite(ratio)) return undefined;
  if (ratio >= 4) return 'var(--ok)'; // green
  if (ratio >= 3) return 'orange'; // yellow
  return 'var(--bad)'; // red
};

export const colorForDrive = (mins: number) => {
  if (!Number.isFinite(mins)) return undefined;
  if (mins <= 90) return 'var(--ok)'; // green
  if (mins <= 120) return 'orange'; // orange as requested
  return 'var(--bad)'; // red
};
