/**
 * EMR-10 (a), owner decision D4: checkout lists the estimate's items and staff mark each Accept or
 * Decline with the family present. Collecting is blocked until every item has a choice, and the
 * accepted total is what is taken from the hold.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import EstimateSettlePanel from './EstimateSettlePanel';
import {
  getEstimateForAppointment,
  setEstimateLineDecision,
  settleEstimate,
} from '../../api/visitEstimates';

vi.mock('./EstimateCardModal', () => ({ default: () => null }));
vi.mock('../../api/visitEstimates', async (orig) => ({
  ...(await orig<typeof import('../../api/visitEstimates')>()),
  getEstimateForAppointment: vi.fn(),
  setEstimateLineDecision: vi.fn(),
  settleEstimate: vi.fn(),
  authorizeEstimate: vi.fn(),
}));

const line = (id: string, description: string, amount: number, decision: string | null = null) => ({
  id,
  description,
  qty: 1,
  unitPrice: amount,
  amount,
  taxAmount: 0,
  isCovered: false,
  patientId: 7,
  patientName: 'Pippin',
  decision,
});

const estimate = (decisions: Array<string | null>) =>
  ({
    id: 'e1',
    total: 440,
    authorizedAmount: 440,
    stripePaymentIntentId: 'pi_hold',
    lastChargeStatus: 'requires_capture',
    savedPaymentMethodId: 'pm_card',
    lines: [
      line('l1', 'Euthanasia', 250, decisions[0]),
      line('l2', 'Private cremation', 150, decisions[1]),
      line('l3', 'Clay paw print', 40, decisions[2]),
    ],
  }) as any;

beforeEach(() => {
  vi.mocked(getEstimateForAppointment).mockResolvedValue(estimate([null, null, null]));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const settleButton = () => screen.getByRole('button', { name: /Convert to invoice & take payment/ });

describe('EMR-10 checkout accept / decline per estimate item', () => {
  it('lists every item and blocks collecting until each has a choice', async () => {
    render(<EstimateSettlePanel appointmentId={5} />);
    expect(await screen.findAllByTestId('estimate-settle-line')).toHaveLength(3);
    expect(settleButton()).toBeDisabled();
    expect(settleButton().getAttribute('title')).toBe('Accept or decline every item first');
  });

  it('Decline sends the decision; with all chosen the accepted total shows and collecting is allowed', async () => {
    vi.mocked(setEstimateLineDecision).mockResolvedValue(estimate(['accepted', 'accepted', 'declined']));
    vi.mocked(settleEstimate).mockResolvedValue({ id: 'inv-1', total: 400, status: 'paid' });
    render(<EstimateSettlePanel appointmentId={5} />);
    const rows = await screen.findAllByTestId('estimate-settle-line');
    fireEvent.click(rows[2].querySelector('button.decline')!);

    await waitFor(() =>
      expect(setEstimateLineDecision).toHaveBeenCalledWith('e1', 'l3', 'declined')
    );
    await waitFor(() => expect(settleButton()).not.toBeDisabled());
    expect(screen.getByTestId('estimate-settle-accepted-total').textContent).toBe('$400.00');
    expect(screen.getByText(/Only the accepted \$400\.00 is taken/)).toBeTruthy();

    fireEvent.click(settleButton());
    await waitFor(() => expect(settleEstimate).toHaveBeenCalledWith('e1'));
  });

  it('"Accept the remaining items" accepts each undecided line', async () => {
    vi.mocked(getEstimateForAppointment).mockResolvedValue(estimate(['declined', null, null]));
    vi.mocked(setEstimateLineDecision).mockResolvedValue(estimate(['declined', 'accepted', 'accepted']));
    render(<EstimateSettlePanel appointmentId={5} />);
    fireEvent.click(await screen.findByRole('button', { name: /Accept the 2 remaining items/ }));
    await waitFor(() => expect(setEstimateLineDecision).toHaveBeenCalledTimes(2));
    expect(vi.mocked(setEstimateLineDecision).mock.calls.map((c) => c[1])).toEqual(['l2', 'l3']);
  });
});
