import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import VirtualTerminalModal from './VirtualTerminalModal';

vi.mock('../../api/practicePublicConfig', () => ({ loadStripePublishableKey: vi.fn().mockResolvedValue('pk_test_x') }));
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue({
    elements: () => ({ create: () => ({ mount: vi.fn(), unmount: vi.fn(), on: vi.fn(), destroy: vi.fn() }) }),
    createPaymentMethod: vi.fn(),
  }),
}));

/**
 * Owner (Nov 12, 2026): "Card over phone" became "Type card manually", covering a broken reader, a card
 * that won't tap and an owner who isn't there, with a note that typed-in cards cost a higher card fee.
 */
describe('Type card manually window', () => {
  it('is titled "Type card manually" and says typed-in cards cost a higher fee', () => {
    render(<VirtualTerminalModal invoiceId="inv-1" amountDue={75} onCancel={vi.fn()} onPaid={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Type card manually' })).toBeInTheDocument();
    expect(
      screen.getByText(/Typed-in cards cost us a higher card fee than Tap to Pay\. Use this when the reader isn't working, the card won't tap, or the owner isn't with you\./),
    ).toBeInTheDocument();
    expect(screen.queryByText(/over the phone/i)).not.toBeInTheDocument();
  });
});
