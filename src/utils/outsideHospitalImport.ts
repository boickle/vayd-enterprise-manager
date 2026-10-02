import type { OutsideHospitalFields } from '../api/outsideHospitals';

export type ImportField = 'name' | 'address' | 'phone' | 'email' | 'notes';

export type ImportIssue = { level: 'error' | 'warning'; message: string };

export type ImportPreviewRow = {
  /** 1-based line in the pasted text or file, for "row 14 has no name". */
  line: number;
  fields: OutsideHospitalFields;
  issues: ImportIssue[];
};

export type ImportPreview = {
  headers: string[];
  /** Column index for each field, or -1 when the sheet has no such column. */
  mapping: Record<ImportField, number>;
  rows: ImportPreviewRow[];
  /** True when the first line looked like labels rather than a hospital. */
  usedHeaderRow: boolean;
};

const HEADER_SYNONYMS: Record<ImportField, string[]> = {
  name: ['hospital', 'hospital name', 'name', 'practice', 'clinic', 'vet', 'facility'],
  address: ['address', 'street', 'street address', 'location', 'addr', 'mailing address'],
  phone: ['phone', 'phone number', 'telephone', 'tel', 'phone #', 'fax / phone'],
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'contact email'],
  notes: ['notes', 'note', 'comments', 'comment', 'details'],
};

/** Column order in the practice's existing sheet, used when there's no header row. */
const POSITIONAL_ORDER: ImportField[] = ['name', 'address', 'phone', 'email', 'notes'];

const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

/**
 * Split one delimited line, honoring "quoted, fields" and doubled "" escapes.
 * Handles the whole text at once so a quoted field may span newlines.
 */
function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(field);
      field = '';
    } else if (char === '\r') {
      // Swallow; the \n that follows ends the row.
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  row.push(field);
  rows.push(row);

  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

/** Tabs win when present — that's what a copy out of Excel or Sheets produces. */
function detectDelimiter(text: string): string {
  const sample = text.slice(0, 5000);
  if (sample.includes('\t')) return '\t';
  const commas = (sample.match(/,/g) ?? []).length;
  const semicolons = (sample.match(/;/g) ?? []).length;
  return semicolons > commas ? ';' : ',';
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\s#-]/g, ' ').replace(/\s+/g, ' ').trim();
}

function mapHeaders(cells: string[]): {
  mapping: Record<ImportField, number>;
  matched: number;
} {
  const mapping: Record<ImportField, number> = {
    name: -1,
    address: -1,
    phone: -1,
    email: -1,
    notes: -1,
  };
  let matched = 0;
  cells.forEach((cell, index) => {
    const header = normalizeHeader(cell);
    if (!header) return;
    for (const field of POSITIONAL_ORDER) {
      if (mapping[field] !== -1) continue;
      if (HEADER_SYNONYMS[field].includes(header)) {
        mapping[field] = index;
        matched++;
        return;
      }
    }
  });
  return { mapping, matched };
}

function positionalMapping(width: number): Record<ImportField, number> {
  const mapping: Record<ImportField, number> = {
    name: -1,
    address: -1,
    phone: -1,
    email: -1,
    notes: -1,
  };
  POSITIONAL_ORDER.forEach((field, index) => {
    if (index < width) mapping[field] = index;
  });
  return mapping;
}

function cell(cells: string[], index: number): string {
  if (index < 0 || index >= cells.length) return '';
  return cells[index].replace(/\s+/g, ' ').trim();
}

/** Loose key matching the server's, so the preview's skip count is honest. */
export function hospitalDedupeKey(name: string, email: string | null | undefined): string {
  const normalizedName = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bhosp\b/g, 'hospital')
    .replace(/\bvet\b/g, 'veterinary')
    .replace(/\bmem\b/g, 'memorial')
    .replace(/\bctr\b/g, 'center')
    .replace(/\bclin\b/g, 'clinic')
    .replace(/\banml\b/g, 'animal');
  return `${normalizedName}|${(email ?? '').toLowerCase().trim()}`;
}

/**
 * Turn pasted spreadsheet cells or a CSV file into reviewable rows.
 * `existingKeys` comes from the directory already on screen so staff see what
 * would be skipped before they commit.
 */
export function buildImportPreview(
  text: string,
  existingKeys: Set<string> = new Set(),
): ImportPreview {
  const trimmed = text.replace(/^\uFEFF/, '').trim();
  if (!trimmed) {
    return {
      headers: [],
      mapping: positionalMapping(0),
      rows: [],
      usedHeaderRow: false,
    };
  }

  const table = splitDelimited(trimmed, detectDelimiter(trimmed));
  if (table.length === 0) {
    return {
      headers: [],
      mapping: positionalMapping(0),
      rows: [],
      usedHeaderRow: false,
    };
  }

  const width = Math.max(...table.map((cells) => cells.length));
  const headerAttempt = mapHeaders(table[0]);
  const usedHeaderRow = headerAttempt.matched >= 2;
  const mapping = usedHeaderRow ? headerAttempt.mapping : positionalMapping(width);
  const headers = usedHeaderRow
    ? table[0].map((c) => c.trim())
    : POSITIONAL_ORDER.slice(0, width).map((f) => f);
  const body = usedHeaderRow ? table.slice(1) : table;
  const lineOffset = usedHeaderRow ? 2 : 1;

  const seen = new Set(existingKeys);
  const rows: ImportPreviewRow[] = body.map((cells, index) => {
    const name = cell(cells, mapping.name);
    const rawEmail = cell(cells, mapping.email);
    const email = rawEmail.toLowerCase();
    const issues: ImportIssue[] = [];

    if (!name) {
      issues.push({ level: 'error', message: 'No hospital name' });
    }
    if (rawEmail && !EMAIL_RE.test(email)) {
      issues.push({ level: 'warning', message: `“${rawEmail}” is not a valid email` });
    } else if (!rawEmail) {
      issues.push({ level: 'warning', message: 'No email — records must be requested by phone' });
    }

    const usableEmail = rawEmail && EMAIL_RE.test(email) ? email : null;
    if (name) {
      const key = hospitalDedupeKey(name, usableEmail);
      if (seen.has(key)) {
        issues.push({ level: 'error', message: 'Already in the directory' });
      } else {
        seen.add(key);
      }
    }

    return {
      line: index + lineOffset,
      fields: {
        name,
        email: usableEmail,
        phone: cell(cells, mapping.phone) || null,
        address: cell(cells, mapping.address) || null,
        notes: cell(cells, mapping.notes) || null,
      },
      issues,
    };
  });

  return { headers, mapping, rows, usedHeaderRow };
}

export function isImportable(row: ImportPreviewRow): boolean {
  return !row.issues.some((issue) => issue.level === 'error');
}
