/**
 * Owner (Nov 11, 2026): the bag label printed Scout's internal order references ("invoice:<id>"), and the label
 * window called a refill of a chronic prescription Acute.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./SendRxLabelButton', () => ({ default: () => null }));
vi.mock('../../utils/printRxLabel', () => ({ printMailOrderBagLabelDirect: vi.fn() }));
vi.mock('../../utils/ensurePrintRxNumber', () => ({ ensurePrintRxNumber: vi.fn() }));

import { bagLabelOrderNotes, labelAcuity } from './MailOrderFillLabels';

describe('bagLabelOrderNotes', () => {
  it('drops internal references and keeps real notes', () => {
    expect(bagLabelOrderNotes('invoice:86a0ad5d-c6a5-401a-aec3-e98551c822a1')).toBe('');
    expect(bagLabelOrderNotes('From visit invoice:abc invoiceLine:def shippingLine:ghi')).toBe('From visit');
    expect(bagLabelOrderNotes('Leave at the side door autoshipInvoice:in_123')).toBe('Leave at the side door');
    expect(bagLabelOrderNotes(null)).toBe('');
  });
});

describe('labelAcuity', () => {
  it('auto-ships are chronic', () => expect(labelAcuity({ autoship: true, rxAcuity: 'acute' })).toBe('chronic'));
  it('a refill follows its Rx', () => expect(labelAcuity({ autoship: false, rxAcuity: 'chronic' })).toBe('chronic'));
  it('otherwise acute', () => {
    expect(labelAcuity({ autoship: false, rxAcuity: null })).toBe('acute');
    expect(labelAcuity({ autoship: false, rxAcuity: 'acute' })).toBe('acute');
  });
});
