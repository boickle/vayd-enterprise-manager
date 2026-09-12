import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type {
  Bundle,
  BundleGroupInput,
  BundleItemInput,
  GroupSelectionMode,
  ItemCoverage,
  MembershipItemType,
} from '../../api/memberships';
import CatalogItemPicker, {
  catalogItemTypeLabel,
  type PickedCatalogItem,
} from './CatalogItemPicker';
import './BundleGroupEditor.css';

/**
 * Group/item builder shared by bundles and membership plans.
 *
 * A group is either `all` — every item comes with its own allowance — or `choice`, where the
 * items are alternatives drawing on one shared allowance ("one dental X-ray view OR one
 * full-mouth series"). Choice groups are drawn as a braced stack with OR between the options
 * so the relationship is readable without anyone having to parse the mode dropdown.
 */

let keySeq = 0;
function nextKey(): string {
  keySeq += 1;
  return `bg-${keySeq}`;
}

export type BundleItemDraft = {
  key: string;
  id?: number;
  itemType: MembershipItemType;
  catalogItemId: number;
  name: string;
  code: string | null;
  catalogPrice: number | null;
  quantity: string;
  coverage: ItemCoverage;
  copayPrice: string;
  percentOff: string;
  note: string;
};

export type BundleGroupDraft = {
  key: string;
  id?: number;
  name: string;
  description: string;
  selectionMode: GroupSelectionMode;
  allowedQuantity: string;
  items: BundleItemDraft[];
};

const COVERAGE_OPTIONS: { value: ItemCoverage; label: string }[] = [
  { value: 'included', label: 'Included' },
  { value: 'copay', label: 'Copay' },
  { value: 'percent_off', label: '% off' },
];

export function emptyBundleGroup(mode: GroupSelectionMode = 'all'): BundleGroupDraft {
  return {
    key: nextKey(),
    name: mode === 'choice' ? 'Choose one' : 'Included',
    description: '',
    selectionMode: mode,
    allowedQuantity: '1',
    items: [],
  };
}

export function bundleGroupDraftsFrom(bundle: Bundle): BundleGroupDraft[] {
  return [...bundle.groups]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((g) => ({
      key: nextKey(),
      id: g.id,
      name: g.name ?? '',
      description: g.description ?? '',
      selectionMode: g.selectionMode,
      allowedQuantity: String(g.allowedQuantity ?? 1),
      items: [...g.items]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((i) => ({
          key: nextKey(),
          id: i.id,
          itemType: i.itemType,
          catalogItemId: i.catalogItemId,
          name: i.name,
          code: i.code,
          catalogPrice: i.catalogPrice,
          quantity: String(i.quantity ?? 1),
          coverage: i.coverage,
          copayPrice: i.copayPrice != null ? String(i.copayPrice) : '',
          percentOff: i.percentOff != null ? String(i.percentOff) : '',
          note: i.note ?? '',
        })),
    }));
}

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function bundleGroupDraftsToInput(drafts: BundleGroupDraft[]): BundleGroupInput[] {
  return drafts.map((g, gi) => ({
    ...(g.id != null ? { id: g.id } : {}),
    name: g.name.trim() || `Group ${gi + 1}`,
    description: g.description.trim() || null,
    selectionMode: g.selectionMode,
    allowedQuantity: g.selectionMode === 'choice' ? (numOrNull(g.allowedQuantity) ?? 1) : 1,
    sortOrder: gi,
    items: g.items.map(
      (i, ii): BundleItemInput => ({
        ...(i.id != null ? { id: i.id } : {}),
        itemType: i.itemType,
        catalogItemId: i.catalogItemId,
        quantity: numOrNull(i.quantity) ?? 1,
        coverage: i.coverage,
        copayPrice: i.coverage === 'copay' ? numOrNull(i.copayPrice) : null,
        percentOff: i.coverage === 'percent_off' ? numOrNull(i.percentOff) : null,
        sortOrder: ii,
        note: i.note.trim() || null,
      })
    ),
  }));
}

/** Returns the first thing that would make the save meaningless, or null when it is fine. */
export function bundleGroupDraftsProblem(drafts: BundleGroupDraft[]): string | null {
  for (const g of drafts) {
    if (g.items.length === 0) {
      return `“${g.name.trim() || 'Untitled group'}” has no items. Add at least one or remove the group.`;
    }
    if (g.selectionMode === 'choice') {
      const allowed = numOrNull(g.allowedQuantity);
      if (allowed == null || allowed < 1) {
        return `“${g.name.trim() || 'Untitled group'}” needs a whole number for how many options the client picks.`;
      }
      if (allowed > g.items.length) {
        return `“${g.name.trim() || 'Untitled group'}” lets the client pick ${allowed} but only lists ${g.items.length} option${g.items.length === 1 ? '' : 's'}.`;
      }
    }
    for (const i of g.items) {
      if (i.coverage === 'copay' && numOrNull(i.copayPrice) == null) {
        return `Set the copay for “${i.name}”.`;
      }
      if (i.coverage === 'percent_off' && numOrNull(i.percentOff) == null) {
        return `Set the percent off for “${i.name}”.`;
      }
    }
  }
  return null;
}

