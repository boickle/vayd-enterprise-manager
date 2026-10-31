import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, ExternalLink, FileText, RefreshCw, X } from 'lucide-react';
import {
  assignIdexxResultPatient,
  cancelIdexxOrder,
  idexxErrorMessage,
  listIdexxOrdersAwaitingLab,
  listIdexxResults,
  syncIdexxOrder,
  syncIdexxResults,
  type IdexxAwaitingLabOrder,
  type IdexxResultSummary,
} from '../api/idexx';
import { fetchPrimaryProviders, type Provider } from '../api/employee';
import { searchPatientsStaff, type PatientSearchRow } from '../api/patients';
import IdexxChip from '../components/idexx/IdexxChip';
import IdexxOrderFrame from '../components/idexx/IdexxOrderFrame';
import IdexxResultView, { idexxResultStatusLabel } from '../components/idexx/IdexxResultView';
import '../components/idexx/Idexx.css';
import './PendingLabsPage.css';
import { appConfirm } from '../utils/appDialog';

type Tab = 'review' | 'ordered' | 'waiting' | 'unmatched' | 'recent';

const TABS: Array<{ id: Tab; label: string; empty: string }> = [
  { id: 'review', label: 'To review', empty: 'No complete results are waiting for review.' },
  {
    id: 'ordered',
    label: 'Ordered, not at IDEXX yet',
    empty: 'Every order sent from Scout has reached IDEXX.',
  },
  { id: 'waiting', label: 'In progress at IDEXX', empty: 'Nothing is at the lab right now.' },
  { id: 'unmatched', label: 'Unmatched', empty: 'Every result is matched to a pet.' },
  { id: 'recent', label: 'All recent', empty: 'No IDEXX results yet.' },
];

function query(tab: Tab, providerEmployeeId?: number) {
  const provider = providerEmployeeId ? { providerEmployeeId } : {};
  if (tab === 'review') return { unreviewed: true, incomplete: false, limit: 200, ...provider };
  if (tab === 'waiting') return { incomplete: true, limit: 200, ...provider };
  if (tab === 'unmatched') return { unmatched: true, limit: 200, ...provider };
  return { limit: 100, ...provider };
}

function when(raw: string | null): string {
  if (!raw) return '';
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function petLabel(r: PatientSearchRow): string {
  const name = String(r.name ?? r.firstName ?? `Pet #${r.id}`);
  const owner = [r.clientFirstName, r.clientLastName, r.ownerName].find(
    (v) => typeof v === 'string' && v.trim()
  );
  return owner ? `${name} (${String(owner)})` : name;
}

/** Match a result IDEXX could not tie to a pet (ordered on the VetConnect PLUS site, a paper form…). */
function MatchPet({ result, onMatched }: { result: IdexxResultSummary; onMatched: () => void }) {
  const [term, setTerm] = useState(
    [result.patientName, result.clientLastName].filter(Boolean).join(' ')
  );
  const [rows, setRows] = useState<PatientSearchRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError(null);
    try {
      setRows((await searchPatientsStaff(term)).slice(0, 8));
    } catch (e) {
      setError(idexxErrorMessage(e, 'Search failed.'));
    } finally {
      setBusy(false);
    }
  }

  async function pick(row: PatientSearchRow) {
    setBusy(true);
    setError(null);
    try {
      await assignIdexxResultPatient(result.id, Number(row.id));
      onMatched();
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not match the result.'));
      setBusy(false);
    }
  }

  return (
    <div className="idexx-order" style={{ marginBottom: 8 }}>
      <div className="idexx-order__title">Which pet is this?</div>
      <p className="idexx-order__note">
        IDEXX sent it as {result.patientName || 'an unnamed pet'}
        {result.clientLastName ? ` (${result.clientLastName})` : ''}. It was likely ordered outside
        Scout, so check whether the test is on the pet&rsquo;s bill.
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="settings-input"
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void search();
          }}
          placeholder="Pet or owner name"
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy || !term.trim()}
          onClick={() => void search()}
        >
          Search
        </button>
      </div>
      {error ? <p className="idexx-order__error">{error}</p> : null}
      {rows.map((r) => (
        <button
          key={String(r.id)}
          type="button"
          className="idexx-order__result-row"
          disabled={busy}
          onClick={() => void pick(r)}
        >
          <span className="idexx-order__result-name">{petLabel(r)}</span>
          <span className="idexx-order__meta">Match</span>
        </button>
      ))}
    </div>
  );
}

