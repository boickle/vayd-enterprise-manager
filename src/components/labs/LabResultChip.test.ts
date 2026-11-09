import { describe, expect, it } from 'vitest';
import type { LabResult } from '../../api/inHouseLabs';
import { labResultsState } from './LabResultChip';

const result = (over: Partial<LabResult>): LabResult =>
  ({ id: 1, status: 'complete', templateMode: 'table', elementsSnapshot: [], values: {}, ...over }) as LabResult;

describe('labResultsState', () => {
  it('calls a saved notes-only form complete, not normal (nobody marked it normal)', () => {
    expect(labResultsState([result({ templateMode: 'summary' })])).toBe('complete');
  });
  // Owner decision, Nov 8, 2026: the chip says Complete; it doesn't judge normal or abnormal.
  it('calls a saved table form complete', () => {
    expect(labResultsState([result({})])).toBe('complete');
  });
  it('calls a saved form complete even with an abnormal choice (flagged inside the form)', () => {
    expect(
      labResultsState([
        result({
          elementsSnapshot: [
            { key: 'hw', name: 'Heartworm', valueType: 'select', min: null, max: null, units: null, options: ['Negative', 'Positive'], abnormalOptions: ['Positive'] },
          ],
          values: { hw: { value: 'Positive', comments: null } },
        }),
      ]),
    ).toBe('complete');
  });
  it('is waiting while any form is pending', () => {
    expect(labResultsState([result({ templateMode: 'summary', status: 'pending' })])).toBe('waiting');
  });
});
