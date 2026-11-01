/**
 * Block designs for campaign emails and their rendering to email-client-safe HTML:
 * a single 600px table layout with inline styles, which Outlook, Gmail and Apple Mail
 * all render the same way.
 */

export type Align = 'left' | 'center' | 'right';

export type EmailBlock =
  | { id: string; type: 'heading'; text: string; level: 1 | 2; align: Align; color: string }
  | { id: string; type: 'text'; html: string; align: Align }
  | {
      id: string;
      type: 'image';
      src: string;
      alt: string;
      href: string;
      /** Percent of the content width. */
      widthPercent: number;
      align: Align;
    }
  | {
      id: string;
      type: 'button';
      label: string;
      href: string;
      backgroundColor: string;
      textColor: string;
      align: Align;
    }
  | { id: string; type: 'divider'; color: string }
  | { id: string; type: 'spacer'; height: number }
  | { id: string; type: 'html'; html: string };

export type EmailBlockType = EmailBlock['type'];

export type EmailDesignSettings = {
  backgroundColor: string;
  contentBackgroundColor: string;
  textColor: string;
  linkColor: string;
  fontFamily: string;
  footerHtml: string;
};

export type EmailDesign = {
  version: 1;
  settings: EmailDesignSettings;
  blocks: EmailBlock[];
};

export const CONTENT_WIDTH = 600;
const PADDING_X = 32;

export const FONT_OPTIONS = [
  { label: 'Helvetica / Arial', value: 'Helvetica, Arial, sans-serif' },
  { label: 'Georgia', value: "Georgia, 'Times New Roman', serif" },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet', value: "'Trebuchet MS', Helvetica, sans-serif" },
];

export const DEFAULT_SETTINGS: EmailDesignSettings = {
  backgroundColor: '#f3f5f4',
  contentBackgroundColor: '#ffffff',
  textColor: '#1f2a2e',
  linkColor: '#0f766e',
  fontFamily: FONT_OPTIONS[0].value,
  footerHtml: '{{practice_name}} · {{practice_phone}}',
};

let idCounter = 0;
export function newBlockId(): string {
  idCounter += 1;
  return `b${Date.now().toString(36)}${idCounter.toString(36)}`;
}

export function createBlock(type: EmailBlockType): EmailBlock {
  const id = newBlockId();
  switch (type) {
    case 'heading':
      return {
        id,
        type,
        text: 'A headline for {{first_name}}',
        level: 1,
        align: 'left',
        color: '',
      };
    case 'text':
      return {
        id,
        type,
        html: '<p>Hi {{first_name}},</p><p>Write your message here. Mention {{pet_names}} to make it personal.</p>',
        align: 'left',
      };
    case 'image':
      return { id, type, src: '', alt: '', href: '', widthPercent: 100, align: 'center' };
    case 'button':
      return {
        id,
        type,
        label: 'Book a visit',
        href: 'https://',
        backgroundColor: '#0f766e',
        textColor: '#ffffff',
        align: 'center',
      };
    case 'divider':
      return { id, type, color: '#e2e8f0' };
    case 'spacer':
      return { id, type, height: 24 };
    case 'html':
      return { id, type, html: '<p>Custom HTML</p>' };
  }
}

export function createDefaultDesign(): EmailDesign {
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS },
    blocks: [createBlock('heading'), createBlock('text'), createBlock('button')],
  };
}

/** Accepts whatever was stored; anything unrecognised becomes a fresh design. */
export function parseDesign(raw: unknown): EmailDesign | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Partial<EmailDesign>;
  if (d.version !== 1 || !Array.isArray(d.blocks)) return null;
  return {
    version: 1,
    settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) },
    blocks: d.blocks.filter(
      (b): b is EmailBlock => !!b && typeof b === 'object' && 'type' in b && 'id' in b
    ),
  };
}

