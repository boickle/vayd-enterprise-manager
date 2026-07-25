import {
  createGmailDraft,
  deleteGmailDraft,
  fetchGmailSendAs,
  fetchGmailSendAsAlias,
  fetchGmailThread,
  findAllThreadDraftMessages,
  findThreadDraftMessage,
  modifyGmailMessage,
  replySubject,
  sendGmailMessage,
  threadDraftDeleteIds,
  updateGmailDraft,
  formatGmailAddress,
  type GmailDraftResponse,
  type GmailAddress,
  type GmailSendAsAlias,
  type GmailThreadMessage,
} from '../../api/gmail';
import { extractEmailsFromText, normalizeEmail } from '../../utils/gmailEmailExtract';

export type ComposeMode = 'new' | 'reply' | 'replyAll' | 'forward';

export type ComposeContext = {
  mode: ComposeMode;
  threadId?: string;
  replyTo?: GmailThreadMessage;
  mailboxEmail?: string;
  /** Override reply recipient (e.g. client email from a linked appointment request). */
  preferredTo?: string;
  /** When false, autosaved drafts must not move the thread into INBOX. */
  threadInInbox?: boolean;
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

const COMPOSE_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Split a recipient field into committed addresses and the token being typed. */
export function splitRecipientFieldActive(value: string): { committed: string; active: string } {
  const lastSep = Math.max(value.lastIndexOf(','), value.lastIndexOf(';'));
  if (lastSep === -1) {
    return { committed: '', active: value.trimStart() };
  }
  return {
    committed: value.slice(0, lastSep + 1).trim(),
    active: value.slice(lastSep + 1).trimStart(),
  };
}

function isCompleteRecipientToken(token: string): boolean {
  const trimmed = token.trim();
  if (!trimmed) return true;
  return COMPOSE_EMAIL_RE.test(extractEmail(trimmed));
}

/** Whether compose fields are ready for Gmail draft autosave (avoids invalid To headers). */
export function composeDraftSaveReady(fields: {
  from: string;
  to: string;
  cc: string;
}): boolean {
  const fromEmail = extractEmail(fields.from);
  if (!fromEmail || !COMPOSE_EMAIL_RE.test(fromEmail)) return false;

  const toActive = splitRecipientFieldActive(fields.to);
  if (!isCompleteRecipientToken(toActive.active)) return false;

  if (fields.cc.trim()) {
    const ccActive = splitRecipientFieldActive(fields.cc);
    if (!isCompleteRecipientToken(ccActive.active)) return false;
  }

  return true;
}

function buildReferences(replyTo?: GmailThreadMessage): string | undefined {
  if (!replyTo) return undefined;
  const prior = replyTo.headers.references?.trim();
  const msgId = replyTo.headers.messageId?.trim();
  if (prior && msgId) return `${prior} ${msgId}`.trim();
  return msgId || prior || undefined;
}

export function defaultFromAlias(aliases: GmailSendAsAlias[], mailbox: string): string {
  const match =
    aliases.find((a) => a.sendAsEmail.toLowerCase() === mailbox.toLowerCase()) ??
    aliases.find((a) => a.isDefault) ??
    aliases.find((a) => a.isPrimary) ??
    aliases[0];
  return match ? formatFromAlias(match) : mailbox;
}

/** Plain-text signature for the chosen send-as alias (from Gmail settings). */
export function plainTextFromHtml(html: string): string {
  const trimmed = html.trim();
  if (!trimmed) return '';
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(trimmed, 'text/html');
    const text = doc.body.textContent ?? '';
    return text.replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  }
  return trimmed
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function signatureForFromAlias(
  aliases: GmailSendAsAlias[],
  fromFormatted: string,
): string {
  const html = signatureHtmlForFromAlias(aliases, fromFormatted);
  if (!html) return '';
  return plainTextFromHtml(html);
}

export function signatureHtmlForFromAlias(
  aliases: GmailSendAsAlias[],
  fromFormatted: string,
): string {
  const email = extractEmail(fromFormatted).toLowerCase();
  const alias = aliases.find((a) => a.sendAsEmail.toLowerCase() === email);
  return alias?.signature?.trim() ?? '';
}

const REPLY_QUOTE_MARKER = '\n\n---\nOn ';
const FORWARD_QUOTE_MARKER = '\n\n---------- Forwarded message ---------\n';

const EMAIL_BODY_FONT =
  'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111;';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function plainTextToHtml(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br>');
}

export function buildComposeSendBodies(opts: {
  userText: string;
  signatureHtml: string;
  quotedSuffix: string;
  quotedMessage?: GmailThreadMessage | null;
}): { bodyText: string; bodyHtml: string } {
  const user = opts.userText.trim();
  const sigPlain = opts.signatureHtml ? plainTextFromHtml(opts.signatureHtml) : '';

  let text = user;
  if (sigPlain) text = text ? `${text}\n\n${sigPlain}` : sigPlain;

  let html = user ? `<div style="${EMAIL_BODY_FONT}">${plainTextToHtml(user)}</div>` : '';
  if (opts.signatureHtml.trim()) {
    html += html ? '<br>' : '';
    html += opts.signatureHtml.trim();
  }

  if (opts.quotedMessage && opts.quotedSuffix) {
    const attribution = `On ${new Date(opts.quotedMessage.date).toLocaleString()}, ${opts.quotedMessage.headers.from} wrote:`;
    const originalHtml =
      opts.quotedMessage.body.html ??
      plainTextToHtml(opts.quotedMessage.body.text ?? opts.quotedMessage.snippet);
    html +=
      `<br><div class="gmail_quote">` +
      `<div dir="ltr" style="${EMAIL_BODY_FONT}">${escapeHtml(attribution)}<br></div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">` +
      `${originalHtml}</blockquote></div>`;
    text += opts.quotedSuffix;
  } else if (opts.quotedSuffix) {
    text += opts.quotedSuffix;
    html += `<br><div style="${EMAIL_BODY_FONT}">${plainTextToHtml(opts.quotedSuffix.trimStart())}</div>`;
  }

  return { bodyText: text, bodyHtml: html };
}

export type ComposeDraft = {
  to: string;
  cc: string;
  subject: string;
  /** Quoted / forwarded tail — shown separately, not in the user typing area. */
  quotedSuffix: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
};

export function splitComposeBodySuffix(bodyText: string): {
  userPart: string;
  suffix: string;
} {
  const forwardIdx = bodyText.indexOf(FORWARD_QUOTE_MARKER);
  if (forwardIdx >= 0) {
    return { userPart: bodyText.slice(0, forwardIdx), suffix: bodyText.slice(forwardIdx) };
  }
  const replyIdx = bodyText.indexOf(REPLY_QUOTE_MARKER);
  if (replyIdx >= 0) {
    return { userPart: bodyText.slice(0, replyIdx), suffix: bodyText.slice(replyIdx) };
  }
  return { userPart: bodyText, suffix: '' };
}

export function joinComposeBody(userPart: string, signature: string, suffix: string): string {
  const top = userPart.replace(/\s+$/g, '');
  const sig = signature.trim();
  if (suffix) {
    return sig ? `${top}\n\n${sig}${suffix}` : `${top}${suffix}`;
  }
  return sig ? (top ? `${top}\n\n${sig}` : sig) : top;
}

const COMPOSE_USER_ATTR = 'data-compose-user';
const COMPOSE_SIG_ATTR = 'data-compose-signature';
const COMPOSE_QUOTE_ATTR = 'data-compose-quote';

export function buildQuotedComposeHtml(
  quotedSuffix: string,
  quotedMessage?: GmailThreadMessage | null,
): string {
  if (!quotedSuffix.trim() && !quotedMessage) return '';
  if (quotedMessage) {
    const attribution = `On ${new Date(quotedMessage.date).toLocaleString()}, ${quotedMessage.headers.from} wrote:`;
    const originalHtml =
      quotedMessage.body.html ??
      plainTextToHtml(quotedMessage.body.text ?? quotedMessage.snippet);
    return (
      `<div ${COMPOSE_QUOTE_ATTR}="true" class="gmail_quote">` +
      `<div dir="ltr" style="${EMAIL_BODY_FONT}color:#64748b">${escapeHtml(attribution)}</div>` +
      `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex;color:#64748b">` +
      `${originalHtml}</blockquote></div>`
    );
  }
  return `<div ${COMPOSE_QUOTE_ATTR}="true" style="${EMAIL_BODY_FONT}color:#64748b">${plainTextToHtml(quotedSuffix.trimStart())}</div>`;
}

/** Build unified HTML compose body: user area, signature, and quoted reply. */
export function joinComposeBodyHtml(
  userHtml: string,
  signatureHtml: string,
  quotedSuffix: string,
  quotedMessage?: GmailThreadMessage | null,
): string {
  const parts: string[] = [];
  const user = userHtml.trim() || '<br>';
  parts.push(`<div ${COMPOSE_USER_ATTR}="true" style="${EMAIL_BODY_FONT}">${user}</div>`);
  if (signatureHtml.trim()) {
    parts.push(`<div ${COMPOSE_SIG_ATTR}="true">${signatureHtml.trim()}</div>`);
  }
  const quoteHtml = buildQuotedComposeHtml(quotedSuffix, quotedMessage);
  if (quoteHtml) parts.push(quoteHtml);
  return parts.join('');
}

export function buildComposeSendBodiesFromEditorHtml(bodyHtml: string): {
  bodyText: string;
  bodyHtml: string;
} {
  const trimmed = bodyHtml.trim();
  if (!trimmed) return { bodyText: '', bodyHtml: '' };
  return { bodyText: plainTextFromHtml(trimmed), bodyHtml: trimmed };
}

/** User-typed portion of a unified HTML compose body. */
export function userTextFromComposeHtml(
  bodyHtml: string,
  signatureHtml: string,
  quotedSuffix: string,
): string {
  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(bodyHtml, 'text/html');
    const userEl = doc.querySelector(`[${COMPOSE_USER_ATTR}]`);
    if (userEl) return plainTextFromHtml(userEl.innerHTML);
  }
  const sigPlain = signatureHtml ? plainTextFromHtml(signatureHtml) : '';
  return userTextFromComposeBody(plainTextFromHtml(bodyHtml), sigPlain, quotedSuffix);
}

