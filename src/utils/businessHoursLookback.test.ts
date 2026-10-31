/**
 * Found Oct 29, 2026: opening post-visit membership signup froze the page for ~9 s. Walking
 * back business hours stepped to a minute before opening on the same day, so it spun until
 * its 130k-step guard and returned this morning as the cutoff.
 */
import { cutoffAfterBusinessHoursAgo, defaultBusinessHoursOfOperation } from './businessHoursLookback';

const ET = 'America/New_York';
const hoursOfOperation = defaultBusinessHoursOfOperation();
const at = (iso: string) => new Date(iso);

describe('cutoffAfterBusinessHoursAgo (Mon–Fri 8–5)', () => {
  it('walks back across several days: 24 business hours before Thu 10:00 is Mon 13:00', () => {
    const cutoff = cutoffAfterBusinessHoursAgo({
      businessHours: 24,
      timeZone: ET,
      hoursOfOperation,
      asOf: at('2026-10-29T14:00:00Z'), // Thu 10:00 ET
    });
    expect(cutoff.toISOString()).toBe('2026-10-26T17:00:00.000Z'); // Mon 13:00 ET
  });

  it('before opening counts from the previous day: 2 hours before Thu 06:00 is Wed 15:00', () => {
    const cutoff = cutoffAfterBusinessHoursAgo({
      businessHours: 2,
      timeZone: ET,
      hoursOfOperation,
      asOf: at('2026-10-29T10:00:00Z'), // Thu 06:00 ET
    });
    expect(cutoff.toISOString()).toBe('2026-10-28T19:00:00.000Z'); // Wed 15:00 ET
  });

  it('skips the weekend: 1 hour before Sunday noon is Friday 16:00', () => {
    const cutoff = cutoffAfterBusinessHoursAgo({
      businessHours: 1,
      timeZone: ET,
      hoursOfOperation,
      asOf: at('2026-11-01T17:00:00Z'), // Sun 12:00 ET (EST)
    });
    expect(cutoff.toISOString()).toBe('2026-10-30T20:00:00.000Z'); // Fri 16:00 EDT
  });

  it('is fast (the 48-hour picker band)', () => {
    const t = performance.now();
    cutoffAfterBusinessHoursAgo({ businessHours: 48, timeZone: ET, hoursOfOperation, asOf: at('2026-10-29T14:00:00Z') });
    expect(performance.now() - t).toBeLessThan(100);
  });
});
