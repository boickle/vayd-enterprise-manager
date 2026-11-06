/**
 * Owner request (Oct 30, 2026): a post-visit signup in the portal shows what the plan re-prices
 * on the recent visit and the refund, before the owner joins.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import PostVisitRefundOutline from './PostVisitRefundOutline';

const previewMyVisitRefund = vi.fn();
vi.mock('../../api/memberships', () => ({
  previewMyVisitRefund: (...a: unknown[]) => previewMyVisitRefund(...a),
}));

const outline = {
  planName: 'Membership - Feline Foundations - Annual',
  refundDue: 206.5,
  paidTotal: 274,
  newTotal: 67.5,
  hoursLeft: 23,
  visits: [{ visitAt: '2026-10-30T13:06:49.393Z', total: 274, paid: 274 }],
  lines: [
    { description: 'Trip Fee', qty: 1, was: 139, now: 0, covered: true, note: 'Included in your plan' },
    { description: 'Medical/Sick Visit', qty: 1, was: 135, now: 67.5, covered: false, note: 'Member price' },
  ],
  unchangedCount: 1,
};

const props = {
  patientId: 11909,
  petName: 'Templeton',
  planId: 'foundations',
  planChosen: true,
  pricingOption: 'annual' as const,
  addOns: [],
  species: 'cat',
};

beforeEach(() => previewMyVisitRefund.mockReset());

it('lists what is covered or re-priced and the refund for the chosen plan', async () => {
  previewMyVisitRefund.mockResolvedValue(outline);
  render(<PostVisitRefundOutline {...props} />);

  expect(
    await screen.findByText('Join on Membership - Feline Foundations - Annual and get $206.50 back')
  ).toBeInTheDocument();
  expect(screen.getByText('Included in your plan')).toBeInTheDocument();
  expect(screen.getByText('Included')).toBeInTheDocument();
  expect(screen.getByText('$67.50', { selector: 'strong' })).toBeInTheDocument();
  expect(screen.getByText('1 other item stays at the same price.')).toBeInTheDocument();
  expect(screen.getByText('Refund to your card')).toBeInTheDocument();
  expect(screen.getByText(/our team refunds this to the card you paid with/)).toBeInTheDocument();
  expect(previewMyVisitRefund).toHaveBeenCalledWith(
    expect.objectContaining({ patientId: 11909, planId: 'foundations', pricingOption: 'annual', species: 'cat' })
  );
});

it('says it is showing the recommended plan until the owner picks one', async () => {
  previewMyVisitRefund.mockResolvedValue(outline);
  render(<PostVisitRefundOutline {...props} planChosen={false} />);
  expect(await screen.findByText('Join now and get $206.50 back')).toBeInTheDocument();
  expect(screen.getByText(/our recommendation — pick a plan below to see yours/)).toBeInTheDocument();
});

it('shows nothing when there is no recent visit in the window', async () => {
  previewMyVisitRefund.mockResolvedValue(null);
  const { container } = render(<PostVisitRefundOutline {...props} />);
  await waitFor(() => expect(previewMyVisitRefund).toHaveBeenCalled());
  expect(container).toBeEmptyDOMElement();
});
