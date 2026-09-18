import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Package,
  Plus,
  Save,
  Search,
} from 'lucide-react';
import {
  archiveBundle,
  createBundle,
  getBundle,
  getBundleAudit,
  listBundles,
  updateBundle,
  type Bundle,
  type BundleFields,
  type MembershipAuditEntry,
} from '../../api/memberships';
import { apiErrorMessage } from '../../api/http';
import { appAlert, appConfirm } from '../../utils/appDialog';
import BundleGroupEditor, {
  bundleGroupDraftsFrom,
  bundleGroupDraftsProblem,
  bundleGroupDraftsToInput,
  emptyBundleGroup,
  type BundleGroupDraft,
} from './BundleGroupEditor';
import './CatalogBundles.css';

/**
 * Bundles are the sell-once packages: a fixed price for a set of catalog items, with optional
 * "client chooses one of these" groups. Membership plans share the same store but are billed
 * on a subscription and managed under Settings, so they are deliberately not listed here.
 */

type Draft = {
  name: string;
  code: string;
  price: string;
  marketingSummary: string;
  description: string;
  isActive: boolean;
};

const EMPTY_DRAFT: Draft = {
  name: '',
  code: '',
  price: '',
  marketingSummary: '',
  description: '',
  isActive: true,
};

function draftFrom(bundle: Bundle): Draft {
  return {
    name: bundle.name ?? '',
    code: bundle.code ?? '',
    price: bundle.price != null ? String(bundle.price) : '',
    marketingSummary: bundle.marketingSummary ?? '',
    description: bundle.description ?? '',
    isActive: bundle.isActive,
  };
}

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}

function dateTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function itemCount(bundle: Bundle): number {
  return bundle.groups.reduce((sum, g) => sum + g.items.length, 0);
}

function choiceCount(bundle: Bundle): number {
  return bundle.groups.filter(
    (g) => g.selectionMode === 'choice' || g.selectionMode === 'any',
  ).length;
}

type Props = {
  practiceId: number;
  /** Open this bundle once after the list loads (e.g. clicked from Catalog All search). */
  focusBundleId?: number | null;
  onFocusBundleConsumed?: () => void;
  /** Prefill the bundles search box. */
  initialQuery?: string;
};

