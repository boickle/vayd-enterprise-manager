import { useEffect, useState } from 'react';
import {
  getIdexxIntegrationSettings,
  idexxErrorMessage,
  saveIdexxStaffPricing,
  type IdexxIntegrationSettings,
  type IdexxStaffPricing,
} from '../../api/idexx';

type Props = {
  onMessage?: (msg: string, kind: 'success' | 'error') => void;
};

/** How the staff price reads in the form: free is a $0 fixed price. */
type Choice = 'off' | 'free' | 'charge' | 'percent' | 'cost_plus';

function choiceOf(p: IdexxStaffPricing): Choice {
  if (!p.enabled) return 'off';
  if (p.mode === 'charge') return (p.charge ?? 0) === 0 ? 'free' : 'charge';
  return p.mode;
}

function pricingOf(choice: Choice, amount: string): IdexxStaffPricing | null {
  const n = Number(amount);
  const valid = amount.trim() !== '' && Number.isFinite(n) && n >= 0;
  switch (choice) {
    case 'off':
      return { enabled: false, mode: 'charge', percent: null, charge: null };
    case 'free':
      return { enabled: true, mode: 'charge', percent: null, charge: 0 };
    case 'charge':
      return valid ? { enabled: true, mode: 'charge', percent: null, charge: n } : null;
    case 'percent':
      return valid && n <= 100
        ? { enabled: true, mode: 'percent', percent: n, charge: null }
        : null;
    case 'cost_plus':
      return valid ? { enabled: true, mode: 'cost_plus', percent: n, charge: null } : null;
  }
}

function amountOf(p: IdexxStaffPricing): string {
  const v = p.mode === 'charge' ? p.charge : p.percent;
  return v == null ? '' : String(v);
}

/** Settings → Finance → Client Discounts: the staff price for labs linked to IDEXX. */
export default function SettingsIdexxStaffPrice({ onMessage }: Props) {
  const [data, setData] = useState<IdexxIntegrationSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [choice, setChoice] = useState<Choice>('off');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getIdexxIntegrationSettings()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setChoice(choiceOf(d.staffPricing));
        setAmount(amountOf(d.staffPricing));
      })
      .catch((e) => {
        if (!cancelled) setError(idexxErrorMessage(e, 'Could not load the IDEXX settings.'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const next = pricingOf(choice, amount);
  const dirty =
    data != null &&
    next != null &&
    JSON.stringify(next) !==
      JSON.stringify(pricingOf(choiceOf(data.staffPricing), amountOf(data.staffPricing)));

  async function save() {
    if (!next) return;
    setSaving(true);
    try {
      const saved = await saveIdexxStaffPricing(next);
      setData((d) => (d ? { ...d, staffPricing: saved } : d));
      onMessage?.('IDEXX staff price saved.', 'success');
    } catch (e) {
      onMessage?.(idexxErrorMessage(e, 'Could not save.'), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="settings-card" style={{ marginTop: 16 }}>
      <h3 className="settings-card-title">Staff price for IDEXX labs</h3>
      {error ? (
        <p className="settings-muted">{error}</p>
      ) : !data ? (
        <p className="settings-muted">Loading…</p>
      ) : (
        <>
          <p className="settings-muted">
            Applies to every lab linked to IDEXX, including ones added later and tests added inside
            IDEXX&rsquo;s order page, for clients whose account status is marked Staff. Staff pay
            whichever is lower: this or their account-status discount. A lab with its own staff
            price keeps it. &ldquo;Exclude percentage discounts&rdquo; on a lab doesn&rsquo;t block
            this.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="settings-input"
              value={choice}
              disabled={saving}
              onChange={(e) => {
                const c = e.target.value as Choice;
                setChoice(c);
                if (c === 'cost_plus' && !amount) setAmount('10');
              }}
              aria-label="Staff price for IDEXX labs"
              style={{ maxWidth: 260 }}
            >
              <option value="off">Off (account-status discount only)</option>
              <option value="free">Free ($0)</option>
              <option value="charge">Fixed price</option>
              <option value="percent">Percent off</option>
              <option value="cost_plus">Cost plus a markup</option>
            </select>
            {choice === 'charge' || choice === 'percent' || choice === 'cost_plus' ? (
              <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                {choice === 'charge' ? <span>$</span> : null}
                <input
                  type="number"
                  min={0}
                  max={choice === 'percent' ? 100 : undefined}
                  step={choice === 'charge' ? 0.01 : 1}
                  className="settings-input"
                  style={{ width: 100 }}
                  value={amount}
                  disabled={saving}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label={choice === 'charge' ? 'Staff price' : 'Percent'}
                />
                {choice === 'percent' ? <span>% off</span> : null}
                {choice === 'cost_plus' ? <span>% over cost</span> : null}
              </label>
            ) : null}
            <button
              type="button"
              className="btn"
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          <p className="settings-muted" style={{ marginTop: 6 }}>
            Lines already on a bill keep their price until they are re-added.
          </p>
        </>
      )}
    </div>
  );
}
