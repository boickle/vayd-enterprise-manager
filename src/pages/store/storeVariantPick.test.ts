import { describe, expect, it } from 'vitest';
import { packChipsLabel } from './storeVariantPick';

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