function daysSince(raw: string | null): string {
  if (!raw) return '';
  const days = Math.floor((Date.now() - new Date(raw).getTime()) / 86_400_000);
  return Number.isNaN(days)
    ? ''
    : days <= 0
      ? 'today'
      : days === 1
        ? '1 day ago'
        : `${days} days ago`;
}

/**
 * Orders sent from Scout that IDEXX has no result for yet: never finished in VetConnect
 * PLUS, or submitted but the specimen hasn't been received at the lab.
 */
function OrderedList({
  refreshKey,
  providerId,
  providerName,
}: {
  refreshKey: number;
  providerId: number | '';
  providerName: (employeeId: number | null) => string | null;
}) {
  const [rows, setRows] = useState<IdexxAwaitingLabOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [framed, setFramed] = useState<IdexxAwaitingLabOrder | null>(null);
  const [cancelling, setCancelling] = useState<number | null>(null);

  async function cancel(o: IdexxAwaitingLabOrder) {
    const ok = await appConfirm({
      title: 'Cancel this IDEXX order?',
      message: `Cancels order #${o.idexxOrderId} for ${o.patientName || 'this pet'} with IDEXX${
        o.onBill ? '. Its charge stays on the bill; remove it there if it shouldn’t be billed' : ''
      }. If IDEXX already has the sample, call IDEXX instead.`,
      confirmLabel: 'Cancel order',
      cancelLabel: 'Keep',
    });
    if (!ok) return;
    setCancelling(o.id);
    setError(null);
    try {
      await cancelIdexxOrder(o.id);
      await load();
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not cancel the order.'));
    } finally {
      setCancelling(null);
    }
  }

  const load = useCallback(async () => {
    try {
      // Not-finished orders first: someone still has to act on those.
      const items = await listIdexxOrdersAwaitingLab();
      setRows(
        [...items].sort(
          (a, b) =>
            Number(b.status === 'CREATED') - Number(a.status === 'CREATED') ||
            String(a.submittedAt ?? a.created).localeCompare(String(b.submittedAt ?? b.created))
        )
      );
      setError(null);
    } catch (e) {
      setError(idexxErrorMessage(e, 'Could not load IDEXX orders.'));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  if (loading) return <p className="idexx-order__note">Loading…</p>;
  const visible = rows.filter(
    (o) => providerId === '' || o.veterinarianEmployeeId === providerId
  );
  return (
    <>
      {error ? (
        <p className="idexx-order__error" role="alert">
          {error}
        </p>
      ) : null}
      {!visible.length ? (
        <p className="pending-labs__empty">
          {providerId !== '' && rows.length
            ? 'No IDEXX orders for this provider.'
            : TABS.find((t) => t.id === 'ordered')!.empty}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {visible.map((o) => {
            const provider = providerName(o.veterinarianEmployeeId);
            const notFinished = o.status === 'CREATED';
            return (
              <div key={o.id} className="idexx-order__result-row" style={{ cursor: 'default' }}>
                <span className="idexx-order__result-name">
                  <Link
                    to={`/schedule/patients?patientId=${o.patientId}`}
                    className="idexx-result-list__patient"
                    title={`Open ${o.patientName || 'this pet'}'s chart`}
                  >
                    {o.patientName || `Pet #${o.patientId}`}
                  </Link>
                  {provider ? ` · ${provider}` : ''}
                  {o.clientLastName ? ` · ${o.clientLastName}` : ''}
                  {o.testNames.length ? ` · ${o.testNames.join(', ')}` : ''}
                </span>
                <IdexxChip order={o} />
                {o.onBill ? null : (
                  <span
                    className="idexx-order__note--warn"
                    title="Its charge was removed from the bill. Cancel the order unless the test is still wanted."
                  >
                    Not on a bill
                  </span>
                )}
                <span className="idexx-order__meta">
                  #{o.idexxOrderId} ·{' '}
                  {notFinished
                    ? `started ${when(o.created)}`
                    : `submitted ${when(o.submittedAt)} (${daysSince(o.submittedAt)})`}
                </span>
                {notFinished ? (
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setFramed(o)}
                    title="Answer IDEXX's questions and click Order"
                  >
                    <ExternalLink size={13} aria-hidden /> Finish in IDEXX
                  </button>
                ) : o.pdfUrl ? (
                  <button
                    type="button"
                    className="btn secondary btn-sm"
                    onClick={() => window.open(o.pdfUrl!, '_blank', 'noopener')}
                  >
                    <FileText size={13} aria-hidden /> Requisition
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn secondary btn-sm"
                  disabled={cancelling === o.id}
                  onClick={() => void cancel(o)}
                >
                  <X size={13} aria-hidden /> {cancelling === o.id ? 'Cancelling…' : 'Cancel order'}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {framed ? (
        <IdexxOrderFrame
          order={framed}
          patientName={framed.patientName || 'this pet'}
          onClose={() => {
            setFramed(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

/** Practice-wide IDEXX send-out results: what needs a doctor's eyes, what's still at the lab, what needs a pet. */
export default function IdexxResultsPage() {
  const [tab, setTab] = useState<Tab>('review');
  const [rows, setRows] = useState<IdexxResultSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [orderedKey, setOrderedKey] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [partialIds, setPartialIds] = useState<ReadonlySet<number>>(() => new Set());
  const [providers, setProviders] = useState<Provider[]>([]);
  const [providerId, setProviderId] = useState<number | ''>('');
  const loadGen = useRef(0);

  useEffect(() => {
    void fetchPrimaryProviders()
      .then((rows) =>
        setProviders(
          [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
        )
      )
      .catch(() => setProviders([]));
  }, []);

  const providerName = useCallback(
    (employeeId: number | null) => {
      if (employeeId == null) return null;
      return providers.find((p) => Number(p.id) === employeeId)?.name ?? null;
    },
    [providers]
  );

  const loadReviewCount = useCallback(async () => {
    try {
      const res = await listIdexxResults({
        unreviewed: true,
        incomplete: false,
        limit: 1,
        ...(providerId === '' ? {} : { providerEmployeeId: providerId }),
      });
      setReviewCount(res.total ?? res.items?.length ?? 0);
    } catch {
      /* The tab still works; the count catches up on the next refresh. */
    }
  }, [providerId]);

  const load = useCallback(async () => {
    const gen = ++loadGen.current;
    if (tab !== 'review') void loadReviewCount();
    if (tab === 'ordered') {
      setOrderedKey((k) => k + 1);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listIdexxResults(
        query(tab, providerId === '' ? undefined : providerId)
      );
      if (gen !== loadGen.current) return;
      // Critical first, then abnormal, newest first within each.
      const rank = (r: IdexxResultSummary) => (r.hasCritical ? 0 : r.hasOutOfRange ? 1 : 2);
      setRows(
        [...(res.items ?? [])].sort(
          (a, b) =>
            (tab === 'review' ? rank(a) - rank(b) : 0) ||
            String(b.receivedAt ?? '').localeCompare(String(a.receivedAt ?? ''))
        )
      );
      setError(null);
      if (tab === 'review') setReviewCount(res.total ?? res.items?.length ?? 0);
    } catch (e) {
      if (gen !== loadGen.current) return;
      setError(idexxErrorMessage(e, 'Could not load IDEXX results.'));
      setRows([]);
    } finally {
      if (gen === loadGen.current) setLoading(false);
    }
  }, [tab, providerId, loadReviewCount]);

  useEffect(() => {
    void load();
  }, [load]);

  // Results arrive on their own every 5 minutes; keep the list current while it's open.
  useEffect(() => {
    const t = window.setInterval(() => void load(), 120_000);
    return () => window.clearInterval(t);
  }, [load]);

  async function checkNow() {
    setChecking(true);
    try {
      await syncIdexxResults();
      if (tab === 'ordered') {
        // Orders not finished in IDEXX only change status when each is re-read.
        const open = (await listIdexxOrdersAwaitingLab()).filter((o) => o.status === 'CREATED');
        await Promise.all(open.map((o) => syncIdexxOrder(o.id).catch(() => undefined)));
      }
      await load();
    } catch (e) {
      setError(idexxErrorMessage(e, 'IDEXX is unavailable. Try again in a minute.'));
    } finally {
      setChecking(false);
    }
  }

  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div className="pending-labs">
      <header className="pending-labs__head">
        <div className="pending-labs__tabs" role="tablist" aria-label="IDEXX results filter">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'is-active' : undefined}
              onClick={() => {
                setTab(t.id);
                setOpenId(null);
              }}
            >
              {t.label}
              {t.id === 'review' && reviewCount > 0 ? (
                <span className="pending-labs__count">{reviewCount > 99 ? '99+' : reviewCount}</span>
              ) : null}
            </button>
          ))}
        </div>
        <div className="pending-labs__tools">
          <span className="pending-labs__provider-wrap">
            <select
              className="pending-labs__provider"
              aria-label="Provider"
              value={providerId}
              onChange={(e) => {
                setProviderId(e.target.value ? Number(e.target.value) : '');
                setOpenId(null);
              }}
            >
              <option value="">All providers</option>
              {providers.map((p) => (
                <option key={String(p.id)} value={Number(p.id)}>
                  {p.name}
                </option>
              ))}
            </select>
          </span>
          <button
            type="button"
            className="btn secondary btn-sm"
            disabled={checking}
            onClick={() => void checkNow()}
          >
            <RefreshCw size={13} aria-hidden /> {checking ? 'Checking…' : 'Check IDEXX now'}
          </button>
        </div>
      </header>

      {error ? (
        <p className="idexx-order__error" role="alert">
          {error}
        </p>
      ) : null}

      {tab === 'ordered' ? (
        <OrderedList
          refreshKey={orderedKey}
          providerId={providerId}
          providerName={providerName}
        />
      ) : loading ? (
        <p className="idexx-order__note">Loading…</p>
      ) : !rows.length ? (
        <p className="pending-labs__empty">
          {providerId !== '' ? 'No IDEXX results for this provider.' : current.empty}
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 6 }}>
          {rows.map((r) => {
            const open = openId === r.id;
            const pet = r.patientName || 'Unnamed';
            const shown = partialIds.has(r.id) ? { ...r, hasPending: true } : r;
            return (
              <div key={r.id}>
                <div className="idexx-result-list__row">
                  <button
                    type="button"
                    className="idexx-result-list__chevron"
                    aria-expanded={open}
                    aria-label={open ? `Collapse ${pet}` : `Expand ${pet}`}
                    onClick={() => setOpenId(open ? null : r.id)}
                  >
                    {open ? (
                      <ChevronDown size={14} aria-hidden />
                    ) : (
                      <ChevronRight size={14} aria-hidden />
                    )}
                  </button>
                  {open && r.patientId ? (
                    <Link
                      to={`/schedule/patients?patientId=${r.patientId}`}
                      className="idexx-result-list__patient"
                      title={`Open ${pet}'s chart`}
                    >
                      {pet}
                    </Link>
                  ) : (
                    <button
                      type="button"
                      className="idexx-result-list__name"
                      aria-expanded={open}
                      onClick={() => setOpenId(open ? null : r.id)}
                    >
                      {pet}
                    </button>
                  )}
                  {r.providerName ? (
                    <span className="idexx-result-list__provider">· {r.providerName}</span>
                  ) : null}
                  <button
                    type="button"
                    className="idexx-result-list__expand"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : r.id)}
                  >
                    <span className="idexx-order__result-name">
                      {r.clientLastName || r.testNames.length ? '· ' : ''}
                      {r.clientLastName ? `${r.clientLastName}` : ''}
                      {r.clientLastName && r.testNames.length ? ' · ' : ''}
                      {r.testNames.length ? r.testNames.join(', ') : ''}
                    </span>
                    <IdexxChip order={{ status: 'SUBMITTED', results: [shown] }} />
                    <span className="idexx-order__meta">
                      {idexxResultStatusLabel(shown)} · {when(r.receivedAt)}
                    </span>
                  </button>
                </div>
                {open ? (
                  <div style={{ padding: '8px 4px 4px' }}>
                    {!r.patientId ? (
                      <MatchPet
                        result={r}
                        onMatched={() => {
                          setOpenId(null);
                          void load();
                        }}
                      />
                    ) : null}
                    <IdexxResultView
                      resultId={r.id}
                      onReviewedChange={() => void load()}
                      onPartialChange={(partial) =>
                        setPartialIds((prev) => {
                          if (partial === prev.has(r.id)) return prev;
                          const next = new Set(prev);
                          if (partial) next.add(r.id);
                          else next.delete(r.id);
                          return next;
                        })
                      }
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
