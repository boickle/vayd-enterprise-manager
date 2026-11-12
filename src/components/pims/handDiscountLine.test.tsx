/** W12-5: a hand-discounted line shows the regular price struck through; a normal line shows one price. */
import { render, screen } from '@testing-library/react';
import { LineAmount, EditableUnitPriceForTest as EditableUnitPrice } from './ClientFinancialWorkspace';
import { handDiscountRegularAmount } from '../../utils/membershipLineDiscount';

const handLine = {
  id: 'l1',
  description: 'Office exam',
  qty: 1,
  unitPrice: 60,
  amount: 60,
  listUnitPrice: 75,
  manualDiscountAmount: 15,
  discountReason: 'Loyal client',
  isCovered: false,
};
const normalLine = { ...handLine, unitPrice: 75, amount: 75, listUnitPrice: null, manualDiscountAmount: null, discountReason: null };

it('W12-5 bill: a hand-discounted line shows $75.00 struck through and $60.00', () => {
  render(<LineAmount line={handLine as any} />);
  const was = screen.getByTestId('line-regular-price');
  expect(was.tagName).toBe('S');
  expect(was.textContent).toBe('$75.00');
  expect(screen.getByText(/\$60\.00/)).toBeTruthy();
});

it('W12-5 bill: the unit price column shows both prices too', () => {
  const { container } = render(
    <EditableUnitPrice line={handLine as any} canEdit={false} editing={false} onEdit={() => {}} onCancel={() => {}} onCommit={async () => true} />,
  );
  expect(container.querySelector('.client-fin__was')?.textContent).toBe('$75.00');
  expect(container.textContent).toContain('$60.00');
});

it('W12-5: a normal line shows one price', () => {
  render(<LineAmount line={normalLine as any} />);
  expect(screen.queryByTestId('line-regular-price')).toBeNull();
  expect(screen.getByText('$75.00')).toBeTruthy();
});

it('W12-5: a member line keeps its own tag and is not treated as a hand discount', () => {
  const member = { ...handLine, manualDiscountAmount: null, discountReason: 'Membership discount (Puppy/Kitten - Annual, 20%)' };
  expect(handDiscountRegularAmount(member)).toBeNull();
  expect(handDiscountRegularAmount(handLine)).toBe(75);
  expect(handDiscountRegularAmount({ ...handLine, qty: 2, amount: 120 })).toBe(150);
  expect(handDiscountRegularAmount({ ...handLine, isCovered: true })).toBeNull();
});
