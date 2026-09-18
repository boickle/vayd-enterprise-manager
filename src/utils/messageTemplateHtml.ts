import { htmlToPlainText, looksLikeHtmlFragment } from './sanitizeCommunicationHtml';

/** Keep paragraph breaks when an HTML email template is used as a text. */
export function htmlToMultilinePlain(html: string): string {
  const normalized = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n');
  if (typeof document !== 'undefined') {
    const d = document.createElement('div');
    d.innerHTML = normalized;
    return (d.textContent ?? '').replace(/\n{3,}/g, '\n\n').trim();
  }
  return htmlToPlainText(normalized);
}

export function templateBodyForChannel(
  body: string,
  channel: 'email' | 'sms' | 'both',
): string {
  if (channel === 'sms' && looksLikeHtmlFragment(body)) {
    return htmlToMultilinePlain(body);
  }
  return body;
}
