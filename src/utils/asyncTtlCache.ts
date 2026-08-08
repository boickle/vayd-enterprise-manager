type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

/**
 * In-memory TTL cache that also dedupes concurrent callers for the same key.
 * Useful for analytics pages that fan out many overlapping API requests.
 */
export function createAsyncTtlCache(defaultTtlMs: number) {
  const values = new Map<string, CacheEntry<unknown>>();
  const inflight = new Map<string, Promise<unknown>>();

  async function getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = defaultTtlMs
  ): Promise<T> {
    const now = Date.now();
    const hit = values.get(key) as CacheEntry<T> | undefined;
    if (hit && hit.expiresAt > now) return hit.value;

    const pending = inflight.get(key) as Promise<T> | undefined;
    if (pending) return pending;

    const promise = (async () => {
      try {
        const value = await fetcher();
        values.set(key, { value, expiresAt: Date.now() + ttlMs });
        return value;
      } finally {
        inflight.delete(key);
      }
    })();

    inflight.set(key, promise);
    return promise;
  }

  function clear(prefix?: string) {
    if (!prefix) {
      values.clear();
      inflight.clear();
      return;
    }
    for (const key of values.keys()) {
      if (key.startsWith(prefix)) values.delete(key);
    }
    for (const key of inflight.keys()) {
      if (key.startsWith(prefix)) inflight.delete(key);
    }
  }

  return { getOrFetch, clear };
}

/** Run async work over items with a fixed concurrency cap. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!, index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => run()));
  return results;
}
