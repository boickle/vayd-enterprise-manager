/** Oct 30, 2026: a doctor-declined mail item still offered "Request cancellation". */
import { mailItemDeclined } from './MailInvoiceLineCheckbox';
import type { MailOrder } from '../../api/onlineStore';

const order = { lines: [
  { inventoryItemId: 1, lineStatus: 'rejected' },
  { inventoryItemId: 2, lineStatus: 'awaiting_doctor_approval' },
] } as unknown as MailOrder;

it('the declined item has nothing to cancel; the other item still can be', () => {
  expect(mailItemDeclined(order, 1)).toBe(true);
  expect(mailItemDeclined(order, 2)).toBe(false);
  expect(mailItemDeclined(order, null)).toBe(false);
});
