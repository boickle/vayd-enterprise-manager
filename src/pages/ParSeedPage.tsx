import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { usePermissions } from '../permissions/PermissionContext';
import {
  getParApprovalOffices,
  getParSeedSheet,
  listInventoryBranchLocations,
  listPracticeBranches,
  submitParSeed,
  type InventoryBranchLocation,
  type ParSeedResult,
  type ParSeedRow,
  type ParSeedSheet,
  type ParSeedSheetItem,
  type ParTargets,
  type PracticeBranch,
} from '../api/branchInventory';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import ParLevelsModeTabs from '../components/inventory/ParLevelsModeTabs';
import './Settings.css';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';
const LOC_STORAGE_PREFIX = 'vayd_inventory_par_seed_location:';
const USAGE_WINDOWS = [30, 60, 90, 180, 365];

type Field = keyof ParTargets;
type Draft = Record<Field, string>;
type Filter = 'all' | 'used' | 'unset' | 'set' | 'changed';

const fieldsFor = (isDefault: boolean): Field[] => (isDefault ? ['min', 'max'] : ['par']);
const FIELD_LABEL: Record<Field, string> = { par: 'Par', min: 'Min', max: 'Max' };

function show(n: number | null | undefined): string {
  return n == null ? '' : String(n);
}

/** Blank rather than 0 when the location has never been counted for this item. */
function knownOnHand(item: ParSeedSheetItem): number | null {
  return item.counted || item.onHand !== 0 ? item.onHand : null;
}

/** Blank rather than 0 when there is no recorded usage. */
function knownUsed(item: ParSeedSheetItem, sheet: ParSeedSheet): number | null {
  const used = sheet.isDefault ? item.usedOffice : item.usedHere;
  return used ? used : null;
}

function draftFor(item: ParSeedSheetItem): Draft {
  return { par: show(item.par), min: show(item.min), max: show(item.max) };
}

/** Parsed draft value: undefined = invalid, null = blank. */
function parseDraft(s: string): number | null | undefined {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t.replace(/,/g, ''));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function sortItems(items: ParSeedSheetItem[]): ParSeedSheetItem[] {
  return items.slice().sort((a, b) => {
    const ca = a.categoryName || 'Uncategorized';
    const cb = b.categoryName || 'Uncategorized';
    if (ca !== cb) return ca.localeCompare(cb);
    return a.name.localeCompare(b.name);
  });
}

function suggest(
  item: ParSeedSheetItem,
  sheet: ParSeedSheet,
  days: { par: number; min: number; max: number }
): ParTargets {
  const perDay = (used: number) => used / Math.max(1, sheet.usageDays);
  const cover = (used: number, d: number) =>
    used > 0 ? Math.max(1, Math.ceil(perDay(used) * d)) : null;
  if (!sheet.isDefault) return { par: cover(item.usedHere, days.par), min: null, max: null };
  const min = cover(item.usedOffice, days.min);
  const max = cover(item.usedOffice, days.max);
  return { par: null, min, max: min != null && max != null ? Math.max(min, max) : max };
}

function csvCell(value: string | number | null | undefined): string {
  const s = value == null ? '' : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function rowsFromCsv(
  text: string,
  isDefault: boolean
): { rows: ParSeedRow[]; error: string | null } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: 'The file has no rows under the header.' };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const find = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));
  const col = {
    code: find(/^code$/, /^item code$/, /^sku$/),
    name: find(/^item$/, /^name$/, /^item name$/, /^description$/),
    par: find(/^par( level)?$/),
    min: find(/^min(imum)?$/, /^reorder( point)?$/),
    max: find(/^max(imum)?$/, /^order up to$/),
  };
  if (col.code < 0 && col.name < 0) {
    return { rows: [], error: 'Could not find a "Code" or "Item" column in the header row.' };
  }
  if (isDefault ? col.min < 0 && col.max < 0 : col.par < 0) {
    return {
      rows: [],
      error: isDefault
        ? 'This is the default location — the file needs a "Min" and/or "Max" column.'
        : 'This location uses par — the file needs a "Par" column.',
    };
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : undefined);
  const rows = table.slice(1).map((r, i) => ({
    line: i + 2,
    code: get(r, col.code) || null,
    name: get(r, col.name) || null,
    par: get(r, col.par),
    min: get(r, col.min),
    max: get(r, col.max),
  }));
  return { rows, error: null };
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

