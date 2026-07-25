import {
  fetchClientMessages,
  type ClientMessagesResponse,
} from '../api/clientPortal';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  data: ClientMessagesResponse;
  fetchedAt: number;
};

const cache = new Map<number, CacheEntry>();

export function getCachedClientMessages(clientId: number): ClientMessagesResponse | null {
  const hit = cache.get(clientId);
  if (!hit) return null;
  if (Date.now() - hit.fetchedAt > CACHE_TTL_MS) {
    cache.delete(clientId);
    return null;
  }
  return hit.data;
}

export function setCachedClientMessages(clientId: number, data: ClientMessagesResponse): void {
  cache.set(clientId, { data, fetchedAt: Date.now() });
}

/** Fetch client SMS history; returns cached data when fresh, optional background refresh. */
export async function fetchClientMessagesCached(
  clientId: number,
  opts?: { refresh?: boolean },
): Promise<ClientMessagesResponse> {
  const cached = getCachedClientMessages(clientId);
  if (cached && !opts?.refresh) return cached;
  const data = await fetchClientMessages(clientId);
  setCachedClientMessages(clientId, data);
  return data;
}
