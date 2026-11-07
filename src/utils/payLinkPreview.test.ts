import { describe, expect, it } from 'vitest';
import { payLinkPreview, payLinkPreviewText } from './payLinkPreview';

const money = (n: number) => `$${n.toFixed(2)}`;

describe('W8A-4 pay link preview net of account credit', () => {
  it('$184.50 owed, $30 credit: the link asks for $154.50', () => {
    expect(payLinkPreview(184.5, 30)).toEqual({ amount: 154.5, creditUsed: 30 });
    expect(payLinkPreviewText(184.5, 30, 2, money)).toBe(
      'Sends $154.50 for 2 unpaid invoices ($30.00 account credit comes off first)'
    );
  });
  it('no credit: unchanged wording', () => {
    expect(payLinkPreviewText(22.5, 0, 1, money)).toBe('Sends $22.50 for the unpaid invoice');
  });
  it('credit covers it all: no link, use Account credit', () => {
    expect(payLinkPreview(40, 50)).toEqual({ amount: 0, creditUsed: 40 });
    expect(payLinkPreviewText(40, 50, 1, money)).toMatch(/Use Account credit on the bill/);
  });
});