/** Swap send-as signature HTML while preserving user text and quoted tail. */
export function replaceSignatureHtmlInCompose(bodyHtml: string, newSignatureHtml: string): string {
  if (typeof DOMParser === 'undefined') return bodyHtml;
  const doc = new DOMParser().parseFromString(bodyHtml, 'text/html');
  const sigEl = doc.querySelector(`[${COMPOSE_SIG_ATTR}]`);
  if (!sigEl) return bodyHtml;
  if (newSignatureHtml.trim()) {
    sigEl.innerHTML = newSignatureHtml.trim();
  } else {
    sigEl.remove();
  }
  return doc.body.innerHTML;
}

/** HTML body from a saved Gmail draft message. */
export function fullHtmlFromDraftMessage(message: GmailThreadMessage): string {
  if (message.body.html?.trim()) return message.body.html.trim();
  const text = message.body.text ?? message.snippet ?? '';
  return plainTextToHtml(text);
}

/** Plain-text body from a saved Gmail draft message. */
export function fullBodyFromDraftMessage(message: GmailThreadMessage): string {
  const raw =
    message.body.text ??
    (message.body.html ? plainTextFromHtml(message.body.html) : '') ??
    message.snippet;
  return raw ?? '';
}

/** User-typed portion of a unified compose body (excludes signature and quoted tail). */
export function userTextFromComposeBody(
  body: string,
  sigPlain: string,
  quotedSuffix: string,
): string {
  const suffix = quotedSuffix.trimStart();
  let top = body;
  if (suffix) {
    const suffixIdx = body.indexOf(suffix);
    if (suffixIdx >= 0) top = body.slice(0, suffixIdx).replace(/\s+$/g, '');
    else {
      const { userPart } = splitComposeBodySuffix(body);
      top = userPart.replace(/\s+$/g, '');
    }
  } else {
    const { userPart } = splitComposeBodySuffix(body);
    top = userPart.replace(/\s+$/g, '');
  }
  const sig = sigPlain.trim();
  if (sig && top.endsWith(sig)) {
    top = top.slice(0, -sig.length).replace(/\s+$/g, '');
  }
  return top;
}

