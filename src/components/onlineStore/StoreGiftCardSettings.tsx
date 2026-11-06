import { useEffect, useState } from 'react';
import type { StoreGiftCardSettings, StoreListingGiftCardPatch } from '../../api/onlineStore';

function parseAmounts(text: string): number[] | null {
  const parts = text
    .split(/[,\s]+/)
    .map((p) => p.replace(/^\$/, '').trim())
    .filter(Boolean);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n <= 0)) return null;
  return [...new Set(nums.map((n) => Math.round(n * 100) / 100))].sort((a, b) => a - b);
}

/**
 * Amounts, custom range, and terms for a gift card listing. The sale on the listing (edited
 * above) is the purchase discount: 20% off sells a $100 card for $80.
 */
export default function StoreGiftCardSettingsEditor({
  value,
  disabled,
  onSave,
}: {
  value: StoreGiftCardSettings | null | undefined;
  disabled?: boolean;
  onSave: (patch: StoreListingGiftCardPatch) => Promise<unknown> | void;
}) {
  const current = value ?? { amounts: [], allowCustom: false, min: null, max: null, terms: null };
  const [amounts, setAmounts] = useState(current.amounts.join(', '));
  const [allowCustom, setAllowCustom] = useState(current.allowCustom);
  const [min, setMin] = useState(current.min != null ? String(current.min) : '');
  const [max, setMax] = useState(current.max != null ? String(current.max) : '');
  const [terms, setTerms] = useState(current.terms ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setAmounts(current.amounts.join(', '));
    setAllowCustom(current.allowCustom);
    setMin(current.min != null ? String(current.min) : '');
    setMax(current.max != null ? String(current.max) : '');
    setTerms(current.terms ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value)]);

  const save = async () => {
    const parsed = parseAmounts(amounts);
    if (!parsed) {
      setErr('Amounts must be dollar values separated by commas, e.g. 25, 50, 100.');
      return;
    }
    if (!parsed.length && !allowCustom) {
      setErr('Add at least one amount or allow other amounts.');
      return;
    }
    const minN = min.trim() ? Number(min) : null;
    const maxN = max.trim() ? Number(max) : null;
    if ((minN != null && !(minN > 0)) || (maxN != null && !(maxN > 0))) {
      setErr('Minimum and maximum must be greater than $0.');
      return;
    }
    if (minN != null && maxN != null && minN > maxN) {
      setErr('The minimum must not be more than the maximum.');
      return;
    }
    setErr(null);
    try {
      await onSave({
        giftCardAmounts: parsed,
        giftCardAllowCustom: allowCustom,
        giftCardMin: minN,
        giftCardMax: maxN,
        giftCardTerms: terms.trim() || null,
      });
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save gift card settings');
    }
  };

  return (
    <div className="store-add-workspace__field" style={{ marginTop: 10, display: 'grid', gap: 8 }}>
      <span style={{ fontWeight: 600 }}>Gift card amounts</span>
      <input
        className="settings-input"
        value={amounts}
        disabled={disabled}
        onChange={(e) => setAmounts(e.target.value)}
        placeholder="25, 50, 100, 250"
      />
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={allowCustom}
          disabled={disabled}
          onChange={(e) => setAllowCustom(e.target.checked)}
        />
        <span>Let buyers enter another amount</span>
      </label>
      {allowCustom ? (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="settings-muted">Minimum ($)</span>
            <input
              className="settings-input"
              inputMode="decimal"
              value={min}
              disabled={disabled}
              onChange={(e) => setMin(e.target.value)}
              placeholder="10"
              style={{ width: 110 }}
            />
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            <span className="settings-muted">Maximum ($)</span>
            <input
              className="settings-input"
              inputMode="decimal"
              value={max}
              disabled={disabled}
              onChange={(e) => setMax(e.target.value)}
              placeholder="500"
              style={{ width: 110 }}
            />
          </label>
        </div>
      ) : null}
      <label style={{ display: 'grid', gap: 4 }}>
        <span className="settings-muted">
          Terms shown on the card and email. Leave blank to use the standard terms.
        </span>
        <textarea
          className="settings-input"
          rows={3}
          value={terms}
          disabled={disabled}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="Good toward any Vet At Your Door service or store purchase. No cash value; not refundable except where required by law. Does not expire."
        />
      </label>
      <p className="settings-muted" style={{ margin: 0 }}>
        To sell cards at a discount (for example, pay $80 for $100), set a sale on this listing.
        Membership discounts and coupons never apply to gift cards.
      </p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          className="btn secondary"
          disabled={disabled}
          onClick={() => void save()}
        >
          Save gift card settings
        </button>
        {saved ? <span className="settings-muted">Saved</span> : null}
      </div>
      {err ? (
        <p className="settings-error" style={{ margin: 0, color: '#9b1c1c' }}>
          {err}
        </p>
      ) : null}
    </div>
  );
}
