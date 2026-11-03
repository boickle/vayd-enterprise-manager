import { describe, expect, it } from 'vitest';
import { usesLegacyEuthanasiaPrepay } from './euthanasiaPrepay';

describe('usesLegacyEuthanasiaPrepay (D1)', () => {
  it('a new euthanasia invoice with only the prepay flag is an ordinary bill', () => {
    expect(usesLegacyEuthanasiaPrepay({ isEuthanasiaPrepay: true })).toBe(false);
    expect(usesLegacyEuthanasiaPrepay({ isEuthanasiaPrepay: true, lastChargeStatus: 'requires_capture' })).toBe(false);
  });

  it('an invoice that already used the prepay (card saved at booking, saved card, or a hold) keeps it', () => {
    expect(usesLegacyEuthanasiaPrepay({ isEuthanasiaPrepay: true, stripeSetupIntentId: 'seti_1' })).toBe(true);
    expect(usesLegacyEuthanasiaPrepay({ isEuthanasiaPrepay: true, savedPaymentMethodId: 'pm_1' })).toBe(true);
    expect(
      usesLegacyEuthanasiaPrepay({ isEuthanasiaPrepay: true, stripePaymentIntentId: 'pi_1', lastChargeStatus: 'requires_capture' }),
    ).toBe(true);
  });

  it('never applies without the prepay flag', () => {
    expect(usesLegacyEuthanasiaPrepay({ isEuthanasiaPrepay: false, savedPaymentMethodId: 'pm_1' })).toBe(false);
    expect(usesLegacyEuthanasiaPrepay(null)).toBe(false);
  });
});
