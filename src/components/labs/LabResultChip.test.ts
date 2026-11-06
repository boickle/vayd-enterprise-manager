import { describe, expect, it } from 'vitest';
import type { LabResult } from '../../api/inHouseLabs';
import { labResultsState } from './LabResultChip';

const result = (over: Partial<LabResult>): LabResult =>
  ({ id: 1, status: 'complete', templateMode: 'table', elementsSnapshot: [], values: {}, ...over }) as LabResult;

describe('labResultsState', () => {
  it('calls a saved notes-only form complete, not normal (nobody marked it normal)', () => {
    expect(labResultsState([result({ templateMode: 'summary' })])).toBe('complete');
  });
  it('calls a table form with nothing flagged normal', () => {
    expect(labResultsState([result({})])).toBe('normal');
  });
  it('is waiting while any form is pending', () => {
    expect(labResultsState([result({ templateMode: 'summary', status: 'pending' })])).toBe('waiting');
  });
});
