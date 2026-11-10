/** COM-A18: a shared mailbox Google disconnected shows "Disconnected — reconnect" in the Gmail settings. */
import { render, screen } from '@testing-library/react';
import { vi } from 'vitest';
import SettingsGmailMailboxPermissions from './SettingsGmailMailboxPermissions';

const fetchPerms = vi.hoisted(() => vi.fn());
vi.mock('../../api/gmail', async (orig) => ({
  ...(await orig<typeof import('../../api/gmail')>()),
  fetchGmailMailboxPermissions: (...a: unknown[]) => fetchPerms(...a),
  updateGmailMailboxPermissions: vi.fn(),
}));

it('flags only the disconnected mailbox', async () => {
  fetchPerms.mockResolvedValue({
    mailboxes: [
      { email: 'field@vayd.test', displayLabel: 'field@', connected: false },
      { email: 'info@vayd.test', displayLabel: 'info@', connected: true },
    ],
    users: [],
  });
  render(<SettingsGmailMailboxPermissions />);
  expect(await screen.findByText('Disconnected — reconnect')).toBeInTheDocument();
  expect(screen.getByTestId('gmail-mailbox-disconnected-field@vayd.test')).toBeInTheDocument();
  expect(screen.queryByTestId('gmail-mailbox-disconnected-info@vayd.test')).toBeNull();
});
