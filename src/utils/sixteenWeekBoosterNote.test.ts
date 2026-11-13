import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { sixteenWeekBoosterNote } from './schedulerVisitDisplay';

const TZ = 'America/New_York';
const at = (iso: string) => DateTime.fromISO(iso, { zone: TZ });

describe('sixteenWeekBoosterNote', () => {
  it('shows the upcoming 16-week date for a young puppy', () => {
    // Born Aug 30 → 16 weeks on Dec 20.
    expect(sixteenWeekBoosterNote('2026-08-30', TZ, at('2026-11-12T10:00'))).toBe('16 weeks on 12/20/2026');
  });

  it('is not shifted a day by a midnight-UTC DOB', () => {
    expect(sixteenWeekBoosterNote('2026-08-30T00:00:00.000Z', TZ, at('2026-11-12T10:00'))).toBe(
      '16 weeks on 12/20/2026',
    );
  });

  it('says "turned" on and after the 16-week day', () => {
    expect(sixteenWeekBoosterNote('2026-08-30', TZ, at('2026-12-20T08:00'))).toBe('turned 16 weeks on 12/20/2026');
    expect(sixteenWeekBoosterNote('2026-08-30', TZ, at('2027-01-16T08:00'))).toBe('turned 16 weeks on 12/20/2026');
  });

  it('is hidden from 20 weeks on, and without a usable DOB', () => {
    expect(sixteenWeekBoosterNote('2026-08-30', TZ, at('2027-01-17T08:00'))).toBeNull();
    expect(sixteenWeekBoosterNote('2020-01-01', TZ, at('2026-11-12T08:00'))).toBeNull();
    expect(sixteenWeekBoosterNote(null, TZ)).toBeNull();
    expect(sixteenWeekBoosterNote('not a date', TZ)).toBeNull();
    expect(sixteenWeekBoosterNote('2026-12-01', TZ, at('2026-11-12T08:00'))).toBeNull();
  });
});
