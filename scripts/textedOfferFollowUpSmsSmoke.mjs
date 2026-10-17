/**
 * Smoke checks for Texted Offers follow-up SMS payload routing.
 * Run: node scripts/textedOfferFollowUpSmsSmoke.mjs
 *
 * Mirrors src/utils/textedOfferFollowUpSms.ts
 */

function buildTextedOfferFollowUpSmsPayload(input) {
  const offerFrom = input.offerSmsFrom?.trim() || null;
  const outreachFrom = input.schedulingOutreachFrom?.trim() || null;
  const from = offerFrom || outreachFrom;
  return {
    message: input.message,
    source: 'slot_offer',
    ...(from ? { from } : {}),
    ...(input.overrideNonProd ? { overrideNonProd: true } : {}),
  };
}

function textedOfferFollowUpFromLineLabel(offerSmsFrom, schedulingOutreachFrom) {
  return offerSmsFrom?.trim() || schedulingOutreachFrom?.trim() || null;
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const OFFER_FROM = '+12075551111';
const OUTREACH = '+12075551212';

{
  const p = buildTextedOfferFollowUpSmsPayload({
    message: 'Hi — following up on the offer.',
    offerSmsFrom: OFFER_FROM,
    schedulingOutreachFrom: OUTREACH,
  });
  assert(p.from === OFFER_FROM, 'prefer original offer smsFrom');
  assert(p.useRemindersFrom == null, 'must not set useRemindersFrom when from is known');
  assert(p.source === 'slot_offer', 'source is slot_offer');
  assert(
    textedOfferFollowUpFromLineLabel(OFFER_FROM, OUTREACH) === OFFER_FROM,
    'label matches offer from'
  );
}

{
  const p = buildTextedOfferFollowUpSmsPayload({
    message: 'Follow-up',
    offerSmsFrom: null,
    schedulingOutreachFrom: OUTREACH,
  });
  assert(p.from === OUTREACH, 'fall back to scheduling outreach as explicit from');
  assert(p.useRemindersFrom == null, 'must not set useRemindersFrom on outreach fallback');
}

{
  const p = buildTextedOfferFollowUpSmsPayload({
    message: 'Follow-up',
    offerSmsFrom: '  ',
    schedulingOutreachFrom: null,
  });
  assert(p.from == null, 'omit from when neither line is known');
  assert(p.useRemindersFrom == null, 'still must not set useRemindersFrom');
}

{
  const p = buildTextedOfferFollowUpSmsPayload({
    message: 'Follow-up',
    offerSmsFrom: OFFER_FROM,
    overrideNonProd: true,
  });
  assert(p.overrideNonProd === true, 'pass through overrideNonProd');
  assert(p.from === OFFER_FROM, 'override does not change from');
}

console.log('textedOfferFollowUpSmsSmoke: ok');
