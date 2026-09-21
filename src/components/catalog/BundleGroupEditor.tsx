import { useState } from 'react';
import { GripVertical, Plus, Trash2 } from 'lucide-react';
import type {
  Bundle,
  BundleGroupInput,
  BundleItemInput,
  GroupSelectionMode,
  ItemCoverage,
  ItemProductionBasis,
  MembershipItemType,
} from '../../api/memberships';
import CatalogItemPicker, {
  catalogItemTypeLabel,
  type PickedCatalogItem,
} from './CatalogItemPicker';
import { appAlert, appConfirm } from '../../utils/appDialog';
import './BundleGroupEditor.css';

/**
 * Bundle contents editor. Matches memberships: each line has an OR button so staff can
 * turn “always include this” into “pick one of these at invoice time” without hunting a
 * mode dropdown. Duplicate catalog rows are never kept twice — qty bumps, or Move to OR.
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
  productionBasis: ItemProductionBasis;
  productionOverride: string;
  note: string;
};

export type BundleGroupDraft = {
  key: string;
  id?: number;
  name: string;
  description: string;
  selectionMode: GroupSelectionMode;
  allowedQuantity: string;
  /** Sell-once choice: must pick when true. Ignored for `any` (always optional). */
  isRequired: boolean;
  items: BundleItemDraft[];
};

const COVERAGE_OPTIONS: { value: ItemCoverage; label: string }[] = [
  { value: 'included', label: 'Included' },
  { value: 'copay', label: 'Copay' },
  { value: 'percent_off', label: '% off' },
];

const PRODUCTION_OPTIONS: { value: ItemProductionBasis; label: string }[] = [
  { value: 'full_price', label: 'Full item price' },
  { value: 'membership_price', label: 'Membership price' },
  { value: 'custom', label: 'Custom' },
];

function numOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Default invoice-facing label: “Pick 1”, “Pick 2”, or “Pick Any”. */
function defaultGroupLabel(mode: GroupSelectionMode, picksRaw?: string | number): string {
  if (mode === 'any') return 'Pick Any';
  if (mode === 'choice') {
    const n =
      typeof picksRaw === 'number'
        ? picksRaw
        : numOrNull(String(picksRaw ?? '1')) ?? 1;
    const picks = Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
    return `Pick ${picks}`;
  }
  return 'Always included';
}

function autoChoiceName(_itemName: string, picksRaw?: string | number): string {
  return defaultGroupLabel('choice', picksRaw);
}

function autoAnyName(_itemName?: string): string {
  return defaultGroupLabel('any');
}

/** True when the label is empty or still one of our generated defaults (old or new). */
function isAutoGroupLabel(group: BundleGroupDraft): boolean {
  const n = group.name.trim();
  if (!n) return true;
  if (/^Pick \d+$/i.test(n)) return true;
  if (/^Pick Any$/i.test(n)) return true;
  if (/^Always included$/i.test(n)) return true;
  if (/^Optional add-ons$/i.test(n)) return true;
  if (/ — pick one$/i.test(n) || / — any$/i.test(n)) return true;
  if (/^Any\b/i.test(n) && /pick at invoice/i.test(n)) return true;
  return false;
}

function displayGroupTitle(group: BundleGroupDraft): string {
  if (group.selectionMode === 'choice') {
    return group.name.trim() || defaultGroupLabel('choice', group.allowedQuantity);
  }
  if (group.selectionMode === 'any') {
    return group.name.trim() || defaultGroupLabel('any');
  }
  // Single always-included line: the item name is the group. Multi-line groups used
  // to keep an auto-name from whatever was first (e.g. after peeling an OR out),
  // which looked like a duplicate of a choice above — always say “Always included”.
  if (group.items.length === 1) return group.items[0].name;
  return 'Always included';
}

export function emptyBundleGroup(mode: GroupSelectionMode = 'all'): BundleGroupDraft {
  return {
    key: nextKey(),
    name: '',
    description: '',
    selectionMode: mode,
    allowedQuantity: '1',
    isRequired: mode !== 'any',
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
      isRequired: g.selectionMode === 'any' ? false : g.isRequired !== false,
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
          productionBasis:
            i.productionBasis === 'membership_price' ||
            i.productionBasis === 'custom' ||
            i.productionBasis === 'full_price'
              ? i.productionBasis
              : i.productionOverride != null
                ? 'custom'
                : 'full_price',
          productionOverride:
            i.productionOverride != null ? String(i.productionOverride) : '',
          note: i.note ?? '',
        })),
    }));
}

