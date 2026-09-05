import { Fragment, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/useAuth';
import { listPracticeBranches, type PracticeBranch } from '../api/branchInventory';
import {
  listCountReport,
  listItemMovementsOrg,
  type CountReportRow,
  type ItemMovementRow,
} from '../api/inventoryCounts';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

export default function InventoryCountReportPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [abc, setAbc] = useState('');
  const [offOnly, setOffOnly] = useState(true);
  const [rows, setRows] = useState<CountReportRow[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [trail, setTrail] = useState<ItemMovementRow[]>([]);
  const [trailBusy, setTrailBusy] = useState(false);

  useEffect(() => {
    void listPracticeBranches(practiceId)
      .then((list) => setBranches(list.filter((b) => b.isActive !== false)))
      .catch(() => setBranches([]));
  }, [practiceId]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void listCountReport(practiceId, {
      branchId: branchId === '' ? undefined : branchId,
      abc: abc || undefined,
      offOnly,
      limit: 100,
    })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows);
        setTotal(data.total);
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
  }, [practiceId, branchId, abc, offOnly]);

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
        Submitted cycle counts. Off counts are where counted quantity did not match the
        system. Open a row for location detail and the item’s movement trail across offices.
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
            <option value="">All offices</option>
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
                    <td>
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
                      <td colSpan={8}>
                        <div className="settings-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                          Locations
                        </div>
                        <table className="settings-table">
                          <thead>
                            <tr>
                              <th>Location</th>
                              <th>Expected</th>
                              <th>Counted</th>
                            </tr>
                          </thead>
                          <tbody>
                            {row.locations.map((loc) => (
                              <tr key={loc.branchLocationId}>
                                <td>{loc.locationName ?? loc.branchLocationId}</td>
                                <td>{loc.expectedQty ?? '—'}</td>
                                <td>{loc.actualQty ?? '—'}</td>
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
            Showing {rows.length} of {total}
          </p>
        </div>
      )}
    </div>
  );
}
