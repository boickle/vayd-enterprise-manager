function normalizeApiErrorText(value: unknown): string | null {
  if (typeof value === 'string') {
    const t = value.trim();
    return t || null;
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

/** Prefer server `message` over axios' generic "Request failed with status code …". */
export function extractHttpErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (typeof err === 'string') return err.trim() || fallback;
  if (err && typeof err === 'object') {
    const ax = err as {
      response?: { data?: { message?: unknown; error?: unknown } };
      message?: string;
    };
    const server =
      normalizeApiErrorText(ax.response?.data?.message) ||
      normalizeApiErrorText(ax.response?.data?.error);
    if (server) return server;
    const msg = ax.message?.trim();
    if (msg && !/^Request failed with status code \d+$/i.test(msg)) return msg;
  }
  return fallback;
}
