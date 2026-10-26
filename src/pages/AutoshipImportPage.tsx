import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { apiErrorMessage } from '../api/http';
import { searchStoreInventory } from '../api/onlineStore';
import { searchClientsStaff, type ClientSearchRow } from '../api/clientsStaff';
import {
  getEcwidAutoshipMode,
  listEcwidAutoships,
  moveAllApprovedEcwidAutoships,
  moveEcwidAutoship,
  refreshEcwidAutoships,
  setEcwidAutoshipStatus,
  updateEcwidAutoship,
  type EcwidAutoshipMode,
  type EcwidAutoshipPatch,
  type EcwidAutoshipRow,
  type MoveAddress,
} from '../api/ecwidAutoship';
import { appConfirm } from '../utils/appDialog';
import { formatAutoshipFrequency } from './store/storeCartState';
import { currentPracticeId } from '../utils/practiceIdFromToken';
import './Settings.css';
import './AutoshipImport.css';

const FREQUENCIES = ['monthly', 'every_2_months', 'quarterly', 'every_6_months', 'yearly'];

type Filter = 'pending' | 'approved' | 'moved' | 'skipped' | 'gone' | 'all';

function practiceIdFromToken(token: string | null): number {
  try {
    if (!token) return currentPracticeId();
    const p = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return Number(p.practiceId ?? p.practice_id) || 1;
  } catch {
    return 1;
  }
}

