/**
 * EMR-12: at checkout the family can decline (hold released, nothing charged), and when the card
 * hold had expired the panel tells staff the saved card was charged instead.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EstimateSettlePanel from './EstimateSettlePanel';
import {
  getEstimateForAppointment,
  markEstimateDeclined,
  settleEstimate,
} from '../../api/visitEstimates';

vi.mock('./EstimateCardModal', () => ({ default: () => null }));
vi.mock('../../api/visitEstimates', async (orig) => ({
  ...(await orig<typeof import('../../api/visitEstimates')>()),
  getEstimateForAppointment: vi.fn(),
  setEstimateLineDecision: vi.fn(),
  settleEstimate: vi.fn(),
  authorizeEstimate: vi.fn(),
  markEstimateDeclined: vi.fn(),
}));

const estimate = {
  id: 'e1',
  total: 475,
  authorizedAmount: 475,
  stripePaymentIntentId: 'pi_hold',
  lastChargeStatus: 'requires_capture',
  savedPaymentMethodId: 'pm_card',
  lines: [
    { id: 'l1', description: 'Euthanasia', qty: 1, unitPrice: 475, amount: 475, taxAmount: 0, isCovered: false, decision: 'accepted' },
  ],
} as any;

beforeEach(() => {
  vi.mocked(getEstimateForAppointment).mockResolvedValue(estimate);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('EMR-12 checkout: changes of mind', () => {
  it('Family declined asks first, then declines; the hold-released note replaces the panel', async () => {
    vi.mocked(markEstimateDeclined).mockResolvedValue({ ...estimate, status: 'declined' });
    const onSettled = vi.fn();
    render(<EstimateSettlePanel appointmentId={5} onSettled={onSettled} />);
    fireEvent.click(await screen.findByRole('button', { name: /Family declined/ }));
    expect(markEstimateDeclined).not.toHaveBeenCalled();
    expect(screen.getByText(/The \$475\.00 hold comes off their card/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Yes, the family declined/ }));
    await waitFor(() => expect(markEstimateDeclined).toHaveBeenCalledWith('e1'));
    const note = await screen.findByTestId('estimate-settle-notice');
    expect(note.textContent).toMatch(/hold was released and nothing was charged/);
    expect(screen.queryByRole('button', { name: /Convert to invoice/ })).toBeNull();
    expect(settleEstimate).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('Keep the estimate backs out without declining', async () => {
    render(<EstimateSettlePanel appointmentId={5} />);
    fireEvent.click(await screen.findByRole('button', { name: /Family declined/ }));
    fireEvent.click(screen.getByRole('button', { name: /Keep the estimate/ }));
    expect(markEstimateDeclined).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Convert to invoice/ })).toBeTruthy();
  });

  it('after settling, an expired hold is reported to staff', async () => {
    vi.mocked(settleEstimate).mockResolvedValue({
      id: 'inv-1',
      total: 475,
      status: 'paid',
      holdNotice: 'The card hold on this estimate had expired, so the saved card was charged for the bill instead.',
    });
    const onSettled = vi.fn();
    render(<EstimateSettlePanel appointmentId={5} onSettled={onSettled} />);
    fireEvent.click(await screen.findByRole('button', { name: /Convert to invoice & take payment/ }));
    await waitFor(() => expect(onSettled).toHaveBeenCalledWith('inv-1'));
    expect((await screen.findByTestId('estimate-settle-notice')).textContent).toMatch(/hold .* had expired/);
  });

  it('after a normal settle the panel goes away', async () => {
    vi.mocked(settleEstimate).mockResolvedValue({ id: 'inv-1', total: 475, status: 'paid' });
    const { container } = render(<EstimateSettlePanel appointmentId={5} />);
    fireEvent.click(await screen.findByRole('button', { name: /Convert to invoice & take payment/ }));
    await waitFor(() => expect(container.innerHTML).toBe(''));
  });
});