export function bundleGroupDraftsToInput(drafts: BundleGroupDraft[]): BundleGroupInput[] {
  return drafts.map((g, gi) => ({
    ...(g.id != null ? { id: g.id } : {}),
    name:
      g.selectionMode === 'choice'
        ? g.name.trim() || defaultGroupLabel('choice', g.allowedQuantity)
        : g.selectionMode === 'any'
          ? g.name.trim() || defaultGroupLabel('any')
          : g.items.length === 1
            ? g.name.trim() || g.items[0]?.name || `Included ${gi + 1}`
            : // Don’t persist a leftover first-item name on multi-line always-included groups
              'Always included',
    description: g.description.trim() || null,
    selectionMode: g.selectionMode,
    allowedQuantity: g.selectionMode === 'choice' ? (numOrNull(g.allowedQuantity) ?? 1) : 1,
    isRequired:
      g.selectionMode === 'any' ? false : g.selectionMode === 'choice' ? g.isRequired !== false : true,
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
        productionBasis: i.productionBasis,
        productionOverride:
          i.productionBasis === 'custom' ? numOrNull(i.productionOverride) : null,
        sortOrder: ii,
        note: i.note.trim() || null,
      }),
    ),
  }));
}

/** Returns the first thing that would make the save meaningless, or null when it is fine. */
export function bundleGroupDraftsProblem(drafts: BundleGroupDraft[]): string | null {
  for (const g of drafts) {
    const label = displayGroupTitle(g);
    if (g.items.length === 0) {
      return `“${label}” has no items. Add at least one or remove the group.`;
    }
    if (g.selectionMode === 'choice') {
      const allowed = numOrNull(g.allowedQuantity);
      if (allowed == null || allowed < 1) {
        return `“${label}” needs a whole number for how many options to pick.`;
      }
      if (allowed > g.items.length) {
        return `“${label}” lets staff pick ${allowed} but only lists ${g.items.length} option${g.items.length === 1 ? '' : 's'}.`;
      }
    }
    for (const i of g.items) {
      if (i.coverage === 'copay' && numOrNull(i.copayPrice) == null) {
        return `Set the copay for “${i.name}”.`;
      }
      if (i.coverage === 'percent_off' && numOrNull(i.percentOff) == null) {
        return `Set the percent off for “${i.name}”.`;
      }
      if (i.productionBasis === 'custom' && numOrNull(i.productionOverride) == null) {
        return `Set the doctor production amount for “${i.name}”.`;
      }
    }
  }
  return null;
}

function draftFromPick(picked: PickedCatalogItem): BundleItemDraft {
  return {
    key: nextKey(),
    itemType: picked.itemType,
    catalogItemId: picked.catalogItemId,
    name: picked.name,
    code: picked.code,
    catalogPrice: picked.price,
    quantity: '1',
    coverage: 'included',
    copayPrice: '',
    percentOff: '',
    productionBasis: 'full_price',
    productionOverride: '',
    note: '',
  };
}

type Props = {
  practiceId: number;
  groups: BundleGroupDraft[];
  onChange: (next: BundleGroupDraft[]) => void;
  disabled?: boolean;
  /**
   * `bundle` — OR picks happen when the bundle is added to an invoice.
   * `membership` — OR is a shared future allowance.
   */
  context?: 'bundle' | 'membership';
};

