/**
 * B11 (OSV-10 dry run, Nov 8, 2026; owner decision Nov 9): after "Reject + refund + email" sends the email, the
 * order records the client contact, so it no longer shows "Contact client" or counts in the rejected-orders banner.
 */
import { vi } from 'vitest';

vi.mock('../api/onlineStore', () => ({}));

import { rejectEmailSentAction } from './MailOrdersPage';

it('B11: a whole-order reject email records the contact (no second refund)', () => {
  expect(
    rejectEmailSentAction({
      outreachOnly: false,
      subject: 'Update on your order #281',
      bodyText: 'Hi Maria',
      refundRejected: true,
    })
  ).toEqual({
    action: 'email_sent',
    rejectOutreach: true,
    refundRejected: false,
    notes: 'Rejection emailed · Update on your order #281',
    message: 'Hi Maria',
  });
});

it('rejected-item outreach is unchanged: it records the contact and can refund the rejected items', () => {
  expect(
    rejectEmailSentAction({
      outreachOnly: true,
      subject: 'About Maple’s order',
      bodyText: 'Hi',
      refundRejected: true,
    })
  ).toEqual({
    action: 'email_sent',
    rejectOutreach: true,
    refundRejected: true,
    notes: 'Rejected item outreach · About Maple’s order',
    message: 'Hi',
  });
});
