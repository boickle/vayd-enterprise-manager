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
