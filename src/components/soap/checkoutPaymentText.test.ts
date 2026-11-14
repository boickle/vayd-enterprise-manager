import { describe, expect, it } from 'vitest';
import {
  accountCreditButtonText,
  cardOnFileButtonText,
  cardText,
  cashTenderNote,
  cashTenderPlan,
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
    // W12-4: after a reload the API names the card on the tender.
    expect(paidTenderLines([{ id: 'g', method: 'gift_card', amount: 50, giftCardLast4: '9PVM' } as never])[0].label).toBe('Gift card ••••9PVM');
  });
});

describe('cash at visit checkout: part cash, rest by card (Nov 13, 2026)', () => {
  it('blank or exact pays the bill', () => {
    expect(cashTenderPlan(107, '')).toEqual({ amount: 107, cashReceived: null, changeGiven: null });
    expect(cashTenderPlan(107, '107.00')).toEqual({ amount: 107, cashReceived: 107, changeGiven: null });
  });

  it('more than due pays the bill and gives change', () => {
    expect(cashTenderPlan(107, '$120')).toEqual({ amount: 107, cashReceived: 120, changeGiven: 13 });
    expect(cashTenderNote(107, 107, 13)).toBe('Recorded cash payment of $107.00. Give $13.00 change.');
  });

  it('less than due records only that much and leaves the rest open', () => {
    expect(cashTenderPlan(107, '50')).toEqual({ amount: 50, cashReceived: 50, changeGiven: null });
    expect(cashTenderNote(107, 50, null)).toBe(
      'Recorded $50.00 in cash. $57.00 is still due: take the rest by card or another way.',
    );
  });

  it('zero or nonsense is refused', () => {
    expect(cashTenderPlan(107, '0').error).toMatch(/Enter the cash received/);
    expect(cashTenderPlan(107, 'abc').error).toMatch(/Enter the cash received/);
  });
});
