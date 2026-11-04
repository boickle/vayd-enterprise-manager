/**
 * SCH-10 (D4): the pending "Employer promotion" line on the client's first visit invoice, which
 * staff confirm at checkout.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import EmployerPromotionLine from './EmployerPromotionLine';
import type { VisitInvoice } from '../../api/visitWorkflow';

const confirmEmployerPromotion = vi.fn();
vi.mock('../../api/visitWorkflow', () => ({
  confirmEmployerPromotion: (...a: unknown[]) => confirmEmployerPromotion(...a),
}));

const pending = {
  usageId: 1,
  promotionId: 2,
  promotionName: 'Acme employee $50 off',
  companyName: 'Acme',
  label: 'Employer promotion',
  discountType: 'fixed_amount',
  amount: 50,
};
const invoice = (over: Partial<VisitInvoice> = {}) =>
  ({ id: 'inv-1', status: 'open', pendingEmployerPromotion: pending, ...over }) as VisitInvoice;

describe('EmployerPromotionLine', () => {
  beforeEach(() => {
    confirmEmployerPromotion.mockReset();
  });

  it('shows the pending line with the amount and a confirm button', () => {
    render(<EmployerPromotionLine invoice={invoice()} onInvoiceChange={vi.fn()} />);
    expect(screen.getByTestId('employer-promotion-line')).toHaveTextContent(
      'Employer promotion –$50.00'
    );
    expect(screen.getByRole('button', { name: /confirm promotion/i })).toBeEnabled();
  });

  it('confirming applies it and hands back the updated invoice', async () => {
    const updated = invoice({ pendingEmployerPromotion: null });
    confirmEmployerPromotion.mockResolvedValue(updated);
    const onChange = vi.fn();
    render(<EmployerPromotionLine invoice={invoice()} onInvoiceChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm promotion/i }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(updated));
    expect(confirmEmployerPromotion).toHaveBeenCalledWith('inv-1');
  });

  it('shows the server message when it cannot be applied', async () => {
    const failure = Object.assign(new Error('Request failed'), {
      response: { data: { message: 'This employer promotion has already been applied' } },
    });
    confirmEmployerPromotion.mockImplementation(async () => {
      throw failure;
    });
    render(<EmployerPromotionLine invoice={invoice()} onInvoiceChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /confirm promotion/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('already been applied');
  });

  it('shows nothing when no promotion is pending or the invoice is not open', () => {
    const { rerender, container } = render(
      <EmployerPromotionLine
        invoice={invoice({ pendingEmployerPromotion: null })}
        onInvoiceChange={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <EmployerPromotionLine invoice={invoice({ status: 'paid' })} onInvoiceChange={vi.fn()} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
