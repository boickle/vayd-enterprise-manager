import type { UnscheduledReminder } from '../api/careOutreach';
import type { CareOutreachPriorityChipCounts } from './careOutreachPriorityFilters';

export type CareOutreachListCacheEntry = {
  rows: UnscheduledReminder[];
  priorityChipCounts: CareOutreachPriorityChipCounts;
  cacheKey: string;
  cachedAt: number;
};

const TTL_MS = 45_000;
let cache: CareOutreachListCacheEntry | null = null;

export function careOutreachListCacheKey(
  priority: string,
  dueDateFrom: string,
  dueDateTo: string,
): string {
  return `${priority}|${dueDateFrom}|${dueDateTo}`;
}

export function readCareOutreachListCache(
  cacheKey: string,
): CareOutreachListCacheEntry | null {
  if (!cache || cache.cacheKey !== cacheKey) return null;
  if (Date.now() - cache.cachedAt > TTL_MS) return null;
  return cache;
}

export function writeCareOutreachListCache(entry: CareOutreachListCacheEntry): void {
  cache = entry;
}

export function clearCareOutreachListCache(): void {
  cache = null;
}
