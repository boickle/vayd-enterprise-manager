/**
 * One conversation per appointment request: emails in the request's Gmail thread, texts with the
 * request's phone number, and calls staff logged, in time order. Pure so it is easy to test.
 */
import type { GmailThreadMessage } from '../api/gmail';
import { isAppointmentRequestNotificationSubject } from './appointmentRequestDisplay';

export type ConversationChannel = 'email' | 'text' | 'call' | 'event';

export type ConversationItem = {
  key: string;
  channel: ConversationChannel;
  /** 'in' = from the client; 'out' = from us; 'event' items have no side. */
  direction: 'in' | 'out' | 'none';
  at: string;
  body: string;
  /** Email subject, call outcome label, or event title. */
  title?: string | null;
  /** Who on our side sent it, when known. */
  author?: string | null;
  /** Text sent before the request came in: folded under "Show earlier texts". */
  beforeRequest?: boolean;
};

export type ConversationText = {
  id: string;
  direction: 'in' | 'out';
  body: string;
  at: string;
  beforeRequest: boolean;
};

export type ConversationCall = {
  id: number;
  at: string;
  outcome: 'reached' | 'voicemail' | 'no_answer';
  note: string | null;
  employee: { firstName: string | null; lastName: string | null } | null;
};

export const CALL_OUTCOME_LABELS: Record<ConversationCall['outcome'], string> = {
  reached: 'Reached',
  voicemail: 'Left voicemail',
  no_answer: 'No answer',
};

function lower(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase();
}

function timeMs(iso: string): number {
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? t : 0;
}

function personName(
  p: { firstName?: string | null; lastName?: string | null } | null | undefined
): string | null {
  const n = [p?.firstName, p?.lastName].filter(Boolean).join(' ').trim();
  return n || null;
}

/** Plain text from an HTML email body (no DOM needed). */
export function emailHtmlToText(html: string): string {
  return html
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)\s*\/?>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Just the new part of an email: drops the quoted history ("On … wrote:", "> " lines,
 * "-----Original Message-----", Outlook "From: … Sent:" headers).
 */
export function stripQuotedEmailText(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (/^on .+wrote:?$/i.test(t)) break;
    // Gmail wraps a long "On … wrote:" onto two lines.
    if (/^on .+/i.test(t) && /wrote:?$/i.test((lines[i + 1] ?? '').trim())) break;
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(t)) break;
    if (/^from:\s.+/i.test(t) && /^(sent|date):\s/i.test((lines[i + 1] ?? '').trim())) break;
    if (t.startsWith('>')) continue;
    out.push(line);
  }
  return out.join('\n').trim();
}

function emailBody(m: GmailThreadMessage): string {
  const raw = m.body.text?.trim()
    ? m.body.text
    : m.body.html
      ? emailHtmlToText(m.body.html)
      : m.snippet;
  return stripQuotedEmailText(raw ?? '') || (m.snippet ?? '').trim();
}

export function buildRequestConversation(args: {
  submittedAt: string;
  clientEmail: string | null;
  emails: readonly GmailThreadMessage[];
  texts: readonly ConversationText[];
  calls: readonly ConversationCall[];
}): ConversationItem[] {
  const clientEmail = lower(args.clientEmail);
  const items: ConversationItem[] = [
    {
      key: 'event-received',
      channel: 'event',
      direction: 'none',
      at: args.submittedAt,
      title: 'Request received',
      body: '',
    },
  ];

  for (const m of args.emails) {
    if (m.labelIds?.includes('DRAFT')) continue;
    const fromClient = clientEmail !== '' && lower(m.from?.email) === clientEmail;
    // The thread starts with the internal "Appointment Request: …" email to the CL inbox.
    if (
      !fromClient &&
      isAppointmentRequestNotificationSubject(m.subject) &&
      !/^re:/i.test(m.subject.trim())
    ) {
      continue;
    }
    items.push({
      key: `email-${m.id}`,
      channel: 'email',
      direction: fromClient ? 'in' : 'out',
      at: m.date,
      title: m.subject,
      author: fromClient ? null : m.from?.name?.trim() || m.from?.email || null,
      body: emailBody(m),
    });
  }

  for (const t of args.texts) {
    items.push({
      key: `text-${t.id || t.at}`,
      channel: 'text',
      direction: t.direction,
      at: t.at,
      body: t.body,
      beforeRequest: t.beforeRequest,
    });
  }

  for (const c of args.calls) {
    items.push({
      key: `call-${c.id}`,
      channel: 'call',
      direction: 'out',
      at: c.at,
      title: CALL_OUTCOME_LABELS[c.outcome] ?? c.outcome,
      author: personName(c.employee),
      body: c.note ?? '',
    });
  }

  return items.sort((a, b) => timeMs(a.at) - timeMs(b.at));
}

/** One-line state under the conversation: "Owner replied by text · 9:24 AM", "Contacted · no reply yet". */
export function conversationSummary(items: readonly ConversationItem[]): {
  tone: 'none' | 'waiting' | 'replied';
  label: string;
  at: string | null;
} {
  const live = items.filter((i) => i.channel !== 'event' && !i.beforeRequest);
  const last = live[live.length - 1];
  if (!last) return { tone: 'none', label: 'Not contacted yet', at: null };
  if (last.direction === 'in') {
    return {
      tone: 'replied',
      label: last.channel === 'text' ? 'Owner texted back' : 'Owner emailed back',
      at: last.at,
    };
  }
  return { tone: 'waiting', label: 'Contacted · no reply yet', at: last.at };
}