type Props = {
  practiceId: number;
  groups: BundleGroupDraft[];
  onChange: (next: BundleGroupDraft[]) => void;
  disabled?: boolean;
};

export default function BundleGroupEditor({
  practiceId,
  groups,
  onChange,
  disabled = false,
}: Props) {
  function patchGroup(key: string, patch: Partial<BundleGroupDraft>) {
    onChange(groups.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  function patchItem(groupKey: string, itemKey: string, patch: Partial<BundleItemDraft>) {
    onChange(
      groups.map((g) =>
        g.key === groupKey
          ? {
              ...g,
              items: g.items.map((i) => (i.key === itemKey ? { ...i, ...patch } : i)),
            }
          : g
      )
    );
  }

  function addItem(groupKey: string, picked: PickedCatalogItem) {
    onChange(
      groups.map((g) =>
        g.key === groupKey
          ? {
              ...g,
              items: [
                ...g.items,
                {
                  key: nextKey(),
                  itemType: picked.itemType,
                  catalogItemId: picked.catalogItemId,
                  name: picked.name,
                  code: picked.code,
                  catalogPrice: picked.price,
                  quantity: '1',
                  coverage: 'included' as ItemCoverage,
                  copayPrice: '',
                  percentOff: '',
                  note: '',
                },
              ],
            }
          : g
      )
    );
  }

  function removeItem(groupKey: string, itemKey: string) {
    onChange(
      groups.map((g) =>
        g.key === groupKey ? { ...g, items: g.items.filter((i) => i.key !== itemKey) } : g
      )
    );
  }

  function moveGroup(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= groups.length) return;
    const next = [...groups];
    const [moved] = next.splice(index, 1);
    next.splice(target, 0, moved);
    onChange(next);
  }

  return (
    <div className="bge">
      {groups.length === 0 ? (
        <p className="bge__empty">
          No groups yet. A bundle is one or more groups of catalog items — everything in an “all
          included” group comes with the bundle, while a “choose” group lets the client pick between
          alternatives.
        </p>
      ) : null}

      {groups.map((group, gi) => {
        const choice = group.selectionMode === 'choice';
        return (
          <section key={group.key} className={`bge-group${choice ? ' bge-group--choice' : ''}`}>
            <header className="bge-group__head">
              <div className="bge-group__reorder">
                <GripVertical size={14} aria-hidden />
                <button
                  type="button"
                  className="bge-group__move"
                  aria-label="Move group up"
                  disabled={disabled || gi === 0}
                  onClick={() => moveGroup(gi, -1)}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className="bge-group__move"
                  aria-label="Move group down"
                  disabled={disabled || gi === groups.length - 1}
                  onClick={() => moveGroup(gi, 1)}
                >
                  ↓
                </button>
              </div>
              <label className="bge-field bge-field--grow">
                <span className="bge-field__label">Group name</span>
                <input
                  className="bge-input"
                  value={group.name}
                  disabled={disabled}
                  placeholder="e.g. Choose one dental radiograph"
                  onChange={(e) => patchGroup(group.key, { name: e.target.value })}
                />
              </label>
              <label className="bge-field">
                <span className="bge-field__label">How it works</span>
                <select
                  className="bge-input"
                  value={group.selectionMode}
                  disabled={disabled}
                  onChange={(e) =>
                    patchGroup(group.key, {
                      selectionMode: e.target.value as GroupSelectionMode,
                    })
                  }
                >
                  <option value="all">All items included</option>
                  <option value="choice">Client chooses (OR)</option>
                </select>
              </label>
              {choice ? (
                <label className="bge-field bge-field--narrow">
                  <span className="bge-field__label">Picks</span>
                  <input
                    className="bge-input"
                    inputMode="numeric"
                    value={group.allowedQuantity}
                    disabled={disabled}
                    onChange={(e) => patchGroup(group.key, { allowedQuantity: e.target.value })}
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="bge-icon-btn"
                aria-label={`Remove group ${group.name || gi + 1}`}
                disabled={disabled}
                onClick={() => onChange(groups.filter((g) => g.key !== group.key))}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </header>

            <label className="bge-field bge-field--full">
              <span className="bge-field__label">Description shown to clients</span>
              <input
                className="bge-input"
                value={group.description}
                disabled={disabled}
                placeholder="Optional"
                onChange={(e) => patchGroup(group.key, { description: e.target.value })}
              />
            </label>

            {choice ? (
              <p className="bge-group__banner">
                <strong>
                  Client picks {numOrNull(group.allowedQuantity) ?? 1} of these {group.items.length}
                </strong>{' '}
                — one shared allowance, so taking any option below uses it up.
              </p>
            ) : (
              <p className="bge-group__banner bge-group__banner--all">
                <strong>All {group.items.length} included</strong> — each item carries its own
                quantity.
              </p>
            )}

            {group.items.length === 0 ? (
              <p className="bge__empty bge__empty--tight">No items in this group yet.</p>
            ) : (
              <ul className="bge-items">
                {group.items.flatMap((item, ii) => {
                  const row = (
                    <li key={item.key} className="bge-item">
                      {choice ? <span className="bge-item__dot" aria-hidden /> : null}
                      <div className="bge-item__body">
                        <div className="bge-item__head">
                          <span
                            className={`cat-item-picker__tag cat-item-picker__tag--${item.itemType}`}
                          >
                            {catalogItemTypeLabel(item.itemType)}
                          </span>
                          <span className="bge-item__name">{item.name}</span>
                          {item.code ? <span className="bge-item__code">{item.code}</span> : null}
                          {item.catalogPrice != null ? (
                            <span className="bge-item__code">
                              list{' '}
                              {new Intl.NumberFormat('en-US', {
                                style: 'currency',
                                currency: 'USD',
                              }).format(item.catalogPrice)}
                            </span>
                          ) : null}
                        </div>
                        <div className="bge-item__controls">
                          <label className="bge-field bge-field--narrow">
                            <span className="bge-field__label">{choice ? 'Counts as' : 'Qty'}</span>
                            <input
                              className="bge-input"
                              inputMode="decimal"
                              value={item.quantity}
                              disabled={disabled}
                              onChange={(e) =>
                                patchItem(group.key, item.key, {
                                  quantity: e.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="bge-field bge-field--narrow">
                            <span className="bge-field__label">Coverage</span>
                            <select
                              className="bge-input"
                              value={item.coverage}
                              disabled={disabled}
                              onChange={(e) =>
                                patchItem(group.key, item.key, {
                                  coverage: e.target.value as ItemCoverage,
                                })
                              }
                            >
                              {COVERAGE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {item.coverage === 'copay' ? (
                            <label className="bge-field bge-field--narrow">
                              <span className="bge-field__label">Copay $</span>
                              <input
                                className="bge-input"
                                inputMode="decimal"
                                value={item.copayPrice}
                                disabled={disabled}
                                onChange={(e) =>
                                  patchItem(group.key, item.key, {
                                    copayPrice: e.target.value,
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          {item.coverage === 'percent_off' ? (
                            <label className="bge-field bge-field--narrow">
                              <span className="bge-field__label">% off</span>
                              <input
                                className="bge-input"
                                inputMode="decimal"
                                value={item.percentOff}
                                disabled={disabled}
                                onChange={(e) =>
                                  patchItem(group.key, item.key, {
                                    percentOff: e.target.value,
                                  })
                                }
                              />
                            </label>
                          ) : null}
                          <label className="bge-field bge-field--grow">
                            <span className="bge-field__label">Note</span>
                            <input
                              className="bge-input"
                              value={item.note}
                              disabled={disabled}
                              placeholder="Optional"
                              onChange={(e) =>
                                patchItem(group.key, item.key, { note: e.target.value })
                              }
                            />
                          </label>
                          <button
                            type="button"
                            className="bge-icon-btn"
                            aria-label={`Remove ${item.name}`}
                            disabled={disabled}
                            onClick={() => removeItem(group.key, item.key)}
                          >
                            <Trash2 size={15} aria-hidden />
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                  if (!choice || ii === 0) return [row];
                  return [
                    <li className="bge-or" key={`or-${item.key}`} aria-hidden>
                      <span>OR</span>
                    </li>,
                    row,
                  ];
                })}
              </ul>
            )}

            <div className="bge-group__add">
              <span className="bge-field__label">
                {choice ? 'Add another option' : 'Add an item'}
              </span>
              <CatalogItemPicker
                practiceId={practiceId}
                value={null}
                disabled={disabled}
                onChange={(picked) => {
                  if (picked) addItem(group.key, picked);
                }}
              />
            </div>
          </section>
        );
      })}

      <div className="bge__actions">
        <button
          type="button"
          className="bge-btn bge-btn--ghost"
          disabled={disabled}
          onClick={() => onChange([...groups, emptyBundleGroup('all')])}
        >
          <Plus size={14} aria-hidden />
          Add “all included” group
        </button>
        <button
          type="button"
          className="bge-btn bge-btn--accent"
          disabled={disabled}
          onClick={() => onChange([...groups, emptyBundleGroup('choice')])}
        >
          <Plus size={14} aria-hidden />
          Add “choose one” (OR) group
        </button>
      </div>
    </div>
  );
}
