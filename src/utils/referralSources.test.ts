import { describe, expect, it } from 'vitest';
import { legacyReferral, REFERRAL_OPTIONS } from './referralSources';

describe('referral sources (CP-T13)', () => {
  it('one list for Add client and Household defaults', () => {
    expect(REFERRAL_OPTIONS[0]).toBe('Referred by a friend or family');
    expect(REFERRAL_OPTIONS).toContain('Other');
  });
  it('keeps an older free-text answer visible instead of losing it', () => {
    expect(legacyReferral('Friend or family')).toBe('Friend or family');
    expect(legacyReferral('Saw our van')).toBeNull();
    expect(legacyReferral('  ')).toBeNull();
    expect(legacyReferral(null)).toBeNull();
  });
});
