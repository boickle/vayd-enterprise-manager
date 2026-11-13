import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../api/practicePublicConfig', () => ({ loadStripePublishableKey: () => Promise.resolve('') }));
vi.mock('@stripe/stripe-js', () => ({ loadStripe: vi.fn() }));
vi.mock('../../api/visitWorkflow', () => ({ chargeKeyedCard: vi.fn() }));

import VirtualTerminalModal from './VirtualTerminalModal';
import { CARD_ON_FILE_STAFF_WORDING } from '../../utils/cardOnFileWording';

const base = { invoiceId: 'inv-1', amountDue: 50, onCancel: () => undefined, onPaid: () => undefined };

describe('Card over the phone: keep the card on file (ask once)', () => {
  it('asks in the window when checkout did not (Billing tab)', () => {
    render(<VirtualTerminalModal {...base} />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText(CARD_ON_FILE_STAFF_WORDING)).toBeInTheDocument();
  });

  it("doesn't ask again when the checkout box was ticked", () => {
    render(<VirtualTerminalModal {...base} consentFromCheckout />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByTestId('virtual-terminal-consent-note')).toHaveTextContent(
      'This card will be kept on file: the owner agreed at checkout.',
    );
  });

  it("doesn't ask again when the checkout box was left unticked", () => {
    render(<VirtualTerminalModal {...base} consentFromCheckout={false} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getByTestId('virtual-terminal-consent-note')).toHaveTextContent('For this payment only');
  });
});

describe('Card over the phone with a card already on file (INV-05)', () => {
  it('says the new card replaces the one on file', () => {
    render(<VirtualTerminalModal {...base} currentCardLabel="Visa •4242" />);
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    expect(screen.getByText(/replaces Visa •4242 as the card on file/)).toBeInTheDocument();
  });
});
