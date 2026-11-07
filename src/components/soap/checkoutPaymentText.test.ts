import { describe, expect, it } from 'vitest';
import {
  accountCreditButtonText,
  cardOnFileButtonText,
  cardText,
  paidTenderLines,
} from './checkoutPaymentText';

describe('checkoutPaymentText', () => {
  it('names cards', () => {
    expect(cardText('visa', '4242')).toBe('Visa •4242');
    expect(cardText(null, null)).toBe('Card');
    expect(cardOnFileButtonText(null)).toBe('Card on file');
    expect(
      cardOnFileButtonText({ customerId: 'c', paymentMethodId: 'p', last4: '4242', brand: 'amex', expMonth: 1, expYear: 2030 }),
    ).toBe('Card on file · Amex •4242');
  });
  it('labels account credit only when there is some', () => {
    expect(accountCreditButtonText(30)).toBe('Account credit ($30.00)');
    expect(accountCreditButtonText(0)).toBe('Account credit');
  });
  it('uses remembered gift card digits when the tender has none', () => {
    const lines = paidTenderLines(
      [{ id: 'g', method: 'gift_card', amount: 50 } as never],
      { g: '9PVM' },
    );
    expect(lines).toEqual([{ id: 'g', label: 'Gift card ••••9PVM', amount: 50 }]);
    expect(paidTenderLines([{ id: 'g', method: 'gift_card', amount: 50 } as never])[0].label).toBe('Gift card');
  });
});
