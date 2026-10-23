import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import {
  listExpiringInventoryLots,
  listInventoryBranchLocations,
  listInventoryLots,
  listPracticeBranches,
  type ExpiringLotItem,
  type InventoryBranchLocation,
  type InventoryLotBalance,
  type PracticeBranch,
} from '../api/branchInventory';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

function daysUntil(iso: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(`${iso.slice(0, 10)}T12:00:00`);
  return Math.round((exp.getTime() - today.getTime()) / 86400000);
}

export default function InventoryExpiringReportPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [withinDays, setWithinDays] = useState(183);
  const [rows, setRows] = useState<ExpiringLotItem[]>([]);
  const [meta, setMeta] = useState<{ fromDate: string; toDate: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);
  const [elsewhere, setElsewhere] = useState<InventoryLotBalance[]>([]);
  const [elsewhereBusy, setElsewhereBusy] = useState(false);

  useEffect(() => {
    void listPracticeBranches(practiceId)
      .then((list) => setBranches(list.filter((b) => b.isActive !== false)))
      .catch(() => setBranches([]));
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') {
      setLocations([]);
      setLocationId('');
      return;
    }
    void listInventoryBranchLocations(practiceId, Number(branchId)).then((locs) => {
      setLocations(locs.filter((l) => l.isActive !== false));
      setLocationId((prev) =>
        prev !== '' && locs.some((l) => l.id === prev) ? prev : ''
      );
    });
  }, [practiceId, branchId]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    setError(null);
    void listExpiringInventoryLots(practiceId, {
      withinDays,
      branchId: branchId === '' ? undefined : Number(branchId),
      locationId: locationId === '' ? undefined : Number(locationId),
    })
      .then((data) => {
        if (cancelled) return;
        setRows(data.rows ?? []);
        setMeta({ fromDate: data.fromDate, toDate: data.toDate });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load expiring lots');
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId, locationId, withinDays]);

  useEffect(() => {
    if (openId == null) {
      setElsewhere([]);
      return;
    }
    let cancelled = false;
    setElsewhereBusy(true);
    void listInventoryLots(practiceId, openId, { includeZero: false })
      .then((lots) => {
        if (!cancelled) setElsewhere(lots);
      })
      .catch(() => {
        if (!cancelled) setElsewhere([]);
      })
      .finally(() => {
        if (!cancelled) setElsewhereBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, openId]);

  return (
    <div className="settings-section">
      <p className="settings-section-description">
        Products with lot stock expiring in the next six months (soonest first). Same product
        at multiple places is one row, ranked by the earliest expiration. Expand a row to see
        all locations and lots for that product.
      </p>
      {error ? (
        <div className="settings-message settings-error-message" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 16, alignItems: 'end' }}>
        <label className="settings-label">
          Office
          <select
            className="settings-input"
            style={{ minWidth: 220 }}
            value={branchId}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
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
          Location
          <select
            className="settings-input"
            style={{ minWidth: 180 }}
            value={locationId}
            disabled={branchId === ''}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label">
          Within
          <select
            className="settings-input"
            value={withinDays}
            onChange={(e) => setWithinDays(Number(e.target.value))}
          >
            <option value={90}>90 days</option>
            <option value={183}>6 months</option>
            <option value={365}>12 months</option>
          </select>
        </label>
      </div>
      {meta ? (
        <p className="settings-muted" style={{ marginTop: 0 }}>
          {busy ? 'Loading…' : `${rows.length} product${rows.length === 1 ? '' : 's'}`}
          {' · '}
          {meta.fromDate} → {meta.toDate}
        </p>
      ) : null}
      {busy && rows.length === 0 ? (
        <p className="settings-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="settings-muted">Nothing expiring in this window.</p>
      ) : (
        <div className="settings-table-container">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Soonest exp</th>
                <th>Days left</th>
                <th>Qty (expiring)</th>
                <th>Places</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const open = openId === row.inventoryItemId;
                const days = daysUntil(row.soonestExpiration);
                return (
                  <Fragment key={row.inventoryItemId}>
                    <tr>
                      <td>
                        <Link
                          to={`/schedule/inventory/items?itemId=${row.inventoryItemId}${
                            row.name ? `&name=${encodeURIComponent(row.name)}` : ''
                          }`}
                          style={{ fontWeight: 600, color: 'inherit', textDecoration: 'underline' }}
                        >
                          {row.name ?? `Item #${row.inventoryItemId}`}
                        </Link>
                        {row.code ? (
                          <div className="settings-muted" style={{ fontSize: 12 }}>
                            {row.code}
                          </div>
                        ) : null}
                      </td>
                      <td>{row.soonestExpiration}</td>
                      <td>
                        <span className={days <= 60 ? 'par-short' : undefined}>{days}</span>
                      </td>
                      <td>{row.totalQty}</td>
                      <td>{row.locations.length}</td>
                      <td>
                        <button
                          type="button"
                          className="btn secondary"
                          onClick={() =>
                            setOpenId((prev) =>
                              prev === row.inventoryItemId ? null : row.inventoryItemId
                            )
                          }
                        >
                          {open ? 'Hide' : 'Expand'}
                        </button>
                      </td>
                    </tr>
                    {open ? (
                      <tr>
                        <td colSpan={6}>
                          <div className="settings-muted" style={{ marginBottom: 8, fontSize: 13 }}>
                            Expiring in this filter
                          </div>
                          <table className="settings-table">
                            <thead>
                              <tr>
                                <th>Office</th>
                                <th>Location</th>
                                <th>Lot</th>
                                <th>Expires</th>
                                <th>QOH</th>
                              </tr>
                            </thead>
                            <tbody>
                              {row.locations.map((loc) => (
                                <tr key={loc.lotId}>
                                  <td>{loc.branchName ?? '—'}</td>
                                  <td>{loc.locationName ?? '—'}</td>
                                  <td>{loc.lotNumber || '—'}</td>
                                  <td>{loc.expirationDate}</td>
                                  <td>{loc.quantityOnHand}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div
                            className="settings-muted"
                            style={{ margin: '16px 0 8px', fontSize: 13 }}
                          >
                            All locations for this product (any expiration)
                          </div>
                          {elsewhereBusy ? (
                            <p className="settings-muted">Loading other stock…</p>
                          ) : elsewhere.length === 0 ? (
                            <p className="settings-muted">No other lot stock on hand.</p>
                          ) : (
                            <table className="settings-table">
                              <thead>
                                <tr>
                                  <th>Office</th>
                                  <th>Location</th>
                                  <th>Lot</th>
                                  <th>Expires</th>
                                  <th>QOH</th>
                                </tr>
                              </thead>
                              <tbody>
                                {elsewhere.map((lot) => (
                                  <tr key={lot.id}>
                                    <td>{lot.branchName ?? '—'}</td>
                                    <td>{lot.locationName ?? '—'}</td>
                                    <td>{lot.lotNumber || '—'}</td>
                                    <td>{lot.expirationDate ?? '—'}</td>
                                    <td>{lot.quantityOnHand}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