export default function CatalogBundles({
  practiceId,
  focusBundleId = null,
  onFocusBundleConsumed,
  initialQuery = '',
}: Props) {
  const [bundles, setBundles] = useState<Bundle[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [query, setQuery] = useState(initialQuery);
  const [showArchived, setShowArchived] = useState(false);

  const [editing, setEditing] = useState<Bundle | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [groups, setGroups] = useState<BundleGroupDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [audit, setAudit] = useState<MembershipAuditEntry[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);

  const reload = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      setBundles(await listBundles({ kind: 'bundle', includeArchived: showArchived }));
    } catch (e) {
      setListError(apiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [showArchived]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (initialQuery.trim()) setQuery(initialQuery);
  }, [initialQuery]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return bundles;
    return bundles.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        (b.code ?? '').toLowerCase().includes(q) ||
        (b.marketingSummary ?? '').toLowerCase().includes(q)
    );
  }, [bundles, query]);

  function flash(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(null), 3500);
  }

  function startCreate() {
    setEditing(null);
    setCreating(true);
    setDraft(EMPTY_DRAFT);
    setGroups([emptyBundleGroup('all')]);
    setAudit([]);
    setAuditOpen(false);
    setFormError(null);
  }

  async function openBundle(row: Bundle) {
    setCreating(false);
    setFormError(null);
    setAuditOpen(false);
    try {
      const full = await getBundle(row.id);
      setEditing(full);
      setDraft(draftFrom(full));
      setGroups(bundleGroupDraftsFrom(full));
      setAudit(await getBundleAudit(full.id).catch(() => []));
    } catch (e) {
      await appAlert({ title: 'Could not open bundle', message: apiErrorMessage(e) });
    }
  }

  useEffect(() => {
    if (focusBundleId == null || loading) return;
    const row = bundles.find((b) => b.id === focusBundleId);
    if (!row) {
      onFocusBundleConsumed?.();
      return;
    }
    let cancelled = false;
    void openBundle(row).finally(() => {
      if (!cancelled) onFocusBundleConsumed?.();
    });
    return () => {
      cancelled = true;
    };
    // One-shot open from Catalog All search.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBundleId, loading, bundles]);

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setGroups([]);
    setDraft(EMPTY_DRAFT);
    setFormError(null);
  }

  function fieldsFromDraft(): BundleFields & { name: string } {
    return {
      name: draft.name.trim(),
      code: draft.code.trim() || null,
      price: numOrNull(draft.price),
      marketingSummary: draft.marketingSummary.trim() || null,
      description: draft.description.trim() || null,
      isActive: draft.isActive,
    };
  }

  async function save() {
    if (!draft.name.trim()) {
      setFormError('Give the bundle a name.');
      return;
    }
    const groupProblem = bundleGroupDraftsProblem(groups);
    if (groupProblem) {
      setFormError(groupProblem);
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (creating) {
        const created = await createBundle(
          'bundle',
          fieldsFromDraft(),
          bundleGroupDraftsToInput(groups)
        );
        flash(`Created ${created.name}`);
        closeEditor();
        await reload();
        return;
      }
      if (!editing) return;
      const saved = await updateBundle(editing.id, fieldsFromDraft(), {
        groups: bundleGroupDraftsToInput(groups),
      });
      flash(`Saved ${saved.name}`);
      setEditing(saved);
      setDraft(draftFrom(saved));
      setGroups(bundleGroupDraftsFrom(saved));
      setAudit(await getBundleAudit(saved.id).catch(() => []));
      await reload();
    } catch (e) {
      setFormError(apiErrorMessage(e));
    } finally {
      setSaving(false);
    }
  }

  async function archive(bundle: Bundle) {
    const ok = await appConfirm({
      title: `Archive ${bundle.name}?`,
      message:
        'The bundle stops being sellable and drops off the list. Anything already sold is untouched.',
      confirmLabel: 'Archive bundle',
      danger: true,
    });
    if (!ok) return;
    try {
      await archiveBundle(bundle.id);
      flash(`Archived ${bundle.name}`);
      if (editing?.id === bundle.id) closeEditor();
      await reload();
    } catch (e) {
      await appAlert({ title: 'Could not archive', message: apiErrorMessage(e) });
    }
  }

  /* ------------------------------------------------------------------ editor */

  if (creating || editing) {
    const title = creating ? 'New bundle' : `Edit ${editing?.name ?? 'bundle'}`;
    return (
      <div className="cbn">
        <div className="cbn__editor-head">
          <button type="button" className="cbn__back" onClick={closeEditor}>
            <ChevronLeft size={15} aria-hidden />
            All bundles
          </button>
          <h3 className="cbn__title">{title}</h3>
          <div className="cbn__editor-actions">
            {editing ? (
              <button
                type="button"
                className="cbn-btn cbn-btn--danger"
                disabled={saving}
                onClick={() => void archive(editing)}
              >
                <Archive size={14} aria-hidden />
                Archive
              </button>
            ) : null}
            <button
              type="button"
              className="cbn-btn cbn-btn--primary"
              disabled={saving}
              onClick={() => void save()}
            >
              <Save size={14} aria-hidden />
              {saving ? 'Saving…' : creating ? 'Create bundle' : 'Save bundle'}
            </button>
          </div>
        </div>

        {formError ? (
          <p className="cbn__error" role="alert">
            {formError}
          </p>
        ) : null}

        <section className="cbn-card">
          <h4 className="cbn-card__title">Bundle details</h4>
          <div className="cbn-grid">
            <label className="cbn-field">
              <span className="cbn-field__label">Name</span>
              <input
                className="cbn-input"
                value={draft.name}
                placeholder="e.g. Puppy Starter Bundle"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label className="cbn-field">
              <span className="cbn-field__label">Code</span>
              <input
                className="cbn-input"
                value={draft.code}
                placeholder="Optional"
                onChange={(e) => setDraft({ ...draft, code: e.target.value })}
              />
            </label>
            <label className="cbn-field">
              <span className="cbn-field__label">One-time price</span>
              <input
                className="cbn-input"
                inputMode="decimal"
                value={draft.price}
                placeholder="0.00"
                onChange={(e) => setDraft({ ...draft, price: e.target.value })}
              />
              <span className="cbn-field__hint">
                What the client pays once for the whole bundle.
              </span>
            </label>
            <label className="cbn-field cbn-field--check">
              <input
                type="checkbox"
                checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })}
              />
              <span>Sellable</span>
            </label>
            <label className="cbn-field cbn-field--full">
              <span className="cbn-field__label">Client-facing summary</span>
              <input
                className="cbn-input"
                value={draft.marketingSummary}
                placeholder="One line the client sees"
                onChange={(e) => setDraft({ ...draft, marketingSummary: e.target.value })}
              />
            </label>
            <label className="cbn-field cbn-field--full">
              <span className="cbn-field__label">Internal notes</span>
              <textarea
                className="cbn-input cbn-textarea"
                rows={3}
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              />
            </label>
          </div>
        </section>

        <section className="cbn-card">
          <h4 className="cbn-card__title">What’s in the bundle</h4>
          <p className="cbn-card__hint">
            “{draft.name.trim() || 'This bundle'}” is the sellable package name. The lines below
            are the catalog items it expands to.
          </p>
          <BundleGroupEditor
            practiceId={practiceId}
            groups={groups}
            onChange={setGroups}
            disabled={saving}
            context="bundle"
          />
        </section>

        {editing ? (
          <section className="cbn-card">
            <button
              type="button"
              className="cbn__audit-toggle"
              aria-expanded={auditOpen}
              onClick={() => setAuditOpen((v) => !v)}
            >
              {auditOpen ? (
                <ChevronDown size={14} aria-hidden />
              ) : (
                <ChevronRight size={14} aria-hidden />
              )}
              <History size={14} aria-hidden />
              Change history ({audit.length})
            </button>
            {auditOpen ? (
              audit.length === 0 ? (
                <p className="cbn__muted">Nothing recorded yet.</p>
              ) : (
                <ol className="cbn__audit">
                  {audit.map((entry) => (
                    <li key={entry.id}>
                      <span className="cbn__audit-summary">{entry.summary}</span>
                      <span className="cbn__audit-meta">
                        {entry.employeeName ?? 'System'} · {dateTime(entry.createdAt)}
                      </span>
                    </li>
                  ))}
                </ol>
              )
            ) : null}
          </section>
        ) : null}

        <div className="cbn__editor-foot">
          <button
            type="button"
            className="cbn-btn cbn-btn--quiet"
            disabled={saving}
            onClick={closeEditor}
          >
            Cancel
          </button>
          <button
            type="button"
            className="cbn-btn cbn-btn--primary"
            disabled={saving}
            onClick={() => void save()}
          >
            <Save size={14} aria-hidden />
            {saving ? 'Saving…' : creating ? 'Create bundle' : 'Save bundle'}
          </button>
        </div>
      </div>
    );
  }

  /* -------------------------------------------------------------------- list */

  return (
    <div className="cbn">
      {toast ? <p className="cbn__toast">{toast}</p> : null}

      <div className="cbn__intro">
        <h3 className="cbn__title">
          <Package size={16} aria-hidden />
          Bundles
        </h3>
        <p className="cbn__muted">
          A bundle is a set of catalog items sold once for a single price. Groups can be “all
          included” or “client chooses one of these”. Membership plans are billed on a subscription
          and are managed under Settings.
        </p>
      </div>

      <div className="cbn__toolbar">
        <div className="cbn__search">
          <Search size={14} aria-hidden />
          <input
            type="text"
            value={query}
            placeholder="Search bundles…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="cbn__toggle">
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(e) => setShowArchived(e.target.checked)}
          />
          Show archived
        </label>
        <button type="button" className="cbn-btn cbn-btn--primary" onClick={startCreate}>
          <Plus size={14} aria-hidden />
          New bundle
        </button>
      </div>

      {listError ? (
        <p className="cbn__error" role="alert">
          {listError}
        </p>
      ) : null}
      {loading ? <p className="cbn__muted">Loading bundles…</p> : null}
      {!loading && visible.length === 0 ? (
        <p className="cbn__muted">
          {bundles.length === 0
            ? 'No bundles yet. Create one to sell a set of items for a single price.'
            : 'No bundles match that search.'}
        </p>
      ) : null}

      {visible.length > 0 ? (
        <div className="cbn__table-wrap">
          <table className="cbn__table">
            <thead>
              <tr>
                <th>Bundle</th>
                <th>Contents</th>
                <th className="cbn__th-num">Price</th>
                <th>Status</th>
                <th className="cbn__th-actions">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((bundle) => (
                <tr
                  key={bundle.id}
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest('button')) return;
                    void openBundle(bundle);
                  }}
                >
                  <td>
                    <span className="cbn__name">{bundle.name}</span>
                    <span className="cbn__sub">
                      {bundle.code || 'No code'}
                      {bundle.marketingSummary ? ` · ${bundle.marketingSummary}` : ''}
                    </span>
                  </td>
                  <td>
                    <span className="cbn__sub">
                      {bundle.groups.length} group
                      {bundle.groups.length === 1 ? '' : 's'} · {itemCount(bundle)} item
                      {itemCount(bundle) === 1 ? '' : 's'}
                    </span>
                    {choiceCount(bundle) > 0 ? (
                      <span className="cbn__or-pill">
                        {choiceCount(bundle)} pick-at-sale
                        {choiceCount(bundle) === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </td>
                  <td className="cbn__td-num">{money(bundle.price)}</td>
                  <td>
                    <span
                      className={`cbn__status${
                        bundle.isArchived
                          ? ' cbn__status--off'
                          : bundle.isActive
                            ? ' cbn__status--ok'
                            : ' cbn__status--off'
                      }`}
                    >
                      {bundle.isArchived
                        ? 'Archived'
                        : bundle.isActive
                          ? 'Sellable'
                          : 'Not sellable'}
                    </span>
                  </td>
                  <td>
                    <div className="cbn__row-actions">
                      <button
                        type="button"
                        className="cbn-btn cbn-btn--quiet"
                        onClick={() => void openBundle(bundle)}
                      >
                        Edit
                      </button>
                      {!bundle.isArchived ? (
                        <button
                          type="button"
                          className="cbn-btn cbn-btn--quiet"
                          onClick={() => void archive(bundle)}
                        >
                          Archive
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
