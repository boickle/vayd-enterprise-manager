/**
 * RPV-4 (owner, Nov 9, 2026: hide what read-only roles can't use). useMayShow drives the booking,
 * new-client, task and client-record buttons: shown while permissions load, then only to holders.
 */
import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

const state = vi.hoisted(() => ({ permissions: {} as Record<string, string>, resolve: null as null | (() => void) }));
vi.mock('../auth/useAuth', () => ({ useAuth: () => ({ token: 'token' }) }));
vi.mock('../utils/practiceIdFromToken', () => ({ currentPracticeId: () => 1 }));
vi.mock('../api/permissions', () => ({
  fetchMyPermissions: () =>
    new Promise((resolve) => {
      state.resolve = () =>
        resolve({ permissions: state.permissions, roles: [], isLicensed: false, licenseType: null });
    }),
}));

import { PermissionProvider, useMayShow } from './PermissionContext';

function BookButton() {
  const show = useMayShow('routing.book', 'calendar.book_manual');
  return show ? <button type="button">+ Appointment</button> : <span>hidden</span>;
}

const renderIt = () =>
  render(
    <PermissionProvider>
      <BookButton />
    </PermissionProvider>,
  );

it('shows while permissions load, then hides for an Observer', async () => {
  state.permissions = { 'client.view': 'all', 'report.payments': 'all' };
  renderIt();
  expect(screen.getByRole('button', { name: '+ Appointment' })).toBeInTheDocument();
  await waitFor(() => expect(state.resolve).not.toBeNull());
  state.resolve!();
  expect(await screen.findByText('hidden')).toBeInTheDocument();
});

it('stays for a client liaison (either booking permission is enough)', async () => {
  state.resolve = null;
  state.permissions = { 'calendar.book_manual': 'all' };
  renderIt();
  await waitFor(() => expect(state.resolve).not.toBeNull());
  state.resolve!();
  await waitFor(() => expect(screen.queryByText('hidden')).toBeNull());
  expect(screen.getByRole('button', { name: '+ Appointment' })).toBeInTheDocument();
});
