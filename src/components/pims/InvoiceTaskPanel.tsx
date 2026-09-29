import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Mail, MessageSquare, Receipt } from 'lucide-react';
import type { TaskDetail } from '../../api/tasks';
import { createClientPayLink } from '../../api/visitWorkflow';
import { sendClientSms } from '../../api/clientSms';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import { ClientSmsComposeModal } from '../ClientSmsComposeModal';
import { firstNameFromDisplayName } from '../../utils/clientNamePrefix';
import { applySystemTemplate } from '../../utils/messageTemplateCache';
import { mergeValuesFromNames, withClinicDefaults } from '../../utils/messageTemplateFields';

function linkedId(task: TaskDetail, type: 'client' | 'patient'): number | null {
  const hit = task.links?.find((l) => l.entityType === type);
  return hit ? hit.entityId : null;
}

/** Automatic invoice tasks stash the bill UUID in the idempotency key. */
export function invoiceIdFromTask(task: {
  idempotencyKey?: string | null;
}): string | null {
  const key = task.idempotencyKey ?? '';
  const m = key.match(/:invoice:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  return m?.[1] ?? null;
}

function money(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function payLinkMerge(clientName: string, amount: number, labels: string, url: string) {
  return withClinicDefaults({
    client_first_name: firstNameFromDisplayName(clientName) || 'there',
    client_full_name: clientName,
    amount: money(amount),
    invoice_labels: labels,
    pay_link: url,
  });
}

function clientPayReturnUrl(): string {
  return `${window.location.origin}/client-portal`;
}

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const data = (e as { response?: { data?: { message?: string } } }).response?.data;
    if (data && typeof data.message === 'string') return data.message;
  }
  if (e instanceof Error) return e.message;
  return 'Could not send that.';
}

type Props = {
  task: TaskDetail;
  clientName?: string | null;
  canComplete: boolean;
  busy?: boolean;
  onComplete: () => void;
};

/**
 * Close the bill: text a pay link, write the owner, or jump to the invoice.
 * Chart notes stay under the fold on the task screen.
 */
