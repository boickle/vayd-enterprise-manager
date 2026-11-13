/**
 * PAY-C3-1 (D9, Nov 12, 2026): every screen that saves a card shows the same practice-wide wording.
 * Client screens: store card entry, auto-ship card change, portal bill pay (uses the store card entry).
 * Staff screens: Replace card and visit checkout (their tests are in ClientCardOnFileSection.test.tsx
 * and VisitCheckoutPanel.cardConsent.test.tsx).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CARD_ON_FILE_CLIENT_WORDING, CARD_ON_FILE_STAFF_ASK } from './cardOnFileWording';

vi.mock('../api/practicePublicConfig', () => ({ loadStripePublishableKey: vi.fn().mockResolvedValue('pk_test_x') }));
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn().mockResolvedValue({
    elements: () => ({ create: () => ({ mount: vi.fn(), unmount: vi.fn() }) }),
    createPaymentMethod: vi.fn(),
  }),
}));
vi.mock('../api/onlineStore', async (orig) => ({
  ...(await orig<typeof import('../api/onlineStore')>()),
  myStoreAccount: vi.fn().mockResolvedValue({ available: 0, invoices: [], owed: 100, payableOwed: 100, evetNotPayable: 0 }),
  myStoreCards: vi.fn().mockResolvedValue({ hasCard: false, cards: [] }),
}));
vi.mock('../api/clientPortal', () => ({ fetchClientInfo: vi.fn().mockResolvedValue({}) }));
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));
vi.mock('../pages/store/StoreOpenInvoicesPanel', () => ({ default: () => null }));
vi.mock('../pages/store/StoreGiftCardCart', () => ({ StoreGiftCardCodeEntry: () => null }));

import StoreCartCardEntry from '../pages/store/StoreCartCardEntry';
import AutoshipCardPanel from '../pages/store/AutoshipCardPanel';
import PortalAccountCard from '../pages/clientPortal/PortalAccountCard';

const prefill = { name: '', email: '', line1: '', line2: '', city: '', state: '', postal: '' };

describe('PAY-C3-1: one card-on-file wording on every screen', () => {
  it('the client wording is the D9 sentence, and the staff wording names the same four uses', () => {
    expect(CARD_ON_FILE_CLIENT_WORDING).toBe(
      'Keep this card on file. Vet At Your Door may charge it for visits, refills, memberships and online store orders. You can ask us to remove it at any time.',
    );
    expect(CARD_ON_FILE_STAFF_ASK).toBe(
      'Owner agrees we may keep this card on file and charge it for visits, refills, memberships and online store orders. Ask before you tap. Tick this box when they say yes.',
    );
  });

  it('store card entry: the save box says it, and the old "future purchases" wording is gone', () => {
    render(<StoreCartCardEntry billingPrefill={prefill} />);
    expect(screen.getByText(CARD_ON_FILE_CLIENT_WORDING)).toBeTruthy();
    expect(screen.queryByText(/future purchases/)).toBeNull();
  });

  it('auto-ship card change (portal and staff share this panel): shows it', async () => {
    render(
      <AutoshipCardPanel
        load={async () => ({ status: 'active', cards: [{ paymentMethodId: 'pm_1', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2031, current: true }] })}
        save={vi.fn()}
        name="Clem"
        buttonClass="b"
        secondaryButtonClass="s"
      />,
    );
    expect((await screen.findByTestId('autoship-card-wording')).textContent).toBe(CARD_ON_FILE_CLIENT_WORDING);
  });

  it('portal bill pay: entering a new card shows it', async () => {
    render(<PortalAccountCard clientId={1} email="a@b.co" onShop={() => undefined} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Pay now' }));
    expect(await screen.findByText(CARD_ON_FILE_CLIENT_WORDING)).toBeTruthy();
  });
});
