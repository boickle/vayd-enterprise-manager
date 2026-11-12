import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  createDepositPayLink,
  getAppointmentDeposit,
  requestAppointmentDeposit,
  type AppointmentDeposit,
} from '../api/appointmentDeposits';
import { apiErrorMessage } from '../api/http';
import { sendClientSms } from '../api/clientSms';
import { ClientEmailComposeModal } from './ClientEmailComposeModal';
import { ClientSmsComposeModal } from './ClientSmsComposeModal';
import { firstNameFromDisplayName } from '../utils/clientNamePrefix';
import { mergeValuesFromNames } from '../utils/messageTemplateFields';
import '../pages/Scheduler.css';

const money = (n: number) => `$${(Math.round(n * 100) / 100).toFixed(2)}`;

export const DEFAULT_DEPOSIT = 100;

const STATUS_TEXT: Record<AppointmentDeposit['status'], string> = {
  none: 'No deposit asked for yet.',
  requested: 'Asked for, not paid yet.',
  part_paid: 'Partly paid.',
  paid: 'Paid.',
};

/** Words for the text message and the email (kept short; staff can edit before sending). */
export function depositSmsText(clientName: string, amount: number, label: string, url: string): string {
  const first = firstNameFromDisplayName(clientName) || 'there';
  return `Hi ${first}, here is a secure link to pay your ${money(amount)} deposit (${label}): ${url}\n\nThe deposit goes toward your visit. Thank you!`;
}

export function depositEmailText(clientName: string, amount: number, label: string, url: string): string {
  const first = firstNameFromDisplayName(clientName) || 'there';
  return `Hi ${first},\n\nHere is a secure Stripe link to pay your ${money(amount)} deposit (${label}):\n\n${url}\n\nThe deposit goes toward your visit.\n\nThank you.`;
}

type Props = {
  appointmentId: number;
  clientId: number;
  clientName: string;
  doNotSms?: boolean;
  /** Shown when the client is marked "Deposit required". */
  depositRequiredNote?: string | null;
  onClose: () => void;
  /** Open the deposit bill to take cash, check or a card in person. */
  onTakePayment: (invoiceId: string) => void;
};

/**
 * Appointment deposit (owner, Nov 12, 2026): ask for a flat deposit (usually $100) before a visit
 * and collect it by text or email pay link, or in person. Paid deposits sit on the account as
 * credit; the visit's checkout (or a cancel fee) uses it through Account credit.
 */
