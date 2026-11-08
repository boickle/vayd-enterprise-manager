/**
 * LAB-06 (decision D4): numeric ranges are cleared on forms, choice rows keep flagging.
 * Run: npx vitest run src/utils/labValues.lab06.test.ts
 */
import { describe, expect, it } from 'vitest';
import { formatLabRange, isLabValueAbnormal, type LabFormElement } from './labValues';

describe('LAB-06 reference ranges', () => {
  it('LAB-06-1: a choice row (Heartworm) still flags its abnormal option', () => {
    const heartworm: LabFormElement = {
      key: 'hw',
      name: 'Heartworm',
      valueType: 'select',
      min: null,
      max: null,
      units: null,
      options: ['Negative', 'Positive'],
      abnormalOptions: ['Positive'],
    };
    expect(isLabValueAbnormal(heartworm, 'Positive')).toBe(true);
    expect(isLabValueAbnormal(heartworm, 'Negative')).toBe(false);
  });

  it('LAB-06-2: a numeric row with no min/max never flags, and prints no range', () => {
    const glucose: LabFormElement = {
      key: 'glu',
      name: 'Blood glucose',
      valueType: 'number',
      min: null,
      max: null,
      units: 'mg/dl',
    };
    for (const value of ['0', '5', '450', '-3', '99999']) {
      expect(isLabValueAbnormal(glucose, value)).toBe(false);
    }
    expect(formatLabRange(glucose)).toBe('');
  });
});
