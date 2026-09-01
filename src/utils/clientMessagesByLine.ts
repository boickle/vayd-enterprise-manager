import type { Message } from '../api/clientPortal';
import { phonesMatchForQuo, phoneToQuoDialDigits } from './quoContact';

export const CLIENT_MESSAGES_PER_LINE = 10;

export type ClientMessagesLineGroup = {
  /** Normalized key for grouping (10-digit NANP when possible). */
  lineKey: string;
  /** Representative phone string from the messages. */
  linePhone: string;
  messages: Message[];
  latestAt: string;
};

function clientPhonesFrom(input: string | readonly string[] | null | undefined): string[] {
  if (input == null) return [];
  const parts = typeof input === 'string' ? [input] : [...input];
  return parts
    .flatMap((p) => p.split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean);
}

function isOutgoingMessage(message: Message): boolean {
  const dir = String(message.direction ?? '').toLowerCase();
  return dir === 'outgoing' || dir === 'outbound';
}

/** The practice OpenPhone / Quo line a message was sent on or received by. */
export function practiceLineOnMessage(
  message: Message,
  clientPhone: string | readonly string[],
): string {
  const clientPhones = clientPhonesFrom(clientPhone);
  const isClient = (phone: string) => clientPhones.some((c) => phonesMatchForQuo(phone, c));
  if (isOutgoingMessage(message)) {
    return message.from?.trim() || 'unknown';
  }
  const toList = Array.isArray(message.to) ? message.to : message.to ? [message.to] : [];
  for (const to of toList) {
    const trimmed = to?.trim();
    if (trimmed && !isClient(trimmed)) return trimmed;
  }
  for (const to of toList) {
    const trimmed = to?.trim();
    if (trimmed) return trimmed;
  }
  return message.from?.trim() || 'unknown';
}

export function lineKeyForPhone(phone: string): string {
  return phoneToQuoDialDigits(phone) ?? phone.trim();
}

/** True when this Quo message was sent to or received from the given client number. */
export function messageTouchesClientPhone(message: Message, clientPhone: string): boolean {
  if (phonesMatchForQuo(message.from, clientPhone)) return true;
  const toList = Array.isArray(message.to) ? message.to : message.to ? [message.to] : [];
  return toList.some((to) => phonesMatchForQuo(to, clientPhone));
}

export function groupClientMessagesByLine(
  messages: Message[],
  clientPhone: string | readonly string[],
  perLineLimit = CLIENT_MESSAGES_PER_LINE,
): ClientMessagesLineGroup[] {
  const byKey = new Map<string, { linePhone: string; messages: Message[] }>();

  for (const message of messages) {
    const linePhone = practiceLineOnMessage(message, clientPhone);
    const key = lineKeyForPhone(linePhone);
    const bucket = byKey.get(key);
    if (bucket) {
      bucket.messages.push(message);
      if (!phonesMatchForQuo(bucket.linePhone, linePhone)) {
        /* keep first seen format */
      }
    } else {
      byKey.set(key, { linePhone, messages: [message] });
    }
  }

  const groups: ClientMessagesLineGroup[] = [];
  for (const [lineKey, { linePhone, messages: lineMessages }] of byKey) {
    const sorted = [...lineMessages].sort(
      (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
    );
    groups.push({
      lineKey,
      linePhone,
      messages: sorted.slice(0, perLineLimit),
      latestAt: sorted[0]?.createdAt ?? '',
    });
  }

  groups.sort((a, b) => Date.parse(b.latestAt) - Date.parse(a.latestAt));
  return groups;
}
