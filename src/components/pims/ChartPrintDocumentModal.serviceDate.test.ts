import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { chartServiceDate } from './ChartPrintDocumentModal';

describe('chartServiceDate: a printed document files on the day it is dated', () => {
  const now = new Date(2026, 10, 12, 19, 42); // Nov 12, 7:42 PM local

  it("files today's document at the current time, on the same local day", () => {
    const iso = chartServiceDate('2026-11-12', now)!;
    expect(DateTime.fromISO(iso).toFormat('yyyy-LL-dd HH:mm')).toBe('2026-11-12 19:42');
  });

  it('files another date at noon local time, never the day before', () => {
    const iso = chartServiceDate('2025-04-02', now)!;
    expect(DateTime.fromISO(iso).toFormat('yyyy-LL-dd HH:mm')).toBe('2025-04-02 12:00');
    expect(new Date(iso).getDate()).toBe(2);
  });

  it('passes nothing on when there is no date', () => {
    expect(chartServiceDate(undefined, now)).toBeUndefined();
    expect(chartServiceDate('  ', now)).toBeUndefined();
  });
});
