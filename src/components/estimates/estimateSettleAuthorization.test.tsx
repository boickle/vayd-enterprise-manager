/**
 * Owner decisions of Nov 3, 2026 (replace EMR-10 (a)'s per-item Accept / Decline):
 * - checkout lists the estimate's items read-only; no Accept / Decline, no "decide every item" gate;
 * - a euthanasia estimate with a card authorization shows the bubble (what the owner approved and
 *   when, plus any difference) and the button "Run Payment from Authorization";
 * - any other estimate is informational: no card, hold, bubble or payment button.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EstimateSettlePanel from './EstimateSettlePanel';
import {
  convertEstimateToInvoice,
  getEstimateForAppointment,
  getEstimateSettlePreview,
  settleEstimate,
} from '../../api/visitEstimates';

vi.mock('./EstimateCardModal', () => ({ default: () => null }));
vi.mock('../../api/visitEstimates', async (orig) => ({
  ...(await orig<typeof import('../../api/visitEstimates')>()),
  getEstimateForAppointment: vi.fn(),
  getEstimateSettlePreview: vi.fn(),
  settleEstimate: vi.fn(),
  convertEstimateToInvoice: vi.fn(),
  authorizeEstimate: vi.fn(),
}));

const line = (id: string, description: string, amount: number) => ({
  id,
  description,
  qty: 1,
  unitPrice: amount,
  amount,
  taxAmount: 0,
  isCovered: false,
  patientId: 7,
  patientName: 'Pippin',
});

const estimate = (over: Record<string, unknown> = {}) =>
  ({
    id: 'e1',
    total: 440,
    authorizedAmount: 440,
    stripePaymentIntentId: 'pi_hold',
    lastChargeStatus: 'requires_capture',
    savedPaymentMethodId: 'pm_card',
    isEuthanasia: true,
    consentSignedAt: '2026-11-02T18:00:00.000Z',
    lines: [
      line('l1', 'Euthanasia', 250),
      line('l2', 'Private cremation', 150),
      line('l3', 'Clay paw print', 40),
    ],
    ...over,
  }) as any;

const preview = (over: Record<string, unknown> = {}) => ({
  estimateId: 'e1',
  isEuthanasia: true,
  held: true,
  authorizedAmount: 440,
  consentSignedAt: '2026-11-02T18:00:00.000Z',
  finalAmount: 440,
  difference: 0,
  ...over,
});

beforeEach(() => {
  vi.mocked(getEstimateForAppointment).mockResolvedValue(estimate());
  vi.mocked(getEstimateSettlePreview).mockResolvedValue(preview());
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const runButton = () => screen.getByRole('button', { name: /Run Payment from Authorization/ });

describe('Checkout: euthanasia estimate with a card authorization', () => {
  it('lists every item read-only, with no Accept / Decline, and the button is not gated on choices', async () => {
    render(<EstimateSettlePanel appointmentId={5} />);
    expect(await screen.findAllByTestId('estimate-settle-line')).toHaveLength(3);
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Decline$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Convert to invoice/ })).toBeNull();
    expect(runButton()).not.toBeDisabled();
  });

  it('the bubble says what the owner approved and on which date; the click runs the payment', async () => {
    vi.mocked(settleEstimate).mockResolvedValue({ id: 'inv-1', total: 440, status: 'paid' });
    const onSettled = vi.fn();
    render(<EstimateSettlePanel appointmentId={5} onSettled={onSettled} />);
    const bubble = await screen.findByTestId('estimate-authorization-bubble');
    expect(bubble.textContent).toBe(
      'This owner approved $440.00 on November 2, 2026 — it will be charged when you click "Run Payment from Authorization".'
    );
    expect(settleEstimate).not.toHaveBeenCalled();
    fireEvent.click(runButton());
    await waitFor(() => expect(settleEstimate).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('inv-1'));
  });

  it('a final bill over the authorization says the extra goes on the same card', async () => {
    vi.mocked(getEstimateSettlePreview).mockResolvedValue(preview({ finalAmount: 465, difference: 25 }));
    render(<EstimateSettlePanel appointmentId={5} />);
    const bubble = await screen.findByTestId('estimate-authorization-bubble');
    expect(bubble.textContent).toContain(
      'An additional $25.00 will be charged to the same card when you click the button.'
    );
  });

  it('a final bill under the authorization says the rest of the hold is released', async () => {
    vi.mocked(getEstimateSettlePreview).mockResolvedValue(preview({ finalAmount: 400, difference: -40 }));
    render(<EstimateSettlePanel appointmentId={5} />);
    const bubble = await screen.findByTestId('estimate-authorization-bubble');
    expect(bubble.textContent).toContain('$40.00 less than authorized — the rest of the hold is released.');
  });

  it('the preview is read again when the visit invoice changes', async () => {
    const { rerender } = render(<EstimateSettlePanel appointmentId={5} invoiceKey="a" />);
    await screen.findByTestId('estimate-authorization-bubble');
    expect(getEstimateSettlePreview).toHaveBeenCalledTimes(1);
    rerender(<EstimateSettlePanel appointmentId={5} invoiceKey="b" />);
    await waitFor(() => expect(getEstimateSettlePreview).toHaveBeenCalledTimes(2));
  });

  it('nothing left to bill: no invoice to reload, and staff are told the hold was released', async () => {
    vi.mocked(settleEstimate).mockResolvedValue({
      id: null,
      total: 0,
      status: 'nothing_to_bill',
      holdNotice: 'Nothing is left on this estimate to bill, so no invoice was made. Any card hold was released and nothing was charged.',
    });
    const onSettled = vi.fn();
    render(<EstimateSettlePanel appointmentId={5} onSettled={onSettled} />);
    await screen.findByTestId('estimate-authorization-bubble');
    fireEvent.click(runButton());
    expect((await screen.findByTestId('estimate-settle-notice')).textContent).toMatch(/no invoice was made/);
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('no bubble without a live hold', async () => {
    vi.mocked(getEstimateForAppointment).mockResolvedValue(
      estimate({ stripePaymentIntentId: null, lastChargeStatus: null, authorizedAmount: null })
    );
    render(<EstimateSettlePanel appointmentId={5} />);
    await screen.findByText('A card is saved. No hold has been placed yet.');
    expect(screen.queryByTestId('estimate-authorization-bubble')).toBeNull();
    expect(getEstimateSettlePreview).not.toHaveBeenCalled();
  });
});

describe('Checkout: an estimate that is not for euthanasia is informational', () => {
  it('no card, hold, bubble or payment button; its items can be added to the invoice', async () => {
    vi.mocked(getEstimateForAppointment).mockResolvedValue(
      estimate({ isEuthanasia: false, stripePaymentIntentId: null, lastChargeStatus: null, savedPaymentMethodId: null })
    );
    vi.mocked(convertEstimateToInvoice).mockResolvedValue({ id: 'inv-9', total: 440, status: 'open' });
    const onSettled = vi.fn();
    render(<EstimateSettlePanel appointmentId={5} onSettled={onSettled} />);
    expect(await screen.findByTestId('estimate-settle-informational')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Run Payment from Authorization/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Take card/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Authorize now/ })).toBeNull();
    expect(screen.queryByTestId('estimate-authorization-bubble')).toBeNull();
    expect(getEstimateSettlePreview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Add estimate items to the invoice/ }));
    await waitFor(() => expect(convertEstimateToInvoice).toHaveBeenCalledWith('e1'));
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('inv-9'));
    expect(settleEstimate).not.toHaveBeenCalled();
  });
});
