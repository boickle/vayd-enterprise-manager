import type { VisitInvoiceLine } from '../api/visitWorkflow';

export function isInvoiceTagalongLine(line: {
  tagalongOfLineId?: string | null;
}): boolean {
  return Boolean(line.tagalongOfLineId);
}

/** Nest auto-added rebate / companion lines under the charge that triggered them. */
export function attachTagalongLines<
  T extends { id: string; tagalongOfLineId?: string | null },
>(lines: T[]): { parents: T[]; attached: Map<string, T[]>; leftover: T[] } {
  const parents = lines.filter((line) => !isInvoiceTagalongLine(line));
  const parentIds = new Set(parents.map((line) => line.id));
  const attached = new Map<string, T[]>();
  const leftover: T[] = [];
  for (const line of lines) {
    const parentId = line.tagalongOfLineId;
    if (!parentId) continue;
    if (!parentIds.has(parentId)) {
      leftover.push(line);
      continue;
    }
    const list = attached.get(parentId) ?? [];
    list.push(line);
    attached.set(parentId, list);
  }
  return { parents, attached, leftover };
}

export function tagalongChildIds(
  lines: Array<{ id: string; tagalongOfLineId?: string | null }>,
  parentId: string
): string[] {
  return lines.filter((line) => line.tagalongOfLineId === parentId).map((line) => line.id);
}

export function tagalongTaxHint(line: VisitInvoiceLine): string | null {
  if (line.tagalongTaxMode === 'before_tax') {
    return 'Included in the product tax';
  }
  if (line.tagalongOfLineId) {
    return 'After tax';
  }
  return null;
}