/** Swap send-as signature while preserving user text and quoted tail in a unified body. */
export function replaceSignatureBeforeQuote(
  body: string,
  oldSigPlain: string,
  newSigPlain: string,
  quotedSuffix: string,
): string {
  const suffix = quotedSuffix.trimStart();
  if (suffix) {
    const suffixIdx = body.indexOf(suffix);
    if (suffixIdx >= 0) {
      const beforeQuote = body.slice(0, suffixIdx).replace(/\s+$/g, '');
      const afterQuote = body.slice(suffixIdx);
      const old = oldSigPlain.trim();
      let userPart = beforeQuote;
      if (old && beforeQuote.endsWith(old)) {
        userPart = beforeQuote.slice(0, -old.length).replace(/\s+$/g, '');
      }
      return joinComposeBody(userPart, newSigPlain, '') + afterQuote;
    }
  }
  return replaceTrailingSignature(body, oldSigPlain, newSigPlain);
}

/** Swap the trailing send-as signature when the From alias changes. */
export function replaceTrailingSignature(
  userBody: string,
  oldSigPlain: string,
  newSigPlain: string,
): string {
  let body = userBody.replace(/\s+$/g, '');
  const old = oldSigPlain.trim();
  if (old && body.endsWith(old)) {
    body = body.slice(0, -old.length).replace(/\s+$/g, '');
  } else if (old && body === old) {
    body = '';
  }
  const next = newSigPlain.trim();
  if (!next) return body;
  return body ? `${body}\n\n${next}` : next;
}

