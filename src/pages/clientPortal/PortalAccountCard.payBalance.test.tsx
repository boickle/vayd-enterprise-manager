import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../api/onlineStore', async (orig) => ({
  ...(await orig<typeof import('../../api/onlineStore')>()),
  myStoreAccount: vi.fn(),
  myStoreCards: vi.fn(),
  payMyStoreBalance: vi.fn(),
}));
vi.mock('../../api/clientPortal', () => ({ fetchClientInfo: vi.fn().mockResolvedValue({}) }));
vi.mock('../../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));
vi.mock('../store/StoreCartCardEntry', () => ({ default: () => null }));
vi.mock('../store/StoreOpenInvoicesPanel', () => ({ default: () => null }));
vi.mock('../store/StoreGiftCardCart', () => ({ StoreGiftCardCodeEntry: () => null }));

import PortalAccountCard from './PortalAccountCard';
import { myStoreAccount, myStoreCards, payMyStoreBalance, StoreRequestError } from '../../api/onlineStore';

const pay = payMyStoreBalance as ReturnType<typeof vi.fn>;

async function setup(account: { owed: number; payableOwed: number; evetNotPayable: number }) {
  (myStoreAccount as ReturnType<typeof vi.fn>).mockResolvedValue({
    available: 0,
    invoices: [],
    ...account,
  });
  (myStoreCards as ReturnType<typeof vi.fn>).mockResolvedValue({
    hasCard: true,
    cards: [{ paymentMethodId: 'pm_1', brand: 'visa', last4: '4242' }],
  });
  render(<PortalAccountCard clientId={1} email="a@b.co" onShop={() => undefined} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Pay now' }));
}

describe('PortalAccountCard pay balance (OS-03/OS-06)', () => {
  beforeEach(() => pay.mockReset());

  it('offers only the payable amount and notes the held part', async () => {
    await setup({ owed: 150, payableOwed: 100, evetNotPayable: 50 });
    expect(await screen.findByRole('button', { name: 'Pay $100.00' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pay $150.00' })).toBeNull();
    expect(screen.getByText(/\$50\.00 is on older bills/)).toBeTruthy();
  });

  it('keeps the key after a network error or 5xx, and changes it after a 4xx', async () => {
    await setup({ owed: 100, payableOwed: 100, evetNotPayable: 0 });
    pay
      .mockRejectedValueOnce(new StoreRequestError('no answer', null))
      .mockRejectedValueOnce(new StoreRequestError('boom', 503))
      .mockRejectedValueOnce(new StoreRequestError('declined', 402))
      .mockRejectedValueOnce(new StoreRequestError('declined again', 402));
    const click = async (n: number) => {
      fireEvent.click(await screen.findByRole('button', { name: 'Pay $100.00' }));
      await waitFor(() => expect(pay).toHaveBeenCalledTimes(n));
      await screen.findByRole('button', { name: 'Pay $100.00' });
    };
    await click(1);
    await click(2);
    await click(3);
    await click(4);
    const keys = pay.mock.calls.map((c) => c[0].attemptKey);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).toBe(keys[0]);
    expect(keys[3]).not.toBe(keys[0]);
  });

  it('ignores a second click while paying', async () => {
    await setup({ owed: 100, payableOwed: 100, evetNotPayable: 0 });
    let release: (v: unknown) => void = () => undefined;
    pay.mockReturnValue(new Promise((r) => (release = r)));
    const btn = await screen.findByRole('button', { name: 'Pay $100.00' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(pay).toHaveBeenCalledTimes(1);
    release({ paid: 100, giftCardApplied: 0, cardCharged: 100, accountCredit: 0 });
    await screen.findByText(/Paid \$100\.00/);
  });
});
