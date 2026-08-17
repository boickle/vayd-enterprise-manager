import { useEffect, useMemo, useState } from 'react';
import {
  getItemWithPriceBreaks,
  type InventoryItem,
  type SearchResultItem,
} from '../api/quantityPriceBreaks';

export type StockItemGroup = {
  /** Item that actually holds stock; movements must target this id. */
  stockItemId: number;
  label: string;
  /** Sellable codes in the results that draw down this stock item. */
  viaNames: string[];
  /**
   * True when this row is a name match with no outbound stock link
   * (self-stocked inventory, or a charge code missing its association).
   */
  noStockLink: boolean;
  item?: InventoryItem;
};

export async function loadInventoryItem(
  practiceId: number,
  itemId: number
): Promise<InventoryItem> {
  const res = await getItemWithPriceBreaks('inventory', itemId, practiceId);
  return res.item as InventoryItem;
}

/**
 * Collapse catalog search for Receive / Move / Waste.
 *
 * Show a row when:
 * - the name matches and the item has no stock link (draws on itself) — includes
 *   true stock items and charge codes that still need a “Draws from” set; or
 * - the name matches a linked charge code — resolve to that stock item (hub).
 *
 * Linked charge codes never appear as their own rows; unlinked ones do, so staff
 * can still receive them and notice the missing association.
 */
export function useStockItemGroups(
  rows: SearchResultItem[],
  practiceId: number
): StockItemGroup[] {
  const [resolved, setResolved] = useState<Record<number, InventoryItem>>({});

  const base = useMemo(() => {
    const byStockId = new Map<
      number,
      {
        stockItemId: number;
        item?: InventoryItem;
        viaNames: string[];
        /** Name matched an item with no outbound link. */
        matchedUnlinked: boolean;
      }
    >();

    for (const row of rows) {
      const inv = row.inventoryItem;
      if (!inv?.id) continue;

      const linkedId =
        inv.linkedInventoryItemId != null && Number(inv.linkedInventoryItemId) > 0
          ? Number(inv.linkedInventoryItemId)
          : null;
      const stockItemId = linkedId ?? inv.id;
      const entry = byStockId.get(stockItemId) ?? {
        stockItemId,
        viaNames: [],
        matchedUnlinked: false,
      };

      if (linkedId == null) {
        entry.item = inv;
        entry.matchedUnlinked = true;
      } else {
        entry.viaNames.push(String(inv.name ?? row.name));
      }
      byStockId.set(stockItemId, entry);
    }

    return [...byStockId.values()];
  }, [rows]);

  const missingIds = [
    ...new Set(
      base.flatMap((g) => {
        const ids: number[] = [];
        if (!g.item && !resolved[g.stockItemId]) ids.push(g.stockItemId);
        const known = g.item ?? resolved[g.stockItemId];
        const root =
          known?.linkedInventoryItemId != null &&
          Number(known.linkedInventoryItemId) > 0
            ? Number(known.linkedInventoryItemId)
            : null;
        if (root != null && !resolved[root] && !base.some((x) => x.item?.id === root)) {
          ids.push(root);
        }
        return ids;
      })
    ),
  ].join(',');

  useEffect(() => {
    if (!missingIds) return;
    const ids = missingIds.split(',').map(Number);
    let cancelled = false;
    void (async () => {
      const loaded: Record<number, InventoryItem> = {};
      await Promise.all(
        ids.map(async (id) => {
          try {
            loaded[id] = await loadInventoryItem(practiceId, id);
          } catch {
            // Unresolved ids fall back to a numeric label.
          }
        })
      );
      if (!cancelled && Object.keys(loaded).length) {
        setResolved((prev) => ({ ...prev, ...loaded }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [missingIds, practiceId]);

  const groups = base.map((g) => {
    const item = g.item ?? resolved[g.stockItemId];
    const rootId =
      item?.linkedInventoryItemId != null && Number(item.linkedInventoryItemId) > 0
        ? Number(item.linkedInventoryItemId)
        : g.stockItemId;
    const rootItem =
      rootId === g.stockItemId ? item : resolved[rootId] ?? item;
    return {
      stockItemId: rootId,
      item: rootItem,
      label: rootItem?.name ? String(rootItem.name) : `Item #${rootId}`,
      viaNames: g.viaNames,
      matchedUnlinked: g.matchedUnlinked,
      isHub: g.viaNames.length > 0,
    };
  });

  const merged = new Map<number, (typeof groups)[number]>();
  for (const g of groups) {
    const prev = merged.get(g.stockItemId);
    if (!prev) {
      merged.set(g.stockItemId, g);
      continue;
    }
    merged.set(g.stockItemId, {
      ...prev,
      item: prev.item ?? g.item,
      label: prev.item?.name ? prev.label : g.label,
      viaNames: [...new Set([...prev.viaNames, ...g.viaNames])],
      matchedUnlinked: prev.matchedUnlinked || g.matchedUnlinked,
      isHub: prev.isHub || g.isHub,
    });
  }

  // Name match with no stock link, OR resolved stock hub from a linked match.
  const visible = [...merged.values()].filter(
    (g) => g.matchedUnlinked || g.isHub
  );

  return visible
    .map(({ stockItemId, item, label, viaNames, matchedUnlinked, isHub }) => ({
      stockItemId,
      item,
      label,
      viaNames,
      // Unlinked name match that isn't also a hub for other codes in this search.
      noStockLink: matchedUnlinked && !isHub,
    }))
    .sort((a, b) => {
      // Stock hubs first, then unlinked / missing-association rows.
      if (a.noStockLink !== b.noStockLink) return a.noStockLink ? 1 : -1;
      return a.label.localeCompare(b.label);
    });
}
