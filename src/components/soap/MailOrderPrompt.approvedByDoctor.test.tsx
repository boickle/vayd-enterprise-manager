/**
 * B10 (OSV-05 dry run, Nov 8, 2026; owner decision Nov 9): the Send to mail queue window's
 * "Approved by doctor" box, and the "are you sure" check when a prescription is sent unticked.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MailOrderPrompt from './MailOrderPrompt';

vi.mock('../../api/practiceSettings', () => ({
  getPracticeSettings: vi.fn(async () => ({
    'inventory.mailShippingTypes': JSON.stringify([{ id: 'pickup', label: 'Pick up at Raleigh', kind: 'pickup', charge: 'none' }]),
  })),
}));
const confirm = vi.fn(async () => true);
vi.mock('../../utils/appDialog', () => ({ appConfirm: (...args: unknown[]) => confirm(...(args as [])) }));

async function open(props: Partial<Parameters<typeof MailOrderPrompt>[0]> = {}) {
  const onConfirm = vi.fn();
  render(
    <MailOrderPrompt
      practiceId={1}
      itemName="Thyroid tablets 0.4 mg (90 ct)"
      doctorName="Dr. Lane"
      onCancel={() => undefined}
      onConfirm={onConfirm}
      {...props}
    />
  );
  const select = await screen.findByRole('combobox');
  fireEvent.change(select, { target: { value: 'pickup' } });
  return { onConfirm };
}

beforeEach(() => confirm.mockClear());

describe('B10: Approved by doctor on Send to mail queue', () => {
  it('a script approved on the bill starts ticked and goes straight through', async () => {
    const { onConfirm } = await open({ isPrescription: true, approvedAtVisit: true });
    expect(screen.getByRole('checkbox', { name: /Approved by Dr\. Lane/ })).toBeChecked();
    expect(screen.queryByText(/Doctor approves first/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add to mail queue' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ approvedByDoctor: true, payAfterApproval: false });
  });

  it('unticked: asks if it still needs the doctor, then sends it for approval', async () => {
    const { onConfirm } = await open({ isPrescription: true, approvedAtVisit: false });
    expect(screen.getByRole('checkbox', { name: /Approved by Dr\. Lane/ })).not.toBeChecked();

    fireEvent.click(screen.getByRole('button', { name: 'Add to mail queue' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/^Are you sure this still needs Dr\. Lane's approval\?/) })
    );
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ approvedByDoctor: false });
  });

  it('unticked and "Go back": nothing is sent', async () => {
    confirm.mockResolvedValueOnce(false);
    const { onConfirm } = await open({ isPrescription: true });

    fireEvent.click(screen.getByRole('button', { name: 'Add to mail queue' }));

    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('ticking it by hand sends it as approved, with no question', async () => {
    const { onConfirm } = await open({ isPrescription: true });
    fireEvent.click(screen.getByRole('checkbox', { name: /Approved by Dr\. Lane/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add to mail queue' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ approvedByDoctor: true });
  });

  it('not a prescription: no box, no question', async () => {
    const { onConfirm } = await open({ isPrescription: false });
    expect(screen.queryByRole('checkbox', { name: /Approved by/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add to mail queue' }));

    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(confirm).not.toHaveBeenCalled();
    expect(onConfirm.mock.calls[0][0]).toMatchObject({ approvedByDoctor: false });
  });
});
