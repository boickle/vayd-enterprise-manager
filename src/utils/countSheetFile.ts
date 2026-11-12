import type { FirstCountRow, FirstCountSheet, FirstCountSheetItem } from '../api/branchInventory';

/** Tab staff fill in. The upload reads this tab and ignores the Directions tab. */
export const COUNT_TAB = 'Count sheet';
export const DIRECTIONS_TAB = 'Directions';

export const COUNT_SHEET_HEADER = [
  'Code',
  'Item',
  'Unit',
  'Category',
  'Controlled',
  'Lot # required',
  'Count',
  'Lot #',
  'Expiration',
  'Notes',
] as const;

export const COUNT_SHEET_DIRECTIONS: string[] = [
  'How to fill in this count sheet',
  '',
  'Fill in the "Count sheet" tab (the second tab). Do not rename that tab or change its header row. This Directions tab is ignored when the file is uploaded.',
  '',
  'Count what is physically on the shelf, in the unit shown in the Unit column (tablets, not bottles; mL, not vials).',
  'Controlled drugs are counted in mL: add up full bottles plus your best reading of any open bottle. Example: two full 10 mL vials and one with about 4 mL left = 24.',
  'Write 0 if there is none. Leave Count blank only if you did not count that item.',
  "Each lot Scout has on the shelf has its own row, with Lot # and Expiration filled in. Write 0 for a lot that is gone. A blank lot row keeps Scout's amount, except for controlled drugs, where every lot needs a count.",
  '',
  'Lot # and Expiration are required on every row where "Lot # required" says Yes (vaccines, injectables and controlled drugs). Copy them from the bottle, vial or box. For other items, fill them in if they are on the package.',
  'Expiration can be month/year, e.g. 3/2027 (it means the end of that month).',
  '',
  "A lot that is not listed? Use one row per lot. Copy the item's row, insert it right below, keep the same Code, and enter that lot's Count, Lot # and Expiration. Do not add lots together on one row.",
  'Count every lot of an item at the same time.',
  '',
  "Something on the shelf that is not on the list? Add a row at the bottom with the item's name (or its code if you know it), plus its Count, Lot # and Expiration.",
  '',
  'Save the file as an Excel workbook (.xlsx) and upload it on Inventory → First counts, or send it to your inventory manager.',
];

export function sortForSheet(items: FirstCountSheetItem[]): FirstCountSheetItem[] {
  return items.slice().sort((a, b) => {
    if (a.isControlled !== b.isControlled) return a.isControlled ? -1 : 1;
    const ca = a.categoryName || 'Uncategorized';
    const cb = b.categoryName || 'Uncategorized';
    if (ca !== cb) return ca.localeCompare(cb);
    return a.name.localeCompare(b.name);
  });
}

/** 2027-03-31 → 3/31/2027, as staff write it. */
function sheetExp(iso: string | null): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : String(iso ?? '');
}

export function countSheetFileName(sheet: FirstCountSheet): string {
  const slug = `${sheet.branchName}-${sheet.locationName}`
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase();
  return `count-sheet-${slug}.xlsx`;
}

