import { describe, expect, it } from 'vitest';
import {
  getBundleLinePrice,
  getCatalogLinePrice,
  getTotalPreDiscountForQuantity,
} from './catalogItemPricing';

const cents = (n: number) => Math.round(n * 100) / 100;

const gabapentin = {
  itemType: 'inventory',
  inventoryItem: { price: 0.26, serviceFee: 15, minimumPrice: 0 },
};
const metronidazole = {
  itemType: 'inventory',
  inventoryItem: { price: 0.48, serviceFee: 15, minimumPrice: 46.75 },
};

describe('catalog line pricing (eVet line math)', () => {
  it('charges the service fee once per line', () => {
    expect(cents(getTotalPreDiscountForQuantity(gabapentin, 30))).toBe(22.8);
  });

  it('applies the minimum to the whole line', () => {
    expect(cents(getTotalPreDiscountForQuantity(metronidazole, 14))).toBe(46.75);
  });

  it('stores a unit price that multiplies back to the line total', () => {
    const fromApi = { ...metronidazole, price: 46.75, originalPrice: 46.75 };
    const { unitFinal, totalFinal } = getCatalogLinePrice(fromApi, 14);
    expect(cents(totalFinal)).toBe(46.75);
    expect(cents(unitFinal * 14)).toBe(46.75);
  });

  it('keeps a client discount as the same share of the line', () => {
    const fromApi = { ...gabapentin, price: 15.26 * 0.9, originalPrice: 15.26 };
    expect(cents(getCatalogLinePrice(fromApi, 30).totalFinal)).toBe(cents(22.8 * 0.9));
  });

  it('uses the quantity price break for the unit price and still adds the fee once', () => {
    const withBreaks = {
      ...gabapentin,
      tieredPricing: {
        hasTieredPricing: true,
        priceBreaks: [
          { lowQuantity: '1', highQuantity: '29', price: '0.26', markup: '', isActive: true },
          { lowQuantity: '30', highQuantity: '999', price: '0.2', markup: '', isActive: true },
        ],
      },
    };
    expect(cents(getTotalPreDiscountForQuantity(withBreaks, 30))).toBe(21);
    expect(cents(getTotalPreDiscountForQuantity(withBreaks, 10))).toBe(17.6);
  });
});

describe('member and client pricing on a qty line', () => {
  it('charges a membership copay per unit', () => {
    const fromApi = { ...gabapentin, price: 0.1, originalPrice: 15.26, perUnitPrice: 0.1 };
    expect(cents(getCatalogLinePrice(fromApi, 30).totalFinal)).toBe(3);
  });

  it('never charges a copay above the normal line total', () => {
    const fromApi = { ...gabapentin, price: 5, originalPrice: 15.26, perUnitPrice: 5 };
    expect(cents(getCatalogLinePrice(fromApi, 30).totalFinal)).toBe(22.8);
  });

  it('charges staff cost-plus per unit with no service fee', () => {
    const costPlus = 0.13 * 1.1;
    const fromApi = { ...gabapentin, price: costPlus, originalPrice: 15.26, perUnitPrice: costPlus };
    expect(cents(getCatalogLinePrice(fromApi, 30).totalFinal)).toBe(4.29);
  });

  it('takes a membership percent off the whole line, fee included', () => {
    const fromApi = { ...gabapentin, price: 15.26 * 0.8, originalPrice: 15.26 };
    expect(cents(getCatalogLinePrice(fromApi, 30).totalFinal)).toBe(18.24);
  });

  it('charges $0 for a covered item', () => {
    const fromApi = {
      ...gabapentin,
      price: 0,
      originalPrice: 15.26,
      wellnessPlanPricing: {
        hasCoverage: true,
        isWithinLimit: true,
        adjustedPrice: 0,
        originalPrice: 15.26,
        includedQuantity: 30,
        usedQuantity: 0,
        remainingQuantity: 30,
      },
    };
    const priced = getCatalogLinePrice(fromApi, 30);
    expect(priced.totalFinal).toBe(0);
    expect(priced.isCovered).toBe(true);
  });
});

describe('bundle line pricing', () => {
  const line = { listUnitPrice: 22.8 / 30, quantity: 30 };

  it('charges the normal line total when there is no discount', () => {
    expect(cents(getBundleLinePrice(line).totalFinal)).toBe(22.8);
  });

  it('applies a 10% client discount once', () => {
    const checked = { adjustedPrice: 15.26 * 0.9, originalPrice: 15.26 };
    expect(cents(getBundleLinePrice(line, checked).totalFinal)).toBe(20.52);
  });

  it('marks a covered membership line at $0', () => {
    const checked = {
      adjustedPrice: 0,
      originalPrice: 15.26,
      wellnessPlanPricing: { hasCoverage: true, isWithinLimit: true },
    } as Parameters<typeof getBundleLinePrice>[1];
    const priced = getBundleLinePrice(line, checked);
    expect(priced.totalFinal).toBe(0);
    expect(priced.isCovered).toBe(true);
  });

  describe("the bundle's own price for an item (eVet package item price; owner request, Oct 30, 2026)", () => {
    const telazol = { listUnitPrice: 24.38, quantity: 0.8, priceOverride: 0 };

    it('charges $0 when the bundle prices the item at $0, whatever the catalog says', () => {
      expect(getBundleLinePrice(telazol)).toEqual({ unitFinal: 0, totalFinal: 0, isCovered: false });
    });

    it('uses the bundle price per unit, with no client discount on top', () => {
      const librela = { listUnitPrice: 111.3, quantity: 2, priceOverride: 85.75 };
      const checked = { adjustedPrice: 100.17, originalPrice: 111.3 };
      expect(getBundleLinePrice(librela, checked, 10)).toEqual({
        unitFinal: 85.75,
        totalFinal: 171.5,
        isCovered: false,
      });
    });

    it('a membership benefit that covers the item still makes it free', () => {
      const librela = { listUnitPrice: 111.3, quantity: 1, priceOverride: 85.75 };
      const checked = {
        adjustedPrice: 0,
        originalPrice: 111.3,
        wellnessPlanPricing: { hasCoverage: true, isWithinLimit: true },
      } as Parameters<typeof getBundleLinePrice>[1];
      expect(getBundleLinePrice(librela, checked).isCovered).toBe(true);
    });
  });
});
