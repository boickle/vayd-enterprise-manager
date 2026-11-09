/**
 * RP-03-18 (frontend component): the Offboard dialog shows the three warnings (draft SOAPs, stock at
 * their controlled-drug location, only holder of a role) and still allows Offboard. Also checks the
 * dialog says the login ends (RP-03-6) and that Cancel changes nothing (RP-03-19).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import OffboardDialog from './OffboardDialog';
import type { OffboardPreview } from '../../api/offboarding';

const offboard = vi.hoisted(() => vi.fn());
const preview: OffboardPreview = {
  employee: {
    id: 7,
    name: 'Odile Brackenridge',
    doctorName: 'Dr. Brackenridge',
    isActive: true,
    isProvider: true,
  },
  today: '2026-11-09',
  lastDay: '2026-11-09',
  offboarding: null,
  openTaskCount: 2,
  futureVisits: [
    {
      id: 101,
      start: '2026-11-16T14:00:00.000Z',
      clientName: 'Ada Lovelace',
      patientName: 'Biscuit',
    },
  ],
  primaryDoctorOf: { pets: 2, households: 1, forwardBookings: 0 },
  worksWith: [{ userId: 55, name: 'Tamsin Tech', email: 'tamsin@vayd.test' }],
  hasActiveLogin: true,
  warnings: {
    draftSoaps: 2,
    controlledStockItems: 3,
    controlledLocationId: 9,
    onlyHolderOfRoles: ['Medical Director'],
  },
};
vi.mock('../../api/offboarding', () => ({
  fetchOffboardPreview: async () => preview,
  offboardEmployee: (...a: unknown[]) => offboard(...a),
}));
vi.mock('../../api/clientsStaff', () => ({ searchClientsStaff: async () => [] }));

const colleagues = [
  { id: 7, name: 'Odile Brackenridge', isProvider: true },
  { id: 8, name: 'Wren Doctor', isProvider: true },
  { id: 9, name: 'Pat Manager', isProvider: false },
];

it('RP-03-18 shows all three warnings and Offboard is still allowed', async () => {
  offboard
    .mockReset()
    .mockResolvedValue({ id: 1, completedAt: null, lastDay: '2026-11-09', rebookTaskId: 3 });
  const onDone = vi.fn();
  render(
    <OffboardDialog
      employeeId={7}
      employeeName="Odile Brackenridge"
      colleagues={colleagues}
      onClose={vi.fn()}
      onDone={onDone}
    />
  );

  expect(await screen.findByTestId('offboard-warning-drafts')).toHaveTextContent(
    '2 unsigned records'
  );
  expect(screen.getByTestId('offboard-warning-stock')).toHaveTextContent(
    /controlled-drug location \(3 items\)/
  );
  expect(screen.getByTestId('offboard-warning-roles')).toHaveTextContent('only Medical Director');
  expect(screen.getByTestId('offboard-summary')).toHaveTextContent(/login\s+ends/);
  expect(screen.getByText(/Rebook Dr\. Brackenridge's visits/)).toBeInTheDocument();
  // The person being offboarded is not offered as their own replacement.
  expect(screen.queryByRole('option', { name: 'Odile Brackenridge' })).toBeNull();

  const button = screen.getByRole('button', { name: 'Offboard' });
  expect(button).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Their tasks go to'), { target: { value: '9' } });
  fireEvent.change(screen.getByLabelText('New primary doctor'), { target: { value: '8' } });
  fireEvent.change(screen.getByLabelText('Tamsin Tech works with'), { target: { value: '8' } });
  expect(button).toBeEnabled();
  fireEvent.click(button);

  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(offboard).toHaveBeenCalledWith(7, {
    lastDay: '2026-11-09',
    taskToEmployeeId: 9,
    primaryDoctorToId: 8,
    worksWith: [{ userId: 55, doctorId: 8 }],
    householdClientId: null,
  });
});

it('RP-03-19 Cancel closes the dialog without changing anything', async () => {
  offboard.mockReset();
  const onClose = vi.fn();
  render(
    <OffboardDialog
      employeeId={7}
      employeeName="Odile Brackenridge"
      colleagues={colleagues}
      onClose={onClose}
      onDone={vi.fn()}
    />
  );
  await screen.findByTestId('offboard-warning-drafts');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(onClose).toHaveBeenCalled();
  expect(offboard).not.toHaveBeenCalled();
});
