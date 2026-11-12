import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientContactComposeModal } from './ClientContactComposeModal';

vi.mock('../api/clientsStaff', async (orig) => ({
  ...(await orig<object>()),
  fetchClientByIdStaff: vi.fn(async () => ({
    id: 9,
    doNotSms: true,
    smsOptOut: true,
    smsOptOutSource: 'replied STOP',
    smsOptOutAt: '2026-11-09T15:00:00.000Z',
  })),
}));
vi.mock('../hooks/useGmailInboxAccess', () => ({
  useGmailInboxAccess: () => ({ allowed: false, loading: false }),
}));
vi.mock('../hooks/useClientEmailComposeSetup', () => ({
  useClientEmailComposeSetup: () => ({
    loading: false,
    error: null,
    mailbox: null,
    from: '',
    setFrom: () => {},
    fromOptions: [],
    handleFromChange: () => {},
    signatureHtml: '',
    to: '',
    setTo: () => {},
  }),
}));

afterEach(cleanup);

it('COM-03: Care Outreach text is disabled with the reason when the client replied STOP', async () => {
  render(
    <ClientContactComposeModal
      open
      clientId={9}
      clientLabel="Ana Rivera"
      initialSmsMessage="Hi Ana, Biscuit is due."
      canText
      onClose={() => {}}
      smsSource="care_outreach"
    />,
  );
  const reason = await screen.findByTestId('texts-off-reason');
  expect(reason.textContent).toContain('Texts off: replied STOP (Nov 9, 2026)');
  await waitFor(() => {
    const send = screen.getAllByRole('button').filter((b) => /^send/i.test(b.textContent ?? ''));
    expect(send.length).toBeGreaterThan(0);
    for (const b of send) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
