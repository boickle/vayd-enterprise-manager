import type { HoldOwnerFilter } from './api/holds';

export const HOLDS_PATH = '/schedule/holds';

export const HOLDS_OWNER_PARAM = 'owner';

/** Scroll-to row when opening a specific appointment request from a deep link. */
export const HOLDS_HIGHLIGHT_PARAM = 'highlight';

export const DEFAULT_HOLDS_OWNER_FILTER: HoldOwnerFilter = 'me_unassigned';

const STRING_OWNER_FILTERS = new Set<string>([
  'me_unassigned',
  'me',
  'unassigned',
  'all',
]);

export function parseHoldsOwnerParam(raw: string | null): HoldOwnerFilter {
  if (!raw?.trim()) return DEFAULT_HOLDS_OWNER_FILTER;
  const trimmed = raw.trim();
  if (STRING_OWNER_FILTERS.has(trimmed)) {
    return trimmed as HoldOwnerFilter;
  }
  const n = Number(trimmed);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_HOLDS_OWNER_FILTER;
}

export function holdsPathForOwner(owner: HoldOwnerFilter): string {
  if (owner === DEFAULT_HOLDS_OWNER_FILTER) return HOLDS_PATH;
  const params = new URLSearchParams();
  params.set(HOLDS_OWNER_PARAM, String(owner));
  return `${HOLDS_PATH}?${params.toString()}`;
}

export function isHoldsBoardReturnPath(path: string | null | undefined): boolean {
  const trimmed = path?.trim();
  if (!trimmed) return false;
  return trimmed === HOLDS_PATH || trimmed.startsWith(`${HOLDS_PATH}?`);
}

export function parseHoldsHighlightFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get(HOLDS_HIGHLIGHT_PARAM);
  if (!raw?.trim()) return null;
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? Math.trunc(id) : null;
}

export function holdsPathWithHighlight(
  submissionId: number,
  opts?: { owner?: HoldOwnerFilter },
): string {
  const owner = opts?.owner ?? DEFAULT_HOLDS_OWNER_FILTER;
  const url = new URL(holdsPathForOwner(owner), 'http://local');
  url.searchParams.set(HOLDS_HIGHLIGHT_PARAM, String(submissionId));
  return `${url.pathname}${url.search}`;
}
