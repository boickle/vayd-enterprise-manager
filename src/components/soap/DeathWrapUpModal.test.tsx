/**
 * CP-07-7 (frontend half): staff must pick an inactivation reason before Accept (D4).
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

vi.mock('../../utils/deathWrapUp', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/deathWrapUp')>();
  return {
    ...actual,
    acceptDeathWrapUpHousehold: vi.fn().mockResolvedValue({ errors: [] }),
  };
});

import DeathWrapUpModal from './DeathWrapUpModal';
import type { DeathWrapUpPreview } from '../../utils/deathWrapUp';

const preview = {
  patientId: 7,
  patientName: 'Rex',
  memberships: [],
  autoships: [],
  reminders: [],
  futureAppointments: [],
  prescriptions: [],
  mailOrders: [],
} as unknown as DeathWrapUpPreview;

describe('DeathWrapUpModal — CP-07-7 reason required', () => {
  it('disables Accept with a hint until a reason is picked, then passes the reason', async () => {
    const onAccepted = vi.fn();
    render(
      <DeathWrapUpModal previews={[preview]} kind="inactivate" onClose={() => {}} onAccepted={onAccepted} />,
    );

    const accept = screen.getByRole('button', { name: 'Accept' });
    expect(accept).toBeDisabled();
    expect(screen.getByText('Choose a reason to continue.')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Reason for inactivating'), {
      target: { value: 'passed_away' },
    });
    expect(accept).toBeEnabled();
    expect(screen.queryByText('Choose a reason to continue.')).not.toBeInTheDocument();

    fireEvent.click(accept);
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith('passed_away'));
  });

  it('offers exactly the six D4 reasons', () => {
    render(
      <DeathWrapUpModal previews={[preview]} kind="inactivate" onClose={() => {}} onAccepted={() => {}} />,
    );
    const values = Array.from(
      (screen.getByLabelText('Reason for inactivating') as HTMLSelectElement).options,
    )
      .map((o) => o.value)
      .filter(Boolean);
    expect(values).toEqual([
      'euthanized',
      'passed_away',
      'rehomed',
      'moved_or_changed_vets',
      'duplicate_record',
      'other',
    ]);
  });

  it('End Visit (reasonRequired=false) shows no picker and Accept is enabled', async () => {
    const onAccepted = vi.fn();
    render(
      <DeathWrapUpModal
        previews={[preview]}
        kind="inactivate"
        reasonRequired={false}
        onClose={() => {}}
        onAccepted={onAccepted}
      />,
    );
    expect(screen.queryByLabelText('Reason for inactivating')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(onAccepted).toHaveBeenCalledWith(undefined));
  });
});
