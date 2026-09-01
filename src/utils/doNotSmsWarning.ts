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