function money(value: number | null | undefined): string {
  if (value == null) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function addressText(a: MoveAddress | null | undefined): string {
  if (!a) return 'No address on file';
  return [a.line1, a.line2, a.city, a.state, a.postal].filter(Boolean).join(', ');
}

function hasDifference(row: EcwidAutoshipRow): boolean {
  const d = row.diffs;
  return (
    d.address === 'different' ||
    d.address === 'zip' ||
    d.address === 'missing' ||
    d.price === 'increase' ||
    d.price === 'decrease' ||
    d.frequency ||
    d.petName ||
    d.email ||
    d.itemUnlisted ||
    d.rxWithoutPet ||
    row.problems.length > 0
  );
}

/** Debounced search box with a result list; calls onPick with the chosen id. */
function SearchPicker<T>({
  placeholder,
  search,
  label,
  onPick,
}: {
  placeholder: string;
  search: (q: string) => Promise<T[]>;
  label: (row: T) => { id: number; text: string };
  onPick: (id: number) => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<T[]>([]);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    window.clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    timer.current = window.setTimeout(() => {
      void search(q.trim())
        .then((r) => setResults(r.slice(0, 12)))
        .catch(() => setResults([]));
    }, 250);
    return () => window.clearTimeout(timer.current);
  }, [q]);
  return (
    <div className="ai-search">
      <input value={q} placeholder={placeholder} onChange={(e) => setQ(e.target.value)} />
      {results.length > 0 && (
        <ul className="ai-search-results">
          {results.map((r) => {
            const { id, text } = label(r);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => {
                    onPick(id);
                    setQ('');
                    setResults([]);
                  }}
                >
                  {text}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function MoveResult({ row }: { row: EcwidAutoshipRow }) {
  const m = row.move;
  if (!m.movedAt && !m.error) return null;
  const cancel =
    m.ecwidCancel === 'cancelled'
      ? 'Ecwid auto-ship cancelled.'
      : m.ecwidCancel === 'failed'
        ? 'Ecwid auto-ship NOT confirmed cancelled.'
        : m.ecwidCancel === 'test_not_cancelled'
          ? 'Test: Ecwid was left alone (still active).'
          : '';
  return (
    <div className={`ai-move ${m.error ? 'ai-move-error' : ''}`}>
      {m.movedAt ? (
        <div>
          {m.stripeMode === 'test' ? <span className="ai-tag">TEST</span> : null} Moved{' '}
          {new Date(m.movedAt).toLocaleString()}: Scout auto-ship #{m.scoutSubscriptionId}, Stripe{' '}
          <code>{m.stripeSubscriptionId}</code>. {cancel}
        </div>
      ) : null}
      {m.error ? <div className="ai-red-text">{m.error}</div> : null}
    </div>
  );
}

function AutoshipCard({
  row,
  practiceId,
  busy,
  onPatch,
  onStatus,
  onMove,
}: {
  row: EcwidAutoshipRow;
  practiceId: number;
  busy: boolean;
  onPatch: (body: EcwidAutoshipPatch) => void;
  onStatus: (status: 'approved' | 'skipped' | 'pending') => void;
  onMove: () => void;
}) {
  const [qty, setQty] = useState(String(row.scout.quantity ?? ''));
  const [notes, setNotes] = useState(row.notes ?? '');
  useEffect(() => setQty(String(row.scout.quantity ?? '')), [row.scout.quantity]);
  useEffect(() => setNotes(row.notes ?? ''), [row.notes]);
  const d = row.diffs;
  const locked = row.status === 'moved';
  const addressRed = d.address === 'different' || d.address === 'zip' || d.address === 'missing';
  const priceRed = d.price === 'increase' || d.price === 'decrease';

  return (
    <section className={`ai-card ai-status-${row.status}`}>
      <header className="ai-card-head">
        <div>
          <strong>Ecwid #{row.ecwidSubscriptionId}</strong>
          {row.lineIndex > 0 ? <span className="ai-muted"> · item {row.lineIndex + 1}</span> : null}
          <span className={`ai-badge ai-badge-${row.status}`}>{row.status === 'pending' ? 'needs review' : row.status}</span>
          {row.alreadyInScout ? <span className="ai-badge ai-badge-moved">already in Scout</span> : null}
        </div>
        <div className={d.chargeSoon ? 'ai-red-text' : 'ai-muted'}>
          Next Ecwid charge {row.nextCharge || '—'}
          {row.daysUntilCharge != null ? ` (${row.daysUntilCharge} days)` : ''}
        </div>
      </header>
      {row.problems.length > 0 && (
        <ul className="ai-problems">
          {row.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}

      <div className="ai-grid">
        <div className="ai-grid-head" />
        <div className="ai-grid-head">Ecwid today</div>
        <div className="ai-grid-head">Scout going forward</div>

        <div className="ai-label">Client</div>
        <div>
          {row.ecwid.name}
          <div className="ai-muted">{row.ecwid.email}</div>
        </div>
        <div className={!row.scout.client || d.email ? 'ai-diff' : ''}>
          {row.scout.client ? (
            <>
              #{row.scout.client.id} {row.scout.client.name}
              <div className="ai-muted">{row.scout.client.email || 'no email'}</div>
            </>
          ) : (
            <em>No client chosen</em>
          )}
          {!locked && (
            <>
              {row.proposed.clientAlternatives.length > 0 && (
                <div className="ai-alts">
                  Other matches:{' '}
                  {row.proposed.clientAlternatives.map((a) => (
                    <button key={a.id} type="button" className="ai-link" onClick={() => onPatch({ clientId: a.id })}>
                      #{a.id} {a.label}
                    </button>
                  ))}
                </div>
              )}
              <SearchPicker<ClientSearchRow>
                placeholder="Search clients…"
                search={(q) => searchClientsStaff(q)}
                label={(c) => ({
                  id: Number(c.id),
                  text: `#${c.id} ${c.firstName || ''} ${c.lastName || ''}${c.city ? ` — ${c.city}` : ''}`,
                })}
                onPick={(id) => onPatch({ clientId: id })}
              />
            </>
          )}
        </div>

        <div className="ai-label">Pet</div>
        <div>{row.ecwid.petName || <em>none given</em>}</div>
        <div className={d.petName || d.rxWithoutPet ? 'ai-diff' : ''}>
          <select
            disabled={locked || !row.scout.client}
            value={row.scout.patient?.id ?? ''}
            onChange={(e) => onPatch({ patientId: e.target.value ? Number(e.target.value) : null })}
          >
            <option value="">— no pet —</option>
            {row.scout.pets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.active ? '' : ' (inactive)'}
              </option>
            ))}
          </select>
        </div>

        <div className="ai-label">Item</div>
        <div>
          {row.ecwid.product}
          <div className="ai-muted">{row.ecwid.options}</div>
          <div className="ai-muted ai-small">SKU {row.ecwid.sku}</div>
        </div>
        <div className={!row.scout.item || d.itemUnlisted ? 'ai-diff' : ''}>
          {row.scout.item ? (
            <>
              #{row.scout.item.id} {row.scout.item.name}
              <div>
                {row.scout.item.listed ? (
                  <span className="ai-tag">listed in store</span>
                ) : (
                  <span className="ai-tag ai-tag-red">not listed in store</span>
                )}
                {row.scout.item.needsApproval ? <span className="ai-tag">needs doctor approval</span> : null}
              </div>
            </>
          ) : (
            <em>No item chosen</em>
          )}
          {!locked && (
            <>
              {row.proposed.itemAlternatives.length > 0 && (
                <div className="ai-alts">
                  Other matches:{' '}
                  {row.proposed.itemAlternatives.map((a) => (
                    <button key={a.id} type="button" className="ai-link" onClick={() => onPatch({ inventoryItemId: a.id })}>
                      #{a.id} {a.label}
                    </button>
                  ))}
                </div>
              )}
              <SearchPicker<{ id: number; name: string; code: string | null; catalogItemType?: string }>
                placeholder="Search inventory items…"
                search={async (q) =>
                  (await searchStoreInventory(practiceId, q)).filter((i) => i.catalogItemType !== 'procedure')
                }
                label={(i) => ({ id: i.id, text: `#${i.id} ${i.name}${i.code ? ` (${i.code})` : ''}` })}
                onPick={(id) => onPatch({ inventoryItemId: id })}
              />
            </>
          )}
        </div>

        <div className="ai-label">Quantity</div>
        <div>
          {row.ecwid.quantity} × Ecwid pack
        </div>
        <div className={row.proposed.quantityCheck || d.quantity ? 'ai-diff' : ''}>
          <input
            className="ai-qty"
            type="number"
            min={1}
            disabled={locked}
            value={qty}
            onChange={(e) => setQty(e.target.value)}
            onBlur={() => {
              const n = Number(qty);
              if (n > 0 && n !== row.scout.quantity) onPatch({ quantity: n });
            }}
          />
          <div className="ai-muted ai-small">{row.proposed.quantityBasis}</div>
        </div>

        <div className="ai-label">Frequency</div>
        <div>
          {formatAutoshipFrequency(row.ecwid.billingFrequency) || '—'}
          {row.ecwid.skuFrequency && row.ecwid.skuFrequency !== row.ecwid.billingFrequency ? (
            <div className="ai-red-text ai-small">SKU says {formatAutoshipFrequency(row.ecwid.skuFrequency)}</div>
          ) : null}
        </div>
        <div className={d.frequency ? 'ai-diff' : ''}>
          <select
            disabled={locked}
            value={row.scout.frequency ?? ''}
            onChange={(e) => onPatch({ frequency: e.target.value || null })}
          >
            <option value="">—</option>
            {FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {formatAutoshipFrequency(f)}
              </option>
            ))}
          </select>
        </div>

        <div className="ai-label">Each charge</div>
        <div>
          {money(row.ecwid.charge)}
          <div className="ai-muted ai-small">
            {money(row.ecwid.price)} + {money(row.ecwid.tax)} tax
          </div>
        </div>
        <div className={priceRed ? 'ai-diff' : ''}>
          {money(row.scout.charge)}
          {d.priceDifference != null && priceRed ? (
            <strong className="ai-red-text">
              {' '}
              {d.price === 'increase' ? '▲' : '▼'} {money(Math.abs(d.priceDifference))} {d.price}
            </strong>
          ) : d.price === 'same' ? (
            <span className="ai-muted"> same</span>
          ) : null}
          <div className="ai-muted ai-small">
            {row.scout.unitPrice != null ? `${money(row.scout.unitPrice)} each` : ''}
            {row.scout.memberDiscountPct ? ` · ${row.scout.memberDiscountPct}% member discount` : ''}
            {row.scout.tagalongs.map((t) => ` · ${t.name} ${money(t.amount)}`).join('')}
            {row.scout.taxRate ? ` · ${(row.scout.taxRate * 100).toFixed(1)}% tax` : ''}
          </div>
        </div>

        <div className="ai-label">Ship to</div>
        <div className={addressRed ? 'ai-diff' : ''}>
          <label className="ai-radio">
            <input
              type="radio"
              disabled={locked}
              checked={row.addressChoice === 'ecwid'}
              onChange={() => onPatch({ addressChoice: 'ecwid' })}
            />
            {addressText(row.ecwid.address)}
          </label>
        </div>
        <div className={addressRed ? 'ai-diff' : ''}>
          <label className="ai-radio">
            <input
              type="radio"
              disabled={locked || !row.scout.client?.address}
              checked={row.addressChoice === 'scout'}
              onChange={() => onPatch({ addressChoice: 'scout' })}
            />
            {addressText(row.scout.client?.address)}
          </label>
          {d.address === 'formatting' ? <div className="ai-muted ai-small">Same address, written differently</div> : null}
          {addressRed ? <div className="ai-red-text ai-small">Addresses differ: pick the one to ship to</div> : null}
        </div>
      </div>

      <MoveResult row={row} />
      <footer className="ai-card-foot">
        <textarea
          placeholder="Notes"
          disabled={locked}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if ((notes || '') !== (row.notes || '')) onPatch({ notes });
          }}
        />
        <div className="ai-actions">
          {row.reviewedAt ? (
            <span className="ai-muted ai-small">Reviewed {new Date(row.reviewedAt).toLocaleString()}</span>
          ) : null}
          {row.status !== 'approved' && row.status !== 'moved' && row.status !== 'gone' && (
            <button type="button" className="btn" disabled={busy} onClick={() => onStatus('approved')}>
              Approve
            </button>
          )}
          {row.status !== 'skipped' && row.status !== 'moved' && (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => onStatus('skipped')}>
              Skip
            </button>
          )}
          {(row.status === 'approved' || row.status === 'skipped') && (
            <button type="button" className="btn secondary" disabled={busy} onClick={() => onStatus('pending')}>
              Back to review
            </button>
          )}
          {row.status === 'approved' && (
            <button type="button" className="btn ai-move-btn" disabled={busy} onClick={onMove}>
              Move to Scout
            </button>
          )}
        </div>
      </footer>
    </section>
  );
}

