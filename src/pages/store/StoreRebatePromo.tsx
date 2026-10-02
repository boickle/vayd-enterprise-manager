import { useEffect, useRef, useState } from 'react';
import type { StoreTagalongPreview } from '../../api/onlineStore';
import {
  storeRebatePromoCopy,
  storeRebateSavings,
  type StoreCartTagalong,
} from '../../utils/storeTagalongs';

type Props = {
  rules: StoreTagalongPreview[] | null | undefined;
  extras: StoreCartTagalong[];
};

export default function StoreRebatePromo({ rules, extras }: Props) {
  const copy = storeRebatePromoCopy(rules);
  const savings = storeRebateSavings(extras);
  const [burst, setBurst] = useState<{ key: number; amount: number } | null>(null);
  const prev = useRef(0);

  useEffect(() => {
    if (savings > prev.current + 0.009) {
      setBurst({ key: Date.now(), amount: savings });
    }
    prev.current = savings;
  }, [savings]);

  useEffect(() => {
    if (!burst) return;
    const t = window.setTimeout(() => setBurst(null), 2200);
    return () => window.clearTimeout(t);
  }, [burst]);

  if (!copy) return null;

  return (
    <div className="vayd-store__rebate-promo">
      <p>{copy}</p>
      {burst ? <StoreRebateBurst key={burst.key} amount={burst.amount} /> : null}
    </div>
  );
}

function StoreRebateBurst({ amount }: { amount: number }) {
  const bits = Array.from({ length: 18 }, (_, i) => i);
  return (
    <div className="vayd-store__rebate-burst" aria-live="polite">
      <div className="vayd-store__rebate-burst-pop">You got ${amount.toFixed(0)} off!</div>
      {bits.map((i) => (
        <span
          key={i}
          className="vayd-store__rebate-burst-bit"
          style={{
            ['--bit' as string]: String(i),
            ['--hue' as string]: String((i * 27) % 360),
          }}
        />
      ))}
    </div>
  );
}
