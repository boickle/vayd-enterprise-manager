import DOMPurify from 'dompurify';

/**
 * PA-08: the one profile for showing an email body (inbox thread, client email history, appointment-request
 * email). Email HTML comes from anyone who can write to the practice, so it is never rendered as sent:
 * - no script, event handlers (`on…`), forms or form controls, iframes/frames/objects/embeds, `base`, `meta`
 *   or `link`;
 * - no `javascript:` or `data:` URLs (or anything that is not http(s), mailto, tel, a relative path or `#`);
 * - every link opens in a new tab with `rel="noopener noreferrer"`.
 * Ordinary formatting, https images, links and quoted earlier messages are kept.
 */
const FORBID_TAGS = [
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'form',
  'input',
  'button',
  'textarea',
  'select',
  'option',
  'base',
  'meta',
  'link',
];
const FORBID_ATTR = ['action', 'formaction', 'srcdoc', 'xmlns'];
const ALLOWED_URI_REGEXP = /^(?:(?:https?|mailto|tel):|\/|#)/i;
const URL_ATTRS = ['href', 'src', 'xlink:href', 'action', 'formaction', 'background', 'poster', 'cite'];
const UNSAFE_URL = /^\s*(?:javascript|data|vbscript):/i;

/** Screens re-render while staff type; keep recent results so a long email is not cleaned on every key. */
const cache = new Map<string, string>();
const CACHE_LIMIT = 50;

export function sanitizeEmailHtml(html: string | null | undefined): string {
  if (!html) return '';
  const hit = cache.get(html);
  if (hit !== undefined) return hit;
  const out = sanitize(html);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  cache.set(html, out);
  return out;
}

function sanitize(html: string): string {
  const clean = DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS,
    FORBID_ATTR,
    ALLOWED_URI_REGEXP,
    ADD_ATTR: ['target'],
  });
  if (typeof document === 'undefined') return clean;

  // DOMPurify still lets `data:` through on media `src`; drop it, and set every link's target and rel.
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  for (const el of Array.from(tpl.content.querySelectorAll('*'))) {
    for (const name of URL_ATTRS) {
      const value = el.getAttribute(name);
      if (value != null && UNSAFE_URL.test(value)) el.removeAttribute(name);
    }
    const srcset = el.getAttribute('srcset');
    if (srcset != null && /(?:javascript|data|vbscript):/i.test(srcset)) el.removeAttribute('srcset');
    if (el.tagName === 'A') {
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
    }
  }
  return tpl.innerHTML;
}
