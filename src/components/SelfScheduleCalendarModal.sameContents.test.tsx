/**
 * Found Nov 8, 2026 while recording SR-07: the request form's "Pick a Date & Time" sent the same
 * availability request about nine times a second, because it was handed new copies of the same
 * doctor and pet lists and treated each copy as a change. useSameContents keeps the old copy while
 * the contents match, so the picker only fetches again when something really changed.
 */
// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useSameContents } from './SelfScheduleCalendarModal';

describe('useSameContents', () => {
  it('keeps the first copy while a new copy has the same contents', () => {
    const first = [{ id: 7673, name: 'Avery Lane' }];
    const { result, rerender } = renderHook(({ v }) => useSameContents(v), { initialProps: { v: first } });
    rerender({ v: [{ id: 7673, name: 'Avery Lane' }] });
    expect(result.current).toBe(first);
  });

  it('returns the new value once the contents change', () => {
    const { result, rerender } = renderHook(({ v }) => useSameContents(v), {
      initialProps: { v: [{ appointmentTypeId: 472, isNewPatient: false }] as unknown[] | undefined },
    });
    const changed = [{ appointmentTypeId: 472, isNewPatient: true }];
    rerender({ v: changed });
    expect(result.current).toBe(changed);
    rerender({ v: undefined });
    expect(result.current).toBeUndefined();
  });
});
