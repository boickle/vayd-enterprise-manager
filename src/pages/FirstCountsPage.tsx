import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { usePermissions } from '../permissions/PermissionContext';
import {
  getFirstCountProgress,
  getFirstCountSheet,
  listInventoryBranchLocations,
  listPracticeBranches,
  submitFirstCount,
  type FirstCountProgress,
  type FirstCountResult,
  type FirstCountRow,
  type FirstCountSheet,
  type FirstCountSheetItem,
  type CountUploadMode,
  type InventoryBranchLocation,
  type PracticeBranch,
} from '../api/branchInventory';
import { resolvePracticeIdFromToken } from '../utils/practiceIdFromToken';
import { appConfirm } from '../utils/appDialog';
import './Settings.css';

/** Matches the API's warning on a line whose weighed and counted mL disagree. */
const WEIGH_MISMATCH_WARNING = 'Weighed amount and counted mL disagree';

const BRANCH_STORAGE_PREFIX = 'vayd_inventory_branch:';
const LOC_STORAGE_PREFIX = 'vayd_inventory_first_count_location:';
const WRITE_IN_LINES = 20;

type Draft = {
  quantity: string;
  weight: string;
  bottles: string;
  lotNumber: string;
  expirationDate: string;
};
type Filter = 'uncounted' | 'controlled' | 'counted' | 'all';
type SheetScope = 'uncounted' | 'controlled' | 'all';

const EMPTY_DRAFT: Draft = {
  quantity: '',
  weight: '',
  bottles: '',
  lotNumber: '',
  expirationDate: '',
};

function formatWhen(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      });
}

function sortForSheet(items: FirstCountSheetItem[]): FirstCountSheetItem[] {
  return items.slice().sort((a, b) => {
    if (a.isControlled !== b.isControlled) return a.isControlled ? -1 : 1;
    const ca = a.categoryName || 'Uncategorized';
    const cb = b.categoryName || 'Uncategorized';
    if (ca !== cb) return ca.localeCompare(cb);
    return a.name.localeCompare(b.name);
  });
}

function scopeItems(items: FirstCountSheetItem[], scope: SheetScope) {
  if (scope === 'controlled') return items.filter((i) => i.isControlled);
  if (scope === 'uncounted') return items.filter((i) => !i.firstCountedAt);
  return items;
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

function rowsFromCsv(text: string): { rows: FirstCountRow[]; error: string | null } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], error: 'The file has no rows under the header.' };
  const header = table[0].map((h) => h.trim().toLowerCase());
  const find = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));
  const col = {
    code: find(/^code$/, /item code/, /^sku$/),
    name: find(/^item$/, /^name$/, /item name/, /description/),
    qty: find(/^count$/, /counted/, /^qty$/, /quantity/, /on ?hand/),
    weight: find(/^weight/, /weighed/),
    bottles: find(/bottle/),
    lot: find(/lot/),
    exp: find(/^exp/, /expiration/),
    note: find(/note/),
  };
  if (col.qty < 0 && col.weight < 0) {
    return { rows: [], error: 'Could not find a "Count" column in the header row.' };
  }
  if (col.code < 0 && col.name < 0) {
    return { rows: [], error: 'Could not find a "Code" or "Item" column in the header row.' };
  }
  const get = (r: string[], i: number) => (i >= 0 ? (r[i] ?? '').trim() : '');
  const rows = table.slice(1).map((r, i) => ({
    rowNumber: i + 2,
    code: get(r, col.code) || null,
    name: get(r, col.name) || null,
    quantity: get(r, col.qty),
    weight: get(r, col.weight) || null,
    bottles: get(r, col.bottles) || null,
    lotNumber: get(r, col.lot) || null,
    expirationDate: get(r, col.exp) || null,
    note: get(r, col.note) || null,
  }));
  return { rows, error: null };
}

function escapeHtml(s: string | null | undefined): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

