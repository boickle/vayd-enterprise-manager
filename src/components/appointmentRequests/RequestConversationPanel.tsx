/**
 * Right side of an open request on the Appointments list: the request's email thread, texts with
 * the request's phone, Quo calls and call notes in one conversation (see ConversationPanel).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  fetchAppointmentRequestConversation,
  logAppointmentRequestCall,
  sendAppointmentRequestSubmissionSms,
  summarizeAppointmentRequestQuoCall,
  type AppointmentRequestSubmission,
  type AppointmentRequestSubmissionItem,
} from '../../api/appointmentRequestSubmissions';
import { useAppointmentRequestEmail } from '../../hooks/useAppointmentRequestEmail';
import {
  clientDisplayNameFromRequestData,
  requestDataCanText,
  requestDataClientId,
  requestDataPhone,
} from '../../utils/appointmentRequestDisplay';
import { resolveAppointmentRequestSmsMessage } from '../../utils/appointmentRequestSmsMessage';
import { requestDataPetRowSummaries } from '../../utils/appointmentRequestDetailDisplay';
import { ConversationPanel, type ConversationSource } from './ConversationPanel';
import { AppointmentRequestEmailModal } from '../AppointmentRequestEmailModal';

type Props = {
  item: AppointmentRequestSubmissionItem;
  practiceId: number;
  practiceTz: string;
  /** After an email or text goes out: mark contacted, update the row. */
  onContacted: (item: AppointmentRequestSubmissionItem) => void;
  /** After a call is logged (the API already marked it contacted). */
  onSubmissionUpdated: (updated: AppointmentRequestSubmission) => void;
  onGmailLinked?: (patch: {
    gmailThreadId: string;
    gmailMailbox: string;
    gmailLinkedAt: string | null;
  }) => void;
  /** Buttons for the request's next step (Route, Confirm, Not booked…). */
  actions?: ReactNode;
};

export function RequestConversationPanel({
  item,
  practiceId,
  practiceTz,
  onContacted,
  onSubmissionUpdated,
  onGmailLinked,
  actions,
}: Props) {
  const rd = item.requestData ?? {};
  const phone = requestDataPhone(rd);
  const baseEmail = useAppointmentRequestEmail(item, { onGmailLinked });
  /** The Email window (From / send as, templates), opened with what was typed. */
  const [windowDraft, setWindowDraft] = useState<string | null>(null);
  const email = useMemo(
    () => (baseEmail ? { ...baseEmail, openWindow: (draft: string) => setWindowDraft(draft) } : null),
    [baseEmail]
  );

  // A client reply arriving while the request is open: load the conversation again.
  const latestReply = item.unreadReplies?.lastAt ?? null;
  const seenReply = useRef<string | null>(latestReply);
  const [replyStamp, setReplyStamp] = useState(0);
  useEffect(() => {
    if (!latestReply || latestReply === seenReply.current) return;
    seenReply.current = latestReply;
    setReplyStamp((n) => n + 1);
    email?.reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on a new reply
  }, [latestReply]);

  const source: ConversationSource = useMemo(() => {
    const clientId = Number(requestDataClientId(rd));
    const firstPet = requestDataPetRowSummaries(rd).find((p) => p.patientId)?.patientId;
    return {
      key: `request-${item.id}-${replyStamp}`,
      startedAt: item.submittedAt,
      startTitle: 'Request received',
      phone,
      canText: Boolean(phone) && requestDataCanText(rd) !== 'No',
      dial: {
        clientId: Number.isFinite(clientId) && clientId > 0 ? clientId : null,
        clientName: clientDisplayNameFromRequestData(rd),
        patientId: firstPet != null ? Number(firstPet) : null,
      },
      email,
      load: ({ part, fresh }) => fetchAppointmentRequestConversation(item.id, part, fresh),
      splitLoad: true,
      fresh: replyStamp > 0,
      summarizeCall: (callId) => summarizeAppointmentRequestQuoCall(item.id, callId),
      sendText: async (message) => {
        await sendAppointmentRequestSubmissionSms(item.id, { message });
        onContacted(item);
      },
      logCall: async (outcome, note) => {
        onSubmissionUpdated(await logAppointmentRequestCall(item.id, { outcome, note }));
      },
      afterEmail: () => onContacted(item),
      suggest: (mode) =>
        resolveAppointmentRequestSmsMessage(item, practiceTz, { practiceId, greeting: mode }),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rebuilt per request and email state
  }, [item, phone, email, practiceTz, practiceId, onContacted, onSubmissionUpdated, replyStamp]);

  return (
    <>
      <ConversationPanel source={source} practiceTz={practiceTz} actions={actions} />
      {windowDraft != null ? (
        <AppointmentRequestEmailModal
          item={item}
          practiceId={practiceId}
          practiceTz={practiceTz}
          initialBodyText={windowDraft}
          onClose={() => setWindowDraft(null)}
          onSent={() => {
            baseEmail?.reload();
            onContacted(item);
          }}
          onGmailLinked={onGmailLinked}
        />
      ) : null}
    </>
  );
}