export function AppointmentDepositModal({
  appointmentId,
  clientId,
  clientName,
  doNotSms,
  depositRequiredNote,
  onClose,
  onTakePayment,
}: Props) {
  const [deposit, setDeposit] = useState<AppointmentDeposit | null>(null);
  const [amount, setAmount] = useState(String(DEFAULT_DEPOSIT));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [compose, setCompose] = useState<null | { channel: 'sms' | 'email'; url: string; amount: number; label: string }>(null);
  const [sms, setSms] = useState('');
  const [smsSending, setSmsSending] = useState(false);
  const [smsError, setSmsError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAppointmentDeposit(appointmentId)
      .then((d) => {
        if (!live) return;
        setDeposit(d);
        if (d.status !== 'none') setAmount(String(d.requested));
      })
      .catch((e) => live && setError(apiErrorMessage(e)));
    return () => {
      live = false;
    };
  }, [appointmentId]);

  const wanted = Number(amount);
  const amountOk = Number.isFinite(wanted) && wanted >= 1;
  const changed = !deposit || deposit.status === 'none' || Math.abs(deposit.requested - wanted) > 0.009;

  /** Save the amount (makes the deposit the first time) and return the fresh summary. */
  async function ensure(): Promise<AppointmentDeposit | null> {
    if (!amountOk) {
      setError('Enter a deposit of at least $1.00.');
      return null;
    }
    if (!changed && deposit) return deposit;
    const next = await requestAppointmentDeposit(appointmentId, wanted);
    setDeposit(next);
    return next;
  }

  async function sendLink(channel: 'sms' | 'email') {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const d = await ensure();
      if (!d) return;
      const back = `${window.location.origin}/client-portal`;
      const link = await createDepositPayLink(appointmentId, { successUrl: back, cancelUrl: back });
      if (channel === 'sms') {
        setSms(depositSmsText(clientName, link.amount, link.label, link.url));
        setSmsError(null);
      }
      setCompose({ channel, url: link.url, amount: link.amount, label: link.label });
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function takePayment() {
    setBusy(true);
    setError(null);
    try {
      const d = await ensure();
      if (d?.invoiceId) onTakePayment(d.invoiceId);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAmount() {
    setBusy(true);
    setError(null);
    try {
      const d = await ensure();
      if (d) setNote(`Deposit set to ${money(d.requested)}.`);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const paidInFull = deposit?.status === 'paid';

  const modal = (
    <div
      className="scheduler-modal-backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <div
        className="scheduler-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="appointment-deposit-title"
        data-testid="appointment-deposit-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="scheduler-modal-header">
          <div className="scheduler-modal-header-text">
            <p className="scheduler-modal-eyebrow">{clientName}</p>
            <h2 id="appointment-deposit-title">Appointment deposit</h2>
          </div>
          <button type="button" className="scheduler-modal-close" aria-label="Close" disabled={busy} onClick={onClose}>
            ×
          </button>
        </div>

        <div className="scheduler-modal-body">
          {depositRequiredNote !== undefined && depositRequiredNote !== null ? (
            <p className="appointment-deposit__flag" role="note">
              <strong>Deposit required</strong>
              {depositRequiredNote ? `: ${depositRequiredNote}` : ''}
            </p>
          ) : null}
          {deposit ? <p>{deposit.label}</p> : <p>Loading…</p>}
          {deposit && deposit.status !== 'none' ? (
            <p data-testid="appointment-deposit-status">
              {STATUS_TEXT[deposit.status]} Asked for {money(deposit.requested)}, paid {money(deposit.paid)}
              {deposit.owed > 0.009 ? `, ${money(deposit.owed)} still to collect` : ''}.
              {deposit.paid > 0.009
                ? ` ${money(deposit.creditLeft)} of it is on the account as credit for checkout.`
                : ''}
            </p>
          ) : null}
          <label className="appointment-deposit__amount">
            Deposit amount ($)
            <input
              type="number"
              min={1}
              step="0.01"
              inputMode="decimal"
              value={amount}
              disabled={busy || paidInFull}
              onChange={(e) => setAmount(e.target.value)}
              data-testid="appointment-deposit-amount"
            />
          </label>
          <p className="appointment-deposit__hint">
            The deposit is kept on the client&apos;s account. At checkout, use <strong>Account credit</strong>{' '}
            to apply it. If the client cancels or doesn&apos;t show, add the cancel fee to a bill and pay it
            with Account credit.
          </p>
          {error ? <p className="client-fin__err" role="alert">{error}</p> : null}
          {note ? <p role="status">{note}</p> : null}
        </div>

        <div className="scheduler-book-actions">
          {!paidInFull && deposit && deposit.status !== 'none' && changed ? (
            <button type="button" className="scheduler-book-btn secondary" disabled={busy || !amountOk} onClick={() => void saveAmount()}>
              Save amount
            </button>
          ) : null}
          <button
            type="button"
            className="scheduler-book-btn secondary"
            disabled={busy || !deposit || paidInFull || !amountOk}
            onClick={() => void takePayment()}
          >
            Take payment now
          </button>
          <button
            type="button"
            className="scheduler-book-btn secondary"
            disabled={busy || !deposit || paidInFull || !amountOk}
            onClick={() => void sendLink('email')}
          >
            Email pay link
          </button>
          <button
            type="button"
            className="scheduler-book-btn primary"
            disabled={busy || !deposit || paidInFull || !amountOk || doNotSms === true}
            title={doNotSms ? 'This client does not get texts.' : undefined}
            onClick={() => void sendLink('sms')}
          >
            Text pay link
          </button>
        </div>
      </div>
      <ClientEmailComposeModal
        open={compose?.channel === 'email'}
        clientId={clientId}
        clientLabel={clientName}
        initialSubject={compose ? compose.label : 'Deposit'}
        initialBodyText={compose ? depositEmailText(clientName, compose.amount, compose.label, compose.url) : ''}
        mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
        onAfterSend={() => {
          setCompose(null);
          setNote('Deposit pay link emailed to the client.');
        }}
        onClose={() => setCompose(null)}
      />
      <ClientSmsComposeModal
        open={compose?.channel === 'sms'}
        clientId={clientId}
        doNotSms={doNotSms}
        clientLabel={clientName}
        message={sms}
        onMessageChange={setSms}
        onClose={() => setCompose(null)}
        sending={smsSending}
        sendError={smsError}
        title="Text deposit pay link"
        subtitle={compose ? `${money(compose.amount)} · ${compose.label}` : undefined}
        mergeValues={mergeValuesFromNames({ clientFullName: clientName })}
        onSend={({ overrideNonProd }) => {
          void (async () => {
            const message = sms.trim();
            if (!message) {
              setSmsError('Enter a message before sending.');
              return;
            }
            setSmsSending(true);
            setSmsError(null);
            try {
              await sendClientSms(clientId, {
                message,
                source: 'financial_pay_link',
                ...(overrideNonProd ? { overrideNonProd: true } : {}),
              });
              setCompose(null);
              setNote('Deposit pay link texted to the client.');
            } catch (e) {
              setSmsError(apiErrorMessage(e));
            } finally {
              setSmsSending(false);
            }
          })();
        }}
      />
    </div>
  );

  return createPortal(modal, document.body);
}
