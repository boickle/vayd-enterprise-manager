/**
 * Smoke checks for Care Outreach "last texted offer sent" parsing.
 * Run: node scripts/lastTextedOfferSentSmoke.mjs
 *
 * Mirrors pure helpers in src/utils/lastTextedOfferSent.ts.
 */
import { DateTime } from 'luxon';

const TEXTED_OFFER_SENT_AT_RE =
  /Texted offer for .+? on (\d{1,2}\/\d{1,2}\/\d{4} \d{1,2}:\d{2} [AP]M)\s*-\s*/gi;

function findTextedOfferSentAts(notes) {
  const text = notes?.trim();
  if (!text) return [];

  const out = [];
  const re = new RegExp(TEXTED_OFFER_SENT_AT_RE.source, TEXTED_OFFER_SENT_AT_RE.flags);
  let match;
  while ((match = re.exec(text)) != null) {
    const sentAtLabel = match[1]?.trim();
    if (!sentAtLabel) continue;
    const sentAt = DateTime.fromFormat(sentAtLabel, 'M/d/yyyy h:mm a');
    if (!sentAt.isValid) continue;
    out.push({ sentAt, sentAtLabel });
  }
  return out;
}

function latestTextedOfferSent(notes) {
  const all = findTextedOfferSentAts(notes);
  if (all.length === 0) return null;
  let best = all[0];
  for (let i = 1; i < all.length; i += 1) {
    const row = all[i];
    if (row.sentAt.toMillis() > best.sentAt.toMillis()) best = row;
  }
  return best;
}

function formatLastTextedOfferSentLabel(notes) {
  const latest = latestTextedOfferSent(notes);
  if (!latest) return null;
  return `Last texted offer sent: ${latest.sentAtLabel}`;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const sampleLine =
  'Texted offer for 07/29/2026 at 11:35 AM with arrival window 10:35 AM - 12:35 PM on 07/15/2026 2:30 PM - DF';

assert(formatLastTextedOfferSentLabel('') === null, 'empty notes → null');
assert(formatLastTextedOfferSentLabel('LMOM left VM') === null, 'manual notes → null');
assert(
  formatLastTextedOfferSentLabel(sampleLine) === 'Last texted offer sent: 07/15/2026 2:30 PM',
  'single offer uses logged send time, not appointment date'
);

const older =
  'Texted offer for 06/01/2026 at 9:00 AM with arrival window 8:00 AM - 10:00 AM on 05/01/2026 9:00 AM - AB';
const newer =
  'Texted offer for 07/29/2026 at 11:35 AM with arrival window 10:35 AM - 12:35 PM on 07/15/2026 2:30 PM - DF';
const multi = `${older}\n\nCalled client.\n\n${newer}`;
assert(
  formatLastTextedOfferSentLabel(multi) === 'Last texted offer sent: 07/15/2026 2:30 PM',
  'picks most recent send among multiple offers'
);

const reverse = `${newer}\n\n${older}`;
assert(
  formatLastTextedOfferSentLabel(reverse) === 'Last texted offer sent: 07/15/2026 2:30 PM',
  'order in notes does not matter'
);

console.log('lastTextedOfferSentSmoke: ok');