export default function InvoiceTaskPanel({
  task,
  clientName: clientNameProp,
  canComplete,
  busy = false,
  onComplete,
}: Props) {
  const clientId = linkedId(task, 'client');
  const invoiceId = invoiceIdFromTask(task);
  const clientName = clientNameProp?.trim() || 'the owner';
  const invoiceHref =
    clientId != null
      ? `/schedule/clients?clientId=${encodeURIComponent(String(clientId))}&tab=financial${
          invoiceId ? `&invoice=${encodeURIComponent(invoiceId)}` : ''
        }`
      : null;

  const [pay, setPay] = useState<null | {
    channel: 'sms';
    url: string;
    amount: number;
    labels: string[];
  }>(null);
  const [paySms, setPaySms] = useState('');
  const [emailOpen, setEmailOpen] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textBody, setTextBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const startPayLink = async () => {
    if (clientId == null) {
      setNote('Link a client on this task to text a pay link.');
      return;
    }
    setActionBusy(true);
    setNote(null);
    setSendError(null);
    try {
      const link = await createClientPayLink(clientId, {
        successUrl: clientPayReturnUrl(),
        cancelUrl: clientPayReturnUrl(),
      });
      const labels = link.invoiceLabels.join(', ');
      setPaySms(
        applySystemTemplate(
          'payment_link_sms',
          payLinkMerge(clientName, link.amount, labels, link.url),
          `Hi ${firstNameFromDisplayName(clientName) || 'there'}, here is a secure link to pay ${money(link.amount)} for ${labels}: ${link.url}`,
        ),
      );
      setPay({ channel: 'sms', url: link.url, amount: link.amount, labels: link.invoiceLabels });
    } catch (e: unknown) {
      setNote(errMsg(e));
    } finally {
      setActionBusy(false);
    }
  };

  const startText = () => {
    if (clientId == null) {
      setNote('Link a client on this task to text them.');
      return;
    }
    setSendError(null);
    setTextBody(
      `Hi ${firstNameFromDisplayName(clientName) || 'there'}, just following up about the open invoice.`,
    );
    setTextOpen(true);
  };

  if (clientId == null && !invoiceHref) {
    return (
      <section className="pims-fb-task" aria-label="Invoice">
        <p className="pims-fb-task__lead">
          This invoice task is missing a client link, so it cannot text or email
          the owner from here.
        </p>
      </section>
    );
  }

  return (
    <section className="pims-fb-task" aria-label="Invoice">
      <p className="pims-fb-task__lead">
        Close this bill or get a pay link to the owner. Text and email stay on
        this task so you do not have to leave the list.
      </p>
      {note ? <p className="pims-task-detail__error">{note}</p> : null}
      <div className="pims-fb-task__actions">
        {invoiceHref ? (
          <Link className="pims-task-detail__btn pims-task-detail__btn--secondary" to={invoiceHref}>
            <Receipt size={16} />
            Open invoice
          </Link>
        ) : null}
        <button
          type="button"
          className="pims-task-detail__btn pims-task-detail__btn--primary"
          disabled={actionBusy || clientId == null}
          onClick={() => void startPayLink()}
        >
          Text to Pay
        </button>
        <button
          type="button"
          className="pims-task-detail__btn pims-task-detail__btn--secondary"
          disabled={clientId == null}
          onClick={startText}
        >
          <MessageSquare size={16} />
          Text owner
        </button>
        <button
          type="button"
          className="pims-task-detail__btn pims-task-detail__btn--secondary"
          disabled={clientId == null}
          onClick={() => {
            setSendError(null);
            setEmailOpen(true);
          }}
        >
          <Mail size={16} />
          Email owner
        </button>
        {canComplete ? (
          <button
            type="button"
            className="pims-task-detail__btn pims-task-detail__btn--secondary"
            disabled={busy}
            onClick={onComplete}
          >
            <Check size={16} />
            Mark complete
          </button>
        ) : null}
      </div>

      {clientId != null ? (
        <>
          <ClientSmsComposeModal
            open={pay != null}
            clientId={clientId}
            clientLabel={clientName}
            message={paySms}
            onMessageChange={setPaySms}
            onClose={() => setPay(null)}
            sending={sending}
            sendError={sendError}
            title="Text pay link"
            subtitle={pay ? `${money(pay.amount)} · ${pay.labels.join(', ')}` : undefined}
            mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
            onSend={({ overrideNonProd }) => {
              void (async () => {
                const message = paySms.trim();
                if (!message) {
                  setSendError('Enter a message before sending.');
                  return;
                }
                setSending(true);
                setSendError(null);
                try {
                  await sendClientSms(clientId, {
                    message,
                    source: 'invoice_task_pay_link',
                    ...(overrideNonProd ? { overrideNonProd: true } : {}),
                  });
                  setPay(null);
                  setNote('Pay link texted to the owner.');
                } catch (e: unknown) {
                  setSendError(errMsg(e));
                } finally {
                  setSending(false);
                }
              })();
            }}
          />
          <ClientSmsComposeModal
            open={textOpen}
            clientId={clientId}
            clientLabel={clientName}
            message={textBody}
            onMessageChange={setTextBody}
            onClose={() => setTextOpen(false)}
            sending={sending}
            sendError={sendError}
            title="Text owner"
            mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
            onSend={({ overrideNonProd }) => {
              void (async () => {
                const message = textBody.trim();
                if (!message) {
                  setSendError('Enter a message before sending.');
                  return;
                }
                setSending(true);
                setSendError(null);
                try {
                  await sendClientSms(clientId, {
                    message,
                    source: 'invoice_task',
                    ...(overrideNonProd ? { overrideNonProd: true } : {}),
                  });
                  setTextOpen(false);
                  setNote('Text sent to the owner.');
                } catch (e: unknown) {
                  setSendError(errMsg(e));
                } finally {
                  setSending(false);
                }
              })();
            }}
          />
          <ClientEmailComposeModal
            open={emailOpen}
            clientId={clientId}
            clientLabel={clientName}
            title="Email owner"
            initialSubject={`Following up on ${clientName}'s invoice`}
            initialBodyText={`Hi ${firstNameFromDisplayName(clientName) || 'there'},\n\nJust following up about the open invoice. Reply here or I can text a pay link.\n\nThank you.`}
            mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
            onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
              await recordScoutChartCommunication({
                clientId,
                channel: 'email',
                body: bodyHtml || bodyText,
                subject,
                destination: to,
                sentFrom: from,
                typeLabel: 'Invoice task email',
                includeOnMedicalRecord: false,
              });
              setNote('Email sent to the owner.');
            }}
            onClose={() => setEmailOpen(false)}
          />
        </>
      ) : null}
    </section>
  );
}
