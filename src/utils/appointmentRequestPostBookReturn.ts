import type { NavigateFunction } from 'react-router';
import {
  appointmentRequestsPathForTab,
  type AppointmentRequestListTab,
} from '../appointments-nav';
import { holdsPathWithHighlight } from '../holds-nav';
import { buildGmailInboxReturnPath } from './routingAppointmentRequestIntent';
import { returnToAppointmentRequestsList } from './appointmentRequestListReturnTab';

/**
 * After booking a HOLD from Appts, land on the Holds board (not New), so Don't send
 * does not animate the row away into a tab that no longer lists holds.
 */
export function navigateAfterAppointmentRequestBook(
  navigate: NavigateFunction,
  args: {
    isHold: boolean;
    appointmentRequestSubmissionId: number;
    returnListTab?: AppointmentRequestListTab | null;
    returnToGmail?: { mailbox?: string | null; threadId?: string | null } | null;
    replace?: boolean;
  },
): void {
  const mailbox = args.returnToGmail?.mailbox?.trim() || '';
  const threadId = args.returnToGmail?.threadId?.trim() || '';
  if (mailbox && threadId) {
    navigate(buildGmailInboxReturnPath(mailbox, threadId), { replace: args.replace });
    return;
  }
  if (args.isHold) {
    navigate(holdsPathWithHighlight(args.appointmentRequestSubmissionId), {
      replace: args.replace,
    });
    return;
  }
  returnToAppointmentRequestsList(navigate, args.returnListTab ?? 'new', {
    replace: args.replace,
  });
}

/** Path-only helper for smoke tests / deep links. */
export function appointmentRequestPostBookReturnPath(args: {
  isHold: boolean;
  appointmentRequestSubmissionId: number;
  returnListTab?: AppointmentRequestListTab | null;
}): string {
  if (args.isHold) {
    return holdsPathWithHighlight(args.appointmentRequestSubmissionId);
  }
  return appointmentRequestsPathForTab(args.returnListTab ?? 'new');
}
