import { CARE_OUTREACH_SMS_SUFFIX } from './careOutreachSmsMessage';
import { isEffectiveClientEmail } from './clientEmailGmailSearch';

export function clientHasEffectiveEmail(email: string | null | undefined): boolean {
  return isEffectiveClientEmail(email);
}

export function careOutreachEmailSubject(providerLastName?: string | null): string {
  const ln = providerLastName?.trim();
  return ln
    ? `Scheduling visit with Dr. ${ln}'s team at Vet At Your Door`
    : `Scheduling visit with Vet At Your Door team`;
}

export function forwardBookingEmailSubject(): string {
  return 'Following up on your Vet At Your Door visit';
}

export function holdEmailSubject(providerLastName?: string | null): string {
  const ln = providerLastName?.trim();
  return ln
    ? `Visit hold follow-up from Dr. ${ln}'s team at Vet At Your Door`
    : `Visit hold follow-up from Vet At Your Door`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function plainTextToClientEmailHtml(text: string): string {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (paragraphs.length === 0) return '';
  return paragraphs
    .map(
      (p) =>
        `<p style="margin:0 0 1em;line-height:1.55;font-family:Arial,sans-serif;font-size:14px;color:#111827;">${escapeHtml(p)}</p>`,
    )
    .join('');
}

function splitCareOutreachSmsBody(text: string): string[] {
  const parts: string[] = [];
  const bangMatch = text.match(/^(.+?!\s*)([\s\S]+)$/);
  if (!bangMatch) {
    parts.push(text.trim());
    return parts.filter(Boolean);
  }
  parts.push(bangMatch[1]!.trim());
  const rest = bangMatch[2]!.trim();
  const questionIdx = rest.indexOf('Would it be');
  if (questionIdx >= 0) {
    const before = rest.slice(0, questionIdx).trim();
    const question = rest.slice(questionIdx).trim();
    if (before) parts.push(before);
    if (question) parts.push(question);
  } else if (rest) {
    parts.push(rest);
  }
  return parts.filter(Boolean);
}

/** Turn scheduling-tool SMS copy into email subject + formatted body. */
export function formatSchedulingSmsAsEmail(
  smsText: string,
  opts: {
    subject: string;
    includeCareOutreachFooter?: boolean;
    genericFooter?: string;
  },
): { subject: string; bodyText: string; bodyHtml: string } {
  let text = smsText.trim();
  const hadCareSuffix = text.includes(CARE_OUTREACH_SMS_SUFFIX);
  if (hadCareSuffix) {
    text = text.replace(CARE_OUTREACH_SMS_SUFFIX, '').trim();
  }

  let footer: string;
  if (opts.includeCareOutreachFooter ?? hadCareSuffix) {
    footer = 'Neighborhood slots go fast — reply to this email if you would like to schedule.';
  } else {
    footer =
      opts.genericFooter ??
      'Reply to this email if that time works or to suggest another option.';
  }

  const bodyParts = splitCareOutreachSmsBody(text);
  const bodyText = [...bodyParts, footer].join('\n\n');
  const htmlParts = bodyParts.map((p) => plainTextToClientEmailHtml(p)).join('');
  const bodyHtml =
    htmlParts +
    `<p style="margin:0;line-height:1.55;font-family:Arial,sans-serif;font-size:14px;color:#111827;"><em>${escapeHtml(footer)}</em></p>`;

  return { subject: opts.subject, bodyText, bodyHtml };
}

export function careOutreachSmsToEmail(
  smsText: string,
  providerLastName?: string | null,
): { subject: string; bodyText: string; bodyHtml: string } {
  return formatSchedulingSmsAsEmail(smsText, {
    subject: careOutreachEmailSubject(providerLastName),
    includeCareOutreachFooter: true,
  });
}

export function forwardBookingSmsToEmail(smsText: string): {
  subject: string;
  bodyText: string;
  bodyHtml: string;
} {
  return formatSchedulingSmsAsEmail(smsText, {
    subject: forwardBookingEmailSubject(),
  });
}

export function holdSmsToEmail(
  smsText: string,
  providerLastName?: string | null,
): { subject: string; bodyText: string; bodyHtml: string } {
  const hadCareSuffix = smsText.includes(CARE_OUTREACH_SMS_SUFFIX);
  return formatSchedulingSmsAsEmail(smsText, {
    subject: holdEmailSubject(providerLastName),
    includeCareOutreachFooter: hadCareSuffix,
    genericFooter: hadCareSuffix
      ? undefined
      : 'Reply to this email if you would like to confirm or adjust the visit.',
  });
}
