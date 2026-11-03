// Owner decision D4 (Nov 2, 2026): the same catalog item for the same pet on the same visit
// (SOAP orders, estimate lines, invoice lines) comes back 409 from the API with the entries
// already there. Hand entry shows them with "Add anyway"; automatic paths skip instead.
import { appConfirm } from './appDialog';

export type DuplicateEntry = {
  source: 'soap_order' | 'estimate_line' | 'invoice_line';
  id: string;
  description: string;
  qty: number;
  status: string | null;
  created: string | null;
};

/** `ask` (hand entry): show the entries with Add anyway / Cancel. `skip` (automatic): never add it. */
export type DuplicateMode = 'ask' | 'skip';

export type DuplicateOptions = { duplicates?: DuplicateMode };

/** Thrown when a duplicate was not added: staff pressed Cancel, or an automatic path skipped it. */
export class DuplicateItemSkipped extends Error {
  readonly entries: DuplicateEntry[];
  constructor(entries: DuplicateEntry[]) {
    super('Not added: it is already on this visit for this pet.');
    this.name = 'DuplicateItemSkipped';
    this.entries = entries;
  }
}

export function isDuplicateItemSkipped(e: unknown): e is DuplicateItemSkipped {
  return e instanceof DuplicateItemSkipped;
}

/** The entries from a duplicate-item 409, or null for any other error. */
export function duplicateEntriesFrom(e: unknown): DuplicateEntry[] | null {
  const res = (e as { response?: { status?: number; data?: { code?: string; duplicates?: unknown } } })
    ?.response;
  if (res?.status !== 409 || res.data?.code !== 'duplicate_item') return null;
  return Array.isArray(res.data.duplicates) ? (res.data.duplicates as DuplicateEntry[]) : [];
}

const SOURCE_LABEL: Record<DuplicateEntry['source'], string> = {
  soap_order: 'SOAP order',
  estimate_line: 'Estimate',
  invoice_line: 'Invoice',
};

export function describeDuplicate(entry: DuplicateEntry): string {
  const qty = Number(entry.qty) || 0;
  const status = entry.status ? ` (${entry.status})` : '';
  return `${SOURCE_LABEL[entry.source] ?? entry.source}: ${entry.description}${
    qty && qty !== 1 ? ` × ${qty}` : ''
  }${status}`;
}

/**
 * Send once; on a duplicate-item 409 ask (or skip). "Add anyway" resends with
 * `confirmDuplicate: true`; Cancel adds nothing and throws {@link DuplicateItemSkipped}.
 */
export async function sendWithDuplicateWarning<T>(
  send: (confirmDuplicate: boolean) => Promise<T>,
  opts: DuplicateOptions & { itemName?: string } = {}
): Promise<T> {
  try {
    return await send(false);
  } catch (e) {
    const entries = duplicateEntriesFrom(e);
    if (!entries) throw e;
    if (opts.duplicates === 'skip') throw new DuplicateItemSkipped(entries);
    const name = opts.itemName?.trim();
    const ok = await appConfirm({
      title: 'Already on this visit',
      message: `${name ? `“${name}”` : 'This item'} is already on this visit for this pet:`,
      listItems: entries.map(describeDuplicate),
      confirmLabel: 'Add anyway',
      cancelLabel: 'Cancel',
    });
    if (!ok) throw new DuplicateItemSkipped(entries);
    return send(true);
  }
}
