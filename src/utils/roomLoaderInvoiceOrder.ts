/**
 * Invoice order for Room Loader items (owner request, Nov 13, 2026).
 *
 * Every pet's items are listed in the practice's standard invoice order
 * (Settings → Room Loader → Invoice order): trip fee, exam, vaccines, labs,
 * procedures, meds, store items. Staff may move an item on one Room Loader;
 * the client form, the PDF and the visit invoice keep that order.
 */

export type InvoiceCategoryKey =
  | 'trip'
  | 'exam'
  | 'vaccine'
  | 'lab'
  | 'procedure'
  | 'med'
  | 'store';
/**
 * `other`: fits no category, listed after every category. `sharps`: sharps disposal, always
 * the pet's last line, after whatever caused it (owner, Nov 13, 2026).
 */
export type InvoiceCategory = InvoiceCategoryKey | 'other' | 'sharps';

export const DEFAULT_INVOICE_CATEGORY_ORDER: InvoiceCategoryKey[] = [
  'trip',
  'exam',
  'vaccine',
  'lab',
  'procedure',
  'med',
  'store',
];

export const INVOICE_CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  trip: 'Trip fee',
  exam: 'Exam',
  vaccine: 'Vaccines',
  lab: 'Labs',
  procedure: 'Procedures',
  med: 'Meds',
  store: 'Store items',
  other: 'Other',
  sharps: 'Sharps disposal',
};

export const INVOICE_CATEGORY_DESCRIPTIONS: Record<InvoiceCategoryKey, string> = {
  trip: 'Trip fees (any item named "Trip Fee")',
  exam: 'Visits, exams and consults',
  vaccine: 'Every vaccine, including rabies',
  lab: 'Lab tests, in-house and outside',
  procedure: 'Procedures done outside the exam (nail trim, X-rays)',
  med: 'Injections and medications',
  store: 'Products the client adds from the store on the check-in form',
};

export type RoomLoaderInvoiceOrderConfig = {
  /** Category order, top of the invoice first. Always holds every category once. */
  categories: InvoiceCategoryKey[];
};

export function defaultInvoiceOrderConfig(): RoomLoaderInvoiceOrderConfig {
  return { categories: [...DEFAULT_INVOICE_CATEGORY_ORDER] };
}

