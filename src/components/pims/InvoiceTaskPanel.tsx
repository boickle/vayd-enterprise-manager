import { useState } from 'react';
import { Link } from 'react-router';
import { Check, Mail, MessageSquare, Receipt } from 'lucide-react';
import { patchTask, type TaskDetail } from '../../api/tasks';
import type { Employee } from '../../api/appointmentSettings';
import { createClientPayLink } from '../../api/visitWorkflow';
import { sendClientSms } from '../../api/clientSms';
import { recordScoutChartCommunication } from '../../api/scoutChart';
import { ClientEmailComposeModal } from '../ClientEmailComposeModal';
import { ClientSmsComposeModal } from '../ClientSmsComposeModal';
import { TaskBodyContent } from './TaskBodyContent';
import { firstNameFromDisplayName } from '../../utils/clientNamePrefix';
import { formatEmployeeDisplayName } from '../../utils/employeeDisplayName';
import { invoiceIdFromTask } from '../../utils/invoiceTask';
import { applySystemTemplate } from '../../utils/messageTemplateCache';
import { mergeValuesFromNames, withClinicDefaults } from '../../utils/messageTemplateFields';

function appendTaskNote(existing: string | null | undefined, heading: string, body: string): string {
  const prior = (existing ?? '').trim();
  const block = `${heading}\n${body.trim()}`;
  return prior ? `${prior}\n\n${block}` : block;
}

function reachoutStamp(actor: string): string {
  const when = new Date().toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return `Reachout · ${when} · ${actor}`;
}

function linkedId(task: TaskDetail, type: 'client' | 'patient'): number | null {
  const hit = task.links?.find((l) => l.entityType === type);
  return hit ? hit.entityId : null;
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
  employees?: Employee[];
  myEmployeeId?: number | null;
  canComplete: boolean;
  canAct?: boolean;
  busy?: boolean;
  onComplete: () => void;
  onUpdated: (updated?: TaskDetail) => void;
};

/**
 * Close the bill: text a pay link, write the owner, or jump to the invoice.
 * Reachouts stay on this task so the next person can see what already happened.
 */
