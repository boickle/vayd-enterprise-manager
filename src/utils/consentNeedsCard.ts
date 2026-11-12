/**
 * Whether the public euthanasia consent form must collect a card on submit.
 * The server requires a card whenever the quoted estimate (plus anything picked on the
 * form) is above zero, so the form must send one in exactly those cases, including an
 * estimate with no clay or memorial picks.
 */
export function consentNeedsCard(input: {
  visitEstimateTotal: number;
  memorialTotal: number;
  clayChargedOnForm: boolean;
}): boolean {
  return (
    (Number(input.visitEstimateTotal) || 0) > 0 ||
    (Number(input.memorialTotal) || 0) > 0 ||
    input.clayChargedOnForm
  );
}