function printSheet(sheet: FirstCountSheet, items: FirstCountSheetItem[], mode: CountUploadMode) {
  const heading = mode === 'annual' ? 'Annual inventory count' : 'Inventory count';
  const sorted = sortForSheet(items);
  const groups: Array<{ title: string; items: FirstCountSheetItem[] }> = [];
  for (const item of sorted) {
    const title = item.isControlled
      ? 'Controlled substances — required before go-live'
      : item.categoryName || 'Uncategorized';
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.items.push(item);
    else groups.push({ title, items: [item] });
  }
  const head =
    '<tr><th class="code">Code</th><th>Item</th><th class="unit">Unit</th><th class="box">Count</th><th class="weight">Weight · bottles</th><th class="lot">Lot #</th><th class="exp">Exp</th><th class="notes">Notes</th></tr>';
  const countCell = (i: FirstCountSheetItem) =>
    i.measure === 'weight' ? '<td class="box na">weigh →</td>' : '<td class="box"></td>';
  const weightCell = (i: FirstCountSheetItem) =>
    i.measure === 'volume'
      ? '<td class="weight na"></td>'
      : `<td class="weight"><span class="u">${i.weightUnit}</span><span class="u b">× bottles</span></td>`;
  const body = groups
    .map(
      (g) => `
      <h2>${escapeHtml(g.title)}</h2>
      <table><thead>${head}</thead><tbody>
      ${g.items
        .map(
          (i) =>
            `<tr><td class="code">${escapeHtml(i.code)}</td><td>${escapeHtml(i.name)}</td><td class="unit">${escapeHtml(i.unit)}</td>${countCell(i)}${weightCell(i)}<td class="lot"></td><td class="exp"></td><td class="notes"></td></tr>`
        )
        .join('')}
      </tbody></table>`
    )
    .join('');
  const writeIns = Array.from({ length: WRITE_IN_LINES })
    .map(
      () =>
        '<tr><td class="code"></td><td></td><td class="unit"></td><td class="box"></td><td class="weight"></td><td class="lot"></td><td class="exp"></td><td class="notes"></td></tr>'
    )
    .join('');
  const html = `<!doctype html><html><head><meta charset="utf-8" />
  <title>Count sheet — ${escapeHtml(sheet.branchName)} · ${escapeHtml(sheet.locationName)}</title>
  <style>
    body { font: 11px/1.3 -apple-system, system-ui, sans-serif; margin: 18px; color: #111; }
    h1 { font-size: 16px; margin: 0 0 4px; }
    h2 { font-size: 12px; margin: 14px 0 4px; break-after: avoid; }
    .meta { display: flex; gap: 24px; margin: 6px 0 4px; }
    .meta span { flex: 1; border-bottom: 1px solid #333; padding-bottom: 2px; }
    .hint { color: #555; margin: 4px 0 8px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #999; padding: 4px 5px; text-align: left; vertical-align: top; }
    th { background: #f1f1f1; font-weight: 600; }
    tr { break-inside: avoid; }
    td { height: 18px; }
    .code { width: 70px; } .unit { width: 54px; } .box { width: 60px; }
    .lot { width: 80px; } .exp { width: 62px; } .notes { width: 110px; }
    .weight { width: 96px; } .na { background: #f4f4f4; color: #888; font-size: 9px; }
    .u { color: #888; font-size: 9px; float: right; margin-left: 4px; } .u.b { float: none; display: block; margin-top: 8px; }
    @media print { body { margin: 0; } thead { display: table-header-group; } }
  </style></head><body>
  <h1>${heading} — ${escapeHtml(sheet.branchName)} · ${escapeHtml(sheet.locationName)}</h1>
  <div class="meta"><span>Counted by:</span><span>Date &amp; time counted:</span></div>
  <p class="hint">Count what is physically on this shelf, in the unit shown (e.g. capsules, not bottles). Leave Count blank if you didn't count it; write 0 if there is none.
  One lot per line — use a write-in line (same code) for each extra lot, and count every lot of an item at the same time. Exp can be 3/2027. Items not on the list go in Write-ins at the end.
  Controlled liquids set up for weighing: weigh the bottles of a lot together and write the weight and how many bottles; Scout works out the mL.</p>
  ${body}
  <h2>Write-ins (not on the list, or extra lots)</h2>
  <table><thead>${head}</thead><tbody>${writeIns}</tbody></table>
  <script>window.onload = function () { window.print(); };</script>
  </body></html>`;
  const win = window.open('', '_blank');
  if (!win) return false;
  win.document.open();
  win.document.write(html);
  win.document.close();
  return true;
}

