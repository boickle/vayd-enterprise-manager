import type { SendClientSmsPayload } from '../api/clientSms';

export type TextedOfferFollowUpSmsInput = {
  message: string;
  /** Original offer SMS send-from when the detail API provides it. */
  offerSmsFrom?: string | null;
  /**
   * Scheduling outreach line (`SMS_REMINDERS_FROM`) for display/fallback from only.
   * Passed as explicit `from` — do not set `useRemindersFrom` (that path was routing
   * follow-ups onto the reminders inbox instead of the client offer thread).
   */
  schedulingOutreachFrom?: string | null;
  overrideNonProd?: boolean;
};

/**
 * Build `/sms/client/:id` payload for Texted Offers → Text client follow-up.
 *
 * Prefer the original offer `smsFrom` so the reply stays on the same Quo thread.
 * Fall back to an explicit scheduling-outreach `from` when the offer line is unknown.
 * Never set `useRemindersFrom` here.
 */
export function buildTextedOfferFollowUpSmsPayload(
  input: TextedOfferFollowUpSmsInput
): SendClientSmsPayload {
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

/** From-line label shown in the compose modal (matches what we send when known). */
export function textedOfferFollowUpFromLineLabel(
  offerSmsFrom?: string | null,
  schedulingOutreachFrom?: string | null
): string | null {
  return offerSmsFrom?.trim() || schedulingOutreachFrom?.trim() || null;
}