/** Known categories once each, in the stored order; any missing ones go where the default puts them last. */
export function normalizeInvoiceCategoryOrder(raw: unknown): InvoiceCategoryKey[] {
  const known = new Set<string>(DEFAULT_INVOICE_CATEGORY_ORDER);
  const out: InvoiceCategoryKey[] = [];
  if (Array.isArray(raw)) {
    for (const value of raw) {
      if (
        typeof value === 'string' &&
        known.has(value) &&
        !out.includes(value as InvoiceCategoryKey)
      ) {
        out.push(value as InvoiceCategoryKey);
      }
    }
  }
  for (const key of DEFAULT_INVOICE_CATEGORY_ORDER) {
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

export function normalizeInvoiceOrderConfig(raw: unknown): RoomLoaderInvoiceOrderConfig {
  const categories =
    raw && typeof raw === 'object' ? (raw as { categories?: unknown }).categories : undefined;
  return { categories: normalizeInvoiceCategoryOrder(categories) };
}

export type InvoiceCategoryInput = {
  name?: string | null;
  code?: string | null;
  /** Catalog type: lab | procedure | inventory. */
  itemType?: string | null;
  /** Inventory category name (e.g. "Vaccines", "Lab - Outside"). */
  categoryName?: string | null;
  /** A product the client added from the online store. */
  isStore?: boolean;
};

const TRIP_FEE = /trip\s*fee|tripfee/i;
const EXAM = /\b(exam|exams|visit|consult|consultation|check-?up|wellness)\b/i;
const NOT_EXAM =
  /pedicure|nail|urn|paw print|refund|\$\d+ off|discount|cancellation|no-?show|cytology/i;
const VACCINE = /vaccin/i;
const LAB_INVENTORY_NAME = /\b4\s*-?dx\b/i;
const SHARPS = /sharps/i;

/** Which invoice category a catalog line belongs to. Name rules cover procedures, which carry no category. */
export function invoiceCategoryFor(input: InvoiceCategoryInput): InvoiceCategory {
  if (input.isStore) return 'store';
  const name = `${input.name ?? ''}`.trim();
  const code = `${input.code ?? ''}`.trim();
  const type = `${input.itemType ?? ''}`.trim().toLowerCase();
  const categoryName = `${input.categoryName ?? ''}`.trim();

  if (SHARPS.test(name)) return 'sharps';
  if (TRIP_FEE.test(name) || TRIP_FEE.test(code)) return 'trip';
  if (type === 'lab' || type === 'laboratory') return 'lab';
  if (type === 'inventory') {
    if (/^lab\b/i.test(categoryName) || LAB_INVENTORY_NAME.test(name)) return 'lab';
    if (VACCINE.test(categoryName) || VACCINE.test(name)) return 'vaccine';
    return 'med';
  }
  if (type === 'procedure') {
    if (EXAM.test(name) && !NOT_EXAM.test(name)) return 'exam';
    return 'procedure';
  }
  // No catalog type (a synthetic visit line, an old saved row): go by the name.
  if (VACCINE.test(name)) return 'vaccine';
  if (EXAM.test(name) && !NOT_EXAM.test(name)) return 'exam';
  return 'other';
}

export function invoiceCategoryRank(
  category: InvoiceCategory,
  order: InvoiceCategoryKey[]
): number {
  if (category === 'sharps') return order.length + 1;
  if (category === 'other') return order.length;
  const rank = order.indexOf(category);
  return rank < 0 ? order.length : rank;
}

export type InvoiceOrderLine = { key: string; category: InvoiceCategory };

/** Standard order: by category, keeping each category's lines in the order given. */
export function standardInvoiceOrderKeys(
  lines: InvoiceOrderLine[],
  order: InvoiceCategoryKey[]
): string[] {
  return lines
    .map((line, index) => ({ line, index }))
    .sort(
      (a, b) =>
        invoiceCategoryRank(a.line.category, order) - invoiceCategoryRank(b.line.category, order) ||
        a.index - b.index
    )
    .map(({ line }) => line.key);
}

/**
 * Where a line goes in an order staff already arranged: after the last line of its own
 * category, else after the last line of an earlier category, else at the top.
 */
export function placeLineInOrder(
  keys: string[],
  line: InvoiceOrderLine,
  categoryOf: (key: string) => InvoiceCategory | undefined,
  order: InvoiceCategoryKey[]
): string[] {
  const out = keys.filter((k) => k !== line.key);
  let at = -1;
  out.forEach((key, i) => {
    if (categoryOf(key) === line.category) at = i + 1;
  });
  if (at < 0) {
    const rank = invoiceCategoryRank(line.category, order);
    at = 0;
    out.forEach((key, i) => {
      const cat = categoryOf(key);
      if (cat != null && invoiceCategoryRank(cat, order) < rank) at = i + 1;
    });
  }
  out.splice(at, 0, line.key);
  return out;
}

/** Sharps disposal always ends the list, whatever staff arranged. */
function sharpsLast(
  keys: string[],
  categoryOf: (key: string) => InvoiceCategory | undefined
): string[] {
  return [
    ...keys.filter((k) => categoryOf(k) !== 'sharps'),
    ...keys.filter((k) => categoryOf(k) === 'sharps'),
  ];
}

/**
 * The order to show. With no saved arrangement it is the standard order. With one, saved keys
 * that still exist keep their places; lines added since are slotted in by category.
 */
export function reconcileInvoiceOrder(
  savedKeys: string[] | null | undefined,
  lines: InvoiceOrderLine[],
  order: InvoiceCategoryKey[]
): string[] {
  const standard = standardInvoiceOrderKeys(lines, order);
  if (!savedKeys || savedKeys.length === 0) return standard;
  const byKey = new Map(lines.map((l) => [l.key, l]));
  let keys = savedKeys.filter((k, i) => byKey.has(k) && savedKeys.indexOf(k) === i);
  const categoryOf = (key: string) => byKey.get(key)?.category;
  for (const key of standard) {
    if (!keys.includes(key)) keys = placeLineInOrder(keys, byKey.get(key)!, categoryOf, order);
  }
  return sharpsLast(keys, categoryOf);
}

export function isStandardInvoiceOrder(
  keys: string[],
  lines: InvoiceOrderLine[],
  order: InvoiceCategoryKey[]
): boolean {
  const standard = standardInvoiceOrderKeys(lines, order);
  return keys.length === standard.length && keys.every((k, i) => k === standard[i]);
}

/** Move one key to another index (drag and drop, or the arrows). */
export function moveInvoiceOrderKey(keys: string[], key: string, toIndex: number): string[] {
  const from = keys.indexOf(key);
  if (from < 0 || toIndex < 0 || toIndex >= keys.length || from === toIndex) return keys;
  const out = [...keys];
  out.splice(from, 1);
  out.splice(toIndex, 0, key);
  return out;
}

/**
 * Client form and PDF: staff lines keep the order staff sent (`staffKeys`); lines the client
 * added on the form (panels, vaccines, add-ons) are slotted in by category. Lines without a
 * staff position (a form sent before this change) are placed by category too.
 */
export function mergeClientLinesIntoStaffOrder(
  lines: Array<InvoiceOrderLine & { staffPosition?: number | null }>,
  order: InvoiceCategoryKey[]
): string[] {
  const staff = lines
    .filter((l) => l.staffPosition != null && Number.isFinite(Number(l.staffPosition)))
    .sort((a, b) => Number(a.staffPosition) - Number(b.staffPosition));
  const byKey = new Map(lines.map((l) => [l.key, l]));
  const categoryOf = (key: string) => byKey.get(key)?.category;
  let keys = staff.map((l) => l.key);
  const rest = lines.filter((l) => !keys.includes(l.key));
  const restStandard = standardInvoiceOrderKeys(rest, order);
  if (keys.length === 0) return restStandard;
  for (const key of restStandard) keys = placeLineInOrder(keys, byKey.get(key)!, categoryOf, order);
  return sharpsLast(keys, categoryOf);
}

/** Sort any rows by an ordered key list; rows whose key is not listed keep their relative order at the end. */
export function sortByKeyOrder<T>(rows: T[], keyOf: (row: T) => string, keys: string[]): T[] {
  const pos = new Map(keys.map((k, i) => [k, i]));
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const pa = pos.get(keyOf(a.row)) ?? keys.length + a.index;
      const pb = pos.get(keyOf(b.row)) ?? keys.length + b.index;
      return pa - pb;
    })
    .map(({ row }) => row);
}