/** Downloads the count sheet as an Excel workbook with a Count sheet tab and a Directions tab. */
export async function downloadCountSheetXlsx(
  sheet: FirstCountSheet,
  items: FirstCountSheetItem[]
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const header = COUNT_SHEET_HEADER.map((h) => ({
    value: h,
    fontWeight: 'bold' as const,
    backgroundColor: '#EEF2F7',
  }));
  // Lot # and Expiration are text so Excel keeps "0123" and "3/2027" as typed.
  const text = (value: string | null | undefined, extra: Record<string, unknown> = {}) => ({
    value: value ?? '',
    type: String,
    format: '@',
    ...extra,
  });
  // One row per lot already on the shelf (lot # and expiration filled in), or one blank row.
  const rows = sortForSheet(items).flatMap((i) => {
    const need = i.requireLotNumber ? { backgroundColor: '#FFF7D6' } : {};
    const lots = i.lots?.length ? i.lots : [null];
    return lots.map((lot) => [
      text(i.code),
      text(i.name),
      text(i.unit),
      text(i.categoryName),
      text(i.isControlled ? 'Yes' : ''),
      text(i.requireLotNumber ? 'Yes' : ''),
      text(''),
      text(lot?.lotNumber ?? '', lot ? {} : need),
      text(lot ? sheetExp(lot.expirationDate) : '', lot ? {} : need),
      text(''),
    ]);
  });
  const directions = COUNT_SHEET_DIRECTIONS.map((line, n) => [
    { value: line, fontWeight: n === 0 ? ('bold' as const) : undefined, wrap: true },
  ]);
  // Directions first so Excel opens on it; the upload still reads only the Count sheet tab.
  await writeXlsxFile([
    { data: directions as never, sheet: DIRECTIONS_TAB, columns: [{ width: 110 }], stickyRowsCount: 1 },
    {
      data: [header, ...rows] as never,
      sheet: COUNT_TAB,
      columns: [18, 36, 8, 26, 11, 15, 10, 16, 13, 30].map((width) => ({ width })),
      stickyRowsCount: 1,
    },
  ]).toFile(countSheetFileName(sheet));
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF. */
export function parseCsv(text: string): string[][] {
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

/** Turns a header row plus data rows (from CSV or Excel) into count rows. */
export function rowsFromTable(table: string[][]): { rows: FirstCountRow[]; error: string | null } {
  if (table.length < 2) return { rows: [], error: 'The file has no rows under the header.' };
  const header = table[0].map((h) =>
    String(h ?? '')
      .trim()
      .toLowerCase()
  );
  const find = (...names: RegExp[]) => header.findIndex((h) => names.some((n) => n.test(h)));
  const col = {
    code: find(/^code$/, /item code/, /^sku$/),
    name: find(/^item$/, /^name$/, /item name/, /description/),
    qty: find(/^count$/, /counted/, /^qty$/, /quantity/, /on ?hand/),
    // Older CSV sheets had weight columns; still read them so those files upload.
    weight: find(/^weight$/, /weighed/),
    bottles: find(/bottle/),
    lot: find(/^lot ?#?$/, /lot (number|no)/),
    exp: find(/^exp/, /expiration/),
    note: find(/note/),
  };
  if (col.qty < 0 && col.weight < 0) {
    return { rows: [], error: 'Could not find a "Count" column in the header row.' };
  }
  if (col.code < 0 && col.name < 0) {
    return { rows: [], error: 'Could not find a "Code" or "Item" column in the header row.' };
  }
  const get = (r: string[], i: number) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const rows = table
    .slice(1)
    .map((r, i) => ({ r, rowNumber: i + 2 }))
    .filter(({ r }) => r.some((c) => String(c ?? '').trim() !== ''))
    .map(({ r, rowNumber }) => ({
      rowNumber,
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

/** Excel cell → text. Dates (if Excel converted one) become YYYY-MM-DD. */
export function excelCellText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return '';
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : '';
  return String(value);
}

/**
 * Order to try tabs in: "Count sheet" first, then any other tab except Directions.
 * Returns tab names as they appear in the file.
 */
export function countTabCandidates(sheetNames: string[]): string[] {
  const norm = (s: string) => s.trim().toLowerCase();
  const preferred = sheetNames.filter((n) => norm(n) === norm(COUNT_TAB));
  const others = sheetNames.filter(
    (n) => norm(n) !== norm(COUNT_TAB) && norm(n) !== norm(DIRECTIONS_TAB)
  );
  return [...preferred, ...others];
}

/** Reads a filled-in count sheet: .xlsx (Count sheet tab) or the older .csv. */
export async function readCountSheetFile(
  file: File
): Promise<{ rows: FirstCountRow[]; error: string | null }> {
  if (!/\.xlsx$/i.test(file.name)) {
    if (/\.xls$/i.test(file.name)) {
      return { rows: [], error: 'Save the file as an Excel workbook (.xlsx), not .xls.' };
    }
    return rowsFromTable(parseCsv(await file.text()));
  }
  const { default: readXlsxFile, readSheetNames } = await import('read-excel-file');
  const names = await readSheetNames(file);
  const tabs = countTabCandidates(names);
  if (!tabs.length) {
    return { rows: [], error: `Could not find the "${COUNT_TAB}" tab.` };
  }
  let firstError: string | null = null;
  for (const tab of tabs) {
    const data = await readXlsxFile(file, { sheet: tab });
    const table = data.map((row) => row.map(excelCellText));
    const result = rowsFromTable(table);
    if (!result.error) return result;
    firstError ??= `${tab} tab: ${result.error}`;
  }
  return { rows: [], error: firstError };
}
