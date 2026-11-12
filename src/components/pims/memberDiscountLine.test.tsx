/**
 * Owner decisions Oct 31, 2026: the plan's out-of-plan % shows on the bill as a discount, not a
 * lower price — and like every other discount: the regular price is crossed out, the
 * discounted price and line total are shown, with a short "Member 10%" tag (full plan label in
 * the tooltip) on the invoice, receipt/email/PDF. Client quotes keep "Member discount 10%".
 */
import { render, screen } from '@testing-library/react';
import { LineAmount } from './ClientFinancialWorkspace';
import { membershipLineDiscount } from '../../utils/membershipLineDiscount';
import { invoiceTableHtml, visitInvoiceToEmailModel } from '../../utils/invoiceEmail';
import { memberDiscountShown, quantityLinePrice } from '../../utils/roomLoaderCatalogPrice';

const LABEL = 'Membership discount (Puppy/Kitten - Annual, 10%)';
const memberLine = {
  id: 'l1',
  description: 'Dental',
  qty: 1,
  unitPrice: 85.5,
  amount: 85.5,
  listUnitPrice: 95,
  discountReason: LABEL,
  isCovered: false,
};

it('BEN-032j invoice line: total is the discounted $85.50 with a "Member 10%" tag', () => {
  render(<LineAmount line={memberLine as any} />);
  expect(screen.getByText('$85.50')).toBeTruthy();
  expect(screen.queryByText('$95.00')).toBeNull();
  const tag = screen.getByTestId('line-member-discount');
  expect(tag.textContent).toBe('Member 10%');
  expect(tag.getAttribute('title')).toContain(LABEL);
  expect(tag.getAttribute('title')).toContain('−$9.50');
});

it('a client or staff discount line keeps the old display: no membership row', () => {
  render(<LineAmount line={{ ...memberLine, unitPrice: 76, amount: 76, discountReason: null } as any} />);
  expect(screen.getByText('$76.00')).toBeTruthy();
  expect(screen.queryByTestId('line-member-discount')).toBeNull();
});

it('a hand-priced line (staff reason) is not a membership discount', () => {
  expect(membershipLineDiscount({ ...memberLine, discountReason: 'Price match' })).toBeNull();
  expect(membershipLineDiscount({ ...memberLine, isCovered: true })).toBeNull();
});

it('receipt / emailed invoice / PDF: regular price crossed out, discounted price, "Member 10%"', () => {
  const model = visitInvoiceToEmailModel(
    { id: 'inv-12345678', total: 85.5, amountPaid: 0, subtotal: 85.5, taxTotal: 0, lines: [memberLine] } as any,
    'Pat Client',
  );
  expect(model.lines[0].discountLabel).toBe(LABEL);
  const html = invoiceTableHtml(model);
  expect(html).toMatch(/line-through[^>]*>\$95\.00/);
  expect(html).toContain('$85.50');
  expect(html).toContain('Member 10%');
  expect(html).not.toContain('−$9.50');
});

describe('Room Loader quote (RL-02-12)', () => {
  const pricing = {
    adjustedPrice: 85.5,
    originalPrice: 95,
    wellnessPlanPricing: {
      hasCoverage: false,
      isWithinLimit: false,
      outOfPlanDiscountApplied: true,
      outOfPlanDiscountPercent: 10,
    },
  } as any;

  it('shows the regular price with "Member discount 10%" taken off', () => {
    expect(memberDiscountShown(pricing, 85.5, 95)).toEqual({
      label: 'Member discount 10%',
      regularTotal: 95,
      discount: 9.5,
    });
  });

  it('no member discount row when a client discount won', () => {
    const won = { ...pricing, wellnessPlanPricing: { ...pricing.wellnessPlanPricing, outOfPlanDiscountApplied: false } };
    expect(memberDiscountShown(won, 76, 95)).toBeNull();
  });

  it('allowance 1 left, qty 3: the 2 extra units get the out-of-plan 10%', () => {
    const covered = {
      item: { itemType: 'inventory', inventoryItem: { id: 1, price: 30 } },
      wellnessPlanPricing: { hasCoverage: true, isWithinLimit: true, remainingQuantity: 1, outOfPlanDiscountPercent: 10 },
    } as any;
    expect(quantityLinePrice(covered, 0, 3).total).toBeCloseTo(54, 5);
  });
});

describe('EditableUnitPrice: member discount shows like a staff discount', () => {
  it('crosses out the regular unit price and shows the discounted one', async () => {
    const { EditableUnitPriceForTest } = await import('./ClientFinancialWorkspace');
    const { container } = render(
      <EditableUnitPriceForTest
        line={memberLine as any}
        canEdit
        editing={false}
        onEdit={() => {}}
        onCancel={() => {}}
        onCommit={async () => true}
      />,
    );
    const was = container.querySelector('.client-fin__was');
    expect(was?.textContent).toBe('$95.00');
    expect(container.textContent).toContain('$85.50');
  });
});
