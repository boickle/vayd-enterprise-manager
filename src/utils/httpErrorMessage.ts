/** Prefer server `message` over axios' generic "Request failed with status code …". */
export function extractHttpErrorMessage(err: unknown, fallback = 'Request failed'): string {
  if (typeof err === 'string') return err.trim() || fallback;
  if (err && typeof err === 'object') {
    const ax = err as {
      response?: { data?: { message?: string; error?: string } };
      message?: string;
    };
    const server = ax.response?.data?.message?.trim() || ax.response?.data?.error?.trim();
    if (server) return server;
    const msg = ax.message?.trim();
    if (msg && !/^Request failed with status code \d+$/i.test(msg)) return msg;
  }
  return fallback;
}
