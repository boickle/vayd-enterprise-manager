import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import {
  listCountReport,
  listItemMovementsOrg,
  markCountReviewed,
  type CountReportRow,
  type ItemMovementRow,
} from '../api/inventoryCounts';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { formatUsd } from '../utils/useCountReviewBranches';
import { useOfficeBranches } from '../utils/useOfficeBranches';
import {
  AttentionBadge,
  refreshInventoryAttention,
  useInventoryAttention,
} from '../utils/useInventoryAttention';
import './Settings.css';

export default function InventoryCountReportPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  // Practice manager and admin see every count; the Controlled Substances Director sees and
  // reviews controlled drugs at every office (owner decisions, Oct 30, 2026).
  const { branches, allowAll, loaded } = useOfficeBranches(practiceId, [
    'inventory.count.review',
    'inventory.count.review_controlled',
  ]);
  const [controlledOnly, setControlledOnly] = useState(false);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [abc, setAbc] = useState('');
  const [offOnly, setOffOnly] = useState(true);
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const attention = useInventoryAttention();
  const [needsReview, setNeedsReview] = useState(false);
  const [needsReviewTouched, setNeedsReviewTouched] = useState(false);
  const [reviewingId, setReviewingId] = useState<number | null>(null);

  useEffect(() => {
    if (!needsReviewTouched && attention.flaggedCounts > 0) setNeedsReview(true);
  }, [attention.flaggedCounts, needsReviewTouched]);

  async function markReviewed(row: CountReportRow) {
    setReviewingId(row.id);
    try {
      const res = await markCountReviewed(practiceId, row.id);
      setRows((prev) =>
        needsReview
          ? prev.filter((r) => r.id !== row.id)
          : prev.map((r) =>
              r.id === row.id
                ? { ...r, reviewedAt: res.reviewedAt, reviewedByName: res.reviewedByName }
                : r
            )
      );
      if (needsReview) setTotal((t) => Math.max(0, t - 1));
      refreshInventoryAttention();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not mark reviewed');
    } finally {
      setReviewingId(null);
    }
  }
  const [rows, setRows] = useState<CountReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [trail, setTrail] = useState<ItemMovementRow[]>([]);
  const [trailBusy, setTrailBusy] = useState(false);

  useEffect(() => {
    if (loaded && !allowAll && branchId === '' && branches[0]) setBranchId(branches[0].id);
  }, [loaded, allowAll, branchId, branches]);

  useEffect(() => {
    if (!loaded) return;
    if (!allowAll && branchId === '') {
      if (!branches.length) setError('You can’t review counts for any office.');
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    void listCountReport(practiceId, {
      branchId: branchId === '' ? undefined : branchId,
      abc: abc || undefined,
      offOnly,
      flaggedOnly,
      needsReview,
      limit: 100,
    })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
        setControlledOnly(data.controlledOnly === true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load count report');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId, abc, offOnly, flaggedOnly, needsReview, loaded, allowAll, branches.length]);

  const pageNetUsd = rows.reduce((sum, r) => sum + (r.varianceCost ?? 0), 0);

  useEffect(() => {
    if (openId == null) {
      setTrail([]);
      return;
    }
    const row = rows.find((r) => r.id === openId);
    if (!row) return;
    let cancelled = false;
    setTrailBusy(true);
    void listItemMovementsOrg(practiceId, row.inventoryItemId, { limit: 40 })
      .then((data) => {
        if (!cancelled) setTrail(data.rows);
      })
      .catch(() => {
        if (!cancelled) setTrail([]);
      })
      .finally(() => {
        if (!cancelled) setTrailBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [openId, practiceId, rows]);

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        {controlledOnly ? (
          <strong style={{ display: 'block', marginBottom: 6 }}>Controlled drugs only.</strong>
        ) : null}
        Submitted cycle counts. Off counts are where counted quantity did not match the
        system; $ is the difference at item cost (negative is a loss). ⚑ means it was over your
        alert threshold and a task went to the practice manager (and the controlled substances director for a controlled drug). Open a row for location detail
        and the item’s movement trail across offices.
      </p>
      {error && (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'end' }}>
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            style={{ minWidth: 220 }}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value === '' ? '' : Number(e.target.value))}
          >
            {allowAll ? <option value="">All offices</option> : null}
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Class
          <select
            className="settings-input"
            value={abc}
            onChange={(e) => setAbc(e.target.value)}
          >
            <option value="">All</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </label>
        <label className="settings-checkbox-item" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={offOnly}
            onChange={(e) => setOffOnly(e.target.checked)}
          />
          <span>Only off counts</span>
        </label>
        <label className="settings-checkbox-item" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={flaggedOnly}
            onChange={(e) => setFlaggedOnly(e.target.checked)}
          />
          <span>Only flagged (over threshold)</span>
        </label>
        <label className="settings-checkbox-item" style={{ marginBottom: 8 }}>
          <input
            type="checkbox"
            checked={needsReview}
            onChange={(e) => {
              setNeedsReviewTouched(true);
              setNeedsReview(e.target.checked);
            }}
          />
          <span>
            Needs review
            <AttentionBadge count={attention.flaggedCounts} />
          </span>
        </label>
      </div>
      {busy && rows.length === 0 && <p className="settings-muted">Loading…</p>}
      {!busy && rows.length === 0 && (
        <p className="settings-muted">No submitted counts match these filters.</p>
      )}
      {rows.length > 0 && (
        <div className="settings-table-container">
          <table className="settings-table par-levels-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Office</th>
                <th>Item</th>
                <th>Class</th>
                <th>Expected</th>
                <th>Counted</th>
                <th>Variance</th>
                <th>$</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.id}>
                  <tr className={row.offCount ? 'par-levels-row--below' : undefined}>
                    <td>
                      {row.submittedAt
                        ? new Date(row.submittedAt).toLocaleString()
                        : '—'}
                    </td>
                    <td>{row.branchName ?? row.branchId}</td>
                    <td>
                      <strong>{row.name}</strong>
                      {row.code ? (
                        <div className="settings-muted" style={{ fontSize: 12 }}>
                          {row.code}
                        </div>
                      ) : null}
                      {row.countedBy?.length ? (
                        <div className="settings-muted" style={{ fontSize: 12 }}>
                          Counted by {row.countedBy.join(', ')}
                        </div>
                      ) : null}
                    </td>
                    <td>{row.effectiveAbc}</td>
                    <td>{row.expectedTotal ?? '—'}</td>
                    <td>{row.actualTotal ?? '—'}</td>
                    <td>
                      {row.variance == null ? (
                        '—'
                      ) : row.variance === 0 ? (
                        <span className="settings-muted">0</span>
                      ) : (
                        <span className="par-short">
                          {row.variance > 0 ? '+' : ''}
                          {row.variance}
                        </span>
                      )}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {row.varianceCost == null || row.variance === 0 ? (
                        <span className="settings-muted">—</span>
                      ) : (
                        <span className={row.varianceCost < 0 ? 'par-short' : undefined}>
                          {formatUsd(row.varianceCost, true)}
                        </span>
                      )}
                      {row.flagged ? (
                        <span title="Over alert threshold — task sent" style={{ marginLeft: 6 }}>
                          ⚑
                        </span>
                      ) : null}
                      {row.flagged && (row.reviewedAt || row.taskDone) ? (
                        <div className="settings-muted" style={{ fontSize: 11 }}>
                          ✓ Reviewed
                          {row.reviewedByName ? ` by ${row.reviewedByName}` : row.taskDone && !row.reviewedAt ? ' (task done)' : ''}
                        </div>
                      ) : null}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {row.flagged && !row.reviewedAt && !row.taskDone ? (
                        <button
                          type="button"
                          className="btn primary"
                          style={{ marginRight: 6 }}
                          disabled={reviewingId === row.id}
                          title="You looked into this difference; clears the alert and finishes its task"
                          onClick={() => void markReviewed(row)}
                        >
                          {reviewingId === row.id ? 'Saving…' : 'Mark reviewed'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn secondary"
                        onClick={() =>
                          setOpenId((prev) => (prev === row.id ? null : row.id))
                        }
                      >
                        {openId === row.id ? 'Hide' : 'Detail'}
                      </button>
                    </td>
                  </tr>
                  {openId === row.id && (
                    <tr>
                      <td colSpan={9}>
                        <div className="settings-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                          Location / lot
                        </div>
                        <table className="settings-table">
                          <thead>
                            <tr>
                              <th>Location</th>
                              <th>Lot</th>
                              <th>Exp</th>
                              <th>Expected</th>
                              <th>Counted</th>
                              <th>Counted by</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.locations.map((loc, i) => (
                              <tr
                                key={`${loc.branchLocationId}:${loc.inventoryLotBalanceId ?? loc.lotNumber ?? i}`}
                              >
                                <td>{loc.locationName ?? loc.branchLocationId}</td>
                                <td>
                                  {loc.lotNumber === 'UNASSIGNED'
                                    ? 'Existing stock (no lot recorded)'
                                    : loc.lotNumber || '—'}
                                </td>
                                <td>{loc.expirationDate?.slice(0, 10) || '—'}</td>
                                <td>{loc.expectedQty ?? '—'}</td>
                                <td>{loc.actualQty ?? '—'}</td>
                                <td>
                                  {loc.countedByName ?? '—'}
                                  {loc.countedAt ? (
                                    <span className="settings-muted">
                                      {' · '}
                                      {new Date(loc.countedAt).toLocaleString()}
                                    </span>
                                  ) : null}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="settings-muted" style={{ margin: '16px 0 8px', fontSize: 13 }}>
                          Movement trail across offices
                        </div>
                        {trailBusy ? (
                          <div className="settings-muted">Loading activity…</div>
                        ) : trail.length === 0 ? (
                          <div className="settings-muted">No movements found.</div>
                        ) : (
                          <table className="settings-table">
                            <thead>
                              <tr>
                                <th>When</th>
                                <th>Office</th>
                                <th>Type</th>
                                <th>Qty</th>
                                <th>From / to</th>
                                <th>Who</th>
                              </tr>
                            </thead>
                            <tbody>
                              {trail.map((m) => (
                                <tr key={m.id}>
                                  <td>{new Date(m.created).toLocaleString()}</td>
                                  <td>{m.branchName ?? m.branchId}</td>
                                  <td>{m.movementType}</td>
                                  <td>{m.quantity}</td>
                                  <td>
                                    {[m.fromLocationName, m.toLocationName]
                                      .filter(Boolean)
                                      .join(' → ') || '—'}
                                  </td>
                                  <td>{m.actorName || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
          <p className="settings-muted" style={{ marginTop: 8 }}>
            Showing {rows.length} of {total} · Net on this page: {formatUsd(pageNetUsd, true)}
          </p>
        </div>
      )}
    </div>
  );
}
