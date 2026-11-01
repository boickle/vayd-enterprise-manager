/** CAT-11: the stock choices on the return screen for one inventory line. */
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import ReturnLineStockFields from './ReturnLineStockFields';
import type { ReturnOptionsLine, ReturnStockDetail } from './returnLineStock';

vi.mock('../../api/appointmentSettings', () => ({ fetchAllEmployees: async () => [] }));

const reasons = [
  { code: 'broken', label: 'Broken', requiresDisposalMethod: 'no' },
  { code: 'returned_unsellable', label: 'Returned, not resellable', requiresDisposalMethod: 'optional' },
];
const methods = [
  { code: 'pharmaceutical', label: 'Pharmaceutical waste' },
  { code: 'sharps', label: 'Sharps container' },
];
const multi: ReturnOptionsLine = {
  isControlled: false,
  lots: [
    { inventoryLotBalanceId: 1, lotNumber: 'A', expirationDate: null, standing: 12 },
    { inventoryLotBalanceId: 2, lotNumber: 'B', expirationDate: null, standing: 8 },
  ],
};

function Harness(props: { options?: ReturnOptionsLine; qty?: number; startBack?: boolean }) {
  const [back, setBack] = useState(props.startBack ?? true);
  const [detail, setDetail] = useState<ReturnStockDetail | undefined>(undefined);
  return (
    <ReturnLineStockFields
      lineId="l1"
      qty={props.qty ?? 5}
      backOnShelf={props.options?.isControlled ? false : back}
      onBackOnShelfChange={setBack}
      shelfLocationId=""
      onShelfChange={() => undefined}
      locations={[]}
      options={props.options}
      detail={detail}
      onDetailChange={setDetail}
      reasons={reasons}
      methods={methods}
      witnessOptions={[{ id: 9, name: 'Sam Rivera' }]}
    />
  );
}

it('shows the waste fields only when the item is not going back on the shelf, with the default reason', () => {
  render(<Harness />);
  expect(screen.queryByText('Record as waste')).toBeNull();
  fireEvent.click(screen.getByLabelText('Back on the shelf'));
  expect(screen.getByText('Record as waste')).toBeInTheDocument();
  expect(screen.getByLabelText('Returned, not resellable')).toBeChecked();
  expect(screen.getByText('Disposal method')).toBeInTheDocument();
  expect(screen.getByLabelText('Notes')).toBeInTheDocument();
  expect(screen.queryByLabelText('Witness (optional)')).toBeNull();
  fireEvent.click(screen.getByLabelText('Back on the shelf'));
  expect(screen.queryByText('Record as waste')).toBeNull();
});

it('blocks "back on the shelf" for a controlled drug, says why, and asks for disposal and a witness', () => {
  render(<Harness options={{ isControlled: true, lots: [] }} />);
  expect(screen.queryByLabelText('Back on the shelf')).toBeNull();
  expect(
    screen.getByText("Controlled drugs returned by a client can't go back into stock; record them as waste.")
  ).toBeInTheDocument();
  expect(screen.getByText('Required for controlled drugs.')).toBeInTheDocument();
  expect(screen.getByLabelText('Witness (optional)')).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a disposal method; it is required for controlled drugs.');
  fireEvent.click(screen.getByLabelText('Sharps container'));
  expect(screen.queryByRole('alert')).toBeNull();
});

it('pre-fills a multi-lot return with the last lot, capped at what is standing', () => {
  const { rerender } = render(<Harness options={multi} qty={5} />);
  expect(screen.getByLabelText('Quantity from lot B')).toHaveValue(5);
  expect(screen.getByLabelText('Quantity from lot A')).toHaveValue(null);
  rerender(<Harness options={multi} qty={10} />);
  expect(screen.getByLabelText('Quantity from lot B')).toHaveValue(8);
  expect(screen.getByLabelText('Quantity from lot A')).toHaveValue(2);
});

it('lets staff split across lots and says when it does not add up or a lot is over', () => {
  render(<Harness options={multi} qty={5} />);
  fireEvent.change(screen.getByLabelText('Quantity from lot A'), { target: { value: '3' } });
  expect(screen.getByRole('alert')).toHaveTextContent('The lots add up to 8 but you are returning 5. Make them match.');
  fireEvent.change(screen.getByLabelText('Quantity from lot B'), { target: { value: '2' } });
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.change(screen.getByLabelText('Quantity from lot B'), { target: { value: '9' } });
  fireEvent.change(screen.getByLabelText('Quantity from lot A'), { target: { value: '' } });
  expect(screen.getByRole('alert')).toHaveTextContent('Lot B has only 8 left to take back; you chose 9.');
});

it('shows no lot choice for a single-lot line', () => {
  render(<Harness options={{ isControlled: false, lots: [multi.lots[0]] }} />);
  expect(screen.queryByText('Which lot(s) go back')).toBeNull();
});
