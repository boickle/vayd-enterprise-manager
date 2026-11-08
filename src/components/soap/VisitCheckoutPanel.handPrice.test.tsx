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

const line = (over: Record<string, unknown>) => ({
  id: 'l1',
  patientId: 7,
  description: 'Office exam',
  qty: 1,
  unitPrice: 75,
  amount: 75,
  isCovered: false,
  providerEmployeeId: 1,
  ...over,
});
const render1 = (lines: unknown[]) =>
  render(
    <VisitCheckoutPanel
      {...({
        invoice: { id: 'inv-1', patientId: 7, status: 'open', lines, inventoryBranchId: 1, inventoryLocationId: 1, total: 75, amountPaid: 0 },
        patientId: 7,
        roster: [{ patientId: 7, patientName: 'Hazel' }],
        practiceId: 1,
        onInvoiceChange: () => {},
      } as never)}
    />,
  );

describe('W12-5 hand-discounted line at checkout', () => {
  beforeEach(() => {
    getInvoiceCardOnFile.mockReset().mockResolvedValue({ card: null, declinedAt: null });
  });

  it('shows $75.00 struck through and $60.00 for a hand-discounted line', async () => {
    render1([line({ unitPrice: 60, amount: 60, listUnitPrice: 75, manualDiscountAmount: 15, discountReason: 'Loyal client' })]);
    const was = await screen.findByTestId('checkout-regular-price');
    expect(was.tagName).toBe('S');
    expect(was.textContent).toBe('$75.00');
    expect(document.body.textContent).toContain('$60.00');
  });

  it('shows one price for a normal line', async () => {
    render1([line({})]);
    await waitFor(() => expect(document.body.textContent).toContain('Office exam'));
    expect(screen.queryByTestId('checkout-regular-price')).toBeNull();
  });
});
