import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  Check,
  CircleDollarSign,
  Loader2,
  Mail,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  executePostVisitSignup,
  listBundles,
  previewPostVisitSignup,
  type Bundle,
  type MembershipBillingInterval,
  type PostVisitSignupPreview,
  type PostVisitSignupResult,
} from '../../api/memberships';
import { apiErrorMessage } from '../../api/http';
import './PostVisitMembershipSignup.css';

type Props = {
  visitInvoiceId: string;
  /** Shown in the heading so staff know whose bill they are rewriting. */
  patientName?: string | null;
  onClose: () => void;
  /** Fires after a successful run so the checkout panel can refetch the invoice. */
  onCompleted: (result: PostVisitSignupResult) => void;
};

function money(n: number | null | undefined): string {
  const value = Number(n) || 0;
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`;
}

function describeAge(hours: number | null): string | null {
  if (hours == null || !Number.isFinite(hours)) return null;
  if (hours < 1) return 'less than an hour ago';
  if (hours < 24) return `${Math.round(hours)} hours ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * The one-button version of the manual post-visit signup: re-prices the visit
 * against the chosen plan, refunds the overpayment, credits the services the
 * patient already received, and emails the client.
 *
 * Preview always runs before execute so staff see the refund before money moves.
 */
export default function PostVisitMembershipSignup({
  visitInvoiceId,
  patientName,
  onClose,
  onCompleted,
}: Props) {
  const [plans, setPlans] = useState<Bundle[]>([]);
  const [plansLoading, setPlansLoading] = useState(true);
  const [packageId, setPackageId] = useState<number | null>(null);
  const [billingInterval, setBillingInterval] =
    useState<MembershipBillingInterval>('monthly');
  const [preview, setPreview] = useState<PostVisitSignupPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [running, setRunning] = useState(false);
  const [skipRefund, setSkipRefund] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PostVisitSignupResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPlansLoading(true);
    listBundles({ kind: 'membership' })
      .then((rows) => {
        if (cancelled) return;
        const sellable = rows.filter((r) => !r.isArchived && r.isActive);
        setPlans(sellable);
        if (sellable.length === 1) setPackageId(sellable[0].id);
      })
      .catch((e) => {
        if (!cancelled) setError(apiErrorMessage(e));
      })
      .finally(() => {
        if (!cancelled) setPlansLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Any change to the plan invalidates the numbers on screen; never let a stale
  // preview sit next to a different plan.
  useEffect(() => {
    setPreview(null);
  }, [packageId, billingInterval]);

  const runPreview = useCallback(async () => {
    if (!packageId) return;
    setPreviewing(true);
    setError(null);
    try {
      setPreview(
        await previewPostVisitSignup({ visitInvoiceId, packageId, billingInterval }),
      );
    } catch (e) {
      setPreview(null);
      setError(apiErrorMessage(e));
    } finally {
      setPreviewing(false);
    }
  }, [billingInterval, packageId, visitInvoiceId]);

  const runExecute = useCallback(async () => {
    if (!packageId || !preview) return;
    setRunning(true);
    setError(null);
    try {
      const res = await executePostVisitSignup({
        visitInvoiceId,
        packageId,
        billingInterval,
        confirmRefundAmount: preview.refundDue,
        skipRefund,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      setResult(res);
      onCompleted(res);
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [
    billingInterval,
    note,
    onCompleted,
    packageId,
    preview,
    skipRefund,
    visitInvoiceId,
  ]);

  const selectedPlan = useMemo(
    () => plans.find((p) => p.id === packageId) ?? null,
    [packageId, plans],
  );

  const covered = preview?.lines.filter((l) => l.coveredByMembership) ?? [];
  const notCovered = preview?.lines.filter((l) => !l.coveredByMembership) ?? [];
  const visitAge = describeAge(preview?.invoice.visitAgeHours ?? null);

  return createPortal(
    <div className="pvms-backdrop" role="dialog" aria-modal="true" aria-label="Post-visit membership signup">
      <div className="pvms-modal">
        <header className="pvms-head">
          <div>
            <h2 className="pvms-title">
              <ShieldCheck size={18} aria-hidden="true" />
              Post-visit membership signup
            </h2>
            <p className="pvms-sub">
              {patientName
                ? `Enrol ${patientName}, re-price this visit, and refund the difference.`
                : 'Enrol this pet, re-price the visit, and refund the difference.'}
            </p>
          </div>
          <button type="button" className="pvms-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </header>

        <div className="pvms-body">
          {error && (
            <div className="pvms-alert pvms-alert--error">
              <AlertTriangle size={15} aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}

          {result ? (
            <SignupReceipt result={result} />
          ) : (
            <>
              <section className="pvms-section">
                <h3 className="pvms-section__title">1. Choose the plan</h3>
                {plansLoading ? (
                  <p className="pvms-muted">Loading plans…</p>
                ) : plans.length === 0 ? (
                  <p className="pvms-muted">
                    No active membership plans yet. Add one under Settings → Memberships.
                  </p>
                ) : (
                  <div className="pvms-plans">
                    {plans.map((plan) => {
                      const price =
                        billingInterval === 'annual' ? plan.priceAnnual : plan.priceMonthly;
                      return (
                        <button
                          key={plan.id}
                          type="button"
                          className={`pvms-plan${packageId === plan.id ? ' is-selected' : ''}`}
                          onClick={() => setPackageId(plan.id)}
                          disabled={running}
                        >
                          <span className="pvms-plan__name">{plan.name}</span>
                          {plan.tier && <span className="pvms-plan__tier">{plan.tier}</span>}
                          <span className="pvms-plan__price">
                            {price == null ? 'No price set' : `${money(price)} / ${billingInterval === 'annual' ? 'yr' : 'mo'}`}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                <div className="pvms-interval" role="radiogroup" aria-label="Billing interval">
                  {(['monthly', 'annual'] as MembershipBillingInterval[]).map((iv) => (
                    <button
                      key={iv}
                      type="button"
                      role="radio"
                      aria-checked={billingInterval === iv}
                      className={`pvms-interval__btn${billingInterval === iv ? ' is-active' : ''}`}
                      onClick={() => setBillingInterval(iv)}
                      disabled={running}
                    >
                      {iv === 'monthly' ? 'Monthly' : 'Annual'}
                    </button>
                  ))}
                </div>
              </section>

              <section className="pvms-section">
                <h3 className="pvms-section__title">2. Check the numbers</h3>
                <button
                  type="button"
                  className="btn secondary pvms-preview-btn"
                  onClick={runPreview}
                  disabled={!packageId || previewing || running}
                >
                  {previewing ? (
                    <>
                      <Loader2 size={14} className="pvms-spin" aria-hidden="true" /> Working it out…
                    </>
                  ) : (
                    <>
                      <CircleDollarSign size={14} aria-hidden="true" />
                      {preview ? 'Recalculate' : 'Calculate refund'}
                    </>
                  )}
                </button>

                {preview && (
                  <>
                    {preview.warnings.length > 0 && (
                      <div className="pvms-alert pvms-alert--warn">
                        <AlertTriangle size={15} aria-hidden="true" />
                        <ul className="pvms-warnlist">
                          {preview.warnings.map((w) => (
                            <li key={w}>{w}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {visitAge && (
                      <p className="pvms-muted pvms-agenote">This visit was billed {visitAge}.</p>
                    )}

                    <div className="pvms-totals">
                      <Total label="Paid at the visit" value={money(preview.amountAlreadyPaid)} />
                      <Total label="Covered by membership" value={money(preview.membershipAdjustments)} tone="good" />
                      <Total label="New total owed" value={money(preview.newTotal)} />
                      <Total
                        label={preview.balanceDue > 0 ? 'Still owed' : 'Refund to client'}
                        value={money(preview.balanceDue > 0 ? preview.balanceDue : preview.refundDue)}
                        tone={preview.balanceDue > 0 ? 'warn' : 'accent'}
                        emphasis
                      />
                    </div>

                    <LineTable title={`Covered by ${selectedPlan?.name ?? 'the plan'}`} lines={covered} empty="Nothing on this bill is covered by that plan." />
                    <LineTable title="Not covered — the client still pays" lines={notCovered} empty="Everything on this bill is covered." />

                    <label className="pvms-check">
                      <input
                        type="checkbox"
                        checked={skipRefund}
                        onChange={(e) => setSkipRefund(e.target.checked)}
                        disabled={running}
                      />
                      <span>
                        Don’t issue the refund automatically
                        <em className="pvms-check__hint">
                          The membership is still created and the visit is still re-priced — only the
                          money stays put. Use this if you’ll refund by hand.
                        </em>
                      </span>
                    </label>

                    <label className="pvms-field">
                      <span className="pvms-field__label">Note for the record (optional)</span>
                      <input
                        type="text"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. signed up at the door"
                        disabled={running}
                      />
                    </label>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <footer className="pvms-foot">
          {result ? (
            <button type="button" className="btn primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button type="button" className="btn secondary" onClick={onClose} disabled={running}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={runExecute}
                disabled={!preview || running || previewing}
                title={preview ? undefined : 'Calculate the refund first'}
              >
                {running ? (
                  <>
                    <Loader2 size={14} className="pvms-spin" aria-hidden="true" /> Signing them up…
                  </>
                ) : skipRefund ? (
                  'Sign up & re-price (no refund)'
                ) : (
                  `Sign up & refund ${money(preview?.refundDue ?? 0)}`
                )}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Total({
  label,
  value,
  tone,
  emphasis,
}: {
  label: string;
  value: string;
  tone?: 'good' | 'warn' | 'accent';
  emphasis?: boolean;
}) {
  return (
    <div className={`pvms-total${emphasis ? ' pvms-total--lead' : ''}${tone ? ` pvms-total--${tone}` : ''}`}>
      <span className="pvms-total__label">{label}</span>
      <span className="pvms-total__value">{value}</span>
    </div>
  );
}

function LineTable({
  title,
  lines,
  empty,
}: {
  title: string;
  lines: PostVisitSignupPreview['lines'];
  empty: string;
}) {
  return (
    <div className="pvms-lines">
      <h4 className="pvms-lines__title">{title}</h4>
      {lines.length === 0 ? (
        <p className="pvms-muted">{empty}</p>
      ) : (
        <table className="pvms-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="pvms-num">Was</th>
              <th className="pvms-num">Now</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.visitInvoiceLineId}>
                <td>
                  {line.description}
                  {line.qty > 1 && <span className="pvms-qty"> ×{line.qty}</span>}
                </td>
                <td className="pvms-num">{money(line.currentAmount)}</td>
                <td className="pvms-num">{money(line.newAmount)}</td>
                <td className="pvms-why">{line.coverageReason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SignupReceipt({ result }: { result: PostVisitSignupResult }) {
  const refundLine =
    result.refundStatus === 'issued'
      ? `Refunded ${money(result.refundAmount)}${result.refundReference ? ` (${result.refundReference})` : ''}.`
      : result.refundStatus === 'not_needed'
        ? 'No refund was due.'
        : result.refundStatus === 'skipped'
          ? `Refund of ${money(result.refundAmount)} was not issued — refund this by hand.`
          : `Refund of ${money(result.refundAmount)} FAILED. Refund this by hand.`;

  return (
    <div className="pvms-receipt">
      <div className="pvms-alert pvms-alert--ok">
        <Check size={15} aria-hidden="true" />
        <span>
          Enrolled in <strong>{result.planName}</strong>.
        </span>
      </div>

      <div className={`pvms-alert ${result.refundStatus === 'failed' ? 'pvms-alert--error' : 'pvms-alert--ok'}`}>
        <CircleDollarSign size={15} aria-hidden="true" />
        <span>{refundLine}</span>
      </div>
      {result.refundError && <p className="pvms-muted">{result.refundError}</p>}

      <div className={`pvms-alert ${result.emailSent ? 'pvms-alert--ok' : 'pvms-alert--warn'}`}>
        <Mail size={15} aria-hidden="true" />
        <span>
          {result.emailSent
            ? 'The client has been emailed a breakdown.'
            : 'The client email did not send — let them know manually.'}
        </span>
      </div>

      <div className="pvms-totals">
        <Total label="New total" value={money(result.invoice.total)} />
        <Total label="Paid" value={money(result.invoice.amountPaid)} />
        <Total label="Balance" value={money(result.invoice.balanceDue)} emphasis />
      </div>

      {result.benefitsCredited.length > 0 && (
        <p className="pvms-muted">
          {result.benefitsCredited.length} service
          {result.benefitsCredited.length === 1 ? '' : 's'} from this visit
          {result.benefitsCredited.length === 1 ? ' was' : ' were'} credited against the new plan, so
          they cannot be claimed twice.
        </p>
      )}

      {result.warnings.length > 0 && (
        <div className="pvms-alert pvms-alert--warn">
          <AlertTriangle size={15} aria-hidden="true" />
          <ul className="pvms-warnlist">
            {result.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