function splitAddressList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function isMailboxAddress(addr: string, mailbox: string): boolean {
  return normalizeEmail(extractEmail(addr)) === normalizeEmail(mailbox);
}

/** External (non-mailbox) emails scraped from the message body — liaison notifications hide the client there. */
function externalEmailsFromMessage(message: GmailThreadMessage, mailbox: string): string[] {
  const mailboxNorm = normalizeEmail(mailbox) ?? '';
  const chunks = [
    message.body.text,
    message.body.html ? plainTextFromHtml(message.body.html) : null,
    message.snippet,
  ];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const chunk of chunks) {
    for (const email of extractEmailsFromText(chunk)) {
      if (email === mailboxNorm || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}

/**
 * Resolve the To line for reply / reply-all.
 * Reply: Reply-To, explicit override, then From (body scrape only for self-sent liaison mail).
 * Reply-all: Reply-To / override / From / To / Cc, excluding the active mailbox.
 */
export function resolveReplyToLine(
  message: GmailThreadMessage,
  mailbox: string,
  mode: ComposeMode,
  preferredTo?: string,
): string {
  const replyToHeader = message.headers.replyTo?.trim();

  if (mode === 'reply') {
    if (replyToHeader) return replyToHeader;
    if (preferredTo?.trim()) return preferredTo.trim();
    // Liaison notifications may send From the mailbox with the client email only in the body.
    if (isMailboxAddress(message.headers.from, mailbox)) {
      const external = externalEmailsFromMessage(message, mailbox);
      if (external.length === 1) return external[0]!;
    }
    return message.headers.from;
  }

  const parts: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string | undefined) => {
    for (const addr of splitAddressList(raw)) {
      if (isMailboxAddress(addr, mailbox)) continue;
      const key = (normalizeEmail(extractEmail(addr)) ?? addr).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(addr);
    }
  };

  if (replyToHeader) add(replyToHeader);
  else if (preferredTo?.trim()) add(preferredTo);
  add(message.headers.from);
  add(message.headers.to);
  if (mode === 'replyAll') add(message.headers.cc);

  if (parts.length === 0) {
    for (const email of externalEmailsFromMessage(message, mailbox)) {
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push(email);
    }
  }

  return parts.length > 0 ? parts.join(', ') : message.headers.from;
}

export function buildComposeDraft(
  ctx: ComposeContext,
): ComposeDraft {
  const replyTo = ctx.replyTo;
  const mailbox = ctx.mailboxEmail ?? '';

  if (ctx.mode === 'new') {
    return {
      to: '',
      cc: '',
      subject: '',
      quotedSuffix: '',
      threadId: ctx.threadId,
    };
  }

  if (!replyTo) {
    return { to: '', cc: '', subject: '', quotedSuffix: '' };
  }

  if (ctx.mode === 'forward') {
    const subj = replyTo.subject.trim();
    const subject = /^fwd:/i.test(subj) ? subj : `Fwd: ${subj || '(no subject)'}`;
    const body = replyTo.body.text ?? replyTo.snippet;
    return {
      to: '',
      cc: '',
      subject,
      quotedSuffix: `\n\n---------- Forwarded message ---------\nFrom: ${replyTo.headers.from}\nDate: ${new Date(replyTo.date).toLocaleString()}\nSubject: ${replyTo.subject}\nTo: ${replyTo.headers.to}\n\n${body}`,
    };
  }

  const toLine = resolveReplyToLine(replyTo, mailbox, ctx.mode, ctx.preferredTo);
  const quoted = `\n\n---\nOn ${new Date(replyTo.date).toLocaleString()}, ${replyTo.headers.from} wrote:\n${replyTo.body.text ?? replyTo.snippet}`;

  return {
    to: toLine,
    cc: ctx.mode === 'replyAll' ? replyTo.headers.cc : '',
    subject: replySubject(replyTo.subject),
    quotedSuffix: quoted,
    threadId: ctx.threadId ?? replyTo.threadId,
    inReplyTo: replyTo.headers.messageId || undefined,
    references: buildReferences(replyTo),
  };
}

export async function loadSendAsAliases(mailbox: string): Promise<GmailSendAsAlias[]> {
  const { aliases } = await fetchGmailSendAs(mailbox);
  const enriched = await Promise.all(
    aliases.map(async (alias) => {
      if (alias.signature?.trim()) return alias;
      try {
        const detail = await fetchGmailSendAsAlias(mailbox, alias.sendAsEmail);
        return { ...alias, ...detail };
      } catch {
        return alias;
      }
    }),
  );
  return enriched;
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
  /** Defaults to tracked; false sends without a read receipt. */
  trackOpens?: boolean;
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
    trackOpens: opts.trackOpens,
  });
}

