import { useEffect, useState } from 'react';
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
};

type Props = {
  practiceId: number;
  itemName: string;
  maxQty?: number;
  onCancel: () => void;
  onConfirm: (result: MailOrderPromptResult) => void;
};

export default function MailOrderPrompt({
  practiceId,
  itemName,
  maxQty = 1,
  onCancel,
  onConfirm,
}: Props) {
  const qtyCap = Math.max(1, Number(maxQty) || 1);
  const [types, setTypes] = useState<MailShippingType[]>([]);
  const [typeId, setTypeId] = useState('');
  const [mailQty, setMailQty] = useState(String(qtyCap));
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

  return (
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
    </div>
  );
}