export default function InvoiceTaskPanel({
  task,
  clientName: clientNameProp,
  employees = [],
  myEmployeeId = null,
  canComplete,
  canAct = true,
  busy = false,
  onComplete,
  onUpdated,
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
  const [copiedLink, setCopiedLink] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailBody, setEmailBody] = useState('');
  const [emailLogToClient, setEmailLogToClient] = useState(false);
  const [textOpen, setTextOpen] = useState(false);
  const [textBody, setTextBody] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [reachout, setReachout] = useState('');
  const [fileToClient, setFileToClient] = useState(false);
  const [savingNote, setSavingNote] = useState(false);

  const actorName = () => {
    const who = myEmployeeId != null ? employees.find((e) => Number(e.id) === myEmployeeId) : null;
    return who ? formatEmployeeDisplayName(who) || who.email : 'Staff';
  };

  const logReachout = async (text: string, opts?: { chart?: boolean }) => {
    const updated = await patchTask(task.id, {
      body: appendTaskNote(task.body, reachoutStamp(actorName()), text),
    });
    if (opts?.chart && clientId != null) {
      await recordScoutChartCommunication({
        clientId,
        channel: 'log',
        body: text,
        typeLabel: 'Invoice follow-up',
        includeOnMedicalRecord: false,
      });
    }
    onUpdated(updated);
    return updated;
  };

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
          `Hi ${firstNameFromDisplayName(clientName) || 'there'}, here is a secure link to pay ${money(link.amount)} for ${labels}: ${link.url}\n\nIf you want to see an itemized invoice, go to the portal.`,
        ),
      );
      setCopiedLink(false);
      setPay({ channel: 'sms', url: link.url, amount: link.amount, labels: link.invoiceLabels });
    } catch (e: unknown) {
      setNote(errMsg(e));
    } finally {
      setActionBusy(false);
    }
  };

  const startEmail = async () => {
    if (clientId == null) {
      setNote('Link a client on this task to email them.');
      return;
    }
    setActionBusy(true);
    setNote(null);
    try {
      const link = await createClientPayLink(clientId, {
        successUrl: clientPayReturnUrl(),
        cancelUrl: clientPayReturnUrl(),
      });
      const first = firstNameFromDisplayName(clientName) || 'there';
      const href = link.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      const portal = clientPayReturnUrl().replace(/&/g, '&amp;').replace(/"/g, '&quot;');
      setEmailBody(
        `<p>Hi ${first},</p><p>I hope you are doing well. Just a quick note that there is still a balance on your invoice — you can <a href="${href}">click here to pay</a> whenever you are ready.</p><p>If you would like to see an itemized invoice, <a href="${portal}">go to the portal</a>.</p><p>Thank you,<br>Your Vet At Your Door Team</p>`,
      );
      setEmailLogToClient(false);
      setEmailOpen(true);
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

  const addReachoutNote = async () => {
    const text = reachout.trim();
    if (!text) {
      setNote('Write what you did before adding a note.');
      return;
    }
    setSavingNote(true);
    setNote(null);
    try {
      await logReachout(text, { chart: fileToClient });
      setReachout('');
      setNote(
        fileToClient && clientId != null
          ? 'Note saved on this task and filed to the client record.'
          : 'Note saved on this task.',
      );
    } catch (e: unknown) {
      setNote(errMsg(e));
    } finally {
      setSavingNote(false);
    }
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
      {canAct ? (
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
          disabled={actionBusy || clientId == null}
          onClick={() => void startEmail()}
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
      ) : null}

      <div className="pims-fb-task__notes">
        <h3>Notes</h3>
        <p className="settings-muted">
          Reachouts stay on this task. Check the box to also file a note on the
          client record — not the pet chart.
        </p>
        {task.body?.trim() ? (
          <div className="pims-fb-task__log">
            <TaskBodyContent body={task.body} />
          </div>
        ) : (
          <p className="settings-muted">No reachouts logged yet.</p>
        )}
        {canAct ? (
          <>
        <label className="pims-fb-task__note-field">
          <span>Add a note</span>
          <textarea
            className="soap-textarea"
            rows={4}
            value={reachout}
            onChange={(e) => setReachout(e.target.value)}
            placeholder="Left a voicemail, owner said they will pay Friday…"
            disabled={savingNote}
          />
        </label>
        <label className="pims-fb-task__chart">
          <input
            type="checkbox"
            checked={fileToClient}
            onChange={(e) => setFileToClient(e.target.checked)}
            disabled={savingNote || clientId == null}
          />
          File this note to {clientName}’s record
        </label>
        <button
          type="button"
          className="pims-task-detail__btn pims-task-detail__btn--primary"
          disabled={savingNote || !reachout.trim()}
          onClick={() => void addReachoutNote()}
        >
          {savingNote ? 'Saving…' : 'Save'}
        </button>
          </>
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
            payLink={pay?.url ?? ''}
            payLinkCopied={copiedLink}
            onPayLinkChange={(url) => {
              setPay((cur) => {
                if (!cur) return cur;
                const prev = cur.url;
                if (prev && url && paySms.includes(prev)) {
                  setPaySms((msg) => msg.split(prev).join(url));
                }
                return { ...cur, url };
              });
            }}
            onCopyPayLink={() => {
              const url = pay?.url?.trim();
              if (!url || !navigator.clipboard?.writeText) return;
              void navigator.clipboard.writeText(url).then(() => {
                setCopiedLink(true);
                window.setTimeout(() => setCopiedLink(false), 2000);
              });
            }}
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
                  await logReachout(`Texted pay link.\n${message}`);
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
                  await logReachout(`Texted the owner.\n${message}`);
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
            initialSubject="Following up on your services with Vet At Your Door"
            initialBodyText={emailBody}
            mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
            saveToClientCommunications={emailLogToClient}
            onSaveToClientCommunicationsChange={setEmailLogToClient}
            onAfterSend={async ({ subject, bodyText, bodyHtml, to, from }) => {
              if (emailLogToClient) {
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
              }
              await logReachout(`Emailed the owner${subject ? ` — ${subject}` : ''}.`);
              setNote(
                emailLogToClient
                  ? 'Email sent and saved to client communications.'
                  : 'Email sent to the owner.',
              );
            }}
            onClose={() => setEmailOpen(false)}
          />
        </>
      ) : null}
    </section>
  );
}