export type GmailComposeDraftSavedInfo = {
  draftId: string;
  threadId: string;
  snippet: string;
  labelIds?: string[];
};

export function draftListSnippet(userText: string, maxLen = 120): string {
  const line = userText.replace(/\s+/g, ' ').trim();
  if (!line) return '';
  if (line.length <= maxLen) return line;
  return `${line.slice(0, maxLen - 1)}…`;
}

/** Strip signature and quoted tail from a saved draft message body. */
export function userBodyFromDraftMessage(
  message: GmailThreadMessage,
  signatureHtml: string,
): string {
  const raw =
    message.body.text ??
    (message.body.html ? plainTextFromHtml(message.body.html) : '') ??
    message.snippet;
  const { userPart } = splitComposeBodySuffix(raw);
  const sigPlain = signatureHtml ? plainTextFromHtml(signatureHtml) : '';
  let body = userPart.replace(/\s+$/g, '');
  if (sigPlain && body.endsWith(sigPlain)) {
    body = body.slice(0, -sigPlain.length).replace(/\s+$/g, '');
  }
  return body;
}

export function formatRecipientField(addresses: GmailAddress[]): string {
  return addresses
    .map((addr) => formatGmailAddress(addr))
    .filter(Boolean)
    .join(', ');
}

export function loadComposeFromThreadDraft(
  threadMessages: GmailThreadMessage[] | undefined,
): {
  draftId: string;
  bodyHtml: string;
  to: string;
  cc: string;
  subject: string;
  from: string;
} | null {
  const draft = findThreadDraftMessage(threadMessages ?? []);
  if (!draft) return null;
  const draftId = draft.draftId?.trim() || draft.id;
  const to =
    formatRecipientField(draft.to) ||
    draft.headers.to
      ?.split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(', ') ||
    '';
  return {
    draftId,
    bodyHtml: fullHtmlFromDraftMessage(draft),
    to: to ? `${to.replace(/,\s*$/, '')}, ` : '',
    cc: draft.headers.cc?.trim() ?? '',
    subject: draft.subject?.trim() || draft.headers.subject?.trim() || '',
    from: draft.headers.from?.trim() || formatGmailAddress(draft.from),
  };
}

