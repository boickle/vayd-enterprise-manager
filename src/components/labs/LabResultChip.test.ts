import { describe, expect, it } from 'vitest';
import type { LabResult } from '../../api/inHouseLabs';
import { labResultsState } from './LabResultChip';

const result = (over: Partial<LabResult>): LabResult =>
  ({ id: 1, status: 'complete', templateMode: 'table', elementsSnapshot: [], values: {}, ...over }) as LabResult;

describe('labResultsState', () => {
  it('calls a saved notes-only form complete, not normal (nobody marked it normal)', () => {
    expect(labResultsState([result({ templateMode: 'summary' })])).toBe('complete');
  });
  // Owner decisions, Nov 8, 2026: numbers aren't judged (Complete); choice rows are (Normal / abnormal).
  const hw = { key: 'hw', name: 'Heartworm', valueType: 'select', min: null, max: null, units: null, options: ['Negative', 'Positive'], abnormalOptions: ['Positive'] };
  const glu = { key: 'glu', name: 'Glucose', valueType: 'number', min: 0, max: 500, units: 'mg/dl' };
  it('calls a saved number-only form complete, whatever the number', () => {
    expect(labResultsState([result({ elementsSnapshot: [glu] as never, values: { glu: { value: '650', comments: null } } as never })])).toBe('complete');
  });
  it('calls a choice form with only normal answers normal', () => {
    expect(labResultsState([result({ elementsSnapshot: [hw] as never, values: { hw: { value: 'Negative', comments: null } } as never })])).toBe('normal');
  });
  it('calls a choice form with an abnormal answer abnormal', () => {
    expect(labResultsState([result({ elementsSnapshot: [hw, glu] as never, values: { hw: { value: 'Positive', comments: null }, glu: { value: '90', comments: null } } as never })])).toBe('abnormal');
  });
  it('is waiting while any form is pending', () => {
    expect(labResultsState([result({ templateMode: 'summary', status: 'pending' })])).toBe('waiting');
  });
});