function downloadCsv(sheet: FirstCountSheet, items: FirstCountSheetItem[]) {
  const header = [
    'Code',
    'Item',
    'Unit',
    'Category',
    'Controlled',
    'Count',
    'Weight',
    'Weigh in',
    'Bottles',
    'Lot #',
    'Expiration',
    'Notes',
  ];
  const lines = [header.join(',')];
  for (const i of sortForSheet(items)) {
    const weighs = i.measure !== 'volume';
    lines.push(
      [
        i.code,
        i.name,
        i.unit,
        i.categoryName,
        i.isControlled ? 'Yes' : '',
        '',
        '',
        weighs ? i.weightUnit : '',
        '',
        '',
        '',
        '',
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
  a.download = `count-sheet-${slug}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function FirstCountsPage() {
  const { token } = useAuth();
  const { effective, error, can } = usePermissions();
  if (!effective) {
    return <p className="settings-muted">{error ?? 'Loading…'}</p>;
  }
  if (!can('inventory.count.baseline', 'all')) {
    return (
      <div className="settings-card" style={{ padding: 16 }}>
        <h2 style={{ margin: '0 0 4px' }}>First / annual counts</h2>
        <p className="settings-muted" style={{ margin: 0 }}>
          You need the &ldquo;First and annual counts&rdquo; permission to enter or upload counts.
          Send your filled-in count sheet to your inventory manager.
        </p>
      </div>
    );
  }
  return <FirstCountsWorkspace token={token} />;
}

function FirstCountsWorkspace({ token }: { token: string | null }) {
  const practiceId = useMemo(() => resolvePracticeIdFromToken(token), [token]);

  const [progress, setProgress] = useState<FirstCountProgress | null>(null);
  const [branches, setBranches] = useState<PracticeBranch[]>([]);
  const [locations, setLocations] = useState<InventoryBranchLocation[]>([]);
  const [branchId, setBranchId] = useState<number | ''>('');
  const [locationId, setLocationId] = useState<number | ''>('');
  const [sheet, setSheet] = useState<FirstCountSheet | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft[]>>({});
  const [mode, setMode] = useState<CountUploadMode>('first');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('uncounted');
  const [scope, setScope] = useState<SheetScope>('uncounted');
  const [countedAt, setCountedAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    result: FirstCountResult;
    rows: FirstCountRow[];
    source: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadProgress = useCallback(() => {
    void getFirstCountProgress(practiceId)
      .then(setProgress)
      .catch(() => setProgress(null));
  }, [practiceId]);

  useEffect(() => {
    loadProgress();
    void listPracticeBranches(practiceId)
      .then((list) => {
        const active = list.filter((b) => b.isActive !== false);
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
  }, [practiceId, loadProgress]);

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
          active.find((l) => l.id === saved) || active.find((l) => l.isDefault) || active[0];
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
      setSheet(await getFirstCountSheet(practiceId, Number(branchId), Number(locationId)));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load the count sheet');
      setSheet(null);
    } finally {
      setLoading(false);
    }
  }, [practiceId, branchId, locationId]);

  useEffect(() => {
    if (locationId === '') return;
    try {
      localStorage.setItem(`${LOC_STORAGE_PREFIX}${practiceId}:${branchId}`, String(locationId));
    } catch {
      /* ignore */
    }
    setDrafts({});
    setPreview(null);
    void reload();
  }, [practiceId, branchId, locationId, reload]);

  const items = useMemo(() => sheet?.items ?? [], [sheet]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortForSheet(items).filter((item) => {
      if (filter === 'uncounted' && item.firstCountedAt) return false;
      if (filter === 'counted' && !item.firstCountedAt) return false;
      if (filter === 'controlled' && !item.isControlled) return false;
      if (!q) return true;
      return item.name.toLowerCase().includes(q) || (item.code || '').toLowerCase().includes(q);
    });
  }, [items, search, filter]);

  const countedHere = items.filter((i) => i.firstCountedAt).length;
  const controlledHere = items.filter((i) => i.isControlled);
  const controlledLeft = controlledHere.filter((i) => !i.firstCountedAt).length;
  const typedRows: FirstCountRow[] = useMemo(
    () =>
      Object.entries(drafts).flatMap(([id, lots]) => {
        const item = items.find((i) => i.inventoryItemId === Number(id));
        return lots
          .filter((d) => d.quantity.trim() !== '' || d.weight.trim() !== '')
          .map((d) => ({
            inventoryItemId: Number(id),
            code: item?.code ?? null,
            name: item?.name ?? null,
            quantity: d.quantity.trim(),
            weight: d.weight.trim() || null,
            bottles: d.bottles.trim() || null,
            lotNumber: d.lotNumber.trim() || null,
            expirationDate: d.expirationDate.trim() || null,
          }));
      }),
    [drafts, items]
  );
  const typedItemCount = new Set(typedRows.map((r) => r.inventoryItemId)).size;

  function setDraft(itemId: number, index: number, patch: Partial<Draft>) {
    setDrafts((prev) => {
      const lots = (prev[itemId] ?? [EMPTY_DRAFT]).slice();
      lots[index] = { ...(lots[index] ?? EMPTY_DRAFT), ...patch };
      return { ...prev, [itemId]: lots };
    });
  }

  function addLot(itemId: number) {
    setDrafts((prev) => ({ ...prev, [itemId]: [...(prev[itemId] ?? [EMPTY_DRAFT]), EMPTY_DRAFT] }));
  }

  function removeLot(itemId: number, index: number) {
    setDrafts((prev) => {
      const lots = (prev[itemId] ?? []).filter((_, i) => i !== index);
      return { ...prev, [itemId]: lots.length ? lots : [EMPTY_DRAFT] };
    });
  }

  function switchMode(next: CountUploadMode) {
    if (next === mode) return;
    setMode(next);
    setPreview(null);
    setFilter(next === 'annual' ? 'all' : 'uncounted');
    setScope(next === 'annual' ? 'all' : 'uncounted');
  }

  function countedAtIso(): string | null {
    if (!countedAt) return null;
    const d = new Date(countedAt);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }

  async function runPreview(rows: FirstCountRow[], source: string) {
    if (branchId === '' || locationId === '') return;
    setBusy(true);
    setError(null);
    try {
      const result = await submitFirstCount(practiceId, Number(branchId), Number(locationId), {
        rows,
        countedAt: countedAtIso(),
        dryRun: true,
        mode,
      });
      setPreview({ result, rows, source });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not check the counts');
    } finally {
      setBusy(false);
    }
  }

  async function applyPreview() {
    if (!preview || branchId === '' || locationId === '') return;
    // Controlled drugs are reconciled against Vet Snap: a weight that disagrees with the count
    // is never posted without someone saying the count is right (INV-08-7).
    const disputed = preview.result.items.filter(
      (row) => row.isControlled && row.warnings.includes(WEIGH_MISMATCH_WARNING)
    );
    if (disputed.length) {
      const ok = await appConfirm({
        title: 'Weight and count disagree',
        message: `The weighed amount and the counted mL disagree for ${disputed
          .map((row) => row.name)
          .join(', ')}. Post the counted mL anyway? Cancel to recount.`,
        confirmLabel: 'Post the counted mL',
        cancelLabel: 'Recount',
      });
      if (!ok) return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = await submitFirstCount(practiceId, Number(branchId), Number(locationId), {
        rows: preview.rows,
        countedAt: countedAtIso(),
        dryRun: false,
        mode,
        confirmWeighMismatch: disputed.length > 0,
      });
      setPreview(null);
      if (preview.source === 'typed') setDrafts({});
      setToast(
        `Saved ${result.mode === 'annual' ? 'annual' : 'first'} counts for ${result.itemsCounted} item${result.itemsCounted === 1 ? '' : 's'}` +
          (result.mode === 'annual' && result.itemsOff
            ? ` · ${result.itemsOff} off (see Count report)`
            : '') +
          (result.unmatched.length
            ? ` · ${result.unmatched.length} write-in/unknown rows to review`
            : '')
      );
      window.setTimeout(() => setToast(null), 5000);
      await reload();
      loadProgress();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save counts');
    } finally {
      setBusy(false);
    }
  }

  async function onFile(file: File) {
    const text = await file.text();
    const { rows, error: parseError } = rowsFromCsv(text);
    if (parseError) {
      setError(`${file.name}: ${parseError}`);
      return;
    }
    await runPreview(rows, file.name);
  }

  const scoped = scopeItems(items, scope);

  return (
    <div className="settings-card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>
            {mode === 'annual' ? 'Annual count' : 'First counts'}
          </h2>
          <div style={{ display: 'flex', gap: 6, margin: '4px 0 8px' }}>
            {(
              [
                ['first', 'First count (go-live)'],
                ['annual', 'Annual count'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="btn secondary"
                style={
                  mode === id
                    ? { background: '#0f766e', color: '#fff', borderColor: '#0f766e' }
                    : undefined
                }
                onClick={() => switchMode(id)}
              >
                {label}
              </button>
            ))}
          </div>
          <p className="settings-muted" style={{ margin: 0, maxWidth: 56 * 16 }}>
            {mode === 'annual' ? (
              <>
                A full recount. Each counted item is set to what was counted, and any difference
                from what Scout expected is booked as an adjustment and listed in the{' '}
                <Link to="/schedule/analytics/inventory/counts">Count report</Link>. Blank counts are
                left alone. Shelves that never had a first count still get an opening balance.
              </>
            ) : (
              <>
                Each shelf starts as <strong>not counted</strong>. Its first count sets the opening
                balance and replaces whatever was there (old eVet numbers, negatives from usage). It
                is not reported as shrink. Shelves can be counted whenever the team gets to them;
                only controlled substances need counting before go-live.
              </>
            )}
          </p>
        </div>
        <Link
          className="btn secondary"
          to="/schedule/analytics/inventory/activity"
          style={{ alignSelf: 'flex-start' }}
        >
          Activity
        </Link>
      </div>

      {progress ? (
        <div className="settings-table-container" style={{ marginTop: 14 }}>
          <table className="settings-table">
            <thead>
              <tr>
                <th>Office</th>
                <th>Location</th>
                <th>Items counted</th>
                <th>Controlled counted</th>
                <th>Last count</th>
              </tr>
            </thead>
            <tbody>
              {progress.branches.flatMap((b) =>
                b.locations.map((loc) => {
                  const controlledDone =
                    progress.controlledItems === 0 ||
                    loc.countedControlled >= progress.controlledItems;
                  return (
                    <tr
                      key={loc.locationId}
                      style={loc.locationId === locationId ? { background: '#f0fdfa' } : undefined}
                    >
                      <td>{b.branchName}</td>
                      <td>
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
                          onClick={() => {
                            setBranchId(b.branchId);
                            try {
                              localStorage.setItem(
                                `${LOC_STORAGE_PREFIX}${practiceId}:${b.branchId}`,
                                String(loc.locationId)
                              );
                            } catch {
                              /* ignore */
                            }
                            if (b.branchId === branchId) setLocationId(loc.locationId);
                          }}
                        >
                          {loc.locationName}
                        </button>
                        {loc.isDefault ? <span className="settings-muted"> (default)</span> : null}
                      </td>
                      <td>
                        {loc.countedItems} of {progress.totalItems}
                      </td>
                      <td
                        style={{ color: controlledDone ? '#166534' : '#b91c1c', fontWeight: 600 }}
                      >
                        {loc.countedControlled} of {progress.controlledItems}
                        {controlledDone ? ' ✓' : ''}
                      </td>
                      <td>{formatWhen(loc.lastCountedAt)}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
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
                {l.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-label" style={{ margin: 0, minWidth: 210 }}>
          When the count was taken
          <input
            className="settings-input"
            type="datetime-local"
            value={countedAt}
            onChange={(e) => setCountedAt(e.target.value)}
          />
        </label>
        <span className="settings-muted" style={{ fontSize: 12, maxWidth: 260, paddingBottom: 6 }}>
          Leave blank for “just now”. If the sheet was counted earlier, anything used or received
          since then is applied on top.
        </span>
      </div>

      {sheet ? (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 10,
            marginTop: 14,
            padding: 12,
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            alignItems: 'flex-end',
          }}
        >
          <label className="settings-label" style={{ margin: 0, minWidth: 190 }}>
            Sheet includes
            <select
              className="settings-input"
              value={scope}
              onChange={(e) => setScope(e.target.value as SheetScope)}
            >
              <option value="uncounted">Not counted yet ({items.length - countedHere})</option>
              <option value="controlled">Controlled only ({controlledHere.length})</option>
              <option value="all">All items ({items.length})</option>
            </select>
          </label>
          <button
            type="button"
            className="btn secondary"
            disabled={!scoped.length}
            onClick={() => {
              if (!printSheet(sheet, scoped, mode)) {
                setError('Allow pop-ups to print the count sheet.');
              }
            }}
          >
            Print count sheet
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={!scoped.length}
            onClick={() => downloadCsv(sheet, scoped)}
          >
            Download CSV to fill in
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
          <span className="settings-muted" style={{ fontSize: 12, flex: '1 1 220px' }}>
            Paper sheets have no current quantities on them (blind count). In Excel, fill the Count
            column, then <em>Save As → CSV</em>. For a second lot, copy the item’s row and change
            the count, lot and exp — list every lot of an item in the same upload.
          </span>
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
        <div style={{ display: 'flex', gap: 6 }}>
          {(
            [
              ['uncounted', 'Not counted'],
              ['controlled', 'Controlled'],
              ['counted', 'Counted'],
              ['all', 'All'],
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
          className="btn"
          disabled={busy || typedRows.length === 0}
          onClick={() => void runPreview(typedRows, 'typed')}
        >
          Review {typedItemCount || ''} typed count{typedItemCount === 1 ? '' : 's'}
        </button>
      </div>

      {sheet ? (
        <p className="settings-muted" style={{ margin: '10px 0 0', fontSize: 13 }}>
          <strong>{sheet.locationName}</strong>: {countedHere} of {items.length} items counted ·{' '}
          <span style={{ color: controlledLeft ? '#b91c1c' : '#166534', fontWeight: 600 }}>
            {controlledLeft
              ? `${controlledLeft} controlled item${controlledLeft === 1 ? '' : 's'} still to count`
              : 'all controlled items counted'}
          </span>
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
          Loading count sheet…
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
                <th>Status</th>
                <th style={{ minWidth: 80 }}>Count</th>
                <th style={{ minWidth: 110 }}>Lot #</th>
                <th style={{ minWidth: 110 }}>Exp</th>
              </tr>
            </thead>
            <tbody>
              {visible.flatMap((item) => {
                const lots = drafts[item.inventoryItemId] ?? [EMPTY_DRAFT];
                const lotInputs = (d: Draft, index: number) => (
                  <>
                    <td>
                      {item.measure !== 'weight' ? (
                        <input
                          className="settings-input"
                          inputMode="decimal"
                          value={d.quantity}
                          onChange={(e) =>
                            setDraft(item.inventoryItemId, index, { quantity: e.target.value })
                          }
                          placeholder={
                            item.measure === 'both'
                              ? 'mL'
                              : item.firstCountedAt && index === 0
                                ? 'Recount'
                                : ''
                          }
                          aria-label={`${item.name} count${index ? ` (lot ${index + 1})` : ''}`}
                        />
                      ) : null}
                      {item.measure !== 'volume' ? (
                        <div
                          style={{
                            display: 'flex',
                            gap: 4,
                            marginTop: item.measure === 'both' ? 4 : 0,
                          }}
                        >
                          <input
                            className="settings-input"
                            inputMode="decimal"
                            value={d.weight}
                            onChange={(e) =>
                              setDraft(item.inventoryItemId, index, { weight: e.target.value })
                            }
                            placeholder={`Weight (${item.weightUnit})`}
                            aria-label={`${item.name} weight in ${item.weightUnit}${index ? ` (lot ${index + 1})` : ''}`}
                            style={{ minWidth: 80 }}
                          />
                          <input
                            className="settings-input"
                            inputMode="numeric"
                            value={d.bottles}
                            onChange={(e) =>
                              setDraft(item.inventoryItemId, index, { bottles: e.target.value })
                            }
                            placeholder="1"
                            title="Bottles weighed together"
                            aria-label={`${item.name} bottles weighed${index ? ` (lot ${index + 1})` : ''}`}
                            style={{ width: 44 }}
                          />
                        </div>
                      ) : null}
                    </td>
                    <td>
                      <input
                        className="settings-input"
                        value={d.lotNumber}
                        onChange={(e) =>
                          setDraft(item.inventoryItemId, index, { lotNumber: e.target.value })
                        }
                        placeholder={item.requireLotNumber ? 'Lot #' : 'Optional'}
                        aria-label={`${item.name} lot number${index ? ` (lot ${index + 1})` : ''}`}
                      />
                    </td>
                    <td>
                      <input
                        className="settings-input"
                        value={d.expirationDate}
                        onChange={(e) =>
                          setDraft(item.inventoryItemId, index, {
                            expirationDate: e.target.value,
                          })
                        }
                        placeholder="3/2027"
                        aria-label={`${item.name} expiration${index ? ` (lot ${index + 1})` : ''}`}
                      />
                    </td>
                  </>
                );
                const extraRows = lots.slice(1).map((d, i) => (
                  <tr key={`${item.inventoryItemId}-lot-${i + 1}`}>
                    <td colSpan={3} style={{ paddingLeft: 32, fontSize: 12 }}>
                      <span className="settings-muted">
                        ↳ {item.name} · lot {i + 2}
                      </span>{' '}
                      <button
                        type="button"
                        className="mail-queue__pet-link"
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          cursor: 'pointer',
                          font: 'inherit',
                          color: '#b91c1c',
                        }}
                        onClick={() => removeLot(item.inventoryItemId, i + 1)}
                      >
                        Remove
                      </button>
                    </td>
                    {lotInputs(d, i + 1)}
                  </tr>
                ));
                return [
                  <tr key={item.inventoryItemId}>
                    <td>
                      <div style={{ fontWeight: 600 }}>
                        {item.name}
                        {item.isControlled ? (
                          <span
                            style={{
                              marginLeft: 6,
                              fontSize: 11,
                              padding: '1px 6px',
                              borderRadius: 999,
                              background: '#fee2e2',
                              color: '#991b1b',
                            }}
                          >
                            Controlled
                          </span>
                        ) : null}
                      </div>
                      <div className="settings-muted" style={{ fontSize: 12 }}>
                        {[item.code, item.categoryName].filter(Boolean).join(' · ')}
                      </div>
                      <button
                        type="button"
                        className="mail-queue__pet-link"
                        style={{
                          background: 'none',
                          border: 0,
                          padding: 0,
                          marginTop: 2,
                          cursor: 'pointer',
                          font: 'inherit',
                          fontSize: 12,
                        }}
                        onClick={() => addLot(item.inventoryItemId)}
                      >
                        + Add lot
                      </button>
                    </td>
                    <td>{item.unit || '—'}</td>
                    <td style={{ fontSize: 12 }}>
                      {mode === 'annual' && item.firstCountedAt ? (
                        <>
                          Last counted {formatWhen(item.lastCountedAt ?? item.firstCountedAt)}
                          <div className="settings-muted">On hand now: {item.onHand ?? 0}</div>
                        </>
                      ) : item.firstCountedAt ? (
                        <>
                          <span style={{ color: '#166534', fontWeight: 600 }}>Counted</span>{' '}
                          {formatWhen(item.firstCountedAt)}
                          {item.firstCountedByName ? ` · ${item.firstCountedByName}` : ''}
                          <div className="settings-muted">On hand now: {item.onHand ?? 0}</div>
                        </>
                      ) : (
                        <span className="settings-muted">Not counted</span>
                      )}
                    </td>
                    {lotInputs(lots[0] ?? EMPTY_DRAFT, 0)}
                  </tr>,
                  ...extraRows,
                ];
              })}
              {visible.length === 0 ? (
                <tr>
                  <td colSpan={6} className="settings-muted">
                    {filter === 'uncounted'
                      ? 'Everything here has been counted.'
                      : 'No items match.'}
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
      {sheet && !loading ? (
        <p className="settings-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Use <strong>+ Add lot</strong> for each extra lot of an item. Saving an item’s count
          replaces all of its lots at this location, so enter every lot you found.
        </p>
      ) : null}
    </div>
  );
}

function PreviewPanel({
  preview,
  source,
  busy,
  onApply,
  onCancel,
}: {
  preview: FirstCountResult;
  source: string;
  busy: boolean;
  onApply: () => void;
  onCancel: () => void;
}) {
  const blocked = preview.errors.length > 0 || preview.itemsCounted === 0;
  const annual = preview.mode === 'annual';
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
        Review before saving {source === 'typed' ? 'typed counts' : `“${source}”`}
      </h3>
      <p style={{ margin: '0 0 8px', fontSize: 13 }}>
        <strong>{preview.itemsCounted}</strong> items counted ({preview.controlledCounted}{' '}
        controlled)
        {annual
          ? ` · ${preview.itemsOff} off from what Scout expected${
              preview.openingItems
                ? ` · ${preview.openingItems} never counted before (opening balance)`
                : ''
            }`
          : preview.recounts
            ? ` · ${preview.recounts} already had a first count and will be reset`
            : ''}
        {preview.blankRows ? ` · ${preview.blankRows} blank rows left as not counted` : ''} ·
        counted {formatWhen(preview.countedAt)}
      </p>

      {preview.errors.length ? (
        <div className="settings-message settings-error-message" style={{ marginBottom: 8 }}>
          <strong>Fix these rows and upload again:</strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {preview.errors.map((e, i) => (
              <li key={i}>
                {e.rowNumber != null && source !== 'typed' ? `Row ${e.rowNumber}: ` : ''}
                {e.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.unmatched.length ? (
        <div style={{ marginBottom: 8 }}>
          <strong style={{ fontSize: 13 }}>
            Not saved: {preview.unmatched.length} write-in / unknown row
            {preview.unmatched.length === 1 ? '' : 's'}
          </strong>
          <span className="settings-muted" style={{ fontSize: 12 }}>
            {' '}
            — add these items to the catalog (or fix the code), then count them again.
          </span>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18, fontSize: 13 }}>
            {preview.unmatched.map((u, i) => (
              <li key={i}>
                {u.rowNumber != null ? `Row ${u.rowNumber}: ` : ''}
                {[u.code, u.name].filter(Boolean).join(' · ') || '(no name)'} — {u.quantity}
                {u.lotNumber ? ` · lot ${u.lotNumber}` : ''}
                {u.expirationDate ? ` · exp ${u.expirationDate}` : ''}
                {u.note ? ` · “${u.note}”` : ''}{' '}
                <span className="settings-muted">({u.reason})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {preview.items.length ? (
        <div
          className="settings-table-container settings-table-container--sticky-head"
          style={{ maxHeight: 360 }}
        >
          <table className="settings-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Counted</th>
                <th>Lots</th>
                <th>{annual ? 'Expected' : 'Scout had'}</th>
                {annual ? <th>Off by</th> : null}
                <th>Since count</th>
                <th>On hand after</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {preview.items.map((row) => (
                <tr key={row.inventoryItemId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{row.name}</div>
                    <div className="settings-muted" style={{ fontSize: 12 }}>
                      {[row.code, row.unit, row.isControlled ? 'Controlled' : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </td>
                  <td>{row.counted}</td>
                  <td style={{ fontSize: 12 }}>
                    {row.lots
                      .map(
                        (l) =>
                          `${l.lotNumber || (l.expirationDate ? 'no lot #' : 'unknown lot')}${
                            l.expirationDate ? ` exp ${l.expirationDate}` : ''
                          }: ${l.quantity}`
                      )
                      .join(' · ')}
                  </td>
                  <td className="settings-muted">
                    {annual ? row.expectedAtCount : row.currentInScout}
                  </td>
                  {annual ? (
                    <td
                      style={{
                        fontWeight: 600,
                        color: row.opening ? undefined : row.change < 0 ? '#b91c1c' : '#166534',
                      }}
                    >
                      {row.opening
                        ? '—'
                        : row.change === 0
                          ? '0'
                          : row.change > 0
                            ? `+${row.change}`
                            : row.change}
                    </td>
                  ) : null}
                  <td>
                    {row.changedSinceCount
                      ? row.changedSinceCount > 0
                        ? `+${row.changedSinceCount}`
                        : row.changedSinceCount
                      : '—'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{row.afterApply}</td>
                  <td style={{ fontSize: 12 }}>
                    {annual && row.opening ? (
                      <div style={{ color: '#b45309' }}>First count here (opening balance)</div>
                    ) : null}
                    {!annual && row.alreadyCounted ? (
                      <div style={{ color: '#b45309' }}>Resets an earlier first count</div>
                    ) : null}
                    {row.warnings.map((w) => (
                      <div key={w} className="settings-muted">
                        {w}
                      </div>
                    ))}
                    {(row.weighings ?? []).map((w, i) => (
                      <div key={`w${i}`} style={{ color: '#1d4ed8' }}>
                        Weighed {w}
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
          {busy
            ? 'Saving…'
            : `Save ${preview.itemsCounted} ${annual ? 'annual' : 'first'} count${preview.itemsCounted === 1 ? '' : 's'}`}
        </button>
        <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
