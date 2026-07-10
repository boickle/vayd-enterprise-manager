import type { GmailThreadMessage } from '../api/gmail';
import { plainTextFromHtml } from '../components/gmail/gmailCompose';

function messageTimestamp(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** Plain-text preview from the first message in a thread (not the latest Gmail snippet). */
export function threadListPreviewFromMessages(
  messages: readonly GmailThreadMessage[],
  maxLen = 160,
): string {
  if (messages.length === 0) return '';

  const sorted = [...messages].sort((a, b) => messageTimestamp(a.date) - messageTimestamp(b.date));
  const first =
    sorted.find((m) => !m.labelIds.includes('DRAFT') && !m.labelIds.includes('TRASH')) ?? sorted[0];
  if (!first) return '';

  let raw =
    first.body.text?.trim() ||
    (first.body.html ? plainTextFromHtml(first.body.html).trim() : '') ||
    first.snippet?.trim() ||
    '';

  raw = raw.replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen - 1)}…`;
}

export function threadCacheKey(mailbox: string, threadId: string): string {
  return `${mailbox}::${threadId}`;
}
