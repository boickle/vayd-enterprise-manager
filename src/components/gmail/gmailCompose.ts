import {
  fetchGmailSendAs,
  replySubject,
  sendGmailMessage,
  type GmailSendAsAlias,
  type GmailThreadMessage,
} from '../../api/gmail';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export type ComposeContext = {
  mode: ComposeMode;
  threadId?: string;
  replyTo?: GmailThreadMessage;
  mailboxEmail?: string;
};

function formatFromAlias(alias: GmailSendAsAlias): string {
  const name = alias.displayName?.trim();
  if (name) return `${name} <${alias.sendAsEmail}>`;
  return alias.sendAsEmail;
}

function extractEmail(raw: string): string {
  const match = raw.match(/<([^>]+)>/);
  return (match?.[1] ?? raw).trim();
}

function buildReferences(replyTo?: GmailThreadMessage): string | undefined {
  if (!replyTo) return undefined;
  const prior = replyTo.headers.references?.trim();
  const msgId = replyTo.headers.messageId?.trim();
  if (prior && msgId) return `${prior} ${msgId}`.trim();
  return msgId || prior || undefined;
}

export function buildComposeDraft(ctx: ComposeContext): {
  to: string;
  cc: string;
  subject: string;
  bodyText: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
} {
  const replyTo = ctx.replyTo;
  const mailbox = ctx.mailboxEmail ?? '';

  if (ctx.mode === 'new') {
    return {
      to: '',
      cc: '',
      subject: '',
      bodyText: '',
    };
  }

  if (!replyTo) {
    return { to: '', cc: '', subject: '', bodyText: '' };
  }

  if (ctx.mode === 'forward') {
    const subj = replyTo.subject.trim();
    const subject = /^fwd:/i.test(subj) ? subj : `Fwd: ${subj || '(no subject)'}`;
    const body = replyTo.body.text ?? replyTo.snippet;
    return {
      to: '',
      cc: '',
      subject,
      bodyText: `\n\n---------- Forwarded message ---------\nFrom: ${replyTo.headers.from}\nDate: ${new Date(replyTo.date).toLocaleString()}\nSubject: ${replyTo.subject}\nTo: ${replyTo.headers.to}\n\n${body}`,
    };
  }

  const fromEmail = extractEmail(replyTo.headers.from);
  const toLine =
    ctx.mode === 'replyAll'
      ? [replyTo.headers.from, replyTo.headers.to]
          .filter(Boolean)
          .join(', ')
          .split(',')
          .map((s) => s.trim())
          .filter((addr) => {
            const email = extractEmail(addr).toLowerCase();
            return email && email !== mailbox.toLowerCase();
          })
          .join(', ')
      : replyTo.headers.from;

  const quoted = `\n\n---\nOn ${new Date(replyTo.date).toLocaleString()}, ${replyTo.headers.from} wrote:\n${replyTo.body.text ?? replyTo.snippet}`;

  return {
    to: toLine,
    cc: ctx.mode === 'replyAll' ? replyTo.headers.cc : '',
    subject: replySubject(replyTo.subject),
    bodyText: quoted,
    threadId: ctx.threadId ?? replyTo.threadId,
    inReplyTo: replyTo.headers.messageId || undefined,
    references: buildReferences(replyTo),
  };
}

export async function loadSendAsAliases(mailbox: string): Promise<GmailSendAsAlias[]> {
  const { aliases } = await fetchGmailSendAs(mailbox);
  return aliases;
}

export function defaultFromAlias(aliases: GmailSendAsAlias[], mailbox: string): string {
  const match =
    aliases.find((a) => a.sendAsEmail.toLowerCase() === mailbox.toLowerCase()) ??
    aliases.find((a) => a.isDefault) ??
    aliases.find((a) => a.isPrimary) ??
    aliases[0];
  return match ? formatFromAlias(match) : mailbox;
}

export async function submitCompose(opts: {
  mailbox: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
}) {
  const to = opts.to
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  const cc = opts.cc
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return sendGmailMessage(opts.mailbox, {
    from: extractEmail(opts.from),
    to,
    cc: cc.length ? cc : undefined,
    subject: opts.subject,
    bodyText: opts.bodyText,
    bodyHtml: opts.bodyHtml,
    threadId: opts.threadId,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  });
}

export { formatFromAlias, extractEmail };
