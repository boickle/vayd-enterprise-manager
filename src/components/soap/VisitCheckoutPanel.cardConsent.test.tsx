import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const startTerminalCheckout = vi.fn();
const getInvoiceCardOnFile = vi.fn();

vi.mock('../../api/visitWorkflow', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/visitWorkflow')>()),
  getInvoiceCardOnFile: (...a: unknown[]) => getInvoiceCardOnFile(...a),
  startTerminalCheckout: (...a: unknown[]) => startTerminalCheckout(...a),
}));
vi.mock('./TerminalReaderPicker', async () => {
  const React = await import('react');
  return {
    default: ({ onCatalog }: { onCatalog?: (c: unknown) => void }) => {
      React.useEffect(() => {
        onCatalog?.({ selectedId: 'r1', readers: [{ id: 'r1', label: 'Reader 1', online: true }] });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return null;
    },
  };
});
vi.mock('../../auth/useAuth', () => ({ useAuth: () => ({ user: {}, employeeId: 1 }) }));
vi.mock('./CheckoutReminders', () => ({ default: () => null }));
vi.mock('../RoomLoaderPdfCanvas', () => ({ default: () => null }));
vi.mock('../../utils/extractUploadText', () => ({}));
vi.mock('../../utils/householdChartPdfs', () => ({}));
vi.mock('../records/RecordDocumentsReview', () => ({ default: () => null }));
vi.mock('../../permissions/PermissionContext', () => ({
  useCan: () => true,
  usePermissions: () => ({ effective: null }),
}));

import VisitCheckoutPanel from './VisitCheckoutPanel';
import { CARD_ON_FILE_STAFF_ASK } from '../../utils/cardOnFileWording';

const invoice = {
  id: 'inv-1',
  patientId: 7,
  status: 'open',
  lines: [],
  inventoryBranchId: 1,
  inventoryLocationId: 1,
} as never;
const props = {
  invoice,
  patientId: 7,
  roster: [{ patientId: 7, patientName: 'Hazel' }],
  practiceId: 1,
  onInvoiceChange: () => {},
} as never;

describe('card on file consent box at checkout', () => {
  beforeEach(() => {
    startTerminalCheckout.mockReset();
    startTerminalCheckout.mockResolvedValue({ checkoutId: 'c1', amountCents: 100, invoice: null });
    getInvoiceCardOnFile.mockReset();
    getInvoiceCardOnFile.mockResolvedValue({ card: null, declinedAt: null });
  });

  it('starts unticked, even when the household never said no', async () => {
    render(<VisitCheckoutPanel {...(props as object)} />);
    const box = (await screen.findByRole('checkbox')) as HTMLInputElement;
    await waitFor(() => expect(getInvoiceCardOnFile).toHaveBeenCalled());
    expect(box.checked).toBe(false);
  });

  it('W12-2: the label says staff tick the box when the client agrees, not "uncheck"', async () => {
    render(<VisitCheckoutPanel {...(props as object)} />);
    await screen.findByRole('checkbox');
    const label = document.querySelector('.soap-checkout-consent')?.textContent ?? '';
    expect(label).toMatch(/Tick this box when they say yes/);
    expect(label).not.toMatch(/uncheck/i);
    expect(label).toMatch(/keep this card on file and charge it for visits, refills, memberships and online store orders/);
  });

  it('PAY-C3-1: the label is the practice-wide staff wording, word for word', async () => {
    render(<VisitCheckoutPanel {...(props as object)} />);
    await screen.findByRole('checkbox');
    const label = document.querySelector('.soap-checkout-consent')?.textContent ?? '';
    expect(label).toBe(CARD_ON_FILE_STAFF_ASK);
  });

  it('PAY-C5-1: an expired card on file shows "Expired, ending 4242" and cannot be charged', async () => {
    getInvoiceCardOnFile.mockResolvedValue({
      card: { customerId: 'cus_1', paymentMethodId: 'pm_1', brand: 'visa', last4: '4242', expMonth: 1, expYear: 2026, expired: true },
      declinedAt: null,
    });
    render(<VisitCheckoutPanel {...(props as object)} />);
    expect((await screen.findByTestId('card-on-file-expired')).textContent).toMatch(/Visa: Expired, ending 4242/);
    expect(screen.getByText('Expired, ending 4242')).toBeTruthy();
    const button = screen.getByTestId('card-on-file-button') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.textContent).not.toMatch(/4242/);
    // With no usable card, the owner can agree to keep the new one.
    expect(document.querySelector('.soap-checkout-consent')).not.toBeNull();
  });

  it('Tap to Pay without ticking the box does not ask to save the card', async () => {
    render(<VisitCheckoutPanel {...(props as object)} />);
    await screen.findByRole('checkbox');
    await waitFor(() => expect(getInvoiceCardOnFile).toHaveBeenCalled());
    const tap = await screen.findByRole('button', { name: /Tap to Pay/ });
    await waitFor(() => expect((tap as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(tap);
    await waitFor(() => expect(startTerminalCheckout).toHaveBeenCalled());
    expect(startTerminalCheckout).toHaveBeenCalledWith('inv-1', { saveCard: false });
  });

  it('ticking the box is what asks to save the card', async () => {
    render(<VisitCheckoutPanel {...(props as object)} />);
    const box = await screen.findByRole('checkbox');
    await waitFor(() => expect(getInvoiceCardOnFile).toHaveBeenCalled());
    fireEvent.click(box);
    const tap = await screen.findByRole('button', { name: /Tap to Pay/ });
    await waitFor(() => expect((tap as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(tap);
    await waitFor(() => expect(startTerminalCheckout).toHaveBeenCalledWith('inv-1', { saveCard: true }));
  });
});
