import { appConfirm } from './appDialog';

export async function confirmSendDespiteDoNotSms(doNotSms: boolean): Promise<boolean> {
  if (!doNotSms) return true;
  return appConfirm({
    title: 'Do not SMS is on',
    message:
      'This client is marked Do not SMS. Automated texts are blocked. Send a text from Scout anyway?',
    confirmLabel: 'Send anyway',
    danger: true,
  });
}

export function clientDoNotSmsFromRecord(record: unknown): boolean {
  if (!record || typeof record !== 'object') return false;
  const o = record as Record<string, unknown>;
  return o.doNotSms === true || o.smsOptOut === true;
}

/** "Nov 9, 2026" in the practice's time zone. */
export function formatTextsOffDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'America/New_York',
  });
}

/**
 * Why Scout turned this client's texts off by itself: "Texts off: replied STOP (Nov 9, 2026)" or
 * "Texts off: Quo blocked (…)". Null when texts are on, or staff turned them off (that one can still
 * be overridden with "Send anyway"; a STOP reply or Quo block cannot, Quo refuses the text).
 */
export function clientTextsOffReason(record: unknown): string | null {
  if (!record || typeof record !== 'object') return null;
  const o = record as Record<string, unknown>;
  if (!clientDoNotSmsFromRecord(record)) return null;
  const source = typeof o.smsOptOutSource === 'string' ? o.smsOptOutSource.trim() : '';
  if (!source) return null;
  const when = typeof o.smsOptOutAt === 'string' ? formatTextsOffDate(o.smsOptOutAt) : '';
  return `Texts off: ${source}${when ? ` (${when})` : ''}`;
}
