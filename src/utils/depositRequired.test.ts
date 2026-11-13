import { describe, expect, it } from 'vitest';
import { alertsWithDeposit, depositBadgeState, depositBadgeTitle } from './depositRequired';

const flagged = { depositRequired: true, depositRequiredNote: 'Two unpaid visits' };

describe('PAY-A18: schedule deposit badge', () => {
  it('shows the deposit status for any visit that has one', () => {
    expect(depositBadgeState({}, 'paid')).toBe('paid');
    expect(depositBadgeState({}, 'requested')).toBe('requested');
    expect(depositBadgeState(flagged, 'part_paid')).toBe('part_paid');
  });

  it('is red ("needed") for a Deposit required client with nothing asked for, and absent otherwise', () => {
    expect(depositBadgeState(flagged, undefined)).toBe('needed');
    expect(depositBadgeState(flagged, 'none')).toBe('needed');
    expect(depositBadgeState({ depositRequired: false }, undefined)).toBeNull();
  });

  it('titles say what was asked for and paid', () => {
    expect(depositBadgeTitle('paid', { requested: 100, paid: 100 })).toBe('Deposit paid ($100.00)');
    expect(depositBadgeTitle('requested', { requested: 100, paid: 0 })).toBe('Deposit asked for ($100.00), not paid yet');
    expect(depositBadgeTitle('part_paid', { requested: 100, paid: 40 })).toBe('Deposit partly paid: $40.00 of $100.00');
    expect(depositBadgeTitle('needed')).toBe('Deposit required: not asked for yet');
  });

  it('the client alert stops saying "collect" once the deposit is paid', () => {
    expect(alertsWithDeposit(flagged, null)).toMatch(/collect a deposit/);
    expect(alertsWithDeposit(flagged, null, { depositPaid: true })).toBe(
      'DEPOSIT REQUIRED (Two unpaid visits): the deposit for this visit is paid.',
    );
  });
});