export default function AutoshipImportPage() {
  const { token } = useAuth();
  const practiceId = practiceIdFromToken(token);
  const [rows, setRows] = useState<EcwidAutoshipRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('pending');
  const [onlyDiffs, setOnlyDiffs] = useState(false);
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<EcwidAutoshipMode | null>(null);

  useEffect(() => {
    setLoading(true);
    listEcwidAutoships(practiceId)
      .then(setRows)
      .catch((e) => setError(apiErrorMessage(e)))
      .finally(() => setLoading(false));
    getEcwidAutoshipMode(practiceId)
      .then(setMode)
      .catch(() => setMode(null));
  }, [practiceId]);

  const replace = (next: EcwidAutoshipRow) => setRows((prev) => prev.map((r) => (r.id === next.id ? next : r)));

  const move = async (row: EcwidAutoshipRow) => {
    const others = rows.filter((r) => r.ecwidSubscriptionId === row.ecwidSubscriptionId && r.id !== row.id);
    const approved = [row, ...others].filter((r) => r.status === 'approved').length;
    const live = mode?.stripe === 'live';
    const message = live
      ? `LIVE: This creates ${approved} Scout auto-ship(s) charged to the client's saved Ecwid card, first charge ${row.nextCharge}, then cancels Ecwid auto-ship #${row.ecwidSubscriptionId}${others.length ? ' (all its items)' : ''}.`
      : `TEST: This creates ${approved} Scout auto-ship(s) in the Stripe sandbox on Stripe's test Visa (4242) under a test email. The client's real card and email are not used, and Ecwid is left alone.`;
    if (!(await appConfirm({ title: 'Move to Scout?', message }))) return;
    setBusyId(row.id);
    setError(null);
    try {
      const updated = await moveEcwidAutoship(practiceId, row.ecwidSubscriptionId);
      const byId = new Map(updated.map((r) => [r.id, r]));
      setRows((prev) => prev.map((r) => byId.get(r.id) ?? r));
      setNote(`Moved Ecwid auto-ship #${row.ecwidSubscriptionId} to Scout${live ? '' : ' (test)'}.`);
    } catch (e) {
      setError(apiErrorMessage(e));
      listEcwidAutoships(practiceId).then(setRows).catch(() => undefined);
    } finally {
      setBusyId(null);
    }
  };

  const patch = async (id: number, body: EcwidAutoshipPatch) => {
    setBusyId(id);
    setError(null);
    try {
      replace(await updateEcwidAutoship(practiceId, id, body));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const status = async (id: number, next: 'approved' | 'skipped' | 'pending') => {
    setBusyId(id);
    setError(null);
    try {
      replace(await setEcwidAutoshipStatus(practiceId, id, next));
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusyId(null);
    }
  };

  const [movingAll, setMovingAll] = useState(false);
  const readyCount = useMemo(() => {
    const bySub = new Map<string, EcwidAutoshipRow[]>();
    for (const r of rows) bySub.set(r.ecwidSubscriptionId, [...(bySub.get(r.ecwidSubscriptionId) || []), r]);
    let n = 0;
    for (const lines of bySub.values()) {
      if (lines.some((l) => l.status === 'approved') && !lines.some((l) => l.status === 'pending' || l.status === 'gone')) n += 1;
    }
    return n;
  }, [rows]);

  const moveAll = async () => {
    const live = mode?.stripe === 'live';
    const message = live
      ? `LIVE: Move ${readyCount} Ecwid auto-ship(s) to Scout. Each is charged to the client's saved Ecwid card on its next Ecwid charge date, and each Ecwid auto-ship is cancelled. Anything Ecwid charges within 48 hours is held back.`
      : `TEST: Move ${readyCount} Ecwid auto-ship(s) in the Stripe sandbox on Stripe's test Visa (4242) under test emails. Clients' real cards and emails are not used, and Ecwid is left alone.`;
    if (!(await appConfirm({ title: 'Move all approved to Scout?', message }))) return;
    setMovingAll(true);
    setError(null);
    try {
      const res = await moveAllApprovedEcwidAutoships(practiceId);
      setRows(res.rows);
      const held = res.held.map((h) => `#${h.ecwidSubscriptionId}: ${h.reason}`).join(' · ');
      setNote(
        `Moved ${res.moved.length} Ecwid auto-ship(s)${live ? '' : ' (test)'}.` +
          (res.held.length ? ` Held ${res.held.length}: ${held}` : '') +
          (res.waitingOnReview ? ` ${res.waitingOnReview} still have items to review.` : ''),
      );
    } catch (e) {
      setError(apiErrorMessage(e));
      listEcwidAutoships(practiceId).then(setRows).catch(() => undefined);
    } finally {
      setMovingAll(false);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const res = await refreshEcwidAutoships(practiceId);
      setRows(res.rows);
      setNote(
        `Pulled ${res.summary.fetched} active Ecwid auto-ships: ${res.summary.added} new, ${res.summary.gone} no longer active. Your choices on existing rows were kept.`,
      );
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setRefreshing(false);
    }
  };

  const counts = useMemo(() => {
    const c = { pending: 0, approved: 0, skipped: 0, gone: 0, moved: 0, increase: 0, decrease: 0, address: 0, cancelFailed: 0 };
    for (const r of rows) {
      c[r.status] += 1;
      if (r.diffs.price === 'increase') c.increase += 1;
      if (r.diffs.price === 'decrease') c.decrease += 1;
      if (['different', 'zip', 'missing'].includes(r.diffs.address)) c.address += 1;
      if (r.move.ecwidCancel === 'failed') c.cancelFailed += 1;
    }
    return c;
  }, [rows]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== 'all' && r.status !== filter) return false;
      if (onlyDiffs && !hasDifference(r)) return false;
      if (!needle) return true;
      return [r.ecwid.name, r.ecwid.email, r.ecwid.petName, r.ecwid.product, r.scout.client?.name, r.scout.item?.name, r.ecwidSubscriptionId]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(needle));
    });
  }, [rows, filter, onlyDiffs, q]);

  return (
    <div className="settings-card ai-page" style={{ padding: 16 }}>
      <h2 style={{ margin: '0 0 4px' }}>Auto-ship Import</h2>
      <p className="ai-muted" style={{ marginTop: 0 }}>
        Review each Ecwid auto-ship before it moves into Scout. Red marks anything that differs between Ecwid and
        Scout. Refresh only reads from Ecwid. Approving only marks a row reviewed; nothing moves until you press
        “Move to Scout”.
      </p>
      {mode?.stripe === 'test' ? (
        <div className="ai-mode ai-mode-test">
          <strong>TEST MODE.</strong> “Move to Scout” uses the Stripe sandbox and Stripe’s test Visa (4242) under a
          test email. Clients’ real cards and emails are not used, and Ecwid auto-ships are not cancelled.
        </div>
      ) : mode?.stripe === 'live' ? (
        <div className="ai-mode ai-mode-live">
          <strong>LIVE.</strong> “Move to Scout” charges the client’s saved Ecwid card on Ecwid’s next charge date and
          cancels the Ecwid auto-ship.
        </div>
      ) : mode?.stripe === 'off' ? (
        <div className="ai-mode ai-mode-live">Stripe is not configured here, so nothing can be moved.</div>
      ) : null}
      {counts.cancelFailed > 0 ? (
        <div className="ai-mode ai-mode-live">
          {counts.cancelFailed} moved auto-ship item(s) could not be confirmed cancelled in Ecwid. Cancel them in Ecwid
          before their next charge or the client will be charged twice (filter: Moved).
        </div>
      ) : null}

      <div className="ai-toolbar">
        <button type="button" className="btn" disabled={refreshing} onClick={() => void refresh()}>
          {refreshing ? 'Pulling from Ecwid…' : 'Refresh from Ecwid'}
        </button>
        <button
          type="button"
          className="btn ai-move-btn"
          disabled={movingAll || !readyCount || mode?.stripe === 'off'}
          onClick={() => void moveAll()}
        >
          {movingAll ? 'Moving…' : `Move all approved to Scout (${readyCount})`}
        </button>
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="pending">Needs review ({counts.pending})</option>
          <option value="approved">Approved ({counts.approved})</option>
          <option value="moved">Moved to Scout ({counts.moved})</option>
          <option value="skipped">Skipped ({counts.skipped})</option>
          <option value="gone">No longer in Ecwid ({counts.gone})</option>
          <option value="all">All ({rows.length})</option>
        </select>
        <label className="ai-radio">
          <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} />
          Only rows with differences
        </label>
        <input
          className="ai-filter"
          placeholder="Search client, pet, product…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <div className="ai-summary ai-muted">
        Price increases: <strong className={counts.increase ? 'ai-red-text' : ''}>{counts.increase}</strong> · decreases:{' '}
        <strong className={counts.decrease ? 'ai-red-text' : ''}>{counts.decrease}</strong> · addresses that differ:{' '}
        <strong className={counts.address ? 'ai-red-text' : ''}>{counts.address}</strong>
      </div>

      {error ? (
        <div className="settings-message settings-error-message">
          <span>{error}</span>
          <button type="button" className="btn secondary" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {note ? (
        <div className="settings-message">
          <span>{note}</span>
          <button type="button" className="btn secondary" onClick={() => setNote(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {loading ? (
        <p>Loading…</p>
      ) : rows.length === 0 ? (
        <p>No Ecwid auto-ships pulled yet. Use “Refresh from Ecwid” to start.</p>
      ) : shown.length === 0 ? (
        <p className="ai-muted">Nothing matches these filters.</p>
      ) : (
        shown.map((row) => (
          <AutoshipCard
            key={row.id}
            row={row}
            practiceId={practiceId}
            busy={busyId === row.id}
            onPatch={(body) => void patch(row.id, body)}
            onStatus={(s) => void status(row.id, s)}
            onMove={() => void move(row)}
          />
        ))
      )}
    </div>
  );
}