function composePayloadFromFields(opts: {
  from: string;
  to: string;
  cc: string;
  subject: string;
  userText: string;
  signatureHtml: string;
  quotedSuffix: string;
  quotedMessage?: GmailThreadMessage | null;
  editorHtml?: string;
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
  const { bodyText, bodyHtml } =
    opts.editorHtml != null
      ? buildComposeSendBodiesFromEditorHtml(opts.editorHtml)
      : buildComposeSendBodies({
          userText: opts.userText,
          signatureHtml: opts.signatureHtml,
          quotedSuffix: opts.quotedSuffix,
          quotedMessage: opts.quotedMessage ?? null,
        });
  return {
    from: extractEmail(opts.from),
    to,
    cc: cc.length ? cc : undefined,
    subject: opts.subject,
    bodyText,
    bodyHtml,
    threadId: opts.threadId,
    inReplyTo: opts.inReplyTo,
    references: opts.references,
  };
}

export async function saveComposeDraft(opts: {
  mailbox: string;
  draftId?: string;
  from: string;
  to: string;
  cc: string;
  subject: string;
  userText: string;
  signatureHtml: string;
  quotedSuffix: string;
  quotedMessage?: GmailThreadMessage | null;
  editorHtml?: string;
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  threadInInbox?: boolean;
  threadMessages?: GmailThreadMessage[];
}): Promise<GmailDraftResponse> {
  let draftId = opts.draftId?.trim();
  if (!draftId && opts.threadId?.trim() && opts.threadMessages?.length) {
    const existing = findAllThreadDraftMessages(opts.threadMessages);
    const latest = existing[existing.length - 1];
    if (latest) {
      draftId = latest.draftId?.trim() || latest.id;
    }
  }

  const payload = {
    ...composePayloadFromFields(opts),
    ...(opts.threadInInbox === false ? { keepOutOfInbox: true as const } : {}),
  };
  const result = draftId
    ? await updateGmailDraft(opts.mailbox, draftId, payload)
    : await createGmailDraft(opts.mailbox, payload);

  if (opts.threadInInbox === false && opts.threadId) {
    try {
      const modified = await modifyGmailMessage(
        opts.mailbox,
        result.id,
        { removeLabelIds: ['INBOX'] },
        opts.threadId,
      );
      return { ...result, labelIds: modified.labelIds };
    } catch {
      /* Gmail may already omit INBOX when keepOutOfInbox is honored server-side */
    }
  }
  return result;
}

export async function discardComposeDraft(mailbox: string, draftId: string): Promise<void> {
  await deleteGmailDraft(mailbox, draftId);
}

/** Delete every draft on a thread — autosave can leave orphans if ids get out of sync. */
export async function discardAllThreadDrafts(
  mailbox: string,
  threadId: string | undefined,
  threadMessages?: GmailThreadMessage[],
): Promise<void> {
  const trimmedThreadId = threadId?.trim();
  let messages = threadMessages ?? [];
  if (trimmedThreadId && messages.length === 0) {
    const thread = await fetchGmailThread(mailbox, trimmedThreadId);
    messages = thread.messages;
  }

  const drafts = findAllThreadDraftMessages(messages);
  const tried = new Set<string>();
  for (const draft of drafts) {
    for (const id of threadDraftDeleteIds(draft)) {
      if (tried.has(id)) continue;
      tried.add(id);
      try {
        await deleteGmailDraft(mailbox, id);
        break;
      } catch {
        /* try alternate id for this draft */
      }
    }
  }
}

export { formatFromAlias, extractEmail };
