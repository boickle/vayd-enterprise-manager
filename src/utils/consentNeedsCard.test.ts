import { describe, expect, it } from 'vitest';
import { consentNeedsCard } from './consentNeedsCard';

describe('consentNeedsCard', () => {
  it('estimate only, no picks: needs a card (the server rejects the submit without one)', () => {
    expect(consentNeedsCard({ visitEstimateTotal: 475, memorialTotal: 0, clayChargedOnForm: false })).toBe(true);
  });
  it('no estimate, memorial picked: needs a card', () => {
    expect(consentNeedsCard({ visitEstimateTotal: 0, memorialTotal: 120, clayChargedOnForm: false })).toBe(true);
  });
  it('no estimate, clay charged on the form: needs a card', () => {
    expect(consentNeedsCard({ visitEstimateTotal: 0, memorialTotal: 0, clayChargedOnForm: true })).toBe(true);
  });
  it('nothing owed: no card', () => {
    expect(consentNeedsCard({ visitEstimateTotal: 0, memorialTotal: 0, clayChargedOnForm: false })).toBe(false);
  });
});
