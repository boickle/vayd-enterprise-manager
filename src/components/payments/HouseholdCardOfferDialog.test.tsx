import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchOffer = vi.fn();
const move = vi.fn();
vi.mock('../../api/householdCards', () => ({
  fetchHouseholdCardOffer: (...a: unknown[]) => fetchOffer(...a),
  moveHouseholdCards: (...a: unknown[]) => move(...a),
}));

import HouseholdCardOfferDialog from './HouseholdCardOfferDialog';

const offer = {
  card: { paymentMethodId: 'pm_new', brand: 'visa', last4: '4242' },
  targets: [
    { kind: 'membership', id: 3, label: "Maple's PLUS membership", current: { brand: 'mastercard', last4: '1111' } },
    { kind: 'autoship', id: 9, label: 'Auto-ship: Heartgard', current: { brand: 'mastercard', last4: '1111' } },
  ],
};

beforeEach(() => {
  fetchOffer.mockReset();
  move.mockReset();
});

describe('One card, everywhere: the offer after a card is saved', () => {
  it('says nothing when everything is already on the new card', async () => {
    fetchOffer.mockResolvedValue({ ...offer, targets: [] });
    const onClose = vi.fn();
    render(<HouseholdCardOfferDialog audience="staff" clientId={7} paymentMethodId="pm_new" onClose={onClose} />);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(screen.queryByTestId('household-card-offer')).toBeNull();
  });

  it('staff: lists the other places, nothing ticked, ask the owner first; moves only what is ticked', async () => {
    fetchOffer.mockResolvedValue(offer);
    move.mockResolvedValue([{ kind: 'membership', id: 3, label: "Maple's PLUS membership", ok: true, error: null }]);
    render(<HouseholdCardOfferDialog audience="staff" clientId={7} paymentMethodId="pm_new" onClose={() => undefined} />);
    expect(await screen.findByText('Use Visa •4242 for these too?')).toBeInTheDocument();
    expect(screen.getByText(/Ask the owner first/)).toBeInTheDocument();
    expect(screen.getAllByText('Now: Mastercard •1111')).toHaveLength(2);
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Maple's PLUS membership/));
    await act(async () => {
      fireEvent.click(update);
    });
    expect(fetchOffer).toHaveBeenCalledWith('staff', 7, 'pm_new');
    expect(move).toHaveBeenCalledWith('staff', 7, 'pm_new', [{ kind: 'membership', id: 3 }]);
    expect(screen.getByText("Maple's PLUS membership: now on Visa •4242.")).toBeInTheDocument();
  });

  it('client: own wording, and a failure says it was not changed', async () => {
    fetchOffer.mockResolvedValue({
      ...offer,
      targets: [{ kind: 'card_on_file', id: null, label: 'Card on file for visits and refills', current: null }],
    });
    move.mockResolvedValue([
      { kind: 'card_on_file', id: null, label: 'Card on file for visits and refills', ok: false, error: 'Stripe said no.' },
    ]);
    render(<HouseholdCardOfferDialog audience="client" clientId={null} paymentMethodId="pm_new" onClose={() => undefined} />);
    expect(await screen.findByText(/Tick any you'd like to move/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Card on file for visits and refills at Vet At Your Door/));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    });
    expect(screen.getByText(/not changed\. Stripe said no\./)).toBeInTheDocument();
  });
});
