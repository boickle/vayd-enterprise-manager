import DOMPurify from 'dompurify';

/** Heuristic: string looks like HTML markup (email bodies from PIMS, etc.). */
export function looksLikeHtmlFragment(s: string): boolean {
  if (!s || s.length < 4) return false;
  return /<[a-z][\s\S]*>/i.test(s);
}

/** Strip tags for one-line summaries and collapsed previews (safe, no script execution). */
export function htmlToPlainText(html: string): string {
  if (typeof document !== 'undefined') {
    const d = document.createElement('div');
    d.innerHTML = html;
    const t = d.textContent ?? d.innerText ?? '';
    return t.replace(/\s+/g, ' ').trim();
  }
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Sanitize HTML for inline display (communication logs). Allows typical email tags;
 * strips scripts/event handlers. Relative img URLs (e.g. PIMS /Practice/...) are kept.
 */
export function sanitizeCommunicationHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|\/|#)/i,
  });
}
