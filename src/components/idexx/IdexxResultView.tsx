import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ExternalLink, FileText, RotateCcw } from 'lucide-react';
import {
  getIdexxResult,
  idexxErrorMessage,
  idexxResultPdfUrl,
  idexxResultViewUrl,
  setIdexxResultReviewed,
  type IdexxResultDetail,
  type IdexxResultTest,
} from '../../api/idexx';
import { idexxTestFlag, type IdexxFlag } from './idexxFlags';
import IdexxClientSummary from './IdexxClientSummary';
import './Idexx.css';

type Props = {
  resultId: number;
  /** Hide "Mark reviewed" (e.g. a read-only view). */
  readOnly?: boolean;
  onReviewedChange?: (reviewed: boolean) => void;
};

type Flag = IdexxFlag;
const testFlag = idexxTestFlag;

function flagText(flag: Flag): string {
  return flag === 'critical' ? 'CRIT' : flag === 'high' ? 'H' : flag === 'low' ? 'L' : '';
}

function when(raw: string | null | undefined): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

export function idexxResultStatusLabel(r: {
  status: string | null;
  statusDetail: string | null;
}): string {
  const status = (r.status || '').toUpperCase();
  const detail = (r.statusDetail || '').toUpperCase();
  if (status === 'COMPLETE') return 'Final';
  if (status === 'CANCELLED') return 'Cancelled';
  if (detail === 'PARTIAL') return 'Partial results';
  if (detail === 'ATLAB') return 'At the lab';
  return 'In process';
}

/** Value against its reference range: the green band is normal. */
function RangeBar({ test, flag }: { test: IdexxResultTest; flag: Flag }) {
  const { low, high, resultNumeric: v } = test;
  if (v == null || low == null || high == null || !(high > low)) return null;
  const pos = Math.min(0.98, Math.max(0.02, 0.2 + (0.6 * (v - low)) / (high - low)));
  return (
    <span className="idexx-range-bar" aria-hidden>
      <span className="idexx-range-bar__normal" />
      <span
        className={`idexx-range-bar__dot${flag === 'critical' ? ' idexx-range-bar__dot--critical' : flag ? ' idexx-range-bar__dot--out' : ''}`}
        style={{ left: `${pos * 100}%` }}
      />
    </span>
  );
}

/**
 * One IDEXX result, readable at a glance: what is off comes first, every value sits on
 * its reference range, and the official PDF and VetConnect PLUS are a click away.
 */
