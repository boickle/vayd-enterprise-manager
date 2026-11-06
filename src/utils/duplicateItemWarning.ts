// Owner decision D4 (Nov 2, 2026; scope changed Nov 3, 2026): the same catalog item for the same
// pet entered on the same invoice on the same day (from the SOAP or directly on the invoice,
// counter sales included), or already on the visit's estimate, comes back 409 from the API with
// the entries already there. Hand entry shows them with "Add anyway"; automatic paths skip
// instead. Qty 2 on one line never warns.
import { appConfirm } from './appDialog';

export type DuplicateEntry = {
  source: 'soap_order' | 'estimate_line' | 'invoice_line';
  id: string;
  description: string;
  qty: number;
  status: string | null;
  created: string | null;
};

/**
 * `ask` (hand entry): show the entries with Add anyway / Cancel. `skip` (automatic, e.g. a refill
 * copied onto the invoice): never add it. `allow`: the same units split over two lines (sending
 * part of a line to mail order), which is not a second entry: sent with `confirmDuplicate`.
 */
export type DuplicateMode = 'ask' | 'skip' | 'allow';

export type DuplicateOptions = { duplicates?: DuplicateMode };

/** Thrown when a duplicate was not added: staff pressed Cancel, or an automatic path skipped it. */
export class DuplicateItemSkipped extends Error {
  readonly entries: DuplicateEntry[];
  constructor(entries: DuplicateEntry[]) {
    super('Not added: it was already entered for this pet.');
    this.name = 'DuplicateItemSkipped';
    this.entries = entries;
  }
}

export function isDuplicateItemSkipped(e: unknown): e is DuplicateItemSkipped {
  return e instanceof DuplicateItemSkipped;
}

type DuplicateResponse = {
  response?: { status?: number; data?: { code?: string; duplicates?: unknown; message?: unknown } };
};

/** The entries from a duplicate-item 409, or null for any other error. */
export function duplicateEntriesFrom(e: unknown): DuplicateEntry[] | null {
  const res = (e as DuplicateResponse)?.response;
  if (res?.status !== 409 || res.data?.code !== 'duplicate_item') return null;
  return Array.isArray(res.data.duplicates) ? (res.data.duplicates as DuplicateEntry[]) : [];
}

const DEFAULT_REASON = 'This item was already entered for this pet today on this invoice.';

/** The server's sentence for what counts as a duplicate here (invoice today, or the visit). */
function duplicateReason(e: unknown): string {
  const message = (e as DuplicateResponse)?.response?.data?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : DEFAULT_REASON;
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
 * `allow` sends with `confirmDuplicate: true` straight away.
 */
export async function sendWithDuplicateWarning<T>(
  send: (confirmDuplicate: boolean) => Promise<T>,
  opts: DuplicateOptions & { itemName?: string } = {}
): Promise<T> {
  if (opts.duplicates === 'allow') return send(true);
  try {
    return await send(false);
  } catch (e) {
    const entries = duplicateEntriesFrom(e);
    if (!entries) throw e;
    if (opts.duplicates === 'skip') throw new DuplicateItemSkipped(entries);
    const name = opts.itemName?.trim();
    const ok = await appConfirm({
      title: 'Already entered for this pet',
      message: `${name ? `“${name}”: ` : ''}${duplicateReason(e)} Already there:`,
      listItems: entries.map(describeDuplicate),
      confirmLabel: 'Add anyway',
      cancelLabel: 'Cancel',
    });
    if (!ok) throw new DuplicateItemSkipped(entries);
    return send(true);
  }
}
