/**
 * Right side of an open hold on the Hold tab (holds that did not come from a request): recent
 * emails with the client, texts, Quo calls with summaries, and call notes, with Email, Text and
 * Call to reach them. Email opens the Email client window (From / send as, templates), the same
 * one as the Email button on the hold.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import { useClientEmailConversation } from '../../hooks/useClientEmailConversation';
import { holdEmailSubject } from '../../utils/clientOutreachEmailMessage';
import { fetchHoldConversation, logHoldCall, type HoldListItem } from '../../api/holds';
import { sendClientSms } from '../../api/clientSms';
import { ConversationPanel, type ConversationSource } from './ConversationPanel';

type Props = {
  /** The hold this conversation hangs off (the household's earliest hold). */
  hold: HoldListItem;
  canText: boolean;
  practiceTz: string;
  /** After a call is logged (the hold may now be owned by the caller). */
  onChanged?: () => void;
  actions?: ReactNode;
};

export function HoldConversationPanel({ hold, canText, practiceTz, onChanged, actions }: Props) {
  const [windowDraft, setWindowDraft] = useState<string | null>(null);
  const [regardingPatientId, setRegardingPatientId] = useState<number | null>(
    hold.patient?.id ?? null
  );
  const email = useClientEmailConversation({
    clientEmail: hold.client?.id != null ? hold.client.email : null,
    secondEmail: hold.client?.id != null ? (hold.client.secondEmail ?? null) : null,
    openWindow: setWindowDraft,
  });
  const clientLabel = hold.client
    ? [hold.client.firstName, hold.client.lastName].filter(Boolean).join(' ')
    : '';

  const source: ConversationSource = useMemo(() => {
    const client = hold.client;
    const clientName = client
      ? [client.firstName, client.lastName].filter(Boolean).join(' ')
      : null;
    const providerId = hold.primaryProvider?.id ?? null;
    return {
      key: `hold-${hold.id}`,
      startedAt: hold.holdPlacedAtIso ?? hold.appointmentStart ?? new Date().toISOString(),
      startTitle: 'Hold placed',
      phone: client?.phone1?.trim() || null,
      canText: canText && client?.id != null,
      dial: { clientId: client?.id ?? null, clientName, patientId: hold.patient?.id ?? null },
      email,
      load: () => fetchHoldConversation(hold.id),
      sendText: async (message) => {
        if (client?.id == null) throw new Error('This hold has no client to text.');
        await sendClientSms(client.id, {
          message,
          source: 'holds',
          // The hold's doctor's Quo line, else the reminders line (same default as before).
          ...(providerId != null ? { primaryProviderId: providerId } : { useRemindersFrom: true }),
        });
      },
      logCall: async (outcome, note) => {
        await logHoldCall(hold.id, { outcome, note });
        onChanged?.();
      },
    };
  }, [hold, canText, onChanged, email]);

  return (
    <>
      <ConversationPanel source={source} practiceTz={practiceTz} actions={actions} />
      {windowDraft != null && hold.client?.id != null ? (
        <ClientEmailComposeModal
          open
          clientId={hold.client.id}
          clientLabel={clientLabel}
          initialSubject={holdEmailSubject(hold.primaryProvider?.lastName)}
          initialBodyText={windowDraft}
          regardingPatients={
            hold.patient ? [{ id: hold.patient.id, name: hold.patient.name || 'Pet' }] : undefined
          }
          regardingPatientId={regardingPatientId}
          onRegardingPatientIdChange={setRegardingPatientId}
          onClose={() => {
            setWindowDraft(null);
            // Sent or not, look again so a sent email shows in the conversation.
            email?.reload();
            onChanged?.();
          }}
        />
      ) : null}
    </>
  );
}
