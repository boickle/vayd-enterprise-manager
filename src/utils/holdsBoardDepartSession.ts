/** Scroll position when leaving the Holds board for scheduler (restored on return). */
export const HOLDS_BOARD_DEPART_KEY = 'vayd:holds-board-depart-v1';

export type HoldsBoardDepartV1 = {
  v: 1;
  scrollY: number;
  groupKey?: string | null;
};

export function writeHoldsBoardDepartSession(next: {
  scrollY: number;
  groupKey?: string | null;
}): void {
  if (typeof sessionStorage === 'undefined') return;
  const scrollY = Number.isFinite(next.scrollY) && next.scrollY >= 0 ? next.scrollY : 0;
  const groupKey = next.groupKey?.trim() || null;
  try {
    sessionStorage.setItem(
      HOLDS_BOARD_DEPART_KEY,
      JSON.stringify({ v: 1, scrollY, groupKey }),
    );
  } catch {
    /* quota */
  }
}

export function readHoldsBoardDepartSession(): HoldsBoardDepartV1 | null {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(HOLDS_BOARD_DEPART_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as HoldsBoardDepartV1;
    if (o?.v !== 1) return null;
    const scrollY = Number(o.scrollY);
    if (!Number.isFinite(scrollY) || scrollY < 0) return null;
    const groupKey =
      typeof o.groupKey === 'string' && o.groupKey.trim() ? o.groupKey.trim() : null;
    return { v: 1, scrollY, groupKey };
  } catch {
    return null;
  }
}

export function clearHoldsBoardDepartSession(): void {
  if (typeof sessionStorage === 'undefined') return;
  try {
    sessionStorage.removeItem(HOLDS_BOARD_DEPART_KEY);
  } catch {
    /* ignore */
  }
}
