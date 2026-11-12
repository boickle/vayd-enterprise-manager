import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { usePermissions } from '../permissions/PermissionContext';
import {
  getParApprovalOffices,
  getParReview,
  keepParReview,
  listPracticeBranches,
  patchParReviewSettings,
  submitParSeed,
  type ParReview,
  type ParReviewItem,
  type ParReviewSettings,
  type ParTargets,
  type PracticeBranch,
} from '../api/branchInventory';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';

type Field = keyof ParTargets;
const FIELD_LABEL: Record<Field, string> = { par: 'Par', min: 'Min', max: 'Max' };
const fieldsFor = (isDefault: boolean): Field[] => (isDefault ? ['min', 'max'] : ['par']);
const show = (n: number | null | undefined) => (n == null ? '' : String(n));
const rowKey = (locationId: number, itemId: number) => `${locationId}:${itemId}`;

type Draft = { selected: boolean; values: Record<Field, string> };

function parse(s: string): number | null | undefined {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export default function ParReviewPage() {
  const { token } = useAuth();
  const { effective, error, can } = usePermissions();
  if (!effective) {
    return <p className="settings-muted">{error ?? 'Loading…'}</p>;
  }
  if (!can('inventory.par.manage', 'all')) {
    return (
      <div className="settings-card" style={{ padding: 16 }}>
        <h2 style={{ margin: '0 0 4px' }}>Par review</h2>
        <p className="settings-muted" style={{ margin: 0 }}>
          You need the &ldquo;Par levels and reorder points&rdquo; permission to approve par, min
          and max changes.
        </p>
      </div>
    );
  }
  return <ParReviewWorkspace token={token} />;
}

function ParReviewWorkspace({ token }: { token: string | null }) {
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [offices, setOffices] = useState<number[] | 'all' | null>(null);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [review, setReview] = useState<ParReview | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    void Promise.all([listPracticeBranches(practiceId), getParApprovalOffices(practiceId)])
      .then(([list, mine]) => {
        const active = list.filter(
          (b) => b.isActive !== false && (mine === 'all' || mine.includes(b.id))
        );
        setOffices(mine);
        setBranches(active);
        let saved: number | null = null;
        try {
          const n = Number(localStorage.getItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`));
          if (Number.isFinite(n) && n > 0) saved = n;
        } catch {
          /* ignore */
        }
        const pick =
          active.find((b) => b.id === saved) || active.find((b) => b.isDefault) || active[0];
        if (pick) setBranchId(pick.id);
      })
      .catch(() => setError('Could not load offices'));
  }, [practiceId]);

  const reload = useCallback(async () => {
    if (branchId === '') return;
    setLoading(true);
    setError(null);
    try {
      const next = await getParReview(practiceId, Number(branchId));
      setReview(next);
      const d: Record<string, Draft> = {};
      for (const loc of next.locations) {
        for (const item of loc.items) {
          d[rowKey(loc.locationId, item.inventoryItemId)] = {
            selected: true,
            values: {
              par: show(item.suggested.par ?? item.current.par),
              min: show(item.suggested.min ?? item.current.min),
              max: show(item.suggested.max ?? item.current.max),
            },
          };
        }
      }
      setDrafts(d);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load the review');
      setReview(null);
    } finally {
      setLoading(false);
    }
  }, [practiceId, branchId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  function patchDraft(key: string, patch: Partial<Draft> | { field: Field; value: string }) {
    setDrafts((prev) => {
      const cur = prev[key];
      if (!cur) return prev;
      if ('field' in patch) {
        return {
          ...prev,
          [key]: { ...cur, values: { ...cur.values, [patch.field]: patch.value } },
        };
      }
      return { ...prev, [key]: { ...cur, ...patch } };
    });
  }

  function selectedIn(loc: ParReview['locations'][number]) {
    return loc.items.filter((i) => drafts[rowKey(loc.locationId, i.inventoryItemId)]?.selected);
  }

  async function accept(loc: ParReview['locations'][number]) {
    if (branchId === '') return;
    const fields = fieldsFor(loc.isDefault);
    const picked = selectedIn(loc);
    const rows = [];
    for (const item of picked) {
      const d = drafts[rowKey(loc.locationId, item.inventoryItemId)];
      const row: Record<string, number | null | string> & { inventoryItemId: number } = {
        inventoryItemId: item.inventoryItemId,
      };
      for (const f of fields) {
        const v = parse(d.values[f]);
        if (v === undefined) {
          setError(`${item.name}: ${FIELD_LABEL[f]} must be a number of 0 or more.`);
          return;
        }
        row[f] = v;
      }
      rows.push(row);
    }
    if (!rows.length) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitParSeed(practiceId, Number(branchId), loc.locationId, {
        rows,
        dryRun: false,
      });
      const problems = res.rows.filter((r) => r.error);
      if (problems.length) {
        setError(
          `Nothing saved for ${loc.locationName}: ${problems
            .slice(0, 3)
            .map((r) => `${r.name} — ${r.error}`)
            .join('; ')}`
        );
        return;
      }
      setToast(
        `${loc.locationName}: updated ${res.summary.changed} item${res.summary.changed === 1 ? '' : 's'}.`
      );
      window.setTimeout(() => setToast(null), 5000);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function keep(loc: ParReview['locations'][number]) {
    if (branchId === '') return;
    const picked = selectedIn(loc);
    if (!picked.length) return;
    setBusy(true);
    setError(null);
    try {
      await keepParReview(
        practiceId,
        Number(branchId),
        loc.locationId,
        picked.map((i) => ({ inventoryItemId: i.inventoryItemId, suggested: i.suggested }))
      );
      setToast(
        `${loc.locationName}: kept the current numbers for ${picked.length} item${picked.length === 1 ? '' : 's'}. They'll come back only if usage shifts again.`
      );
      window.setTimeout(() => setToast(null), 6000);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  const settings = review?.settings;

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Par review</h2>
          <p className="settings-muted" style={{ margin: 0, maxWidth: 56 * 16 }}>
            Items whose recent usage says the par, min or max is off. Nothing changes until you
            accept. On the 1st of each month the office’s par approver gets a task when there’s
            something to review.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignSelf: 'flex-start' }}>
          <Link className="btn secondary" to="/schedule/inventory/par-seed">
            Set par levels (bulk)
          </Link>
          {offices === 'all' ? (
            <button
              type="button"
              className="btn secondary"
              onClick={() => setShowSettings((v) => !v)}
            >
              Settings
            </button>
          ) : null}
        </div>
      </div>

      {showSettings && settings ? (
        <SettingsPanel
          practiceId={practiceId}
          settings={settings}
          onSaved={() => {
            setShowSettings(false);
            void reload();
          }}
        />
      ) : null}

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 16,
          alignItems: 'flex-end',
        }}
      >
        <label className="settings-label" style={{ margin: 0, minWidth: 180 }}>
          Office
          <select
            className="settings-input"
            value={branchId === '' ? '' : String(branchId)}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        {settings ? (
          <span className="settings-muted" style={{ fontSize: 12, paddingBottom: 6 }}>
            Based on the last {settings.usageDays} days · par = {settings.parDays} days of use · min
            = {settings.minDays} / max = {settings.maxDays} days of office use · flagged when more
            than {settings.thresholdPct}% off
          </span>
        ) : null}
      </div>
      {offices !== null && offices !== 'all' && branches.length === 0 ? (
        <p className="settings-muted" style={{ marginTop: 12 }}>
          Your role isn’t assigned to an office. Ask a practice manager to set the office on your
          role.
        </p>
      ) : null}

      {toast ? (
        <p className="settings-message" style={{ marginTop: 10 }}>
          {toast}
        </p>
      ) : null}
      {error ? (
        <div className="settings-message settings-error-message" style={{ marginTop: 10 }}>
          {error}
        </div>
      ) : null}

      {loading ? (
        <p className="settings-muted" style={{ marginTop: 16 }}>
          Loading…
        </p>
      ) : review ? (
        <>
          <UncountedPanel review={review} />
          {review.total === 0 ? (
            <p style={{ marginTop: 16, color: '#166534', fontWeight: 600 }}>
              No par changes to review at {review.branchName} — every par, min and max is close to
              what usage suggests.
            </p>
          ) : null}
          {review.locations
            .filter((loc) => loc.items.length)
            .map((loc) => (
              <LocationBlock
                key={loc.locationId}
                loc={loc}
                drafts={drafts}
                busy={busy}
                onToggle={(key, selected) => patchDraft(key, { selected })}
                onToggleAll={(selected) =>
                  setDrafts((prev) => {
                    const next = { ...prev };
                    for (const i of loc.items) {
                      const k = rowKey(loc.locationId, i.inventoryItemId);
                      if (next[k]) next[k] = { ...next[k], selected };
                    }
                    return next;
                  })
                }
                onValue={(key, field, value) => patchDraft(key, { field, value })}
                onAccept={() => void accept(loc)}
                onKeep={() => void keep(loc)}
                selectedCount={selectedIn(loc).length}
              />
            ))}
        </>
      ) : null}
    </div>
  );
}

