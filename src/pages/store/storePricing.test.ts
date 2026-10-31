import { describe, expect, it } from 'vitest';
import { storeGiftCardAmountError, storeGiftCardPrice, storeLineUnitPrice } from './storePricing';

describe('storeGiftCardPrice', () => {
  it('uses the listing sale: $100 card for $80 at 20% off', () => {
    expect(storeGiftCardPrice(100, { saleType: 'percent', saleValue: 20, saleActive: true })).toBe(80);
  });

  it('never sells a card for $0', () => {
    expect(storeGiftCardPrice(25, { saleType: 'amount', saleValue: 30, saleActive: true })).toBe(25);
  });
});

describe('storeGiftCardAmountError', () => {
  const rules = { amounts: [25, 50, 100], allowCustom: true, min: 10, max: 500 };

  it('accepts presets and in-range custom amounts', () => {
    expect(storeGiftCardAmountError(50, rules)).toBeNull();
    expect(storeGiftCardAmountError(75, rules)).toBeNull();
  });

  it('explains out-of-range amounts', () => {
    expect(storeGiftCardAmountError(5, rules)).toMatch(/start at/);
    expect(storeGiftCardAmountError(600, rules)).toMatch(/up to \$500/);
    expect(storeGiftCardAmountError(75, { ...rules, allowCustom: false })).toMatch(/amounts above/);
  });
});

const line = (args: Parameters<typeof storeLineUnitPrice>[0]) =>
  Math.round(storeLineUnitPrice(args) * args.qty * 100) / 100;

describe('storeLineUnitPrice', () => {
  it('adds the service fee once per line', () => {
    expect(line({ base: 0.26, serviceFee: 15, qty: 30 })).toBe(22.8);
  });

  it('honors the minimum for the whole line', () => {
    expect(line({ base: 0.5, serviceFee: 15, minimumPrice: 46.75, qty: 14 })).toBe(46.75);
  });

  it('applies the quantity break and sale before the fee', () => {
    const breaks = [{ lowQuantity: 30, highQuantity: 999, price: 0.2 }];
    expect(line({ base: 0.26, breaks, serviceFee: 15, qty: 30 })).toBe(21);
    expect(
      line({
        base: 10,
        sale: { saleType: 'percent', saleValue: 10, saleActive: true },
        serviceFee: 5,
        qty: 2,
      }),
    ).toBe(23);
  });

  it('skips the minimum for procedures', () => {
    expect(line({ itemType: 'procedure', base: 5, minimumPrice: 50, qty: 1 })).toBe(5);
  });
});
