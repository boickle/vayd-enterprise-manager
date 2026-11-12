/**
 * Right side of an open hold on the Hold tab (holds that did not come from a request): texts with
 * the client, Quo calls with summaries, and call notes, with Text and Call to reach them.
 */
import { useMemo, type ReactNode } from 'react';
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
      email: null,
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
  }, [hold, canText, onChanged]);

  return <ConversationPanel source={source} practiceTz={practiceTz} actions={actions} />;
}
