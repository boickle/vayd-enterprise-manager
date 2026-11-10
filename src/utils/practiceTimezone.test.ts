/**
 * RP-A4 (helpers): a date picked in the grant form ends at the last instant of that day in Eastern time,
 * across daylight and standard time, and displays back as the same calendar day.
 */
import { endOfPracticeDayIso, formatPracticeDate } from './practiceTimezone';

describe('endOfPracticeDayIso', () => {
  it('uses daylight-time offset in summer and standard-time offset in winter', () => {
    expect(endOfPracticeDayIso('2026-07-15')).toBe('2026-07-15T23:59:59.999-04:00');
    expect(endOfPracticeDayIso('2026-11-30')).toBe('2026-11-30T23:59:59.999-05:00');
  });

  it('is the end of the Eastern day, not midnight UTC', () => {
    const iso = endOfPracticeDayIso('2026-11-30');
    expect(new Date(iso as string).toISOString()).toBe('2026-12-01T04:59:59.999Z');
  });

  it('returns null for anything that is not a calendar day', () => {
    expect(endOfPracticeDayIso('')).toBeNull();
    expect(endOfPracticeDayIso(null)).toBeNull();
    expect(endOfPracticeDayIso('2026-02-31')).toBeNull();
    expect(endOfPracticeDayIso('2026-11-30T10:00:00Z')).toBeNull();
  });
});

describe('formatPracticeDate', () => {
  it('shows an instant as its Eastern calendar day', () => {
    expect(formatPracticeDate('2026-07-16T03:59:59.999Z')).toBe('7/15/2026');
    expect(formatPracticeDate('2026-11-30T23:59:59.999-05:00')).toBe('11/30/2026');
  });

  it('returns an empty string for missing or invalid values', () => {
    expect(formatPracticeDate(null)).toBe('');
    expect(formatPracticeDate('not a date')).toBe('');
  });
});
