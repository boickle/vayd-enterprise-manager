/** Oct 29, 2026: a post-visit membership refund left the ledger saying "No charge". */
import { paidHowLabel } from './ClientFinancialWorkspace';
import type { VisitInvoice } from '../../api/visitWorkflow';

const inv = (tenders: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) =>
  ({ status: 'paid', total: 0, amountPaid: 0, tenders, ...extra }) as unknown as VisitInvoice;

it('a refunded card payment says so instead of "No charge"', () => {
  expect(paidHowLabel(inv([{ method: 'card', amount: 420.13, refundedAmount: 420.13 }]))).toMatch(
    /· Refunded \$420\.13$/,
  );
});

it('an unrefunded payment just names the method', () => {
  expect(paidHowLabel(inv([{ method: 'card', amount: 86.3, refundedAmount: 0 }], { total: 86.3, amountPaid: 86.3 }))).not.toMatch(/Refunded/);
});

it('a truly free paid invoice is still "No charge"', () => {
  expect(paidHowLabel(inv([]))).toBe('No charge');
});
