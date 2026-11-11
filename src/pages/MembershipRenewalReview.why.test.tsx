import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

// Owner, Nov 11, 2026: the renewal page should say why to stay: what the pet keeps, and the care the membership
// covered this year (only when that's a meaningful amount).

let preview: Record<string, unknown> = {};
vi.mock('../api/memberships', async (orig) => ({
  ...(await orig<typeof import('../api/memberships')>()),
  fetchMembershipRenewalPreview: vi.fn(async () => preview),
  requestMembershipRenewalCancel: vi.fn(),
}));

import MembershipRenewalReview from './MembershipRenewalReview';

function base(extra: Record<string, unknown> = {}) {
  return {
    petName: 'Maple',
    clientFirstName: 'Maria',
    currentPlanName: 'Membership - Canine Foundations - Monthly',
    nextPlanName: 'Membership - Canine Foundations - Monthly',
    billingInterval: 'monthly',
    nextPrice: 69,
    termEnd: '2026-11-18',
    reason: 'same',
    alreadyRenewed: false,
    termReviewClosed: false,
    alreadyCanceling: false,
    cancelPhrase: 'CANCEL',
    needsCard: false,
    planOptions: [],
    recommendedPackageId: 30,
    nextPackageId: 30,
    comparison: null,
    benefits: ['One comprehensive wellness exam & trip fee', 'Priority scheduling with your One-Team'],
    coveredThisYear: 432.3,
    ...extra,
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/membership/renewal?token=t1']}>
      <MembershipRenewalReview />
    </MemoryRouter>,
  );
}

describe('renewal review: why stay', () => {
  it('lists what the pet keeps and the care covered this year; the cancel form lists what they lose', async () => {
    preview = base();
    renderPage();
    expect(await screen.findByText('What Maple keeps by staying a member')).toBeTruthy();
    expect(screen.getByText('$432.30')).toBeTruthy();
    expect(screen.getAllByText('Priority scheduling with your One-Team')).toHaveLength(1);

    fireEvent.click(screen.getByRole('button', { name: 'I want to cancel this membership' }));
    expect(screen.getByText(/Maple loses:/)).toBeTruthy();
    expect(screen.getAllByText('Priority scheduling with your One-Team')).toHaveLength(2);
  });

  it('leaves off a small covered amount', async () => {
    preview = base({ coveredThisYear: 40 });
    renderPage();
    await screen.findByText('What Maple keeps by staying a member');
    expect(screen.queryByText(/covered/)).toBeNull();
  });
});