export function escapeHtml(text: string): string {
  return (text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const COLOR_RE = /^#[0-9a-f]{3,8}$|^rgba?\([\d\s.,%]+\)$|^[a-z]{3,20}$/i;
function color(value: string | undefined, fallback: string): string {
  const v = (value ?? '').trim();
  return v && COLOR_RE.test(v) ? v : fallback;
}

export function isValidLink(href: string): boolean {
  const v = (href ?? '').trim();
  if (v.includes('{{')) return true;
  if (/^(mailto|tel):.+/i.test(v)) return true;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

function safeHref(href: string | undefined): string {
  const v = (href ?? '').trim();
  if (/^(https?:|mailto:|tel:)/i.test(v) || v.includes('{{')) return v;
  return '';
}

function alignOf(a: Align | undefined): Align {
  return a === 'center' || a === 'right' ? a : 'left';
}

function row(inner: string, padding = `0 ${PADDING_X}px`): string {
  return `<tr><td style="padding:${padding};">${inner}</td></tr>`;
}

function renderBlock(block: EmailBlock, s: EmailDesignSettings): string {
  const font = s.fontFamily;
  switch (block.type) {
    case 'heading': {
      const size = block.level === 2 ? 20 : 28;
      return row(
        `<h${block.level} style="margin:0 0 12px;font-family:${font};font-size:${size}px;line-height:1.25;font-weight:700;color:${color(block.color, s.textColor)};text-align:${alignOf(block.align)};">${escapeHtml(block.text)}</h${block.level}>`
      );
    }
    case 'text':
      return row(
        `<div class="vayd-text" style="font-family:${font};font-size:16px;line-height:1.6;color:${s.textColor};text-align:${alignOf(block.align)};">${styleRichText(block.html, s)}</div>`
      );
    case 'image': {
      if (!block.src) return '';
      const pct = Math.min(100, Math.max(10, Math.round(block.widthPercent || 100)));
      const width = Math.round(((CONTENT_WIDTH - PADDING_X * 2) * pct) / 100);
      const img = `<img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;outline:none;text-decoration:none;${alignOf(block.align) === 'center' ? 'margin:0 auto;' : alignOf(block.align) === 'right' ? 'margin-left:auto;' : ''}" />`;
      const href = safeHref(block.href);
      const content = href
        ? `<a href="${escapeHtml(href)}" target="_blank" style="text-decoration:none;">${img}</a>`
        : img;
      return row(
        `<div style="text-align:${alignOf(block.align)};padding:0 0 16px;">${content}</div>`
      );
    }
    case 'button': {
      const href = safeHref(block.href) || '#';
      const bg = color(block.backgroundColor, '#0f766e');
      const fg = color(block.textColor, '#ffffff');
      const align = alignOf(block.align);
      return row(
        `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td align="${align}" style="padding:8px 0 20px;"><table role="presentation" border="0" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${bg}" style="border-radius:6px;background:${bg};"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:700;line-height:1;color:${fg};text-decoration:none;border-radius:6px;">${escapeHtml(block.label)}</a></td></tr></table></td></tr></table>`
      );
    }
    case 'divider':
      return row(
        `<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0"><tr><td style="border-top:1px solid ${color(block.color, '#e2e8f0')};font-size:0;line-height:0;height:1px;">&nbsp;</td></tr></table>`,
        `12px ${PADDING_X}px`
      );
    case 'spacer': {
      const h = Math.min(200, Math.max(4, Math.round(block.height || 24)));
      return `<tr><td style="height:${h}px;font-size:0;line-height:0;">&nbsp;</td></tr>`;
    }
    case 'html':
      return row(block.html ?? '');
  }
}

/** Gives paragraphs, lists and links in rich text the inline styles email clients need. */
export function styleRichText(html: string, s: Pick<EmailDesignSettings, 'linkColor'>): string {
  return (html ?? '')
    .replace(
      /<p(\s[^>]*)?>/gi,
      (_m, attrs = '') =>
        `<p${attrs.includes('style=') ? attrs : `${attrs} style="margin:0 0 16px;"`}>`
    )
    .replace(
      /<(ul|ol)(\s[^>]*)?>/gi,
      (_m, tag, attrs = '') =>
        `<${tag}${attrs.includes('style=') ? attrs : `${attrs} style="margin:0 0 16px;padding-left:24px;"`}>`
    )
    .replace(
      /<a\s(?![^>]*style=)([^>]*)>/gi,
      `<a $1 style="color:${color(s.linkColor, '#0f766e')};text-decoration:underline;">`
    );
}

export function renderDesignToHtml(design: EmailDesign, title = ''): string {
  const s = { ...DEFAULT_SETTINGS, ...design.settings };
  const bg = color(s.backgroundColor, DEFAULT_SETTINGS.backgroundColor);
  const contentBg = color(s.contentBackgroundColor, DEFAULT_SETTINGS.contentBackgroundColor);
  const body = design.blocks.map((b) => renderBlock(b, s)).join('\n');
  const footer = s.footerHtml?.trim()
    ? `<tr><td style="padding:24px ${PADDING_X}px 0;font-family:${s.fontFamily};font-size:12px;line-height:1.5;color:#6b7280;text-align:center;">${s.footerHtml}</td></tr>`
    : '';
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="x-apple-disable-message-reformatting">
<title>${escapeHtml(title)}</title>
<style>
  body { margin:0; padding:0; }
  img { -ms-interpolation-mode:bicubic; }
  .vayd-text a { color:${color(s.linkColor, '#0f766e')}; }
  @media only screen and (max-width:620px) {
    .vayd-container { width:100% !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${bg};">
<table role="presentation" width="100%" border="0" cellpadding="0" cellspacing="0" style="background:${bg};">
<tr><td align="center" style="padding:24px 12px;">
<!--[if mso]><table role="presentation" width="${CONTENT_WIDTH}" align="center" border="0" cellpadding="0" cellspacing="0"><tr><td><![endif]-->
<table role="presentation" class="vayd-container" width="${CONTENT_WIDTH}" border="0" cellpadding="0" cellspacing="0" style="width:${CONTENT_WIDTH}px;max-width:100%;background:${contentBg};border-radius:8px;">
<tr><td style="height:32px;font-size:0;line-height:0;">&nbsp;</td></tr>
${body}
<tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>
</table>
<table role="presentation" class="vayd-container" width="${CONTENT_WIDTH}" border="0" cellpadding="0" cellspacing="0" style="width:${CONTENT_WIDTH}px;max-width:100%;">
${footer}
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}

export const MERGE_TAG_OPTIONS = [
  { tag: '{{first_name}}', label: 'First name', sample: 'Alex' },
  { tag: '{{last_name}}', label: 'Last name', sample: 'Sample' },
  { tag: '{{full_name}}', label: 'Full name', sample: 'Alex Sample' },
  { tag: '{{pet_names}}', label: 'Pet names (living pets only)', sample: 'Biscuit and Juniper' },
  { tag: '{{practice_name}}', label: 'Practice name', sample: 'Vet At Your Door' },
  { tag: '{{practice_phone}}', label: 'Practice phone', sample: '(555) 010-0100' },
];

const SAMPLE_VALUES: Record<string, string> = {
  first_name: 'Alex',
  last_name: 'Sample',
  full_name: 'Alex Sample',
  pet_names: 'Biscuit and Juniper',
  practice_name: 'Vet At Your Door',
  practice_phone: '(555) 010-0100',
};

/** Fills merge tags with sample values for the in-app preview. */
export function previewMergeTags(
  html: string,
  values: Record<string, string> = SAMPLE_VALUES
): string {
  return (html ?? '').replace(
    /\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/gi,
    (_m, tag: string, fallback?: string) => {
      const v = values[tag.toLowerCase()];
      return escapeHtml(v ?? fallback ?? '');
    }
  );
}

/**
 * Removes scripts, frames and inline handlers before HTML is shown in the editor or
 * preview. The server cleans it again on save.
 */
export function stripUnsafeHtml(html: string): string {
  return (html ?? '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<script\b[^>]*>/gi, '')
    .replace(/<(iframe|object|embed|frame|frameset|applet)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<(iframe|object|embed|frame|frameset|applet|base)\b[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      /(\s(?:href|src)\s*=\s*)(["']?)\s*(?:javascript|vbscript|data:text\/html)[^"'\s>]*\2/gi,
      '$1$2#$2'
    );
}
