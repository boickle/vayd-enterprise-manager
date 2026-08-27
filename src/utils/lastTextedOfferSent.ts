import { DateTime } from 'luxon';

/**
 * Auto-appended by slot-offer send (`buildSlotOfferOutreachNoteLine`):
 * `Texted offer for MM/dd/yyyy at h:mm a with arrival window … on MM/dd/yyyy h:mm a - Staff`
 * The timestamp after ` on ` is when the offer SMS was logged/sent.
 */
const TEXTED_OFFER_SENT_AT_RE =
  /Texted offer for .+? on (\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} [AP]M)\s*-\s*/gi;

export type LastTextedOfferSent = {
  /** Parsed send/log time (local wall clock from the note; no TZ conversion). */
  sentAt: DateTime;
  /** Exact substring captured from the note, e.g. `07/15/2026 2:30 PM`. */
  sentAtLabel: string;
};

/** Find every texted-offer send timestamp embedded in outreach / contact-log notes. */
export function findTextedOfferSentAts(notes: string | null | undefined): LastTextedOfferSent[] {
  const text = notes?.trim();
  if (!text) return [];

  const out: LastTextedOfferSent[] = [];
  const re = new RegExp(TEXTED_OFFER_SENT_AT_RE.source, TEXTED_OFFER_SENT_AT_RE.flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) != null) {
    const sentAtLabel = match[1]?.trim();
    if (!sentAtLabel) continue;
    const sentAt = DateTime.fromFormat(sentAtLabel, 'M/d/yyyy h:mm a');
    if (!sentAt.isValid) continue;
    out.push({ sentAt, sentAtLabel });
  }
  return out;
}

/** Most recent texted-offer send from contact-log notes, or null when none. */
export function latestTextedOfferSent(notes: string | null | undefined): LastTextedOfferSent | null {
  const all = findTextedOfferSentAts(notes);
  if (all.length === 0) return null;
  let best = all[0]!;
  for (let i = 1; i < all.length; i += 1) {
    const row = all[i]!;
    if (row.sentAt.toMillis() > best.sentAt.toMillis()) best = row;
  }
  return best;
}

/** Plain label for Care Outreach rows, e.g. `Last texted offer sent: 07/15/2026 2:30 PM`. */
export function formatLastTextedOfferSentLabel(notes: string | null | undefined): string | null {
  const latest = latestTextedOfferSent(notes);
  if (!latest) return null;
  return `Last texted offer sent: ${latest.sentAtLabel}`;
}
