import { describe, expect, it } from 'vitest';
import { formatYmd } from './formatYmd';

describe('formatYmd (B6)', () => {
  it('reads a calendar date in words', () => {
    expect(formatYmd('2026-11-13')).toBe('Nov 13, 2026');
    expect(formatYmd('2027-01-01')).toBe('Jan 1, 2027');
  });
  it('ignores a time part and keeps the calendar day', () => {
    expect(formatYmd('2026-11-13T00:00:00.000Z')).toBe('Nov 13, 2026');
  });
  it('leaves other text alone', () => {
    expect(formatYmd('')).toBe('');
    expect(formatYmd(null)).toBe('');
    expect(formatYmd('soon')).toBe('soon');
  });
});
