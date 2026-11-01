import type { AudienceSummary, EmailCampaign } from '../../api/emailCampaigns';
import { EmailDesign, isValidLink, MERGE_TAG_OPTIONS } from './emailDesign';

export type CampaignCheck = { ok: boolean; label: string; blocking: boolean };

const KNOWN_TAGS = new Set(MERGE_TAG_OPTIONS.map((m) => m.tag.replace(/[{}]/g, '')));
const TAG_RE = /\{\{\s*([a-z_]+)\s*(?:\|[^}]*)?\}\}/gi;
/** Gmail cuts off messages larger than about 102 KB behind a "View entire message" link. */
const GMAIL_CLIP_BYTES = 100 * 1024;

export function unknownMergeTags(...inputs: Array<string | null | undefined>): string[] {
  const out = new Set<string>();
  for (const input of inputs) {
    for (const m of (input ?? '').matchAll(TAG_RE)) {
      const tag = m[1].toLowerCase();
      if (!KNOWN_TAGS.has(tag)) out.add(tag);
    }
  }
  return [...out];
}

function htmlHasContent(html: string): boolean {
  const text = html
    .replace(/<(style|head|title)\b[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
  return text.length > 0 || /<img\b/i.test(html);
}

export function campaignChecks(
  campaign: Pick<EmailCampaign, 'subject' | 'preheader' | 'html' | 'editorMode' | 'goal'>,
  design: EmailDesign | null,
  summary: AudienceSummary | null
): CampaignCheck[] {
  const checks: CampaignCheck[] = [];
  checks.push({ ok: !!campaign.subject.trim(), label: 'Subject line is set', blocking: true });
  checks.push({ ok: htmlHasContent(campaign.html), label: 'Email has content', blocking: true });

  const unknown = unknownMergeTags(campaign.subject, campaign.preheader, campaign.html);
  checks.push({
    ok: unknown.length === 0,
    label: unknown.length
      ? `Unknown merge tag${unknown.length > 1 ? 's' : ''}: ${unknown.map((t) => `{{${t}}}`).join(', ')}`
      : 'Merge tags are valid',
    blocking: true,
  });

  if (campaign.editorMode === 'design' && design) {
    const badButtons = design.blocks.filter(
      (b) => b.type === 'button' && !isValidLink(b.href)
    ).length;
    checks.push({
      ok: badButtons === 0,
      label: badButtons
        ? `${badButtons} button${badButtons > 1 ? 's need' : ' needs'} a link`
        : 'Buttons have links',
      blocking: true,
    });
    const noAlt = design.blocks.filter((b) => b.type === 'image' && b.src && !b.alt.trim()).length;
    if (noAlt)
      checks.push({
        ok: false,
        label: `${noAlt} image${noAlt > 1 ? 's have' : ' has'} no alt text`,
        blocking: false,
      });
    const noSrc = design.blocks.filter((b) => b.type === 'image' && !b.src).length;
    if (noSrc)
      checks.push({
        ok: false,
        label: `${noSrc} image block${noSrc > 1 ? 's are' : ' is'} empty`,
        blocking: false,
      });
  }

  checks.push({
    ok: summary ? summary.eligible > 0 : false,
    label: summary
      ? `${summary.eligible.toLocaleString()} clients will receive it`
      : 'Counting the audience…',
    blocking: true,
  });
  checks.push({ ok: !!campaign.preheader?.trim(), label: 'Preview text is set', blocking: false });
  checks.push({
    ok: campaign.goal.type !== 'none',
    label:
      campaign.goal.type !== 'none'
        ? 'Goal is set for conversion reporting'
        : 'No goal: the report will show opens and clicks only',
    blocking: false,
  });
  const bytes = new Blob([campaign.html]).size;
  if (bytes > GMAIL_CLIP_BYTES) {
    checks.push({
      ok: false,
      label: `Email is ${Math.round(bytes / 1024)} KB; Gmail hides content past about 100 KB`,
      blocking: false,
    });
  }
  return checks;
}
