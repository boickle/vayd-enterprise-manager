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
    expect(formatLabRange(glucose)).toBe('mg/dl');
  });

  // Owner decision, Nov 8, 2026: no number ranges at all, even where a form still has min/max.
  it('a numeric row with a min/max left on the form never flags either, and shows only its units', () => {
    const glucose: LabFormElement = {
      key: 'glu',
      name: 'Blood glucose',
      valueType: 'number',
      min: 0,
      max: 500,
      units: 'mg/dl',
    };
    expect(isLabValueAbnormal(glucose, '650')).toBe(false);
    expect(isLabValueAbnormal(glucose, '-1')).toBe(false);
    expect(formatLabRange(glucose)).toBe('mg/dl');
  });

  it('an abnormal choice still flags', () => {
    const hw: LabFormElement = {
      key: 'hw',
      name: 'Heartworm',
      valueType: 'select',
      min: null,
      max: null,
      units: null,
      options: ['Negative', 'Positive'],
      abnormalOptions: ['Positive'],
    };
    expect(isLabValueAbnormal(hw, 'Positive')).toBe(true);
    expect(isLabValueAbnormal(hw, 'Negative')).toBe(false);
  });
});