function printSheet(sheet: ParSeedSheet, items: ParSeedSheetItem[]) {
  const fields = fieldsFor(sheet.isDefault);
  const head = `<tr><th class="code">Code</th><th>Item</th><th class="unit">Unit</th><th class="num">On hand</th><th class="num">Used ${sheet.usageDays}d</th>${fields
    .map(
      (f) =>
        `<th class="num">Now ${FIELD_LABEL[f].toLowerCase()}</th><th class="box">New ${FIELD_LABEL[f].toLowerCase()}</th>`
    )
    .join('')}</tr>`;
  let category = '';
  const body = sortItems(items)
    .map((i) => {
      const title = i.categoryName || 'Uncategorized';
      const heading =
        title !== category
          ? `<tr class="cat"><td colspan="${5 + fields.length * 2}">${escapeHtml(title)}</td></tr>`
          : '';
      category = title;
      return `${heading}<tr><td class="code">${escapeHtml(i.code)}</td><td>${escapeHtml(i.name)}</td><td class="unit">${escapeHtml(i.unit)}</td><td class="num">${show(knownOnHand(i))}</td><td class="num">${show(knownUsed(i, sheet))}</td>${fields
        .map((f) => `<td class="num">${show(i[f])}</td><td class="box"></td>`)
        .join('')}</tr>`;
    })
    .join('');
  const hint = sheet.isDefault
    ? 'Default location: <strong>Min</strong> is the reorder point (order when the office drops to this). <strong>Max</strong> is what to order up to. Usage is for the whole office.'
    : '<strong>Par</strong> is what this location should be filled back up to from the default location. Usage is from this location only.';
  const html = `<!doctype html><html><head><meta charset="utf-8" />
  <title>Par sheet — ${escapeHtml(sheet.branchName)} · ${escapeHtml(sheet.locationName)}</title>
  <style>
    body { font: 11px/1.3 -apple-system, system-ui, sans-serif; margin: 18px; color: #111; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    .hint { color: #555; margin: 4px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 4px 5px; text-align: left; vertical-align: top; }
    th { background: #f1f1f1; font-weight: 600; }
    tr { break-inside: avoid; } td { height: 18px; }
    tr.cat td { background: #fafafa; font-weight: 600; border-left: 0; border-right: 0; padding-top: 10px; }
    .code { width: 70px; } .unit { width: 54px; } .num { width: 52px; text-align: right; color: #444; } .box { width: 60px; }
    @media print { body { margin: 0; } thead { display: table-header-group; } }
  </style></head><body>
  <h1>Par levels — ${escapeHtml(sheet.branchName)} · ${escapeHtml(sheet.locationName)}</h1>
  <p class="hint">${hint} Write a number in the New box to change it, “clear” to remove it, or leave it blank to keep what’s there.</p>
  <table><thead>${head}</thead><tbody>${body}</tbody></table>
  <script>window.onload = function () { window.print(); };</script>
  </body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

function downloadCsv(sheet: ParSeedSheet, items: ParSeedSheetItem[]) {
  const fields = fieldsFor(sheet.isDefault);
  const header = [
    'Code',
    'Item',
    'Unit',
    'Category',
    'On hand',
    `Used last ${sheet.usageDays} days`,
    ...fields.map((f) => FIELD_LABEL[f]),
  ];
  const lines = [header.join(',')];
  for (const i of sortItems(items)) {
    lines.push(
      [
        i.code,
        i.name,
        i.unit,
        i.categoryName,
        knownOnHand(i),
        knownUsed(i, sheet),
        ...fields.map((f) => i[f]),
      ]
        .map(csvCell)
        .join(',')
    );
  }
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}\r\n`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = `${sheet.branchName}-${sheet.locationName}`
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  a.href = url;
  a.download = `par-levels-${slug}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ParSeedPage() {
  const { token } = useAuth();
  const { effective, error, can } = usePermissions();
  if (!effective) {
    return <p className="settings-muted">{error ?? 'Loading…'}</p>;
  }
  if (!can('inventory.par.manage', 'all')) {
    return (
      <div className="settings-card" style={{ padding: 16 }}>
        <h2 style={{ margin: '0 0 4px' }}>Set par levels</h2>
        <p className="settings-muted" style={{ margin: 0 }}>
          You need the &ldquo;Par levels and reorder points&rdquo; permission to change these.
        </p>
      </div>
    );
  }
  return <ParSeedWorkspace token={token} />;
}

function ParSeedWorkspace({ token }: { token: string | null }) {
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);

  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [allLocations, setAllLocations] = useState<
    Array<InventoryBranchLocation & { branchName: string }>
  >([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [usageDays, setUsageDays] = useState(90);
  const [sheet, setSheet] = useState<ParSeedSheet | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [coverDays, setCoverDays] = useState({ par: 7, min: 7, max: 21 });
  const [copyFrom, setCopyFrom] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    result: ParSeedResult;
    rows: ParSeedRow[];
    source: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void Promise.all([listPracticeBranches(practiceId), getParApprovalOffices(practiceId)])
      .then(async ([list, mine]) => {
        const all = list.filter((b) => b.isActive !== false);
        const active = all.filter((b) => mine === 'all' || mine.includes(b.id));
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
        const perBranch = await Promise.all(
          all.map((b) =>
            listInventoryBranchLocations(practiceId, b.id)
              .then((locs) =>
                locs.filter((l) => l.isActive !== false).map((l) => ({ ...l, branchName: b.name }))
              )
              .catch(() => [])
          )
        );
        setAllLocations(perBranch.flat());
      })
      .catch(() => setError('Could not load offices'));
  }, [practiceId]);

  useEffect(() => {
    if (branchId === '') {
      setLocations([]);
      setLocationId('');
      return;
    }
    try {
      localStorage.setItem(`${BRANCH_STORAGE_PREFIX}${practiceId}`, String(branchId));
    } catch {
      /* ignore */
    }
    void listInventoryBranchLocations(practiceId, Number(branchId))
      .then((locs) => {
        const active = locs.filter((l) => l.isActive !== false);
        setLocations(active);
        let saved: number | null = null;
        try {
          const n = Number(localStorage.getItem(`${LOC_STORAGE_PREFIX}${practiceId}:${branchId}`));
          if (Number.isFinite(n) && n > 0) saved = n;
        } catch {
          /* ignore */
        }
        const pick =
          active.find((l) => l.id === saved) || active.find((l) => !l.isDefault) || active[0];
        setLocationId(pick?.id ?? '');
      })
      .catch(() => {
        setLocations([]);
        setLocationId('');
      });
  }, [practiceId, branchId]);

  const reload = useCallback(async () => {
    if (branchId === '' || locationId === '') {
      setSheet(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await getParSeedSheet(
        practiceId,
        Number(branchId),
        Number(locationId),
        usageDays
      );
      setSheet(next);
      setDrafts(Object.fromEntries(next.items.map((i) => [i.inventoryItemId, draftFor(i)])));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load par levels');
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }, [practiceId, branchId, locationId, usageDays]);

  useEffect(() => {
    if (locationId === '') return;
    try {
      localStorage.setItem(`${LOC_STORAGE_PREFIX}${practiceId}:${branchId}`, String(locationId));
    } catch {
      /* ignore */
    }
    setPreview(null);
    setCopyFrom('');
    void reload();
  }, [practiceId, branchId, locationId, reload]);

  const items = useMemo(() => sheet?.items ?? [], [sheet]);
  const fields = fieldsFor(sheet?.isDefault ?? false);

  const changedFields = useCallback(
    (item: ParSeedSheetItem): Partial<Record<Field, number | null>> | 'invalid' | null => {
      const d = drafts[item.inventoryItemId];
      if (!d) return null;
      const out: Partial<Record<Field, number | null>> = {};
      for (const f of fields) {
        const v = parseDraft(d[f]);
        if (v === undefined) return 'invalid';
        if (v !== item[f]) out[f] = v;
      }
      return Object.keys(out).length ? out : null;
    },
    [drafts, fields]
  );

  const typedRows: ParSeedRow[] = useMemo(
    () =>
      items.flatMap((item) => {
        const c = changedFields(item);
        if (!c || c === 'invalid') return [];
        return [{ inventoryItemId: item.inventoryItemId, code: item.code, name: item.name, ...c }];
      }),
    [items, changedFields]
  );
  const invalidCount = items.filter((i) => changedFields(i) === 'invalid').length;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortItems(items).filter((item) => {
      const used = sheet?.isDefault ? item.usedOffice : item.usedHere;
      const isSet = fields.some((f) => item[f] != null);
      if (filter === 'used' && !(used > 0)) return false;
      if (filter === 'unset' && isSet) return false;
      if (filter === 'set' && !isSet) return false;
      if (filter === 'changed' && !changedFields(item)) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || (item.code || '').toLowerCase().includes(q);
    });
  }, [items, search, filter, sheet, fields, changedFields]);

  function setDraft(itemId: number, field: Field, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [itemId]: { ...(prev[itemId] ?? { par: '', min: '', max: '' }), [field]: value },
    }));
  }

  /** Fill drafts from a per-item source; `onlyBlank` keeps anything already typed or saved. */
  function fillDrafts(source: (item: ParSeedSheetItem) => ParTargets | null, onlyBlank: boolean) {
    let filled = 0;
    const next = { ...drafts };
    for (const item of visible) {
      const src = source(item);
      if (!src) continue;
      const d = { ...(next[item.inventoryItemId] ?? draftFor(item)) };
      let touched = false;
      for (const f of fields) {
        if (src[f] == null) continue;
        if (onlyBlank && d[f].trim() !== '') continue;
        d[f] = String(src[f]);
        touched = true;
      }
      if (touched) {
        next[item.inventoryItemId] = d;
        filled += 1;
      }
    }
    setDrafts(next);
    setToast(
      filled
        ? `Filled ${filled} item${filled === 1 ? '' : 's'} — review, then save.`
        : 'Nothing to fill.'
    );
    window.setTimeout(() => setToast(null), 4000);
  }

  async function copyFromLocation(onlyBlank: boolean) {
    const [b, l] = copyFrom.split(':').map(Number);
    if (!b || !l || !sheet) return;
    setBusy(true);
    setError(null);
    try {
      const src = await getParSeedSheet(practiceId, b, l, usageDays);
      const byId = new Map(src.items.map((i) => [i.inventoryItemId, i]));
      fillDrafts((item) => {
        const s = byId.get(item.inventoryItemId);
        if (!s) return null;
        if (sheet.isDefault === src.isDefault) return s;
        return sheet.isDefault
          ? { par: null, min: null, max: s.par }
          : { par: s.max, min: null, max: null };
      }, onlyBlank);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load that location');
    } finally {
      setBusy(false);
    }
  }

  async function runPreview(rows: ParSeedRow[], source: string) {
    if (branchId === '' || locationId === '') return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitParSeed(practiceId, Number(branchId), Number(locationId), {
        rows,
        dryRun: true,
      });
      setPreview({ result, rows, source });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not check the changes');
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!preview || branchId === '' || locationId === '') return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitParSeed(practiceId, Number(branchId), Number(locationId), {
        rows: preview.rows,
        dryRun: false,
      });
      setPreview(null);
      setToast(`Saved ${result.summary.changed} item${result.summary.changed === 1 ? '' : 's'}.`);
      window.setTimeout(() => setToast(null), 5000);
      await reload();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    if (!sheet) return;
    const { rows, error: parseError } = rowsFromCsv(await file.text(), sheet.isDefault);
    if (parseError) {
      setError(`${file.name}: ${parseError}`);
      return;
    }
    await runPreview(rows, file.name);
  }

  const copyChoices = allLocations.filter(
    (l) => l.id !== locationId && (sheet ? Boolean(l.isDefault) === sheet.isDefault : true)
  );
  const usedLabel = sheet?.isDefault ? 'Office used' : 'Used here';

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <ParLevelsModeTabs />
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Set par levels</h2>
          <p className="settings-muted" style={{ margin: 0, maxWidth: 56 * 16 }}>
            Set a whole location at once. The <strong>default location</strong> gets a{' '}
            <strong>min</strong> (reorder when the office is down to this) and a{' '}
            <strong>max</strong> (order up to this). <strong>Other locations</strong> (trucks,
            rooms) get a <strong>par</strong> — what they’re refilled to from the default location.
            Start from usage, copy another location, or fill in a sheet.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 10,
          marginTop: 16,
          alignItems: 'flex-end',
        }}
      >
        <label className="settings-label" style={{ margin: 0, minWidth: 160 }}>
          Office
          <select
            className="settings-input"
            value={branchId === '' ? '' : String(branchId)}
            onChange={(e) => setBranchId(e.target.value ? Number(e.target.value) : '')}
          >
            <option value="">Choose office</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ margin: 0, minWidth: 180 }}>
          Location
          <select
            className="settings-input"
            value={locationId === '' ? '' : String(locationId)}
            onChange={(e) => setLocationId(e.target.value ? Number(e.target.value) : '')}
            disabled={branchId === ''}
          >
            <option value="">Choose location</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.isDefault ? ' (default — min/max)' : ' (par)'}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ margin: 0, minWidth: 150 }}>
          Usage from the last
          <select
            className="settings-input"
            value={usageDays}
            onChange={(e) => setUsageDays(Number(e.target.value))}
          >
            {USAGE_WINDOWS.map((d) => (
              <option key={d} value={d}>
                {d} days
              </option>
            ))}
          </select>
        </label>
      </div>

      {sheet ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
          <ToolBox title="1 · Suggest from usage">
            {sheet.isDefault ? (
              <>
                <DaysInput
                  label="Min = days of office use"
                  value={coverDays.min}
                  onChange={(v) => setCoverDays((p) => ({ ...p, min: v }))}
                />
                <DaysInput
                  label="Max = days of office use"
                  value={coverDays.max}
                  onChange={(v) => setCoverDays((p) => ({ ...p, max: v }))}
                />
              </>
            ) : (
              <DaysInput
                label="Par = days of use here"
                value={coverDays.par}
                onChange={(v) => setCoverDays((p) => ({ ...p, par: v }))}
              />
            )}
            <button
              type="button"
              className="btn secondary"
              onClick={() => fillDrafts((i) => suggest(i, sheet, coverDays), true)}
            >
              Fill blanks
            </button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => fillDrafts((i) => suggest(i, sheet, coverDays), false)}
            >
              Replace all shown
            </button>
            <span className="settings-muted" style={{ fontSize: 12, flex: '1 1 240px' }}>
              {sheet.isDefault
                ? 'Min should cover the vendor’s lead time plus a buffer; max adds one order cycle.'
                : 'Par should cover the time between restocks (e.g. 7 days for a weekly truck refill).'}{' '}
              Uses sales and visit use recorded in Scout, so it gets better the longer you’re live.
              Items with no usage are skipped.
            </span>
          </ToolBox>

          <ToolBox title="2 · Copy from another location">
            <label className="settings-label" style={{ margin: 0, minWidth: 240 }}>
              {sheet.isDefault ? 'Another office’s default' : 'Another truck or room'}
              <select
                className="settings-input"
                value={copyFrom}
                onChange={(e) => setCopyFrom(e.target.value)}
              >
                <option value="">Choose location</option>
                {copyChoices.map((l) => (
                  <option key={l.id} value={`${l.branchId}:${l.id}`}>
                    {l.branchName} · {l.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="btn secondary"
              disabled={!copyFrom || busy}
              onClick={() => void copyFromLocation(true)}
            >
              Fill blanks
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={!copyFrom || busy}
              onClick={() => void copyFromLocation(false)}
            >
              Replace all shown
            </button>
            <span className="settings-muted" style={{ fontSize: 12, flex: '1 1 240px' }}>
              Good for identical trucks: set Truck 1, then copy it to the others.
            </span>
          </ToolBox>

          <ToolBox title="3 · Or fill in a sheet">
            <button
              type="button"
              className="btn secondary"
              disabled={!visible.length}
              onClick={() => {
                if (!printSheet(sheet, visible)) setError('Allow pop-ups to print the sheet.');
              }}
            >
              Print sheet
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={!visible.length}
              onClick={() => downloadCsv(sheet, visible)}
            >
              Download CSV
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => fileRef.current?.click()}
            >
              Upload filled CSV…
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (file) void onFile(file);
              }}
            />
            <span className="settings-muted" style={{ fontSize: 12, flex: '1 1 240px' }}>
              The CSV comes with today’s{' '}
              {fields.map((f) => FIELD_LABEL[f].toLowerCase()).join(' and ')} filled in. Change what
              you want, leave the rest. Blank leaves a value alone; type “clear” to remove one. Only
              the shown items are included.
            </span>
          </ToolBox>
        </div>
      ) : null}

      {preview ? (
        <PreviewPanel
          preview={preview.result}
          source={preview.source}
          busy={busy}
          onApply={() => void applyPreview()}
          onCancel={() => setPreview(null)}
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
        <label className="settings-label" style={{ margin: 0, flex: '1 1 200px' }}>
          Search
          <input
            className="settings-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name or code"
          />
        </label>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(
            [
              ['all', 'All'],
              ['used', 'Used recently'],
              ['unset', 'Not set'],
              ['set', 'Set'],
              ['changed', `Edited (${typedRows.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className="btn secondary"
              style={
                filter === id
                  ? { background: '#0f766e', color: '#fff', borderColor: '#0f766e' }
                  : undefined
              }
              onClick={() => setFilter(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn secondary"
          disabled={busy || typedRows.length === 0}
          onClick={() =>
            setDrafts(Object.fromEntries(items.map((i) => [i.inventoryItemId, draftFor(i)])))
          }
        >
          Undo edits
        </button>
        <button
          type="button"
          className="btn"
          disabled={busy || typedRows.length === 0 || invalidCount > 0}
          onClick={() => void runPreview(typedRows, 'typed')}
        >
          Review {typedRows.length || ''} change{typedRows.length === 1 ? '' : 's'}
        </button>
      </div>
      {invalidCount ? (
        <p style={{ color: '#b91c1c', fontSize: 13, margin: '6px 0 0' }}>
          {invalidCount} box{invalidCount === 1 ? ' has' : 'es have'} something that isn’t a number
          of 0 or more.
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
      ) : !sheet ? (
        <p className="settings-muted" style={{ marginTop: 16 }}>
          Choose an office and location to begin.
        </p>
      ) : (
        <div
          className="settings-table-container settings-table-container--sticky-head"
          style={{ marginTop: 12 }}
        >
          <table className="settings-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th style={{ textAlign: 'right' }}>On hand</th>
                <th
                  style={{ textAlign: 'right' }}
                  title={`Sales and visit use in the last ${sheet.usageDays} days`}
                >
                  {usedLabel} ({sheet.usageDays}d)
                </th>
                <th>Suggested</th>
                {fields.map((f) => (
                  <th key={f} style={{ minWidth: 90 }}>
                    {FIELD_LABEL[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => {
                const d = drafts[item.inventoryItemId] ?? draftFor(item);
                const s = suggest(item, sheet, coverDays);
                const used = sheet.isDefault ? item.usedOffice : item.usedHere;
                const minV = parseDraft(d.min);
                const maxV = parseDraft(d.max);
                const minOverMax = sheet.isDefault && minV != null && maxV != null && minV > maxV;
                return (
                  <tr key={item.inventoryItemId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div className="settings-muted" style={{ fontSize: 12 }}>
                        {[item.code, item.categoryName].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>{item.unit || '—'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {knownOnHand(item) ?? <span className="settings-muted">—</span>}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {used || <span className="settings-muted">—</span>}
                    </td>
                    <td className="settings-muted" style={{ fontSize: 12 }}>
                      {fields.some((f) => s[f] != null)
                        ? fields
                            .map((f) => `${FIELD_LABEL[f].toLowerCase()} ${show(s[f]) || '—'}`)
                            .join(' · ')
                        : '—'}
                    </td>
                    {fields.map((f) => {
                      const v = parseDraft(d[f]);
                      const dirty = v !== undefined && v !== item[f];
                      const bad = v === undefined || (minOverMax && f === 'min');
                      return (
                        <td key={f}>
                          <input
                            className="settings-input"
                            inputMode="decimal"
                            value={d[f]}
                            onChange={(e) => setDraft(item.inventoryItemId, f, e.target.value)}
                            aria-label={`${item.name} ${FIELD_LABEL[f]}`}
                            title={minOverMax && f === 'min' ? 'Min is above max' : undefined}
                            style={{
                              width: 80,
                              background: dirty ? '#fefce8' : undefined,
                              borderColor: bad ? '#dc2626' : dirty ? '#ca8a04' : undefined,
                            }}
                          />
                          {dirty ? (
                            <div className="settings-muted" style={{ fontSize: 11 }}>
                              was {show(item[f]) || 'blank'}
                            </div>
                          ) : null}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={5 + fields.length} className="settings-muted">
                    No items match.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ToolBox({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: 12, border: '1px solid #e5e7eb', borderRadius: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>{title}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        {children}
      </div>
    </div>
  );
}

function DaysInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="settings-label" style={{ margin: 0, width: 170 }}>
      {label}
      <input
        className="settings-input"
        type="number"
        min={1}
        max={365}
        value={value}
        onChange={(e) => onChange(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
      />
    </label>
  );
}

function PreviewPanel({
  preview,
  source,
  busy,
  onApply,
  onCancel,
}: {
  preview: ParSeedResult;
  source: string;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const { summary } = preview;
  const fields = fieldsFor(preview.isDefault);
  const errors = preview.rows.filter((r) => r.error);
  const changed = preview.rows.filter((r) => !r.error && r.changed);
  const blocked = errors.length > 0 || changed.length === 0;
  return (
    <div
      style={{
        marginTop: 14,
        padding: 14,
        border: '2px solid #0f766e',
        borderRadius: 8,
        background: '#f8fffd',
      }}
    >
      <h3 style={{ margin: '0 0 6px' }}>
        Review before saving {source === 'typed' ? 'your edits' : `“${source}”`}
      </h3>
      <p style={{ margin: '0 0 8px', fontSize: 13 }}>
        <strong>{summary.changed}</strong> item{summary.changed === 1 ? '' : 's'} will change
        {summary.unchanged ? ` · ${summary.unchanged} unchanged` : ''}
        {summary.errors ? ` · ${summary.errors} to fix` : ''}
      </p>
      {errors.length ? (
        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
          <strong>Nothing is saved until these are fixed:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {errors.map((r) => (
              <li key={`${r.line}-${r.name}`}>
                {source !== 'typed' ? `Row ${r.line}: ` : ''}
                {r.name} — {r.error}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {changed.length ? (
        <div
          className="settings-table-container settings-table-container--sticky-head"
          style={{ maxHeight: 360 }}
        >
          <table className="settings-table">
            <thead>
              <tr>
                <th>Item</th>
                {fields.map((f) => (
                  <th key={f}>{FIELD_LABEL[f]}</th>
                ))}
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {changed.map((r) => (
                <tr key={r.inventoryItemId ?? r.line}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.name}</div>
                    {r.code ? (
                      <div className="settings-muted" style={{ fontSize: 12 }}>
                        {r.code}
                      </div>
                    ) : null}
                  </td>
                  {fields.map((f) => {
                    const before = r.before?.[f] ?? null;
                    const after = r.after?.[f] ?? null;
                    return (
                      <td key={f}>
                        {before === after ? (
                          <span className="settings-muted">{show(after) || '—'}</span>
                        ) : (
                          <>
                            <span className="settings-muted">{show(before) || 'blank'}</span> →{' '}
                            <strong>{show(after) || 'cleared'}</strong>
                          </>
                        )}
                      </td>
                    );
                  })}
                  <td style={{ fontSize: 12 }}>
                    {r.warnings.map((w) => (
                      <div key={w} style={{ color: '#b45309' }}>
                        {w}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button type="button" className="btn" disabled={busy || blocked} onClick={onApply}>
          {busy ? 'Saving…' : `Save ${changed.length} change${changed.length === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
