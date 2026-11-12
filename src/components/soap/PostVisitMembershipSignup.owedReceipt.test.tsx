import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { PostVisitSignupResult } from '../../api/memberships';
import { SignupReceipt } from './PostVisitMembershipSignup';

// P-03: when the post-visit refund failed, the receipt said "Refund this by hand" but its totals showed
// "Balance $0.00", as if the client were square. It now shows what the client is owed back.
function result(over: Partial<PostVisitSignupResult> & { owed?: number }): PostVisitSignupResult {
  const { owed, ...rest } = over;
  return {
    membershipId: 41,
    planName: 'Membership - Feline Foundations - Monthly',
    planPrice: 59,
    refundStatus: 'failed',
    refundAmount: 385.96,
    refundReference: null,
    refundError: 'Stripe refused the refund',
    chargeStatus: 'not_needed',
    chargeAmount: 0,
    chargeReference: null,
    chargeError: null,
    subscriptionStatus: 'issued',
    subscriptionAmount: 59,
    subscriptionId: 'sub_1',
    subscriptionError: null,
    invoice: {
      id: 'inv-1',
      status: 'paid',
      subtotal: 32.02,
      taxTotal: 0,
      total: 32.02,
      membershipAdjustments: -385.96,
      amountPaid: 417.98,
      balanceDue: 0,
      owedToClient: owed,
    },
    benefitsCredited: [],
    emailSent: true,
    warnings: [],
    ...rest,
  } as PostVisitSignupResult;
}

describe('post-visit signup receipt (P-03)', () => {
  it('shows what the client is owed when the refund failed', () => {
    render(<SignupReceipt result={result({ owed: 385.96 })} />);
    expect(screen.getByText('Owed to client')).toBeTruthy();
    expect(screen.getAllByText(/\$385\.96/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Balance')).toBeNull();
    expect(screen.getByText(/you have a task for it/)).toBeTruthy();
  });

  it('shows the balance when nothing is owed back', () => {
    render(<SignupReceipt result={result({ refundStatus: 'issued', refundReference: 're_1', owed: 0 })} />);
    expect(screen.getByText('Balance')).toBeTruthy();
    expect(screen.queryByText('Owed to client')).toBeNull();
  });
});
