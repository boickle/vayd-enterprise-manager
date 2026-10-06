import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { getPracticeSettings } from '../../api/practiceSettings';
import {
  MAIL_SHIPPING_TYPES_KEY,
  mailOriginForType,
  mailShippingAmountForType,
  mailShippingPaymentForType,
  parseMailShippingTypes,
  type MailShippingType,
} from '../../utils/mailShippingTypes';
import './MailOrderPrompt.css';

export type MailOrderPromptResult = {
  origin: 'office_pickup' | 'staff_mail';
  shippingPaymentStatus: 'paid' | 'awaiting_payment';
  shippingChargeName: string;
  shipping: number;
  type: MailShippingType;
  mailQty: number;
  sendWithoutPayment: boolean;
  payAfterApproval: boolean;
};

type PaymentPlan = 'now' | 'after_approval' | 'without_payment';

const PAYMENT_PLANS: Array<{ id: PaymentPlan; label: string; hint: string }> = [
  {
    id: 'now',
    label: 'Take payment now',
    hint: 'Collect on this invoice as usual — card on file, reader, or a card read out over the phone.',
  },
  {
    id: 'after_approval',
    label: 'Doctor approves first, then collect payment',
    hint: 'Nothing is charged yet. Once the doctor approves, the mail order team texts or emails the owner a pay link before filling.',
  },
  {
    id: 'without_payment',
    label: 'Send without payment',
    hint: 'Pharmacy can fill and ship now. The order stays open until the owner pays. Staff only — not printed on the invoice.',
  },
];

type Props = {
  practiceId: number;
  itemName: string;
  maxQty?: number;
  /** Invoice already paid — there is no payment to arrange. */
  paid?: boolean;
  /** Why the doctor still has to approve (e.g. script not approved yet). */
  approvalNote?: string | null;
  onCancel: () => void;
  onConfirm: (result: MailOrderPromptResult) => void;
};

export default function MailOrderPrompt({
  practiceId,
  itemName,
  maxQty = 1,
  paid = false,
  approvalNote,
  onCancel,
  onConfirm,
}: Props) {
  const qtyCap = Math.max(1, Number(maxQty) || 1);
  const [types, setTypes] = useState<MailShippingType[]>([]);
  const [typeId, setTypeId] = useState('');
  const [mailQty, setMailQty] = useState(String(qtyCap));
  const [plan, setPlan] = useState<PaymentPlan>('now');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    void getPracticeSettings(practiceId)
      .then((settings) => {
        const next = parseMailShippingTypes(settings[MAIL_SHIPPING_TYPES_KEY]);
        setTypes(next);
        setTypeId(next[0]?.id || '');
      })
      .catch(() => {
        setTypes([]);
        setTypeId('');
      })
      .finally(() => setLoading(false));
  }, [practiceId]);

  const selected = types.find((t) => t.id === typeId) ?? types[0] ?? null;
  const amount = selected ? mailShippingAmountForType(selected) : 0;
  const parsedQty = Number(mailQty);
  const qty =
    Number.isFinite(parsedQty) && parsedQty >= 1
      ? Math.min(qtyCap, Math.floor(parsedQty))
      : qtyCap;
  const keepQty = Math.round((qtyCap - qty) * 1000) / 1000;

  return createPortal(
    <div className="mail-order-prompt-backdrop" role="dialog" aria-modal="true">
      <div className="mail-order-prompt">
        <h3>Send to mail queue</h3>
        <p className="mail-order-prompt__item">{itemName}</p>
        {loading ? (
          <p className="mail-order-prompt__hint">Loading shipping types…</p>
        ) : types.length === 0 ? (
          <p className="mail-order-prompt__hint">
            Add shipping types under Settings → Inventory → Mail shipping. Those same types are used here and,
            when marked, on the online store.
          </p>
        ) : (
          <>
            {qtyCap > 1 ? (
              <label>
                Quantity to mail
                <input
                  type="number"
                  min={1}
                  max={qtyCap}
                  step={1}
                  value={mailQty}
                  onChange={(e) => setMailQty(e.target.value)}
                />
                <span className="mail-order-prompt__hint">
                  {keepQty > 0
                    ? `${qty} of ${qtyCap} will go to the mail queue. ${keepQty} stay on this invoice to dispense in person.`
                    : `All ${qtyCap} will go to the mail queue.`}
                </span>
              </label>
            ) : null}
            <label>
              Shipping / pick-up type
              <select value={selected?.id || ''} onChange={(e) => setTypeId(e.target.value)}>
                {types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                    {mailShippingAmountForType(t) > 0
                      ? ` — $${mailShippingAmountForType(t).toFixed(2)}`
                      : ' — $0.00'}
                  </option>
                ))}
              </select>
            </label>
            <p className="mail-order-prompt__hint">
              {selected
                ? `${selected.label} will be added to this invoice${
                    amount > 0 ? ` as $${amount.toFixed(2)}` : ' at $0.00'
                  }.`
                : ''}
            </p>
            {approvalNote ? (
              <p className="mail-order-prompt__notice" role="status">
                {approvalNote}
              </p>
            ) : null}
            {paid ? null : (
              <fieldset className="mail-order-prompt__plans">
                <legend>Payment</legend>
                {PAYMENT_PLANS.map((option) => (
                  <label
                    key={option.id}
                    className={`mail-order-prompt__check${plan === option.id ? ' is-on' : ''}`}
                  >
                    <input
                      type="radio"
                      name="mail-order-payment-plan"
                      checked={plan === option.id}
                      onChange={() => setPlan(option.id)}
                    />
                    <span>
                      {option.label}
                      <span className="mail-order-prompt__hint">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
          </>
        )}
        <div className="mail-order-prompt__actions">
          <button
            type="button"
            className="btn primary"
            disabled={!selected || qty < 1}
            onClick={() => {
              if (!selected) return;
              onConfirm({
                origin: mailOriginForType(selected),
                shippingPaymentStatus: mailShippingPaymentForType(selected, false),
                shippingChargeName: selected.label,
                shipping: mailShippingAmountForType(selected),
                type: selected,
                mailQty: qty,
                sendWithoutPayment: !paid && plan === 'without_payment',
                payAfterApproval: !paid && plan === 'after_approval',
              });
            }}
          >
            Add to mail queue
          </button>
          <button type="button" className="btn secondary" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
