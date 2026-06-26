/** Coalesce concurrent identical async work (e.g. duplicate GETs during one page load). */
export function dedupeInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlight.get(key);
  if (existing) return existing as Promise<T>;
  const promise = fn().finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

const inFlight = new Map<string, Promise<unknown>>();
