/** SCH-01b: when the API refuses a role change, the Roles screen shows the API's own message. */
import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsScoutRoles from './SettingsScoutRoles';

const REFUSAL =
  'Only a superadmin can give or remove the Practice Manager role. Please ask a superadmin to make this change.';

const replace = vi.hoisted(() => vi.fn());
vi.mock('../../api/appointmentSettings', () => ({
  fetchEmployeeRoles: async () => [
    { id: 7, name: 'Practice Manager', slug: 'practice_manager', isBranchSpecific: false },
  ],
  fetchAllEmployees: async () => [
    { id: 1, firstName: 'Pat', lastName: 'Admin', isActive: true },
    { id: 2, firstName: 'Sam', lastName: 'Tech', isActive: true },
  ],
  fetchScoutRoleAssignments: async () => ({
    role: { id: 7, name: 'Practice Manager', slug: 'practice_manager', isBranchSpecific: false },
    assignments: [],
  }),
  fetchRoleManualBookingAppointmentTypes: async () => [],
  replaceScoutRoleAssignments: (...a: unknown[]) => replace(...a),
  createScoutEmployeeRole: vi.fn(),
  patchScoutEmployeeRole: vi.fn(),
  updateRoleManualBookingAppointmentTypes: vi.fn(),
}));
vi.mock('../../api/branchInventory', () => ({ listPracticeBranches: async () => [] }));
vi.mock('./RolePermissionsEditor', () => ({ default: () => null }));

/** Stands in for Settings, which shows the error message it is given above the tab. */
function Host() {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      {error && <div role="alert">{error}</div>}
      <SettingsScoutRoles
        practiceId={1}
        appointmentTypes={[]}
        onMessage={(msg, kind) => kind === 'error' && setError(msg)}
      />
    </>
  );
}

it('shows the API refusal message when saving assignees is refused', async () => {
  replace.mockReset().mockRejectedValue({
    response: { status: 403, data: { statusCode: 403, error: 'Forbidden', message: REFUSAL } },
    message: 'Request failed with status code 403',
  });
  render(<Host />);

  fireEvent.click(await screen.findByRole('checkbox', { name: /Sam/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save assignees' }));

  await waitFor(() => expect(replace).toHaveBeenCalled());
  expect(await screen.findByRole('alert')).toHaveTextContent(REFUSAL);
});
