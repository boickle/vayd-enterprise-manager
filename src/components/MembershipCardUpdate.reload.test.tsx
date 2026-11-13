import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getMembershipCard = vi.fn();
vi.mock('../api/memberships', () => ({
  getMembershipCard: (...a: unknown[]) => getMembershipCard(...a),
  moveMembershipToStripe: vi.fn(),
  updateMembershipCard: vi.fn(),
}));
vi.mock('./soap/PostVisitCardEntry', () => ({ default: () => null }));

import MembershipCardUpdate from './MembershipCardUpdate';

// P-25b: after staff link a Stripe subscription by hand, the card box kept saying "Not on Stripe yet"
// because it loaded once per membership. It now reloads when the subscription id changes.
describe('MembershipCardUpdate reloads after a subscription is linked', () => {
  beforeEach(() => getMembershipCard.mockReset());

  it('asks again when the subscription id changes', async () => {
    getMembershipCard.mockResolvedValueOnce({ card: null, canUpdate: false, canMoveToStripe: true, reason: null });
    const { rerender } = render(<MembershipCardUpdate membershipId={7} subscriptionId={null} />);
    expect(await screen.findByText('Not on Stripe yet')).toBeTruthy();

    getMembershipCard.mockResolvedValueOnce({
      card: { brand: 'visa', last4: '4242', expMonth: 12, expYear: 2034 },
      canUpdate: true,
      canMoveToStripe: false,
      reason: null,
    });
    rerender(<MembershipCardUpdate membershipId={7} subscriptionId="sub_123" />);

    await waitFor(() => expect(getMembershipCard).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByText('Not on Stripe yet')).toBeNull());
  });
});
