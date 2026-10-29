import { useCallback, useEffect, useState } from 'react';
import {
  GIFT_CARD_CHANNEL_LABELS,
  GIFT_CARD_STATUS_LABELS,
  GIFT_CARD_TXN_LABELS,
  adjustGiftCard,
  getGiftCard,
  issueGiftCard,
  listGiftCards,
  refundGiftCard,
  resendGiftCard,
  voidGiftCard,
  type GiftCardStatus,
  type GiftCardTransaction,
  type StaffGiftCard,
} from '../api/giftCards';
import { useCan } from '../permissions/PermissionContext';
import { PermissionDenied } from '../permissions/PermissionGate';
import { appPrompt } from '../utils/appDialog';
import { currentPracticeId } from '../utils/practiceIdFromToken';
import './Settings.css';

const STATUS_FILTERS: Array<{ key: '' | GiftCardStatus; label: string }> = [
  { key: '', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'depleted', label: 'Used up' },
  { key: 'void', label: 'Void' },
];

function money(value: number | null | undefined): string {
  return `$${(Number(value) || 0).toFixed(2)}`;
}

function when(value: string | null | undefined): string {
  if (!value) return '';
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? value
    : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function formatCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

type IssueForm = {
  faceValue: string;
  reason: string;
  recipientName: string;
  recipientEmail: string;
  message: string;
  deliverAt: string;
};

const EMPTY_ISSUE: IssueForm = {
  faceValue: '',
  reason: '',
  recipientName: '',
  recipientEmail: '',
  message: '',
  deliverAt: '',
};

function IssueGiftCardForm({
  onIssued,
  onCancel,
}: {
  onIssued: (card: StaffGiftCard) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<IssueForm>(EMPTY_ISSUE);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (key: keyof IssueForm) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async () => {
    const faceValue = Math.round(Number(form.faceValue) * 100) / 100;
    if (!(faceValue > 0)) return setErr('Enter the card amount.');
    if (!form.reason.trim())
      return setErr('Say why this card is being issued; it shows on the bookkeeping report.');
    setBusy(true);
    setErr(null);
    try {
      const card = await issueGiftCard(currentPracticeId(), {
        faceValue,
        reason: form.reason.trim(),
        amountPaid: 0,
        recipientName: form.recipientName.trim() || null,
        recipientEmail: form.recipientEmail.trim() || null,
        message: form.message.trim() || null,
        deliverAt: form.deliverAt || null,
      });
      setForm(EMPTY_ISSUE);
      onIssued(card);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not issue the gift card');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
      <h3 style={{ margin: 0 }}>Issue a gift card</h3>
      <p className="settings-muted" style={{ margin: 0 }}>
        For goodwill, donations, and giveaways. Nothing is charged; the card is recorded as issued
        at no cost.
      </p>
      <div
        style={{
          display: 'grid',
          gap: 10,
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        }}
      >
        <label className="settings-label">
          Amount
          <input
            className="settings-input"
            inputMode="decimal"
            value={form.faceValue}
            onChange={set('faceValue')}
            placeholder="50.00"
          />
        </label>
        <label className="settings-label">
          Reason *
          <input
            className="settings-input"
            value={form.reason}
            onChange={set('reason')}
            placeholder="Service recovery, raffle donation, …"
          />
        </label>
        <label className="settings-label">
          Recipient name
          <input
            className="settings-input"
            value={form.recipientName}
            onChange={set('recipientName')}
          />
        </label>
        <label className="settings-label">
          Recipient email
          <input
            className="settings-input"
            type="email"
            value={form.recipientEmail}
            onChange={set('recipientEmail')}
            placeholder="Leave blank to print it"
          />
        </label>
        <label className="settings-label">
          Send on
          <input
            className="settings-input"
            type="date"
            value={form.deliverAt}
            onChange={set('deliverAt')}
          />
        </label>
      </div>
      <label className="settings-label">
        Message
        <textarea
          className="settings-input"
          rows={2}
          maxLength={500}
          value={form.message}
          onChange={set('message')}
        />
      </label>
      {err ? <div className="settings-message settings-error-message">{err}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Issuing…' : 'Issue gift card'}
        </button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function GiftCardDetail({
  cardId,
  onChanged,
  onClose,
}: {
  cardId: string;
  onChanged: (card: StaffGiftCard) => void;
  onClose: () => void;
}) {
  const canManage = useCan('gift_card.manage');
  const [card, setCard] = useState<StaffGiftCard | null>(null);
  const [txns, setTxns] = useState<GiftCardTransaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const res = await getGiftCard(currentPracticeId(), cardId);
      setCard(res.card);
      setTxns(res.transactions);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the gift card');
    }
  }, [cardId]);

  useEffect(() => {
    setShowCode(false);
    setNote(null);
    void load();
  }, [load]);

  const act = async (run: () => Promise<StaffGiftCard | unknown>, done: string) => {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const next = await run();
      if (next && typeof next === 'object' && 'id' in next) onChanged(next as StaffGiftCard);
      await load();
      setNote(done);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  if (!card) {
    return (
      <div className="settings-card" style={{ padding: 16 }}>
        {err ? <div className="settings-message settings-error-message">{err}</div> : 'Loading…'}
      </div>
    );
  }

  const pid = currentPracticeId();
  const unused = Math.abs(card.balance - card.faceValue) < 0.005;
  const canRefund =
    canManage &&
    card.status !== 'void' &&
    unused &&
    card.amountPaid > 0 &&
    Boolean(card.stripePaymentIntentId);

  const doVoid = async () => {
    const reason = await appPrompt({
      title: 'Void this gift card?',
      message: `The ${money(card.balance)} left on it can no longer be spent. This does not refund the buyer.`,
      placeholder: 'Reason',
      requireReason: true,
      confirmLabel: 'Void card',
    });
    if (reason) await act(() => voidGiftCard(pid, card.id, reason), 'Gift card voided.');
  };

  const doRefund = async () => {
    const reason = await appPrompt({
      title: 'Refund this gift card?',
      message: `Refunds ${money(card.amountPaid)} to the buyer's card and closes the gift card.`,
      placeholder: 'Reason',
      requireReason: true,
      confirmLabel: 'Refund',
    });
    if (reason)
      await act(() => refundGiftCard(pid, card.id, reason), `Refunded ${money(card.amountPaid)}.`);
  };

  const doAdjust = async () => {
    const raw = await appPrompt({
      title: 'Adjust the balance',
      message: 'Enter the amount to add, or a negative amount to take off (for example -10).',
      placeholder: '10.00',
      requireReason: true,
      confirmLabel: 'Next',
    });
    if (!raw) return;
    const amount = Math.round(Number(raw) * 100) / 100;
    if (!Number.isFinite(amount) || amount === 0) {
      setErr('Enter a dollar amount other than zero.');
      return;
    }
    const reason = await appPrompt({
      title: `${amount > 0 ? 'Add' : 'Take off'} ${money(Math.abs(amount))}`,
      message: 'The reason is saved on the card and the bookkeeping report.',
      placeholder: 'Reason',
      requireReason: true,
      confirmLabel: 'Adjust',
    });
    if (reason) await act(() => adjustGiftCard(pid, card.id, amount, reason), 'Balance adjusted.');
  };

  const doResend = async () => {
    const email = await appPrompt({
      title: 'Email the gift card',
      message: 'Sends the card to this address now.',
      placeholder: 'name@example.com',
      defaultValue: card.recipientEmail || card.purchaserEmail || '',
      requireReason: true,
      confirmLabel: 'Send',
    });
    if (email)
      await act(() => resendGiftCard(pid, card.id, email.trim()), `Sent to ${email.trim()}.`);
  };

  return (
    <div className="settings-card" style={{ padding: 16, display: 'grid', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          alignItems: 'flex-start',
        }}
      >
        <div>
          <h3 style={{ margin: 0 }}>
            Gift card ••••{card.code.slice(-4)} · {GIFT_CARD_STATUS_LABELS[card.status]}
          </h3>
          <p className="settings-muted" style={{ margin: '4px 0 0' }}>
            {money(card.balance)} left of {money(card.faceValue)}
            {card.source === 'staff_issued'
              ? ` · issued by staff${card.issueReason ? ` (${card.issueReason})` : ''}`
              : ` · bought for ${money(card.amountPaid)}`}
          </p>
        </div>
        <button type="button" className="btn secondary" onClick={onClose}>
          Close
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gap: 6,
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
        }}
      >
        <div>
          <strong>Code</strong>
          <div style={{ fontFamily: 'monospace' }}>
            {showCode ? formatCode(card.code) : `••••-••••-••••-${card.code.slice(-4)}`}{' '}
            <button
              type="button"
              className="btn secondary"
              style={{ padding: '2px 8px' }}
              onClick={() => setShowCode((s) => !s)}
            >
              {showCode ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <div>
          <strong>Bought by</strong>
          <div>{card.purchaserName || '—'}</div>
          {card.purchaserEmail ? <div className="settings-muted">{card.purchaserEmail}</div> : null}
          {card.fromName ? <div className="settings-muted">Signed “{card.fromName}”</div> : null}
        </div>
        <div>
          <strong>For</strong>
          <div>{card.recipientName || '—'}</div>
          {card.recipientEmail ? <div className="settings-muted">{card.recipientEmail}</div> : null}
        </div>
        <div>
          <strong>Delivery</strong>
          <div>
            {card.deliveredAt
              ? `Sent ${when(card.deliveredAt)}`
              : card.deliverAt
                ? `Sends ${when(card.deliverAt)}`
                : card.recipientEmail
                  ? 'Not sent yet'
                  : 'Printed, no email'}
          </div>
        </div>
      </div>
      {card.message ? (
        <blockquote style={{ margin: 0, fontStyle: 'italic' }}>“{card.message}”</blockquote>
      ) : null}
      {card.voidReason ? <p style={{ margin: 0 }}>Closed: {card.voidReason}</p> : null}

      {err ? <div className="settings-message settings-error-message">{err}</div> : null}
      {note ? <div className="settings-message">{note}</div> : null}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a className="btn secondary" href={card.printUrl} target="_blank" rel="noreferrer">
          Print
        </a>
        {card.status !== 'void' ? (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void doResend()}
          >
            Email card
          </button>
        ) : null}
        {canManage && card.status !== 'void' ? (
          <>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => void doAdjust()}
            >
              Adjust balance
            </button>
            {canRefund ? (
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => void doRefund()}
              >
                Refund buyer
              </button>
            ) : null}
            <button
              type="button"
              className="btn secondary danger"
              disabled={busy}
              onClick={() => void doVoid()}
            >
              Void
            </button>
          </>
        ) : null}
      </div>

      <div>
        <h4 style={{ margin: '8px 0' }}>History</h4>
        <table className="settings-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>When</th>
              <th>What</th>
              <th>Where</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t) => (
              <tr key={t.id}>
                <td>{when(t.created)}</td>
                <td>{GIFT_CARD_TXN_LABELS[t.type] ?? t.type}</td>
                <td>{GIFT_CARD_CHANNEL_LABELS[t.channel] ?? t.channel}</td>
                <td style={{ textAlign: 'right' }}>{money(t.faceAmount)}</td>
                <td style={{ textAlign: 'right' }}>{money(t.balanceAfter)}</td>
                <td>{t.note || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GiftCardsPage() {
  const canView = useCan('gift_card.redeem');
  const canIssue = useCan('gift_card.issue');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | GiftCardStatus>('');
  const [cards, setCards] = useState<StaffGiftCard[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCards(
        await listGiftCards(currentPracticeId(), {
          q: q.trim() || undefined,
          status: status || undefined,
        })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load gift cards');
    } finally {
      setLoading(false);
    }
  }, [q, status]);

  useEffect(() => {
    if (!canView) return;
    const t = window.setTimeout(() => void reload(), 250);
    return () => window.clearTimeout(t);
  }, [reload, canView]);

  if (!canView) return <PermissionDenied what="look up gift cards" />;

  const replaceCard = (card: StaffGiftCard) =>
    setCards((list) => {
      const i = list.findIndex((c) => c.id === card.id);
      if (i < 0) return [card, ...list];
      const next = list.slice();
      next[i] = card;
      return next;
    });

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="settings-card" style={{ padding: 16, display: 'grid', gap: 10 }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}
        >
          <div>
            <h2 style={{ margin: 0 }}>Gift cards</h2>
            <p className="settings-muted" style={{ margin: 0 }}>
              Look up a card by code, buyer, or recipient. Totals for bookkeeping are on the Gift
              cards report.
            </p>
          </div>
          {canIssue && !issuing ? (
            <button type="button" className="btn primary" onClick={() => setIssuing(true)}>
              Issue gift card
            </button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              type="button"
              className={status === f.key ? 'btn primary' : 'btn secondary'}
              onClick={() => setStatus(f.key)}
            >
              {f.label}
            </button>
          ))}
          <input
            className="settings-input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Last 4 or full code, name, email"
            style={{ minWidth: 260 }}
          />
        </div>
      </div>

      {issuing ? (
        <IssueGiftCardForm
          onCancel={() => setIssuing(false)}
          onIssued={(card) => {
            setIssuing(false);
            replaceCard(card);
            setSelectedId(card.id);
          }}
        />
      ) : null}

      {selectedId ? (
        <GiftCardDetail
          key={selectedId}
          cardId={selectedId}
          onChanged={replaceCard}
          onClose={() => setSelectedId(null)}
        />
      ) : null}

      {error ? <div className="settings-message settings-error-message">{error}</div> : null}

      <div className="settings-card" style={{ padding: 16, overflowX: 'auto' }}>
        <table className="settings-table" style={{ width: '100%' }}>
          <thead>
            <tr>
              <th>Card</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Balance</th>
              <th style={{ textAlign: 'right' }}>Value</th>
              <th style={{ textAlign: 'right' }}>Paid</th>
              <th>Bought by</th>
              <th>For</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {cards.map((c) => (
              <tr
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                style={{
                  cursor: 'pointer',
                  background: c.id === selectedId ? 'rgba(0,0,0,0.04)' : undefined,
                }}
              >
                <td style={{ fontFamily: 'monospace' }}>••••{c.code.slice(-4)}</td>
                <td>{GIFT_CARD_STATUS_LABELS[c.status]}</td>
                <td style={{ textAlign: 'right' }}>{money(c.balance)}</td>
                <td style={{ textAlign: 'right' }}>{money(c.faceValue)}</td>
                <td style={{ textAlign: 'right' }}>
                  {c.source === 'staff_issued' ? 'Issued' : money(c.amountPaid)}
                </td>
                <td>{c.purchaserName || c.purchaserEmail || '—'}</td>
                <td>{c.recipientName || c.recipientEmail || '—'}</td>
                <td>{when(c.created)}</td>
              </tr>
            ))}
            {!cards.length ? (
              <tr>
                <td colSpan={8} className="settings-muted">
                  {loading ? 'Loading…' : 'No gift cards match.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
