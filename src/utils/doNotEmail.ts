/**
 * "Do not email" (owner, Nov 13, 2026): staff can't email a client who asked not to be emailed. The API refuses the
 * send (422, code EMAIL_OPT_OUT); the email windows say so before anyone types a message.
 */
export const EMAIL_OPT_OUT_CODE = 'EMAIL_OPT_OUT';

function pick(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** True when the staff client payload has "Do not email" on. */
export function clientHasDoNotEmail(client: unknown): boolean {
  return Boolean(client && typeof client === 'object' && (client as Record<string, unknown>).doNotEmail === true);
}

/** The client's own addresses (primary and second), lower-cased. */
export function clientOwnEmails(client: unknown): string[] {
  if (!client || typeof client !== 'object') return [];
  const c = client as Record<string, unknown>;
  return [pick(c.email), pick(c.secondEmail)].filter((e): e is string => !!e).map((e) => e.toLowerCase());
}

/** Does a "To" line ("a@x.com, b@y.com") include one of the client's own addresses? */
export function toLineHitsClient(toLine: string, client: unknown): boolean {
  const own = new Set(clientOwnEmails(client));
  if (!own.size) return false;
  return toLine
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .some((s) => s && own.has(s));
}

export function doNotEmailMessage(clientName: string | null | undefined): string {
  const who = clientName?.trim() || 'This client';
  return (
    `${who} has "Do not email" on, so Scout won't email them. Call or text instead. ` +
    'If they ask for email again, clear "Do not email" on the client page.'
  );
}
