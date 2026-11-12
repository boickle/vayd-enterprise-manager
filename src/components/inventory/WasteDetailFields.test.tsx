/** CAT-12: controlled waste needs a disposal method and may name a witness; ordinary waste is unchanged. */
import { fireEvent, render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import WasteDetailFields from './WasteDetailFields';

vi.mock('../../api/appointmentSettings', () => ({ fetchAllEmployees: async () => [] }));

const base = {
  methods: [
    { code: 'pharmaceutical', label: 'Pharmaceutical waste' },
    { code: 'sharps', label: 'Sharps container' },
  ],
  disposalCode: '',
  onDisposalChange: () => undefined,
  witnessOptions: [
    { id: 4, name: 'Pat Lee' },
    { id: 9, name: 'Sam Rivera' },
  ],
  witnessEmployeeId: null,
  onWitnessChange: () => undefined,
};

it('marks the disposal method required for a controlled item, even when the reason does not ask for it', () => {
  render(<WasteDetailFields {...base} isControlled showDisposal={false} />);
  expect(screen.getByText('Disposal method')).toBeInTheDocument();
  expect(screen.getByText('Required for controlled drugs.')).toBeInTheDocument();
  expect(screen.getByLabelText('Pharmaceutical waste')).toBeRequired();
});

it('shows no witness picker, and no required mark, for a non-controlled item', () => {
  render(<WasteDetailFields {...base} isControlled={false} />);
  expect(screen.queryByLabelText('Witness (optional)')).toBeNull();
  expect(screen.queryByText('Required for controlled drugs.')).toBeNull();
  expect(screen.getByLabelText('Pharmaceutical waste')).not.toBeRequired();
});

it('hides the disposal box for ordinary waste when the reason does not ask for it', () => {
  render(<WasteDetailFields {...base} isControlled={false} showDisposal={false} />);
  expect(screen.queryByText('Disposal method')).toBeNull();
});

it('offers the other employees as witness, leaves out the signed-in person, and reports the pick', () => {
  const onWitnessChange = vi.fn();
  render(<WasteDetailFields {...base} isControlled currentEmployeeId={4} onWitnessChange={onWitnessChange} />);
  expect(screen.queryByRole('option', { name: 'Pat Lee' })).toBeNull();
  fireEvent.change(screen.getByLabelText('Witness (optional)'), { target: { value: '9' } });
  expect(onWitnessChange).toHaveBeenCalledWith(9);
  fireEvent.change(screen.getByLabelText('Witness (optional)'), { target: { value: '' } });
  expect(onWitnessChange).toHaveBeenLastCalledWith(null);
});
