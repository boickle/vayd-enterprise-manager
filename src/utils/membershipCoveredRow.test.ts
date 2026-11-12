import { describe, expect, it } from 'vitest';
import { membershipCoveredAmount, membershipCoveredLabel } from './membershipCoveredRow';

describe('membership covered row', () => {
  it('names the one covered line', () => {
    expect(
      membershipCoveredLabel([
        { description: 'Office exam', isCovered: true },
        { description: 'Nail trim', isCovered: false },
      ]),
    ).toBe('Office exam included in membership');
  });

  it('names two covered lines, skips deleted ones and repeats', () => {
    expect(
      membershipCoveredLabel([
        { description: 'Office exam', isCovered: true },
        { description: 'DHPP', isCovered: true },
        { description: 'DHPP', isCovered: true },
        { description: 'Rabies', isCovered: true, isDeleted: true },
      ]),
    ).toBe('Office exam and DHPP included in membership');
  });

  it('counts three or more, and has a plain label when names are missing', () => {
    expect(
      membershipCoveredLabel([
        { description: 'Office exam', isCovered: true },
        { description: 'DHPP', isCovered: true },
        { description: 'Rabies', isCovered: true },
      ]),
    ).toBe('3 items included in membership');
    expect(membershipCoveredLabel([])).toBe('Included in membership');
  });

  it('shows the amount as covered, no minus sign', () => {
    expect(membershipCoveredAmount(-75)).toBe('$75.00 covered');
    expect(membershipCoveredAmount('1234.5')).toBe('$1,234.50 covered');
  });
});
