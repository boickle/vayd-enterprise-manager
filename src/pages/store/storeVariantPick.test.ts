import { describe, expect, it } from 'vitest';
import {
  namedOptionsOf,
  optionValuesAt,
  packChipsLabel,
  settleOptionPicks,
  variantForPicks,
  weightOptionIndex,
} from './storeVariantPick';

describe('pack chip heading', () => {
  it('flavors are an "Option", not a size', () => {
    expect(packChipsLabel([], ['Beef', 'Malt', 'Poultry', 'Seafood', 'Vanilla Mint'])).toBe('Option');
  });
  it('weight ranges under month durations stay "Weight"', () => {
    expect(packChipsLabel(['1-month', '3-month'], ['10–22 lbs', '22.1–44 lbs'])).toBe('Weight');
  });
  it('counts and sizes keep their old headings', () => {
    expect(packChipsLabel(['25 mg'], ['Bottle of 30', 'Bottle of 90'])).toBe('Amount');
    // Unchanged existing behaviour: no strengths reads as "Weight".
    expect(packChipsLabel([], ['4 lbs', '12 lbs'])).toBe('Weight');
    expect(packChipsLabel([])).toBe('Weight');
  });
});

describe('named shopper choices', () => {
  const bravecto = [
    { id: 1, options: ['1 month', '4.4–9.9 lbs'] },
    { id: 2, options: ['1 month', '9.9–22 lbs'] },
    { id: 3, options: ['3 months', '9.9–22 lbs'] },
  ];

  it('uses the names only when every item has its own complete set of values', () => {
    expect(namedOptionsOf({ optionNames: ['Duration', 'Weight'], variants: bravecto })).toEqual([
      'Duration',
      'Weight',
    ]);
    expect(
      namedOptionsOf({ optionNames: ['Duration', 'Weight'], variants: [...bravecto, { id: 4, options: ['1 month'] }] })
    ).toEqual([]);
    expect(
      namedOptionsOf({ optionNames: ['Flavor'], variants: [{ options: ['Beef'] }, { options: ['Beef'] }] })
    ).toEqual([]);
  });

  it('offers only the values that exist under the earlier picks', () => {
    expect(optionValuesAt(bravecto, 1, ['3 months'])).toEqual(['9.9–22 lbs']);
    expect(optionValuesAt(bravecto, 0, [])).toEqual(['1 month', '3 months']);
  });

  it('moves a later pick to one that exists when an earlier pick changes', () => {
    const picks = settleOptionPicks(bravecto, 2, ['3 months', '4.4–9.9 lbs']);
    expect(picks).toEqual(['3 months', '9.9–22 lbs']);
    expect(variantForPicks(bravecto, picks)?.id).toBe(3);
  });

  it('finds the weight choice for the pet weight auto-pick', () => {
    expect(weightOptionIndex(bravecto, 2)).toBe(1);
    expect(weightOptionIndex([{ options: ['Beef'] }, { options: ['Malt'] }], 1)).toBe(-1);
  });
});
