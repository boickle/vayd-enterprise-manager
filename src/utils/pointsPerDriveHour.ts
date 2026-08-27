/** Points ÷ drive hours. Returns null when there is no drive time. */
export function pointsPerDriveHour(points: number, driveMin: number): number | null {
  if (!(driveMin > 0)) return null;
  return points / (driveMin / 60);
}

/** Compact label for calendar headers and the optimize baseline. */
export function formatPointsPerDriveHour(
  ratio: number | null,
  digits = 1
): string {
  if (ratio == null || !Number.isFinite(ratio)) return '—';
  return `${ratio.toFixed(digits)} /hr`;
}
