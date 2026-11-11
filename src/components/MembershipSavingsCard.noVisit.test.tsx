import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClientPortalPetSavings, MembershipPlanExtras } from '../api/membershipSavings';
import { PetSavingsCard } from './MembershipSavingsCard';

/** A pet with no visit to compare: the card explains why and says where to look next. */
function pet(planExtras: MembershipPlanExtras | null): ClientPortalPetSavings {
  return {
    patientId: 1,
    portalPetId: '1',
    petName: 'Ginger',
    estimate: null,
    recommendedPlanId: 'golden',
    recommendedPlanName: 'Golden Membership',
    planExtras,
    multiPetCredit: 0,
  };
}

const emptyExtras: MembershipPlanExtras = { includedItems: [], includedValue: 0, memberDiscounts: [] };
const listExtras: MembershipPlanExtras = {
  includedItems: [{ name: 'Annual lab work', quantity: 1, regularPrice: 180 }],
  includedValue: 180,
  memberDiscounts: [],
};

const text = () => document.body.textContent ?? '';

describe('PetSavingsCard with no visit to compare', () => {
  it('says why there are no savings yet', () => {
    render(<PetSavingsCard pet={pet(listExtras)} highlighted={false} onJoin={() => {}} />);
    expect(text()).toContain(
      "We can't show Ginger's savings yet because we don't have a recent wellness visit with vaccines to compare."
    );
  });

  it('points at the list when one is shown under it', () => {
    render(<PetSavingsCard pet={pet(listExtras)} highlighted={false} onJoin={() => {}} />);
    expect(text()).toContain('Here’s what Golden Membership includes:');
    expect(screen.getByText('Annual lab work')).toBeTruthy();
    expect(text()).not.toContain('Tap “');
  });

  it('points at the Join button when there is no list to show', () => {
    render(<PetSavingsCard pet={pet(emptyExtras)} highlighted={false} onJoin={() => {}} />);
    expect(text()).toContain(
      'Tap “Join Golden for Ginger” below to see everything Golden Membership includes and its price.'
    );
    expect(text()).not.toContain('Here’s what');
    expect(screen.getByRole('button', { name: 'Join Golden for Ginger' })).toBeTruthy();
  });

  it('staff view (no Join button) does not tell anyone to tap it', () => {
    render(<PetSavingsCard pet={pet(emptyExtras)} highlighted={false} />);
    expect(text()).not.toContain('Tap “');
    expect(text()).not.toContain('Here’s what');
  });

  it('with no plan details, still describes what membership covers', () => {
    render(<PetSavingsCard pet={pet(null)} highlighted={false} onJoin={() => {}} />);
    expect(text()).toContain('Membership covers the annual wellness exam');
    expect(screen.getByRole('button', { name: 'Explore membership for Ginger' })).toBeTruthy();
  });
});