export default function IdexxResultView({ resultId, readOnly, onReviewedChange }: Props) {
  const [result, setResult] = useState<IdexxResultDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);

  useEffect(() => {
    let canceled = false;
    setResult(null);
    setError(null);
    void getIdexxResult(resultId)
      .then((r) => {
        if (!canceled) setResult(r);
      })
      .catch((e) => {
        if (!canceled) setError(idexxErrorMessage(e, 'Could not load this result.'));
      });
    return () => {
      canceled = true;
    };
  }, [resultId]);

  const flagged = useMemo(() => {
    const out: Array<{ test: IdexxResultTest; flag: Exclude<Flag, null> }> = [];
    for (const c of result?.categories ?? []) {
      for (const t of c.tests) {
        const flag = testFlag(t);
        if (flag) out.push({ test: t, flag });
      }
    }
    return out;
  }, [result]);

  async function openPdf() {
    setBusy('pdf');
    setError(null);
    // Open the tab now so the browser doesn't block it as a pop-up.
    const win = window.open('', '_blank');
    try {
      const url = await idexxResultPdfUrl(resultId);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      setError(idexxErrorMessage(e, 'Could not open the IDEXX report.'));
    } finally {
      setBusy(null);
    }
  }

  async function openVetConnect() {
    setBusy('vcp');
    setError(null);
    const win = window.open('', '_blank');
    try {
      const url = await idexxResultViewUrl(resultId);
      if (win) win.location.href = url;
      else window.open(url, '_blank');
    } catch (e) {
      win?.close();
      setError(idexxErrorMessage(e, 'Could not open VetConnect PLUS.'));
    } finally {
      setBusy(null);
    }
  }

  async function setReviewed(reviewed: boolean) {
    if (!result) return;
    setBusy('review');
    setError(null);
    try {
      const saved = await setIdexxResultReviewed(resultId, reviewed);
      setResult({
        ...result,
        reviewedAt: saved.reviewedAt,
        reviewedByEmployeeId: saved.reviewedByEmployeeId,
      });
      onReviewedChange?.(reviewed);
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not save.'));
    } finally {
      setBusy(null);
    }
  }

  if (!result) {
    return error ? (
      <p className="idexx-order__error">{error}</p>
    ) : (
      <p className="idexx-order__note">Loading results…</p>
    );
  }

  const critical = flagged.some((f) => f.flag === 'critical');
  return (
    <div className="idexx-result">
      <div className="idexx-result__head">
        <div>
          <div className="idexx-order__title">{idexxResultStatusLabel(result)}</div>
          <div className="idexx-result__meta">
            {result.specimenCollectionDate ? (
              <span>
                Collected {when(result.specimenCollectionDate).split(',').slice(0, 2).join(',')}
              </span>
            ) : null}
            {result.idexxUpdatedAt ? <span>Updated {when(result.idexxUpdatedAt)}</span> : null}
            {result.accessionId ? <span>Accession {result.accessionId}</span> : null}
            {result.veterinarian ? <span>{result.veterinarian}</span> : null}
            {result.delayed ? <span style={{ color: '#9a3412' }}>IDEXX posted a delay</span> : null}
          </div>
        </div>
        <div className="idexx-result__actions">
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy != null}
            onClick={() => void openPdf()}
          >
            <FileText size={13} aria-hidden /> PDF
          </button>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={busy != null}
            title="Images, trends and IDEXX tools"
            onClick={() => void openVetConnect()}
          >
            <ExternalLink size={13} aria-hidden /> VetConnect PLUS
          </button>
          {readOnly ? null : result.reviewedAt ? (
            <>
              <span className="idexx-result__reviewed">
                <CheckCircle2 size={13} aria-hidden /> Reviewed {when(result.reviewedAt)}
              </span>
              <button
                type="button"
                className="btn secondary btn-sm"
                disabled={busy != null}
                title="Mark as not reviewed"
                onClick={() => void setReviewed(false)}
              >
                <RotateCcw size={13} aria-hidden />
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-sm"
              disabled={busy != null}
              onClick={() => void setReviewed(true)}
            >
              <CheckCircle2 size={13} aria-hidden /> Mark reviewed
            </button>
          )}
        </div>
      </div>

      {error ? <p className="idexx-order__error">{error}</p> : null}

      {flagged.length ? (
        <div className={`idexx-result__flags${critical ? ' idexx-result__flags--critical' : ''}`}>
          <span className="idexx-result__flags-title">
            {critical ? 'Critical' : `${flagged.length} out of range`}
          </span>
          {flagged.map(({ test, flag }, i) => (
            <span
              key={`${test.code ?? test.name}-${i}`}
              className={`idexx-result__flag-pill${flag === 'critical' ? ' idexx-result__flag-pill--critical' : ''}`}
            >
              {test.name} {test.result}
              {test.units ? ` ${test.units}` : ''} {flagText(flag)}
            </span>
          ))}
        </div>
      ) : (result.categories ?? []).length ? (
        <div className="idexx-order__note idexx-order__note--ok">
          Everything is within the reference range.
        </div>
      ) : (
        <div className="idexx-order__note">No values yet.</div>
      )}

      {flagged.length ? (
        <div className="idexx-result__toolbar">
          <span />
          <label className="idexx-result__toggle">
            <input
              type="checkbox"
              checked={onlyFlagged}
              onChange={(e) => setOnlyFlagged(e.target.checked)}
            />
            Only out of range
          </label>
        </div>
      ) : null}

      {(result.categories ?? []).map((c, ci) => {
        const tests = onlyFlagged ? c.tests.filter((t) => testFlag(t)) : c.tests;
        if (!tests.length) return null;
        return (
          <div key={`${c.code ?? c.name}-${ci}`} className="idexx-result__section">
            <div className="idexx-result__section-title">{c.name}</div>
            <table className="idexx-result__table">
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Result</th>
                  <th>Reference</th>
                </tr>
              </thead>
              <tbody>
                {tests.map((t, ti) => {
                  const flag = testFlag(t);
                  return (
                    <tr
                      key={`${t.code ?? t.name}-${ti}`}
                      className={flag ? `idexx-result__row--${flag}` : undefined}
                    >
                      <td>
                        {t.name}
                        {t.notes?.length ? (
                          <div className="idexx-result__note">{t.notes.join('\n')}</div>
                        ) : null}
                      </td>
                      <td className="idexx-result__value">
                        {t.qualifier ? `${t.qualifier} ` : ''}
                        {t.result ?? '—'}
                        {t.units ? <span className="idexx-result__units">{t.units}</span> : null}
                        {flag ? <span className="idexx-result__flag">{flagText(flag)}</span> : null}
                      </td>
                      <td className="idexx-result__range">
                        <RangeBar test={t} flag={flag} />
                        {t.referenceRange ?? ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {c.notes?.length ? (
              <div className="idexx-result__note" style={{ padding: '6px 10px' }}>
                {c.notes.map((n) => [n.title, n.content].filter(Boolean).join(': ')).join('\n')}
              </div>
            ) : null}
          </div>
        );
      })}

      {result.notes?.content ? (
        <div className="idexx-result__notes">
          {result.notes.title ? <strong>{result.notes.title}: </strong> : null}
          {result.notes.content}
        </div>
      ) : null}

      {(result.categories ?? []).length ? (
        <IdexxClientSummary result={result} readOnly={readOnly} onSaved={setResult} />
      ) : null}
    </div>
  );
}