export default function BundleGroupEditor({
  practiceId,
  groups,
  onChange,
  disabled = false,
  context = 'bundle',
}: Props) {
  const [pickerGroupKey, setPickerGroupKey] = useState<string | null>(null);
  const [pickerFocusNonce, setPickerFocusNonce] = useState(0);

  function openPicker(groupKey: string) {
    setPickerGroupKey(groupKey);
    setPickerFocusNonce((n) => n + 1);
  }

  function tidyGroups(cur: BundleGroupDraft[], keepKey?: string): BundleGroupDraft[] {
    return cur
      .filter((group) => group.items.length > 0 || group.key === keepKey)
      .map((group) =>
        group.selectionMode === 'choice' && group.items.length < 2 && group.key !== keepKey
          ? {
              ...group,
              selectionMode: 'all' as const,
              name: group.items[0]?.name ?? '',
            }
          : group,
      );
  }

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
          : g,
      ),
    );
  }

  function closePicker() {
    setPickerGroupKey(null);
    onChange(tidyGroups(groups));
  }

  /**
   * Switch Include all / OR / ANY on an existing group without rebuilding items.
   * Keeps a custom label; refreshes auto defaults when the staff hasn’t renamed it.
   */
  function setGroupMode(groupKey: string, mode: GroupSelectionMode) {
    onChange(
      groups.map((g) => {
        if (g.key !== groupKey || g.selectionMode === mode) return g;
        const picks = g.allowedQuantity || '1';
        const refreshLabel = isAutoGroupLabel(g);
        return {
          ...g,
          selectionMode: mode,
          allowedQuantity: mode === 'choice' ? picks : '1',
          isRequired:
            mode === 'any' ? false : mode === 'choice' ? g.isRequired !== false : true,
          name: refreshLabel
            ? mode === 'all' && g.items.length === 1
              ? ''
              : defaultGroupLabel(mode, picks)
            : g.name,
        };
      }),
    );
  }

  /** Membership-style: OR next to a line opens a picker for another option. */
  function addOr(group: BundleGroupDraft, itemKey: string) {
    peelToPickMode(group, itemKey, 'choice');
  }

  /**
   * ANY on an always-included group turns the whole checklist into an invoice
   * multi-select. Peeling one line (and leaving siblings always-included) made
   * those siblings auto-dump onto the invoice — the opposite of what staff want.
   */
  function addAny(group: BundleGroupDraft, itemKey: string) {
    if (group.selectionMode === 'all' && group.items.length > 1) {
      const cleaned = tidyGroups(groups, group.key);
      onChange(
        cleaned.map((g) =>
          g.key === group.key
            ? {
                ...g,
                selectionMode: 'any' as const,
                allowedQuantity: '1',
                isRequired: false,
                name: isAutoGroupLabel(g) ? defaultGroupLabel('any') : g.name.trim() || defaultGroupLabel('any'),
              }
            : g,
        ),
      );
      openPicker(group.key);
      return;
    }
    peelToPickMode(group, itemKey, 'any');
  }

  function peelToPickMode(
    group: BundleGroupDraft,
    itemKey: string,
    mode: 'choice' | 'any',
  ) {
    const peeledKey = nextKey();
    let openKey = group.key;
    const cleaned = tidyGroups(groups, group.key);
    const idx = cleaned.findIndex((row) => row.key === group.key);
    if (idx < 0) return;
    const row = cleaned[idx];
    const itemIndex = Math.max(
      0,
      row.items.findIndex((item) => item.key === itemKey),
    );
    const target = row.items[itemIndex] ?? row.items[0];
    if (!target) return;

    const autoName =
      mode === 'any'
        ? defaultGroupLabel('any')
        : defaultGroupLabel('choice', target.quantity || row.allowedQuantity || '1');

    let next: BundleGroupDraft[];
    if (row.selectionMode === mode || row.items.length <= 1) {
      next = cleaned.map((g) =>
        g.key === row.key
          ? {
              ...g,
              selectionMode: mode,
              allowedQuantity: mode === 'choice' ? target.quantity || g.allowedQuantity || '1' : '1',
              isRequired: mode === 'choice' ? g.isRequired !== false : false,
              name: isAutoGroupLabel(g) ? autoName : g.name.trim() || autoName,
            }
          : g,
      );
      openKey = row.key;
    } else {
      const before = row.items.slice(0, itemIndex);
      const after = row.items.slice(itemIndex + 1);
      const peeled: BundleGroupDraft = {
        key: peeledKey,
        name: autoName,
        description: '',
        selectionMode: mode,
        allowedQuantity: mode === 'choice' ? target.quantity || '1' : '1',
        isRequired: mode === 'choice',
        items: [target],
      };
      const replacement: BundleGroupDraft[] = [];
      if (before.length) {
        replacement.push({
          ...row,
          items: before,
          // Clear multi-line leftover names so the card doesn’t keep showing the
          // item that just moved into the OR/ANY group above.
          name: before.length === 1 ? before[0].name : '',
          isRequired: true,
        });
      }
      replacement.push(peeled);
      if (after.length) {
        replacement.push({
          key: nextKey(),
          name: after.length === 1 ? after[0].name : '',
          description: '',
          selectionMode: 'all',
          allowedQuantity: '1',
          isRequired: true,
          items: after,
        });
      }
      next = [...cleaned.slice(0, idx), ...replacement, ...cleaned.slice(idx + 1)];
      openKey = peeledKey;
    }
    onChange(next);
    openPicker(openKey);
  }

  function addItem(groupKey: string, picked: PickedCatalogItem) {
    void (async () => {
      const target = groups.find((g) => g.key === groupKey);
      if (!target) return;

      const existing = groups
        .flatMap((g) => g.items.map((item) => ({ group: g, item })))
        .find(
          (row) =>
            row.item.itemType === picked.itemType &&
            row.item.catalogItemId === picked.catalogItemId,
        );

      if (!existing) {
        onChange(
          groups.map((g) =>
            g.key === groupKey ? { ...g, items: [...g.items, draftFromPick(picked)] } : g,
          ),
        );
        if (target.selectionMode === 'choice' || target.selectionMode === 'any') {
          openPicker(groupKey);
        } else {
          setPickerGroupKey(null);
        }
        return;
      }

      if (existing.group.key === groupKey) {
        if (target.selectionMode === 'choice' || target.selectionMode === 'any') {
          await appAlert({
            title: 'Already an option',
            message: `${picked.name} is already in this ${target.selectionMode === 'any' ? 'ANY' : 'OR'} list.`,
          });
          openPicker(groupKey);
          return;
        }
        const nextQty = Math.max(1, (numOrNull(existing.item.quantity) ?? 1) + 1);
        onChange(
          groups.map((g) =>
            g.key === existing.group.key
              ? {
                  ...g,
                  items: g.items.map((i) =>
                    i.key === existing.item.key ? { ...i, quantity: String(nextQty) } : i,
                  ),
                }
              : g,
          ),
        );
        await appAlert({
          title: 'Already in this bundle',
          message: `${picked.name} is already here. Quantity is now ${nextQty}.`,
        });
        setPickerGroupKey(null);
        return;
      }

      const anchor =
        target.selectionMode === 'choice' || target.selectionMode === 'any'
          ? target.items[0]?.name || displayGroupTitle(target)
          : displayGroupTitle(target);

      if (target.selectionMode === 'choice' || target.selectionMode === 'any') {
        const kind = target.selectionMode === 'any' ? 'ANY' : 'OR';
        const move = await appConfirm({
          title: 'Already on this bundle',
          message:
            `${picked.name} is already on this bundle as its own line.\n\n` +
            `Move it into the ${kind} with “${anchor}”? We’ll remove the separate line so it isn’t charged twice.`,
          confirmLabel: `Move into this ${kind}`,
          cancelLabel: 'Cancel',
        });
        if (!move) {
          openPicker(groupKey);
          return;
        }

        onChange(
          tidyGroups(
            groups.map((g) => {
              if (g.key === existing.group.key) {
                return { ...g, items: g.items.filter((i) => i.key !== existing.item.key) };
              }
              if (g.key === groupKey) {
                return { ...g, items: [...g.items, existing.item] };
              }
              return g;
            }),
            groupKey,
          ),
        );
        openPicker(groupKey);
        return;
      }

      const nextQty = Math.max(1, (numOrNull(existing.item.quantity) ?? 1) + 1);
      onChange(
        groups.map((g) =>
          g.key === existing.group.key
            ? {
                ...g,
                items: g.items.map((i) =>
                  i.key === existing.item.key ? { ...i, quantity: String(nextQty) } : i,
                ),
              }
            : g,
        ),
      );
      await appAlert({
        title: 'Already on this bundle',
        message: `${picked.name} is already listed. Quantity is now ${nextQty}.`,
      });
      setPickerGroupKey(null);
    })();
  }

  function removeItem(groupKey: string, itemKey: string) {
    onChange(
      tidyGroups(
        groups.map((g) =>
          g.key === groupKey ? { ...g, items: g.items.filter((i) => i.key !== itemKey) } : g,
        ),
      ),
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

  function startNewItem() {
    const group = emptyBundleGroup('all');
    onChange([...tidyGroups(groups), group]);
    openPicker(group.key);
  }

  function startAnyGroup() {
    const group = emptyBundleGroup('any');
    group.name = defaultGroupLabel('any');
    onChange([...tidyGroups(groups), group]);
    openPicker(group.key);
  }

  return (
    <div className="bge">
      <p className="bge__lede">
          {context === 'bundle'
          ? 'The bundle name above is what you search for on an invoice. Lines below are what gets charged. Use the mode control on each group to choose Include all, OR (pick N), or ANY (optional checklist).'
          : 'Each line is included. Switch a group to OR when the member picks one of several options.'}
      </p>

      {groups.length === 0 && pickerGroupKey == null ? (
        <p className="bge__empty">No items yet. Add a catalog item to start.</p>
      ) : null}

      {groups.map((group, gi) => {
        const choice = group.selectionMode === 'choice';
        const anyMode = group.selectionMode === 'any';
        const pickAtSale = choice || anyMode;
        const picking = pickerGroupKey === group.key;
        return (
          <section
            key={group.key}
            className={`bge-group${choice ? ' bge-group--choice' : ''}${anyMode ? ' bge-group--any' : ''}`}
          >
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

              {choice || anyMode || context === 'bundle' || group.items.length > 0 ? (
                <>
                  <div className="bge-group__title-block">
                    <label className="bge-field bge-field--mode">
                      <span className="bge-field__label">Mode</span>
                      <select
                        className={`bge-mode-select${anyMode ? ' bge-mode-select--any' : ''}${
                          !choice && !anyMode ? ' bge-mode-select--all' : ''
                        }`}
                        value={group.selectionMode}
                        disabled={disabled}
                        aria-label="Group mode"
                        onChange={(e) =>
                          setGroupMode(group.key, e.target.value as GroupSelectionMode)
                        }
                      >
                        <option value="all">Include all</option>
                        <option value="choice">OR — pick at invoice</option>
                        {context === 'bundle' ? (
                          <option value="any">ANY — pick at invoice</option>
                        ) : null}
                      </select>
                    </label>
                    {choice || anyMode ? (
                      <label className="bge-field bge-field--grow">
                        <span className="bge-field__label">Label</span>
                        <input
                          className="bge-input"
                          value={group.name}
                          disabled={disabled}
                          placeholder={
                            anyMode
                              ? defaultGroupLabel('any')
                              : defaultGroupLabel('choice', group.allowedQuantity)
                          }
                          onChange={(e) => patchGroup(group.key, { name: e.target.value })}
                        />
                      </label>
                    ) : group.items.length === 1 ? (
                      <p className="bge-group__title-text">{displayGroupTitle(group)}</p>
                    ) : null}
                  </div>
                  {choice ? (
                    <div className="bge-group__meta">
                      <label className="bge-field bge-field--narrow">
                        <span className="bge-field__label">Picks</span>
                        <input
                          className="bge-input"
                          inputMode="numeric"
                          value={group.allowedQuantity}
                          disabled={disabled}
                          onChange={(e) => {
                            const allowedQuantity = e.target.value;
                            const patch: Partial<BundleGroupDraft> = { allowedQuantity };
                            if (isAutoGroupLabel(group)) {
                              patch.name = defaultGroupLabel('choice', allowedQuantity);
                            }
                            patchGroup(group.key, patch);
                          }}
                        />
                      </label>
                      <label className="bge-check">
                        <input
                          type="checkbox"
                          checked={group.isRequired !== false}
                          disabled={disabled}
                          onChange={(e) =>
                            patchGroup(group.key, { isRequired: e.target.checked })
                          }
                        />
                        <span>Required</span>
                      </label>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="bge-group__title-block">
                  <span className="bge-group__badge bge-group__badge--all">Always included</span>
                  {group.items.length === 1 ? (
                    <p className="bge-group__title-text">{displayGroupTitle(group)}</p>
                  ) : null}
                </div>
              )}

              <button
                type="button"
                className="bge-icon-btn"
                aria-label={`Remove ${displayGroupTitle(group)}`}
                disabled={disabled}
                onClick={() => {
                  if (pickerGroupKey === group.key) setPickerGroupKey(null);
                  onChange(groups.filter((g) => g.key !== group.key));
                }}
              >
                <Trash2 size={15} aria-hidden />
              </button>
            </header>

            {choice ? (
              <p className="bge-group__banner">
                {group.isRequired !== false ? (
                  <>
                    <strong>
                      Staff picks {numOrNull(group.allowedQuantity) ?? 1} of these{' '}
                      {group.items.length}
                    </strong>{' '}
                    when this bundle is added to an invoice.
                  </>
                ) : (
                  <>
                    <strong>Optional</strong> — staff may pick{' '}
                    {numOrNull(group.allowedQuantity) ?? 1} of these {group.items.length}, or skip.
                  </>
                )}
              </p>
            ) : anyMode ? (
              <p className="bge-group__banner bge-group__banner--any">
                <strong>Staff can check any, all, or none</strong> of these{' '}
                {group.items.length} when this bundle is added to an invoice.
              </p>
            ) : group.items.length > 1 ? (
              <p className="bge-group__banner bge-group__banner--all">
                <strong>All {group.items.length} always charged</strong> — switch Mode to OR or
                ANY to pick at invoice time instead.
              </p>
            ) : null}

            {group.items.length === 0 ? (
              <p className="bge__empty bge__empty--tight">Pick a catalog item below.</p>
            ) : (
              <ul className="bge-items">
                {group.items.flatMap((item, ii) => {
                  const row = (
                    <li key={item.key} className="bge-item">
                      {pickAtSale ? <span className="bge-item__dot" aria-hidden /> : null}
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
                            <span className="bge-field__label">{pickAtSale && choice ? 'Counts as' : 'Qty'}</span>
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
                          <label className="bge-field">
                            <span className="bge-field__label">Doctor production</span>
                            <select
                              className="bge-input"
                              value={item.productionBasis}
                              disabled={disabled}
                              onChange={(e) =>
                                patchItem(group.key, item.key, {
                                  productionBasis: e.target.value as ItemProductionBasis,
                                })
                              }
                            >
                              {PRODUCTION_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {item.productionBasis === 'custom' ? (
                            <label className="bge-field bge-field--narrow">
                              <span className="bge-field__label">Production $</span>
                              <input
                                className="bge-input"
                                inputMode="decimal"
                                value={item.productionOverride}
                                disabled={disabled}
                                onChange={(e) =>
                                  patchItem(group.key, item.key, {
                                    productionOverride: e.target.value,
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
                          {!disabled && group.selectionMode === 'all' ? (
                            <>
                              <button
                                type="button"
                                className="bge-or-btn"
                                title="Staff must pick one of several options"
                                onClick={() => addOr(group, item.key)}
                              >
                                OR
                              </button>
                              {context === 'bundle' ? (
                                <button
                                  type="button"
                                  className="bge-or-btn bge-or-btn--any"
                                  title="Staff can check any, all, or none"
                                  onClick={() => addAny(group, item.key)}
                                >
                                  ANY
                                </button>
                              ) : null}
                            </>
                          ) : !disabled && choice ? (
                            <button
                              type="button"
                              className="bge-or-btn"
                              title="Add another OR option"
                              onClick={() => addOr(group, item.key)}
                            >
                              OR
                            </button>
                          ) : null}
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

            {pickAtSale && !disabled ? (
              <div className="bge-group__add">
                <span className="bge-field__label">
                  {anyMode ? 'Add another ANY option' : 'Add another OR option'}
                </span>
                <CatalogItemPicker
                  key={`pick-${group.key}-${pickerFocusNonce}`}
                  practiceId={practiceId}
                  value={null}
                  disabled={disabled}
                  autoFocus={picking}
                  exclude={group.items.map((i) => ({
                    itemType: i.itemType,
                    catalogItemId: i.catalogItemId,
                  }))}
                  onChange={(picked) => {
                    if (picked) addItem(group.key, picked);
                  }}
                />
              </div>
            ) : picking ? (
              <div className="bge-group__add">
                <span className="bge-field__label">Add catalog item</span>
                <CatalogItemPicker
                  key={`pick-${group.key}-${pickerFocusNonce}`}
                  practiceId={practiceId}
                  value={null}
                  disabled={disabled}
                  autoFocus
                  exclude={group.items.map((i) => ({
                    itemType: i.itemType,
                    catalogItemId: i.catalogItemId,
                  }))}
                  onChange={(picked) => {
                    if (picked) addItem(group.key, picked);
                  }}
                />
                <button type="button" className="bge-link" onClick={closePicker}>
                  Done
                </button>
              </div>
            ) : !pickAtSale && !disabled && group.items.length > 0 ? (
              <button
                type="button"
                className="bge-link"
                onClick={() => openPicker(group.key)}
              >
                + Add another always-included item here
              </button>
            ) : null}
          </section>
        );
      })}

      <div className="bge__actions">
        <button
          type="button"
          className="bge-btn bge-btn--ghost"
          disabled={disabled}
          onClick={startNewItem}
        >
          <Plus size={14} aria-hidden />
          Add item
        </button>
        {context === 'bundle' ? (
          <button
            type="button"
            className="bge-btn bge-btn--accent"
            disabled={disabled}
            onClick={startAnyGroup}
          >
            <Plus size={14} aria-hidden />
            Add ANY group
          </button>
        ) : null}
      </div>
    </div>
  );
}
