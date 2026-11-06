/** INV-A12: the Receive screen reads pack sizes the same way the API does. */
import { describe, expect, it } from 'vitest';
import { inferVendorPackSize } from './vendorPackSize';

describe('inferVendorPackSize', () => {
  it.each([
    ['RABVAC 3 25X1DS', 25],
    ['CARPROFEN 100MG 180CT', 180],
    ['METRONIDAZOLE 250MG 500 TABS', 500],
    ['SIMPARICA TRIO 6 PK', 6],
    ['Bottle of 100 Amoxicillin 250mg', 100],
  ])('reads "%s" as %i', (text, n) => {
    expect(inferVendorPackSize(text)).toBe(n);
  });

  it('ignores strengths and volumes', () => {
    expect(inferVendorPackSize('CARPROFEN 100MG')).toBeNull();
    expect(inferVendorPackSize('CERENIA INJ 10MG/ML 20ML')).toBeNull();
  });
});
