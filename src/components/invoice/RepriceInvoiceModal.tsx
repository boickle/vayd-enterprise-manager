import { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import {
  applyInvoiceReprice,
  previewInvoiceReprice,
  type RepricePreview,
  type RepriceRow,
  type VisitInvoice,
} from '../../api/visitWorkflow';
import './RepriceInvoiceModal.css';

type Props = {
  invoiceId: string;
  /** Pet names by id, for bills with more than one pet. */
  petNames?: Map<number, string> | Record<number, string>;
  onClose: () => void;
  onApplied: (invoice: VisitInvoice) => void;
};

const money = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);

function errorText(e: unknown): string {
  const data = (e as { response?: { data?: { message?: unknown } } })?.response?.data;
  const msg = Array.isArray(data?.message) ? data?.message.join(' ') : data?.message;
  return typeof msg === 'string' && msg.trim()
    ? msg
    : e instanceof Error
      ? e.message
      : 'Something went wrong.';
}

/** What the bill comes to with the ticked rows repriced. Exported for tests. */
export function repricedTotal(preview: RepricePreview, ticked: Set<string>): number {
  const delta = preview.rows
    .filter((r) => ticked.has(r.lineId))
    .reduce((sum, r) => sum + r.next.amount + r.next.tax - r.current.amount - r.current.tax, 0);
  return Math.round((preview.total + delta) * 100) / 100;
}

/**
 * Reprice an open bill (owner decisions, Oct 30, 2026): every line at today's membership and
 * discount pricing — a membership started mid-visit, a new client discount. Lines priced by
 * hand are kept. Drops come ticked, raises unticked. Can't take the bill below what's paid.
 */
export default function RepriceInvoiceModal({ invoiceId, petNames, onClose, onApplied }: Props) {
  const [preview, setPreview] = useState<RepricePreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    previewInvoiceReprice(invoiceId)
      .then((p) => {
        if (!live) return;
        setPreview(p);
        setTicked(new Set(p.rows.filter((r) => r.selected).map((r) => r.lineId)));
      })
      .catch((e) => live && setLoadError(errorText(e)));
    return () => {
      live = false;
    };
  }, [invoiceId]);

  const changed = useMemo(
    () => (preview?.rows ?? []).filter((r) => r.change === 'lower' || r.change === 'higher'),
    [preview]
  );
  const kept = useMemo(() => (preview?.rows ?? []).filter((r) => r.change === 'kept'), [preview]);
  const sameCount = (preview?.rows ?? []).filter((r) => r.change === 'same').length;
  const newTotal = preview ? repricedTotal(preview, ticked) : 0;
  const belowPaid = preview != null && newTotal + 0.009 < preview.amountPaid;

  const petCount = new Set((preview?.rows ?? []).map((r) => r.patientId)).size;
  const petName = (id: number | null) => {
    if (id == null || petCount < 2 || !petNames) return null;
    return petNames instanceof Map ? petNames.get(id) : petNames[id];
  };

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function apply() {
    if (!ticked.size || saving || belowPaid) return;
    setSaving(true);
    setError(null);
    try {
      onApplied(await applyInvoiceReprice(invoiceId, [...ticked]));
    } catch (e) {
      setError(errorText(e));
      setSaving(false);
    }
  }

  const row = (r: RepriceRow, selectable: boolean) => {
    const pet = petName(r.patientId);
    return (
      <li key={r.lineId}>
        <label className={`rpm-row${ticked.has(r.lineId) ? ' is-on' : ''}${selectable ? '' : ' is-kept'}`}>
          {selectable ? (
            <input
              type="checkbox"
              checked={ticked.has(r.lineId)}
              onChange={() => toggle(r.lineId)}
              disabled={saving}
            />
          ) : (
            <span className="rpm-row__spacer" aria-hidden />
          )}
          <span className="rpm-row__body">
            <span className="rpm-row__name">
              {r.description}
              {r.qty !== 1 ? ` × ${r.qty}` : ''}
              {pet ? <span className="rpm-row__pet"> · {pet}</span> : null}
            </span>
            <span className="rpm-row__reason">{r.reason}</span>
          </span>
          <span className="rpm-row__price">
            {r.change === 'kept' ? (
              r.current.label
            ) : (
              <>
                <s>{r.current.label}</s>
                <span className={r.change === 'higher' ? 'rpm-up' : 'rpm-down'}>{r.next.label}</span>
              </>
            )}
          </span>
        </label>
      </li>
    );
  };

  return (
    <div className="rpm-backdrop" role="presentation" onClick={saving ? undefined : onClose}>
      <div
        className="rpm-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="rpm-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="rpm-modal__head">
          <div>
            <h2 id="rpm-title" className="rpm-modal__title">
              Reprice this bill
            </h2>
            <p className="rpm-modal__hint">
              Today's membership and discount prices for each line. Price drops are ticked; raises
              aren't, so tick them if you mean to.
            </p>
          </div>
          <button type="button" className="rpm-icon-btn" aria-label="Close" onClick={onClose} disabled={saving}>
            <X size={18} aria-hidden />
          </button>
        </header>

        <div className="rpm-body">
          {loadError ? (
            <p role="alert" className="rpm-error">
              {loadError}
            </p>
          ) : !preview ? (
            <p className="rpm-muted">Checking prices…</p>
          ) : (
            <>
              {changed.length ? (
                <ul className="rpm-list">{changed.map((r) => row(r, true))}</ul>
              ) : (
                <p className="rpm-muted">Every line is already at today's price.</p>
              )}
              {kept.length ? (
                <>
                  <p className="rpm-section">Priced by hand — kept</p>
                  <ul className="rpm-list">{kept.map((r) => row(r, false))}</ul>
                </>
              ) : null}
              {sameCount ? (
                <p className="rpm-muted">
                  {sameCount} other line{sameCount === 1 ? ' is' : 's are'} already at today's price.
                </p>
              ) : null}
            </>
          )}
        </div>

        {preview && changed.length ? (
          <div className="rpm-totals">
            <span>
              Bill {money(preview.total)} → <strong>{money(newTotal)}</strong>
            </span>
            {preview.amountPaid > 0.009 ? <span className="rpm-muted">{money(preview.amountPaid)} paid</span> : null}
          </div>
        ) : null}
        {belowPaid ? (
          <p role="alert" className="rpm-error rpm-pad">
            That would take the bill below the {money(preview!.amountPaid)} already paid. Use “Owner
            paid — refund visit” on the membership to refund the difference.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rpm-error rpm-pad">
            {error}
          </p>
        ) : null}

        <footer className="rpm-modal__foot">
          <button type="button" className="rpm-btn rpm-btn--ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="button"
            className="rpm-btn rpm-btn--primary"
            disabled={!ticked.size || saving || belowPaid}
            onClick={() => void apply()}
          >
            {saving
              ? 'Repricing…'
              : `Reprice ${ticked.size} line${ticked.size === 1 ? '' : 's'}`}
          </button>
        </footer>
      </div>
    </div>
  );
}
