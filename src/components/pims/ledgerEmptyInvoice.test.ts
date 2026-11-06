/** Oct 30, 2026: removing the only charge on a bill made the bill vanish from the ledger. */
import { isEmptyOpenInvoice } from './ClientFinancialWorkspace';
import type { VisitInvoice } from '../../api/visitWorkflow';

const inv = (extra: Record<string, unknown>) =>
  ({ status: 'open', isDeleted: false, amountPaid: 0, lines: [], ...extra }) as unknown as VisitInvoice;

it('a blank new draft is hidden', () => {
  expect(isEmptyOpenInvoice(inv({}))).toBe(true);
});

it('a bill emptied by removing charges with a reason still shows', () => {
  expect(isEmptyOpenInvoice(inv({ removedChargeCount: 1 }))).toBe(false);
  expect(
    isEmptyOpenInvoice(inv({ lines: [{ id: 'l', isDeleted: true, removedAt: '2026-10-30T12:16:07Z' }] })),
  ).toBe(false);
});

it('a bill taken over from eVet still shows', () => {
  expect(isEmptyOpenInvoice(inv({ evetInvoiceId: 135164 }))).toBe(false);
});
