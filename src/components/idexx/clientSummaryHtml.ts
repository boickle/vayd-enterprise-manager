import { sanitizeCommunicationHtml } from '../../utils/sanitizeCommunicationHtml';

/**
 * The client summary is plain text when the AI drafts it ("- " bullets, blank lines between
 * paragraphs) and HTML once a doctor edits it in the formatting editor (owner, Nov 9, 2026).
 * These helpers turn either form into what each place needs: the editor, the read view, the
 * email, and plain text for copying, previews and the "[doctor to add]" check.
 */

const EMAIL_P =
  'margin:0 0 14px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1f2937;';
const EMAIL_LI =
  'margin:0 0 8px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1f2937;';
const EMAIL_LIST = 'margin:0 0 14px;padding-left:22px;';

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** True when the summary was saved from the formatting editor. */
export function isSummaryHtml(value: string | null | undefined): boolean {
  return /<(p|div|ul|ol|li|br|strong|b|em|i|u|a)\b/i.test(value ?? '');
}

/** Plain text (paragraphs and "- " bullets) as HTML; `styled` adds the email's inline styles. */
export function summaryTextToHtml(text: string, styled = false): string {
  const p = styled ? ` style="${EMAIL_P}"` : '';
  const li = styled ? ` style="${EMAIL_LI}"` : '';
  const ul = styled ? ` style="${EMAIL_LIST}"` : '';
  const out: string[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  const flushPara = () => {
    const bits = para.map((l) => escapeHtml(l.trim())).filter(Boolean);
    para = [];
    if (bits.length) out.push(`<p${p}>${bits.join('<br>')}</p>`);
  };
  const flushBullets = () => {
    if (!bullets.length) return;
    out.push(`<ul${ul}>${bullets.map((b) => `<li${li}>${escapeHtml(b)}</li>`).join('')}</ul>`);
    bullets = [];
  };
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim();
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (!line) {
      flushPara();
      flushBullets();
    } else if (bullet) {
      flushPara();
      bullets.push(bullet[1]);
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return out.join('');
}

/** What the formatting editor starts with. */
export function summaryEditorHtml(value: string | null | undefined): string {
  const v = value ?? '';
  return isSummaryHtml(v) ? sanitizeCommunicationHtml(v) : summaryTextToHtml(v);
}

/** Plain text: paragraphs separated by a blank line, list items as "- " lines. */
export function summaryPlainText(value: string | null | undefined): string {
  const v = value ?? '';
  if (!isSummaryHtml(v)) return v;
  const doc = new DOMParser().parseFromString(`<div>${sanitizeCommunicationHtml(v)}</div>`, 'text/html');
  const lines: string[] = [];
  const walk = (node: Element) => {
    for (const child of Array.from(node.children)) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'ul' || tag === 'ol') {
        Array.from(child.children).forEach((li) => lines.push(`- ${(li.textContent ?? '').trim()}`));
        lines.push('');
      } else if (tag === 'p' || tag === 'div') {
        if (child.querySelector('p, div, ul, ol')) walk(child);
        else {
          lines.push((child as HTMLElement).innerText ?? child.textContent ?? '');
          lines.push('');
        }
      } else {
        lines.push(child.textContent ?? '');
      }
    }
    // Text written straight into the editor root, without a paragraph around it.
    const loose = Array.from(node.childNodes)
      .filter((n) => n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent?.trim())
      .filter(Boolean);
    if (loose.length) lines.unshift(loose.join(' '), '');
  };
  walk(doc.body.firstElementChild as Element);
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** The email body: the doctor's formatting with the email's inline styles. */
export function summaryEmailHtml(value: string): string {
  if (!isSummaryHtml(value)) return summaryTextToHtml(value, true);
  const doc = new DOMParser().parseFromString(`<div>${sanitizeCommunicationHtml(value)}</div>`, 'text/html');
  const root = doc.body.firstElementChild as HTMLElement;
  root.querySelectorAll('p, div').forEach((el) => el.setAttribute('style', EMAIL_P));
  root.querySelectorAll('li').forEach((el) => el.setAttribute('style', EMAIL_LI));
  root.querySelectorAll('ul, ol').forEach((el) => el.setAttribute('style', EMAIL_LIST));
  return root.innerHTML;
}