function LocationBlock({
  loc,
  drafts,
  busy,
  selectedCount,
  onToggle,
  onToggleAll,
  onValue,
  onAccept,
  onKeep,
}: {
  loc: ParReview['locations'][number];
  drafts: Record<string, Draft>;
  busy: boolean;
  selectedCount: number;
  onToggle: (key: string, selected: boolean) => void;
  onToggleAll: (selected: boolean) => void;
  onValue: (key: string, field: Field, value: string) => void;
  onAccept: () => void;
  onKeep: () => void;
}) {
  const fields = fieldsFor(loc.isDefault);
  const allSelected = selectedCount === loc.items.length;
  return (
    <div style={{ marginTop: 18 }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          gap: 8,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <h3 style={{ margin: 0 }}>
          {loc.locationName}{' '}
          <span className="settings-muted" style={{ fontWeight: 400, fontSize: 13 }}>
            {loc.isDefault
              ? 'default location · min / max from office usage'
              : 'par from usage here'}
          </span>
        </h3>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn"
            disabled={busy || !selectedCount}
            onClick={onAccept}
          >
            Accept {selectedCount} selected
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={busy || !selectedCount}
            onClick={onKeep}
          >
            Keep current for selected
          </button>
        </div>
      </div>
      <div
        className="settings-table-container settings-table-container--sticky-head"
        style={{ marginTop: 8 }}
      >
        <table className="settings-table">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => onToggleAll(e.target.checked)}
                  aria-label={`Select all at ${loc.locationName}`}
                />
              </th>
              <th>Item</th>
              <th style={{ textAlign: 'right' }}>On hand</th>
              <th style={{ textAlign: 'right' }}>Used</th>
              {fields.map((f) => (
                <th key={f}>{FIELD_LABEL[f]}: now → new</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loc.items.map((item: ParReviewItem) => {
              const key = rowKey(loc.locationId, item.inventoryItemId);
              const d = drafts[key];
              if (!d) return null;
              return (
                <tr key={key} style={d.selected ? undefined : { opacity: 0.55 }}>
                  <td>
                    <input
                      type="checkbox"
                      checked={d.selected}
                      onChange={(e) => onToggle(key, e.target.checked)}
                      aria-label={`Select ${item.name}`}
                    />
                  </td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{item.name}</div>
                    <div className="settings-muted" style={{ fontSize: 12 }}>
                      {[item.code, item.unit, item.notSet ? 'not set yet' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                    {!item.counted ? (
                      <div style={{ fontSize: 12, color: '#b45309' }}>
                        Not counted here yet — on hand is a guess
                      </div>
                    ) : null}
                  </td>
                  <td style={{ textAlign: 'right' }}>{item.onHand}</td>
                  <td style={{ textAlign: 'right' }}>{item.used}</td>
                  {fields.map((f) => (
                    <td key={f}>
                      <span className="settings-muted">{show(item.current[f]) || 'blank'}</span> →{' '}
                      <input
                        className="settings-input"
                        inputMode="decimal"
                        value={d.values[f]}
                        onChange={(e) => onValue(key, f, e.target.value)}
                        aria-label={`${item.name} new ${FIELD_LABEL[f]}`}
                        style={{ width: 70, display: 'inline-block' }}
                      />
                      {item.suggested[f] != null && show(item.suggested[f]) !== d.values[f] ? (
                        <div className="settings-muted" style={{ fontSize: 11 }}>
                          suggested {item.suggested[f]}
                        </div>
                      ) : null}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UncountedPanel({ review }: { review: ParReview }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!review.uncountedTotal) {
    return (
      <p className="settings-muted" style={{ marginTop: 16, fontSize: 13 }}>
        Everything in use at {review.branchName} has had its first count.
      </p>
    );
  }
  const controlled = review.locations.reduce(
    (n, l) => n + l.uncounted.filter((u) => u.isControlled).length,
    0
  );
  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        border: '1px solid #fcd34d',
        background: '#fffbeb',
        borderRadius: 8,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <div>
          <strong>
            Not counted yet: {review.uncountedTotal} item{review.uncountedTotal === 1 ? '' : 's'}
          </strong>
          {controlled ? (
            <span style={{ color: '#b91c1c', fontWeight: 600 }}> · {controlled} controlled</span>
          ) : null}
          <div className="settings-muted" style={{ fontSize: 12, maxWidth: 640 }}>
            These are in use, on hand, or have a par/min/max, but the shelf has never been counted.
            Their on-hand numbers still come from eVet, so reorders and refills for them are
            guesses. Par suggestions are still fine — they come from usage, not on hand.
          </div>
        </div>
        <Link
          className="btn secondary"
          to="/schedule/inventory/first-counts"
          style={{ alignSelf: 'flex-start' }}
        >
          Go to First counts
        </Link>
      </div>
      <ul style={{ margin: '8px 0 0', paddingLeft: 18, fontSize: 13 }}>
        {review.locations
          .filter((l) => l.uncounted.length)
          .map((l) => (
            <li key={l.locationId} style={{ marginBottom: 4 }}>
              <button
                type="button"
                className="mail-queue__pet-link"
                style={{
                  background: 'none',
                  border: 0,
                  padding: 0,
                  cursor: 'pointer',
                  font: 'inherit',
                }}
                onClick={() => setOpen(open === l.locationId ? null : l.locationId)}
              >
                {l.locationName}: {l.uncounted.length} item{l.uncounted.length === 1 ? '' : 's'}
                {l.uncounted.some((u) => u.isControlled)
                  ? ` (${l.uncounted.filter((u) => u.isControlled).length} controlled)`
                  : ''}{' '}
                {open === l.locationId ? '▾' : '▸'}
              </button>
              {open === l.locationId ? (
                <div style={{ marginTop: 4, fontSize: 12 }}>
                  {l.uncounted.map((u) => (
                    <div key={u.inventoryItemId}>
                      {u.isControlled ? (
                        <span style={{ color: '#991b1b', fontWeight: 600 }}>Controlled · </span>
                      ) : null}
                      {u.name}
                      <span className="settings-muted">
                        {' '}
                        · {u.used ? `used ${u.used}` : 'no recent use'} · eVet on hand {u.onHand}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </li>
          ))}
      </ul>
    </div>
  );
}

function SettingsPanel({
  practiceId,
  settings,
  onSaved,
}: {
  practiceId: number;
  settings: ParReviewSettings;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const num = (key: keyof ParReviewSettings, label: string, hint: string) => (
    <label className="settings-label" style={{ margin: 0, width: 190 }}>
      {label}
      <input
        className="settings-input"
        type="number"
        min={1}
        value={Number(draft[key])}
        onChange={(e) => setDraft((p) => ({ ...p, [key]: Number(e.target.value) || 1 }))}
      />
      <span className="settings-muted" style={{ fontSize: 11 }}>
        {hint}
      </span>
    </label>
  );
  return (
    <div style={{ marginTop: 14, padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
        Monthly review settings (whole practice)
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        {num('usageDays', 'Usage window (days)', 'How far back to look')}
        {num('parDays', 'Par = days of use', 'Time between truck/room restocks')}
        {num('minDays', 'Min = days of office use', 'Vendor lead time + buffer')}
        {num('maxDays', 'Max = days of office use', 'Min + one order cycle')}
        {num('thresholdPct', 'Flag when off by (%)', 'Smaller = more items to review')}
        <label
          className="settings-label"
          style={{ margin: 0, display: 'flex', gap: 6, alignItems: 'center', paddingTop: 20 }}
        >
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft((p) => ({ ...p, enabled: e.target.checked }))}
          />
          Send the monthly task
        </label>
      </div>
      {error ? (
        <div className="settings-message settings-error-message" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
      <button
        type="button"
        className="btn"
        style={{ marginTop: 10 }}
        disabled={busy}
        onClick={() => {
          setBusy(true);
          setError(null);
          void patchParReviewSettings(practiceId, draft)
            .then(onSaved)
            .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not save'))
            .finally(() => setBusy(false));
        }}
      >
        Save settings
      </button>
    </div>
  );
}
