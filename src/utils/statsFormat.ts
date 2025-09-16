// utils/statsFormat.ts
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
