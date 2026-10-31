/**
 * Owner decision Oct 31, 2026 (BEN-032r): a visit estimate shows the plan's out-of-plan % like
 * every other discount: regular price crossed out, the discounted price and total, and a short
 * "Member 10%" tag (full plan label on hover). Same in the emailed estimate / PDF.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import EstimateWorkspace from './EstimateWorkspace';
import { estimateEmailModel, invoiceTableHtml } from '../../utils/invoiceEmail';

vi.mock('../../permissions/PermissionContext', () => ({ useCan: () => false }));
vi.mock('../../api/roomLoader', () => ({
  checkItemPricing: vi.fn(),
  searchItems: vi.fn(async () => []),
}));
vi.mock('../../api/visitEstimates', async (orig) => ({
  ...(await orig<typeof import('../../api/visitEstimates')>()),
  addEstimateLine: vi.fn(),
  updateEstimateLine: vi.fn(),
  removeEstimateLine: vi.fn(),
}));

const LABEL = 'Membership discount (Canine Foundations PLUS - Monthly, 10%)';

const line = (o: Record<string, unknown> = {}) => ({
  id: 'l1',
  practiceId: 1,
  estimateId: 'e1',
  patientId: 7,
  patientName: 'Pip',
  providerEmployeeId: null,
  enteredByEmployeeId: null,
  enteredByName: null,
  catalogItemId: 5,
  catalogItemType: 'inventory',
  bundleSaleId: null,
  sourceBundleId: null,
  sourceBundleName: null,
  hideOnInvoice: false,
  description: 'Dental',
  qty: 2,
  unitPrice: 85.5,
  listUnitPrice: 95,
  discountReason: LABEL,
  amount: 171,
  isCovered: false,
  taxableAmount: 0,
  taxRate: 0,
  taxAmount: 0,
  created: '2026-10-31T00:00:00Z',
  updated: '2026-10-31T00:00:00Z',
  ...o,
});

const estimate = (lines: any[]) =>
  ({
    id: 'e1',
    practiceId: 1,
    estimateNumber: 4,
    status: 'draft',
    created: '2026-10-31T00:00:00Z',
    subtotal: 171,
    taxTotal: 0,
    total: 171,
    membershipAdjustments: 0,
    lines,
  }) as any;

describe('estimate screen', () => {
  it('crosses out the regular price and total, shows the discounted ones and a "Member 10%" tag', () => {
    render(<EstimateWorkspace estimate={estimate([line()])} onChange={() => {}} />);
    expect(screen.getByTestId('estimate-list-price').textContent).toBe('$95.00');
    expect(screen.getByTestId('estimate-list-amount').textContent).toBe('$190.00');
    expect(screen.getAllByText('$85.50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$171.00').length).toBeGreaterThan(0);
    const tag = screen.getByTestId('estimate-member-discount');
    expect(tag.textContent).toBe('Member 10%');
    expect(tag.getAttribute('title')).toContain(LABEL);
  });

  it('a line without the membership reason shows no tag and nothing crossed out', () => {
    render(
      <EstimateWorkspace
        estimate={estimate([line({ discountReason: null, listUnitPrice: null, unitPrice: 95, amount: 190 })])}
        onChange={() => {}}
      />,
    );
    expect(screen.queryByTestId('estimate-member-discount')).toBeNull();
    expect(screen.queryByTestId('estimate-list-price')).toBeNull();
  });
});

describe('emailed estimate / PDF', () => {
  it('crosses out the regular price, shows the discounted price and the "Member 10%" note', () => {
    const model = estimateEmailModel(estimate([line()]), 'Pat Client');
    expect(model.lines[0].discountLabel).toBe(LABEL);
    const html = invoiceTableHtml(model);
    expect(html).toMatch(/line-through[^>]*>\$190\.00/);
    expect(html).toContain('$171.00');
    expect(html).toContain('Member 10%');
  });

  it('a non-membership discount keeps the old look (no member note)', () => {
    const model = estimateEmailModel(
      estimate([line({ discountReason: null, unitPrice: 76, amount: 152, listUnitPrice: 95 })]),
      'Pat Client',
    );
    expect(invoiceTableHtml(model)).not.toContain('Member 10%');
  });
});
