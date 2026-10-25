import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from '../auth/useAuth';
import { getShrinkSummary, type ShrinkItemRow, type ShrinkSummary } from '../api/inventoryCounts';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { formatUsd, useCountReviewBranches } from '../utils/useCountReviewBranches';
import './Settings.css';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

const PRESETS: { id: string; label: string; from: () => string }[] = [
  { id: '30', label: 'Last 30 days', from: () => daysAgo(29) },
  { id: '90', label: 'Last 90 days', from: () => daysAgo(89) },
  { id: 'ytd', label: 'This year', from: () => `${new Date().getFullYear()}-01-01` },
  { id: '365', label: 'Last 12 months', from: () => daysAgo(364) },
];

const pctText = (n: number | null | undefined) => (n == null ? '—' : `${n}%`);

function Kpi({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'good' | 'warn' | 'bad';
}) {
  const color =
    tone === 'bad' ? '#b42318' : tone === 'warn' ? '#b54708' : tone === 'good' ? '#067647' : undefined;
  return (
    <div
      style={{
        border: '1px solid #e4e7ec',
        borderRadius: 8,
        padding: '12px 14px',
        background: '#fff',
        minWidth: 0,
      }}
    >
      <div className="settings-muted" style={{ fontSize: 12, marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{value}</div>
      {hint ? (
        <div className="settings-muted" style={{ fontSize: 12, marginTop: 4 }}>
          {hint}
        </div>
      ) : null}
    </div>
  );
}

function ItemTable({ rows, empty }: { rows: ShrinkItemRow[]; empty: string }) {
  if (!rows.length) return <p className="settings-muted">{empty}</p>;
  return (
    <div className="settings-table-container">
      <table className="settings-table">
        <thead>
          <tr>
            <th>Item</th>
            <th>Class</th>
            <th>Times counted</th>
            <th>Times off</th>
            <th>Net units</th>
            <th>Net $</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.inventoryItemId}>
              <td>{r.name}</td>
              <td>{r.abc}</td>
              <td>{r.counted}</td>
              <td>{r.timesOff}</td>
              <td>
                {r.netUnits > 0 ? '+' : ''}
                {Number(r.netUnits.toFixed(2))}
              </td>
              <td className={r.netUsd < 0 ? 'par-short' : undefined}>{formatUsd(r.netUsd, true)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function InventoryShrinkReportPage() {
  const { token } = useAuth() as { token: string | null };
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const { branches, allowAll, loaded } = useCountReviewBranches(practiceId);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [preset, setPreset] = useState('90');
  const [data, setData] = useState<ShrinkSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loaded && !allowAll && branchId === '' && branches[0]) setBranchId(branches[0].id);
  }, [loaded, allowAll, branchId, branches]);

  useEffect(() => {
    if (!loaded) return;
    if (!allowAll && branchId === '') {
      if (!branches.length) setError('You can’t review counts for any office.');
      return;
    }
    const range = PRESETS.find((p) => p.id === preset) ?? PRESETS[1];
    let cancelled = false;
    setBusy(true);
    setError(null);
    void getShrinkSummary(practiceId, {
      fromDate: range.from(),
      toDate: iso(new Date()),
      branchId: branchId === '' ? undefined : branchId,
    })
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load the report');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [practiceId, branchId, preset, loaded, allowAll, branches.length]);

  const shrinkTone =
    data?.shrinkPct == null ? undefined : data.shrinkPct > 3 ? 'bad' : data.shrinkPct > 2 ? 'warn' : 'good';
  const accuracyTone =
    data?.counts.accuracyPct == null
      ? undefined
      : data.counts.accuracyPct >= 95
        ? 'good'
        : data.counts.accuracyPct >= 85
          ? 'warn'
          : 'bad';
  const t = data?.thresholds;

  return (
    <div className="settings-section">
      <p className="settings-section-description" style={{ marginBottom: 12 }}>
        How much inventory is going missing and how reliable your counts are. Shrink is counts
        that came up short plus logged waste, at item cost. Count accuracy is the share of counts
        within your alert thresholds (Settings → Inventory). Good targets: accuracy 95%+, shrink
        under 2% of inventory value; over 3% usually means missed charges or unlogged waste.
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
          Period
          <select className="settings-input" value={preset} onChange={(e) => setPreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        {busy ? <span className="settings-muted">Loading…</span> : null}
      </div>

      {data ? (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12,
              marginBottom: 20,
            }}
          >
            <Kpi
              label="Shrink"
              value={formatUsd(data.shrinkUsd)}
              hint={`${pctText(data.shrinkPct)} of ${formatUsd(data.inventoryValueUsd)} on hand`}
              tone={shrinkTone}
            />
            <Kpi
              label="Count accuracy"
              value={pctText(data.counts.accuracyPct)}
              hint={`${data.counts.withinTolerance} of ${data.counts.itemsCounted} within threshold · ${pctText(data.counts.exactPct)} exact`}
              tone={accuracyTone}
            />
            <Kpi
              label="Flagged counts"
              value={data.counts.flagged}
              hint="Over threshold; a task was sent"
              tone={data.counts.flagged ? 'warn' : undefined}
            />
            <Kpi
              label="Counts short / over"
              value={
                <span>
                  <span className="par-short">{formatUsd(-data.counts.lossUsd)}</span>
                  {' / '}
                  {formatUsd(data.counts.gainUsd, true)}
                </span>
              }
              hint={`Net ${formatUsd(data.counts.netUsd, true)}`}
            />
            <Kpi
              label="Logged waste"
              value={formatUsd(data.waste.usd)}
              hint={`${data.waste.events} waste entr${data.waste.events === 1 ? 'y' : 'ies'}`}
            />
            <Kpi
              label="Weekly counts done"
              value={pctText(data.completion.pct)}
              hint={`${data.completion.done} of ${data.completion.due} items on weekly lists`}
              tone={
                data.completion.pct == null
                  ? undefined
                  : data.completion.pct >= 95
                    ? 'good'
                    : data.completion.pct >= 80
                      ? 'warn'
                      : 'bad'
              }
            />
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '8px 0' }}>
            By class
          </h3>
          <div className="settings-table-container" style={{ marginBottom: 20 }}>
            <table className="settings-table">
              <thead>
                <tr>
                  <th>Class</th>
                  <th>Flag when off by more than</th>
                  <th>Counted</th>
                  <th>Accuracy</th>
                  <th>Net $</th>
                </tr>
              </thead>
              <tbody>
                {data.byClass.map((c) => {
                  const th = t?.[c.abc as 'A' | 'B' | 'C'];
                  return (
                    <tr key={c.abc}>
                      <td>{c.abc}</td>
                      <td className="settings-muted">
                        {th
                          ? th.units === 0
                            ? 'Any difference'
                            : `${th.units} units${th.usd > 0 ? ` or ${formatUsd(th.usd)}` : ''}`
                          : '—'}
                      </td>
                      <td>{c.counted}</td>
                      <td>{pctText(c.accuracyPct)}</td>
                      <td className={c.netUsd < 0 ? 'par-short' : undefined}>
                        {formatUsd(c.netUsd, true)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '8px 0' }}>
            Biggest losses
          </h3>
          <ItemTable rows={data.topLosses} empty="No counts came up short in this period." />

          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '20px 0 8px' }}>
            Off more than once
          </h3>
          <p className="settings-muted" style={{ marginTop: 0 }}>
            Repeat differences point to a process problem (charging, waste logging, receiving) rather
            than a one-time miscount.
          </p>
          <ItemTable rows={data.repeatOffenders} empty="No item was off more than once." />

          <h3 style={{ fontSize: 15, fontWeight: 600, margin: '20px 0 8px' }}>
            By location
          </h3>
          {data.byLocation.length === 0 ? (
            <p className="settings-muted">No location counts in this period.</p>
          ) : (
            <div className="settings-table-container">
              <table className="settings-table">
                <thead>
                  <tr>
                    <th>Office</th>
                    <th>Location</th>
                    <th>Counts</th>
                    <th>Net units</th>
                    <th>Net $</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byLocation.map((l) => (
                    <tr key={l.branchLocationId}>
                      <td>{l.branchName}</td>
                      <td>{l.locationName}</td>
                      <td>{l.cells}</td>
                      <td>
                        {l.netUnits > 0 ? '+' : ''}
                        {Number(l.netUnits.toFixed(2))}
                      </td>
                      <td className={l.netUsd < 0 ? 'par-short' : undefined}>
                        {formatUsd(l.netUsd, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.counts.firstCounts > 0 ? (
            <p className="settings-muted" style={{ marginTop: 12 }}>
              {data.counts.firstCounts} first count{data.counts.firstCounts === 1 ? '' : 's'} in this
              period set opening balances and aren’t included in accuracy or shrink.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
