import { staffVoidedTenderText, tenderFullyRefunded } from './ClientFinancialWorkspace';

it('W9B-3: a fully refunded tender reads refunded by whoever refunded it', () => {
  const t = { amount: 50, refundedAmount: 50, voidedAt: '2026-11-07', voidReason: 'Refunded to card' };
  expect(tenderFullyRefunded(t)).toBe(true);
  const text = staffVoidedTenderText(t, 'Visa', 'Robin Hale', null);
  expect(text).toContain('refunded by Robin Hale');
  expect(text).not.toContain('voided');
});

it('W9B-3: a real void stays voided; a part refund is not a full refund', () => {
  const v = { amount: 50, voidedAt: '2026-11-07', voidReason: 'Keyed twice' };
  expect(staffVoidedTenderText(v, 'Cash', 'Robin Hale', null)).toContain('voided by Robin Hale');
  expect(tenderFullyRefunded({ amount: 50, refundedAmount: 20 })).toBe(false);
});
