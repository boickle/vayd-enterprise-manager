import { describe, expect, it } from 'vitest';

import { describeReturnRefund, splitReturnRefund } from './returnRefundSplit';

describe('PAY-A15 Return & refund split (cards first, then account credit)', () => {
  it('an amount the card can cover goes all to the card', () => {
    expect(splitReturnRefund(40, 70, 50)).toEqual({ card: 40, credit: 0, max: 120, over: false });
    expect(describeReturnRefund(splitReturnRefund(40, 70, 50))).toBe('$40.00 to card');
  });

  it('above the card: the card takes what it can, the rest is account credit', () => {
    expect(splitReturnRefund(65, 40, 50)).toEqual({ card: 40, credit: 25, max: 90, over: false });
    expect(describeReturnRefund(splitReturnRefund(65, 40, 50))).toBe('$40.00 to card, $25.00 back as account credit');
  });

  it('the whole bill: card and credit both fully refunded', () => {
    expect(splitReturnRefund(120, 70, 50)).toEqual({ card: 70, credit: 50, max: 120, over: false });
  });

  it('more than card + credit payments is "over"', () => {
    expect(splitReturnRefund(130, 70, 50).over).toBe(true);
    expect(splitReturnRefund(80, 70, 0).over).toBe(true);
  });

  it('no credit payment: same as before (card only)', () => {
    expect(splitReturnRefund(70, 70, 0)).toEqual({ card: 70, credit: 0, max: 70, over: false });
  });

  it('rounds to cents', () => {
    expect(splitReturnRefund(10.005, 3.333, 10)).toMatchObject({ card: 3.33, credit: 6.68 });
  });
});
