// Keep in step with vayd-api src/scribe/scribe-payment-redaction.util.ts.
/**
 * Hides payment card details a client reads out during a recorded visit, before the
 * transcript is shown, saved, or sent to the AI. Deepgram has already turned spoken
 * digits into numerals (`smart_format`).
 */

export const CARD_NUMBER_TAG = '<CREDIT_CARD_NUMBER>';
export const EXPIRATION_TAG = '<EXPIRATION_DATE>';
export const CVV_TAG = '<CVV>';

/** Card brands start 2–6; ISO pet microchips start 9 (or 0), so a 15-digit chip is left alone. */
const CARD_NUMBER =
  /\b(?:[2-6]\d{12,18}|[2-6]\d{3}(?:[ -]\d{4}){3}|3\d{3}[ -]\d{6}[ -]\d{5})\b/g;

/** A run of 4-digit groups read out one at a time: "4242. 4242. 4242" */
const CARD_GROUPS = /\b\d{4}(?:[ \t.,-]{1,3}\d{4}){2,4}\b/g;

const MONTH =
  '(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?';
const EXPIRY_VALUE = `(?:\\d{1,2}\\s*[/.-]\\s*\\d{2,4}|\\d{1,2}\\s+\\d{2}(?:\\d{2})?\\b|${MONTH}\\s*(?:of\\s+)?\\d{2,4})`;
const EXPIRY_AFTER_WORDS = new RegExp(
  `\\b(valid\\s+(?:through|thru|until)|good\\s+(?:through|thru)|expir(?:es|ation|y)(?:\\s+date)?|exp(?:\\.|\\s+date)?)(\\s*(?:is|of|on|date|:)?\\s*)${EXPIRY_VALUE}`,
  'gi',
);
/** A bare MM/YY right after a card number. */
const EXPIRY_AFTER_CARD = new RegExp(
  `(${CARD_NUMBER_TAG}[^<\\n]{0,40}?)\\b(?:0?[1-9]|1[0-2])\\s*/\\s*\\d{2}(?:\\d{2})?\\b`,
  'g',
);

const CVV_AFTER_WORDS =
  /\b(cvv2?|cvc2?|cid|security\s+code|(?:the\s+)?(?:3|4|three|four)[-\s]digits?(?:\s+code)?(?:\s+on\s+the\s+back)?|(?:the\s+)?code(?:\s+on\s+the\s+back)?)(\s*(?:is|are|it's|:)?\s*)\d{3,4}\b/gi;

const CARD_CONTEXT =
  /credit|debit|\bcard\b|visa|master\s?card|amex|american express|discover|\bcvv|\bcvc|security code|valid (?:through|thru)|expir|<CREDIT_CARD_NUMBER>|<EXPIRATION_DATE>/i;

/**
 * `context` is the transcript just before `text` (live segments arrive a few words at a
 * time), so "the code is 123" is caught when the card was read out a moment earlier.
 */
export function redactPaymentDetails(text: string, context = ''): string {
  if (!text) return text;
  let out = text
    .replace(CARD_NUMBER, CARD_NUMBER_TAG)
    .replace(CARD_GROUPS, CARD_NUMBER_TAG)
    .replace(
      EXPIRY_AFTER_WORDS,
      (_m, words: string, gap: string) => `${words}${gap}${EXPIRATION_TAG}`,
    )
    .replace(
      EXPIRY_AFTER_CARD,
      (_m, before: string) => `${before}${EXPIRATION_TAG}`,
    );
  if (CARD_CONTEXT.test(`${context.slice(-400)} ${out}`)) {
    out = out.replace(
      CVV_AFTER_WORDS,
      (_m, words: string, gap: string) => `${words}${gap}${CVV_TAG}`,
    );
  }
  return out;
}
